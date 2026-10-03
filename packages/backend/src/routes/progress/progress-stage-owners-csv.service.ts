import type { Context } from "hono";
import type { Env } from "../../types/env";
import type { ProgressService } from "./progress.service";
import { PROGRESS_STAGE_KEYS, PROGRESS_STAGE_LABELS, type ProgressStageKey } from "./progress.schema";
import { CRLF, csvField, withBom } from "../../platform/csv/csv-writer";
import { parseCsv } from "../../platform/csv/csv-parser";
import { BadRequestError } from "../../platform/http/http-error";

// 出力する列。stageLabel・assigneeNameは人が読むための参考列で、取込では無視する
export const STAGE_OWNERS_CSV_HEADERS = ["stageKey", "stageLabel", "assigneeType", "assigneeRef", "assigneeName"] as const;
const REQUIRED_COLUMNS = ["stageKey", "assigneeType", "assigneeRef"] as const;
const ASSIGNEE_TYPES = ["USER", "ROLE", "DEPT_ROLE"] as const;
type AssigneeType = (typeof ASSIGNEE_TYPES)[number];
const MAX_REPORTED_ERRORS = 20;

interface OwnerRow {
  stageKey: ProgressStageKey;
  assigneeType: AssigneeType;
  assigneeRef: string;
}

// 工程ごとの既定担当のCSV出力・取込。出力は全12工程(未設定の工程は担当が空欄)で、そのまま編集して再取込できる。
//   assigneeType: USER(assigneeRef=社員番号) / ROLE(ロールID) / DEPT_ROLE(部署コード:ロールID)。
//   DEPT_ROLEの部署は「部署コード(部署マスタのid。例: 0041)」で指定する(内部IDも受け付ける)。担当設定自体は部署の
//   内部IDで保存するため、取込時に変換し、出力時は部署コードに戻す
//   取込: CSVに含まれる工程のみ更新する。assigneeType・assigneeRefが両方空欄の工程は未設定に戻す。
//   CSVに無い工程は変更しない。書き込み前に全行を検証し、1件でも不正なら何も反映しない
export class StageOwnersCsvService {
  private progress: ProgressService;

  constructor(progress: ProgressService) {
    this.progress = progress;
  }

  async exportCsv(): Promise<string> {
    const owners = await this.progress.getStageOwners();
    const byStage = new Map(owners.map((o) => [o.stageKey, o]));
    const deptCodes = await this.progress.getDepartmentCodes(
      owners.filter((o) => o.assigneeType === "DEPT_ROLE").map((o) => o.assigneeRef.split(":")[0]),
    );
    // DEPT_ROLEの参照は「内部ID:ロールID」で保存されているため、部署コードへ戻して出力する
    const refOf = (owner: (typeof owners)[number]) => {
      if (owner.assigneeType !== "DEPT_ROLE") return owner.assigneeRef;
      const index = owner.assigneeRef.indexOf(":");
      const dept = owner.assigneeRef.slice(0, index);
      return `${deptCodes.get(dept) ?? dept}${owner.assigneeRef.slice(index)}`;
    };
    const lines = PROGRESS_STAGE_KEYS.map((stageKey) => {
      const owner = byStage.get(stageKey);
      return [
        csvField(stageKey),
        csvField(PROGRESS_STAGE_LABELS[stageKey]),
        csvField(owner?.assigneeType ?? ""),
        csvField(owner ? refOf(owner) : ""),
        csvField(owner?.assigneeName ?? ""),
      ].join(",");
    });
    return withBom([STAGE_OWNERS_CSV_HEADERS.join(","), ...lines].join(CRLF) + CRLF);
  }

