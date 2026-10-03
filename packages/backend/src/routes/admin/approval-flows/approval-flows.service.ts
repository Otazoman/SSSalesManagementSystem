import { Context } from "hono";
import { ApprovalFlowsRepository } from "./approval-flows.repository";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { toCsvBytes, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { CreateApprovalFlowInput } from "./approval-flows.schema";
import {
  BadRequestError,
  NotFoundError,
} from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { SortQuery } from "../../../platform/http/sort";
import { WorkflowEngine } from "../../../workflow-engine/engine";

const RESOURCE_KEY = "approval_flows";

export class ApprovalFlowsService {
  private repo: ApprovalFlowsRepository;

  constructor(env: Env) {
    this.repo = new ApprovalFlowsRepository(env);
  }

  // 1. 一覧取得
  async getAllFlowsWithSteps(sort?: SortQuery) {
    const flows = await this.repo.findAllFlows(sort);
    const steps = await this.repo.findAllStepsWithDetails();
    return flows.map((f) => ({
      ...f,
      steps: steps.filter((s) => s.flowId === f.id),
    }));
  }

  async getFlowsWithStepsPage(params: PaginationParams, sort?: SortQuery) {
    const [flows, steps, total] = await Promise.all([
      this.repo.findFlowsPage(params, sort),
      this.repo.findAllStepsWithDetails(),
      this.repo.countFlows(),
    ]);
    const data = flows.map((f) => ({
      ...f,
      steps: steps.filter((s) => s.flowId === f.id),
    }));
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  // 2. 新規作成
  async createFlow(
    c: Context<{ Bindings: Env }>,
    body: CreateApprovalFlowInput,
  ) {
    const { name, requestType, minAmount, maxAmount, steps, matchField, matchValue } = body;
    const newFlowId = crypto.randomUUID();

    const inserts: any[] = [
      this.repo.buildInsertFlowQuery({
        id: newFlowId,
        name,
        requestType,
        minAmount,
        maxAmount,
        isActive: true,
        matchField: matchField || null,
        matchValue: matchValue || null,
      }),
    ];

    steps.forEach((step, index) => {
      inserts.push(
        this.repo.buildInsertStepQuery({
          id: crypto.randomUUID(),
          flowId: newFlowId,
          stepOrder: index + 1,
          approverRoleId: step.approverRoleId,
          targetDepartmentSurrogateId: step.targetDepartmentSurrogateId || null,
          stepName: step.stepName || null,
          memo: step.memo || null,
        }),
      );
    });

    await this.repo.executeBatch(inserts);

    await logAuditEvent(c, "CREATE_APPROVAL_FLOW", RESOURCE_KEY, newFlowId, null, {
      name,
      requestType,
      minAmount,
      maxAmount,
      matchField: matchField || null,
      matchValue: matchValue || null,
      stepsCount: steps.length,
    });

    return {
      success: true,
      message: "動的承認フローをマスタへ登録・反映しました",
    };
  }

  // 3. 更新 (PUT)
  async updateFlow(
    c: Context<{ Bindings: Env }>,
    id: string,
    body: CreateApprovalFlowInput,
  ) {
    // 💡 isActive をボディから追加で抽出する（未指定の場合は既存値を維持するか、true をデフォルトにする）
    const { name, requestType, minAmount, maxAmount, steps, isActive, matchField, matchValue } = body;

    const oldFlowHeader = await this.repo.findFlowById(id);
    const oldFlowSteps = await this.repo.findStepsByFlowId(id);
    const oldSnapshot = { header: oldFlowHeader, steps: oldFlowSteps };

    const batchQueries: any[] = [
      this.repo.buildUpdateFlowQuery(id, {
        name,
        requestType,
        minAmount,
        maxAmount,
        // 💡 isActive が送られてきた場合はその値を適用し、省略時は既存の値を維持する
        isActive:
          isActive !== undefined ? isActive : (oldFlowHeader?.isActive ?? true),
        matchField: matchField || null,
        matchValue: matchValue || null,
      }),
      this.repo.buildDeleteStepsQuery(id),
    ];

    steps.forEach((step, index) => {
      batchQueries.push(
        this.repo.buildInsertStepQuery({
          id: crypto.randomUUID(),
          flowId: id,
          stepOrder: index + 1,
          approverRoleId: step.approverRoleId,
          targetDepartmentSurrogateId: step.targetDepartmentSurrogateId || null,
          stepName: step.stepName || null,
          memo: step.memo || null,
        }),
      );
    });

    await this.repo.executeBatch(batchQueries);

    await logAuditEvent(c, "UPDATE_APPROVAL_FLOW", RESOURCE_KEY, id, oldSnapshot, {
      name,
      requestType,
      minAmount,
      maxAmount,
      steps,
      isActive,
      matchField: matchField || null,
      matchValue: matchValue || null,
    });

    return { success: true, message: "承認フロー設定を更新しました" };
  }

  // 4. 無効化 (POST)
  async suspendFlow(c: Context<{ Bindings: Env }>, id: string) {
    const oldFlowHeader = await this.repo.findFlowById(id);
    const oldFlowSteps = await this.repo.findStepsByFlowId(id);
    const oldSnapshot = { header: oldFlowHeader, steps: oldFlowSteps };

    await this.repo.executeBatch([
      this.repo.buildUpdateFlowQuery(id, { isActive: false }),
    ]);

    await logAuditEvent(c, "SUSPEND_APPROVAL_FLOW", RESOURCE_KEY, id, oldSnapshot, {
      isActive: false,
    });

    return { success: true, message: "承認フローを無効化しました" };
  }

  // 5. 完全物理削除 (PURGE)
  async purgeFlow(c: Context<{ Bindings: Env }>, id: string) {
    const currentBefore = await this.repo.findFlowById(id);

    if (!currentBefore) {
      throw new NotFoundError("承認フローが見つかりません");
    }
    if (currentBefore.isActive) {
      throw new BadRequestError(
        "有効なフローは物理削除できません。先に無効化してください",
      );
    }

    const oldFlowSteps = await this.repo.findStepsByFlowId(id);
    const oldSnapshot = { header: currentBefore, steps: oldFlowSteps };

    await this.repo.executeBatch([
      this.repo.buildDeleteStepsQuery(id),
      this.repo.buildDeleteFlowQuery(id),
    ]);

    await logAuditEvent(c, "PURGE_APPROVAL_FLOW", RESOURCE_KEY, id, oldSnapshot, null);

    return { success: true, message: "承認フロー設定を完全に消去しました" };
  }

  // 6. CSVダウンロード
  async generateCsv(c: Context<{ Bindings: Env }>) {
    const rawFlows = await this.repo.findAllFlows();
    const rawSteps = await this.repo.findAllStepsWithDetails();

    await logAuditEvent(c, "EXPORT_APPROVAL_FLOWS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
      recordCount: rawFlows.length,
    });

    const headers = [
      "name",
      "requestType",
      "minAmount",
      "maxAmount",
      "isActive",
      "matchField",
      "matchValue",
      "approverRoleId",
      "targetDepartmentId",
      "stepName",
      "stepMemo",
    ];
    const rows: string[] = [];

    rawFlows.forEach((f: any) => {
      const mySteps = rawSteps.filter((s) => s.flowId === f.id);
      const name = csvField(f.name || "");
      const type = csvField(f.requestType || "");
      const min = f.minAmount || 0;
      const max = f.maxAmount || 0;
      const active = f.isActive ? "1" : "0";
      const matchField = csvField(f.matchField || "");
      const matchValue = csvField(f.matchValue || "");

      if (mySteps.length === 0) {
        rows.push(
          [name, type, min, max, active, matchField, matchValue, `""`, `""`, `""`].join(","),
        );
      } else {
        mySteps.forEach((step) => {
          const roleId = csvField(step.approverRoleId || "");
          const deptId = csvField(step.targetDepartmentId || "");
          const stepName = csvField(step.stepName || "");
          const memo = csvField(step.memo || "");
          rows.push(
            [name, type, min, max, active, matchField, matchValue, roleId, deptId, stepName, memo].join(
              ",",
            ),
          );
        });
      }
    });

    return toCsvBytes(buildCsvContent(headers, rows));
  }

  // 7. 一括登録（インポート）
  async bulkRegister(c: Context<{ Bindings: Env }>, file: File) {
    const text = await file.text();
    const allRows = parseCsv(text);

    if (
      allRows.length <= 1 ||
      allRows[0].join(",") !==
        "name,requestType,minAmount,maxAmount,isActive,matchField,matchValue,approverRoleId,targetDepartmentId,stepName,stepMemo"
    ) {
      throw new BadRequestError("CSVヘッダー書式が正しくありません");
    }

    const dataRows = allRows.slice(1);
    let successCount = 0;

    const clearedFlowNames = new Set<string>();
    const flowStepOrderMap = new Map<string, number>();
    const flowIdMap = new Map<string, string>();
    const batchQueries: any[] = [];

    for (const columns of dataRows) {
      const [
        name,
        requestType,
        minAmount,
        maxAmount,
        isActive,
        matchField,
        matchValue,
        approverRoleId,
        targetDepartmentId,
        stepName,
        stepMemo,
      ] = columns;

      if (!name || !requestType) continue;

      let fid: string;

      if (flowIdMap.has(name)) {
        fid = flowIdMap.get(name)!;
      } else {
        const existingFlow = await this.repo.findFlowByName(name);

        if (existingFlow) {
          fid = existingFlow.id;
          batchQueries.push(
            this.repo.buildUpdateFlowQuery(fid, {
              requestType,
              minAmount: Number(minAmount) || 0,
              maxAmount: Number(maxAmount) || 0,
              isActive: isActive === "1",
              matchField: matchField || null,
              matchValue: matchValue || null,
            }),
          );
        } else {
          fid = crypto.randomUUID();
          batchQueries.push(
            this.repo.buildInsertFlowQuery({
              id: fid,
              name,
              requestType,
              minAmount: Number(minAmount) || 0,
              maxAmount: Number(maxAmount) || 0,
              isActive: isActive === "1",
              matchField: matchField || null,
              matchValue: matchValue || null,
            }),
          );
        }

        flowIdMap.set(name, fid);
        flowStepOrderMap.set(name, 0);
      }

      if (!clearedFlowNames.has(name)) {
        batchQueries.push(this.repo.buildDeleteStepsQuery(fid));
        clearedFlowNames.add(name);
      }

      if (approverRoleId && approverRoleId !== "") {
        const currentOrder = (flowStepOrderMap.get(name) || 0) + 1;
        flowStepOrderMap.set(name, currentOrder);

        let deptSurrogateId: string | null = null;
        if (targetDepartmentId && targetDepartmentId.trim() !== "") {
          const cleanDeptId = targetDepartmentId.trim();
          const matchedDepts = await this.repo.findMatchedDepartment(
            cleanDeptId,
            new Date(),
          );

          if (matchedDepts.length > 0) {
            deptSurrogateId = matchedDepts[0].surrogateId;
          }
        }

        batchQueries.push(
          this.repo.buildInsertStepQuery({
            id: crypto.randomUUID(),
            flowId: fid,
            stepOrder: currentOrder,
            approverRoleId,
            targetDepartmentSurrogateId: deptSurrogateId,
            stepName: stepName || null,
            memo: stepMemo || null,
          }),
        );
      }
      successCount++;
    }

    if (batchQueries.length > 0) {
      await this.repo.executeBatch(batchQueries);
    }

    await logAuditEvent(c, "BULK_REGISTER_APPROVAL_FLOWS", RESOURCE_KEY, "BATCH_PROCESS", null, {
      successCount,
      totalFlows: flowIdMap.size,
    });

    return {
      success: true,
      message: `CSVから ${flowIdMap.size} 件のフロー定義(計 ${successCount} 行のステップ構成)を完全に同期しました`,
    };
  }

  // 8. 新規要望: 承認フローの申請経路プレビュー(2026-09-22確定、read-only)。
  // ユーザーを選んで、その人が指定した書類種別・金額で申請した場合にどの承認フロー(経路)を
  // 通るかを、実際の申請データを作らずWorkflowEngine.startWorkflowと同じマッチングロジック
  // (金額レンジ→matchField/matchValue)でシミュレーションする。入力は3つ(ユーザー・書類種別・
  // 仮の金額)に確定しているため、matchPayloadは渡さない(=matchFieldを持つ条件付きフローは
  // このプレビューでは常に対象外になる。理由はmatchReasonで案内する)。
  async previewApprovalRoute(params: {
    userId: string;
    targetType: string;
    amount: number;
  }) {
    const { userId, targetType, amount } = params;

    const candidates = await this.repo.findMatchingFlowsForPreview(
      targetType,
      amount,
    );
    const flow = WorkflowEngine.pickBestMatchingFlow(candidates, undefined);

    if (!flow) {
      return {
        matched: false,
        message: `条件(書類種別: ${targetType}, 金額: ${amount.toLocaleString()}円)に合致する有効な承認フローが定義されていません`,
      };
    }

    const conditionalCandidateCount = candidates.filter(
      (f: any) => !!f.matchField,
    ).length;
    const matchReason =
      conditionalCandidateCount > 0
        ? `同一書類種別・金額帯に${candidates.length}件の候補があり、条件(matchField)を持たない汎用フロー「${flow.name}」が採用されました(matchFieldを持つ${conditionalCandidateCount}件は、このプレビューでは申請データの詳細な条件値を指定していないため対象外です)`
        : `書類種別・金額帯が一致する唯一の候補フロー「${flow.name}」が採用されました`;

    const steps = await this.repo.findStepsByFlowId(flow.id);
    const applicantRoleIds = await this.repo.findApplicantRoleIds(userId);

    const stepResults = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const roleName = await this.repo.getRoleName(step.approverRoleId);
      // WorkflowEngine.startWorkflowと同じく、先頭ステップのみ「申請者本人が既にそのロールを
      // 持っていれば自動通過」の対象になる(2番目以降のステップは自動通過しない)
      const autoPassed =
        i === 0 && applicantRoleIds.includes(step.approverRoleId);

      const approverIds = await this.repo.resolveStepApprovers(
        userId,
        step.approverRoleId,
        step.targetDepartmentSurrogateId,
      );
      const approverNames = await this.repo.getUserNamesByIds(approverIds);

      stepResults.push({
        stepOrder: step.stepOrder,
        stepName: step.stepName,
        approverRoleId: step.approverRoleId,
        roleName,
        targetDepartmentSurrogateId: step.targetDepartmentSurrogateId,
        approverNames,
        autoPassed,
      });
    }

    return {
      matched: true,
      message: "申請経路をシミュレーションしました",
      flowId: flow.id,
      flowName: flow.name,
      matchReason,
      steps: stepResults,
    };
  }
}