  async importCsv(c: Context<{ Bindings: Env }>, file: File) {
    const rows = parseCsv(await file.text());
    const header = rows[0]?.map((h) => h.trim()) ?? [];
    const indexOf = (name: string) => header.indexOf(name);
    if (REQUIRED_COLUMNS.some((name) => indexOf(name) < 0)) {
      throw new BadRequestError(`CSVヘッダー書式が正しくありません(必須列: ${REQUIRED_COLUMNS.join(",")})`);
    }
    const dataRows = rows.slice(1);
    if (dataRows.length === 0) throw new BadRequestError("取り込むデータ行がありません");

    const errors: string[] = [];
    const specified = new Map<ProgressStageKey, OwnerRow | null>(); // null = 未設定に戻す
    const lineOf = new Map<ProgressStageKey, number>(); // 工程 → CSV上の行番号(部署の解決エラー表示用)
    dataRows.forEach((columns, index) => {
      const line = index + 2;
      const cell = (name: string) => (columns[indexOf(name)] ?? "").trim();
      const fail = (message: string) => errors.push(`${line}行目: ${message}`);

      const stageKey = cell("stageKey");
      if (!(PROGRESS_STAGE_KEYS as readonly string[]).includes(stageKey)) {
        return fail(`stageKey「${stageKey}」は工程キーではありません(${PROGRESS_STAGE_KEYS.join(" / ")})`);
      }
      if (specified.has(stageKey as ProgressStageKey)) return fail(`工程「${stageKey}」がCSV内で重複しています`);

      const assigneeType = cell("assigneeType");
      const assigneeRef = cell("assigneeRef");
      if (!assigneeType && !assigneeRef) {
        specified.set(stageKey as ProgressStageKey, null);
        return;
      }
      if (!(ASSIGNEE_TYPES as readonly string[]).includes(assigneeType)) {
        return fail(`assigneeTypeは ${ASSIGNEE_TYPES.join(" / ")} のいずれかを指定してください(未設定に戻す場合は担当を空欄に)`);
      }
      if (!assigneeRef) return fail("assigneeRef(従業員番号・ロールID・部署コード:ロールID)は必須です");
      if (assigneeType === "DEPT_ROLE" && !/^[^:]+:[^:]+$/.test(assigneeRef)) {
        return fail("DEPT_ROLEのassigneeRefは「部署コード:ロールID」の形式で指定してください(例: 0041:manager)");
      }
      lineOf.set(stageKey as ProgressStageKey, line);
      specified.set(stageKey as ProgressStageKey, {
        stageKey: stageKey as ProgressStageKey,
        assigneeType: assigneeType as AssigneeType,
        assigneeRef,
      });
    });
    if (errors.length > 0) {
      const shown = errors.slice(0, MAX_REPORTED_ERRORS);
      const rest = errors.length - shown.length;
      throw new BadRequestError(
        `CSVに不正な行があるため、1件も反映していません(${errors.length}件)\n${shown.join("\n")}${rest > 0 ? `\n...ほか${rest}件` : ""}`,
      );
    }

    // DEPT_ROLEの部署コードを内部IDへ変換する(見つからない/有効期間が終了した部署は行番号つきでエラー)
    const deptErrors: string[] = [];
    for (const [stageKey, owner] of specified) {
      if (!owner || owner.assigneeType !== "DEPT_ROLE") continue;
      const index = owner.assigneeRef.indexOf(":");
      const dept = owner.assigneeRef.slice(0, index);
      const surrogate = await this.progress.resolveDepartmentSurrogateId(dept);
      if (!surrogate) {
        const line = lineOf.get(stageKey) ?? 0;
        deptErrors.push(`${line}行目: 部署コード「${dept}」の有効な部署が見つかりません(部署マスタのidを指定してください)`);
        continue;
      }
      specified.set(stageKey, { ...owner, assigneeRef: `${surrogate}${owner.assigneeRef.slice(index)}` });
    }
    if (deptErrors.length > 0) {
      throw new BadRequestError(`CSVに不正な行があるため、1件も反映していません(${deptErrors.length}件)\n${deptErrors.join("\n")}`);
    }

    // CSVに無い工程は現状のまま、CSVにある工程は上書き(担当が空欄なら未設定)。
    // 存在しない社員・ロール・部門は、既存の一括保存と同じ検証でエラーになり、その場合は何も保存されない
    const current = await this.progress.getStageOwners();
    const next: OwnerRow[] = current
      .filter((o) => !specified.has(o.stageKey as ProgressStageKey))
      .map((o) => ({
        stageKey: o.stageKey as ProgressStageKey,
        assigneeType: o.assigneeType as AssigneeType,
        assigneeRef: o.assigneeRef,
      }));
    for (const owner of specified.values()) if (owner) next.push(owner);
    await this.progress.saveStageOwners(c, { owners: next });

    const cleared = [...specified.values()].filter((o) => o === null).length;
    const updated = specified.size - cleared;
    return {
      success: true,
      updated,
      cleared,
      message: `工程の既定担当を反映しました(設定${updated}件・未設定に戻す${cleared}件)`,
    };
  }
}
