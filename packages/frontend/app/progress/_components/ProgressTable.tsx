import { buildDocumentHref } from "../_lib/document-href";
import type { EmployeeOption } from "../_hooks/useProgress";
import { StatusBadge, StatusBadgeSpec } from "../../_shared/ui/StatusBadge";
import {
  DOCUMENT_LIFECYCLE_STATUS,
  getApprovalResultStatus,
  getBillingPaymentHeaderStatus,
  getInstructionStatus,
} from "../../_shared/status";
import {
  PROGRESS_STAGE_KEYS,
  PROGRESS_STAGE_LABELS,
  ProgressApproval,
  ProgressRow,
  ProgressRootKind,
  ProgressStageDoc,
  ProgressStageKey,
  PURCHASE_CHAIN,
  ROOT_KIND_LABELS,
  SALES_CHAIN,
} from "../_types";

// 工程ごとにステータス語彙が異なるため、各画面で使っている共通辞書(_shared/status)を工程別に引き当てる
// (未知のステータスは原文のままslate表示)
function statusSpec(stage: ProgressStageKey, status: string): StatusBadgeSpec {
  switch (stage) {
    case "receipt_instruction":
    case "shipment_instruction":
      return getInstructionStatus(status);
    case "item_receipt":
    case "item_shipment":
      return getApprovalResultStatus(status);
    case "billing":
    case "payment":
      return getBillingPaymentHeaderStatus(status);
    default:
      // 見積・受注・購買申請・発注・仕入・売上は伝票ライフサイクル(仕入・売上は承認結果系の語彙も併用)
      return DOCUMENT_LIFECYCLE_STATUS[status] ?? getApprovalResultStatus(status);
  }
}

// 承認申請(master_approval_requests)自体のステータス。表示は用語集の「状態の表示」に合わせる
// (REJECTED は現在どこからも設定されないが、差戻しと同じ扱いで表示する)
const APPROVAL_REQUEST_LABEL: Record<string, string> = {
  PENDING: "承認申請中",
  APPROVED: "承認済み",
  REJECTED: "差戻し",
  REMANDED: "差戻し",
  CANCELED: "取下げ",
};

function ApprovalLine({ approval }: { approval: ProgressApproval }) {
  const { requestStatus, approvedLayers, totalLayers, pendingRoleName } = approval;
  if (requestStatus === "PENDING") {
    return (
      <div className="text-[10px] text-amber-800 font-medium">
        承認 {approvedLayers}/{totalLayers}
        {pendingRoleName ? ` → ${pendingRoleName}待ち` : ""}
      </div>
    );
  }
  if (requestStatus === "APPROVED") {
    return <div className="text-[10px] text-emerald-800 font-medium">承認済み {approvedLayers}/{totalLayers}</div>;
  }
  return (
    <div className="text-[10px] text-slate-700">承認申請: {APPROVAL_REQUEST_LABEL[requestStatus] ?? requestStatus}</div>
  );
}

function StageDocChip({ stage, doc }: { stage: ProgressStageKey; doc: ProgressStageDoc }) {
  const spec = statusSpec(stage, doc.status);
  return (
    <div className="space-y-0.5 py-1 first:pt-0 last:pb-0">
      {/* 伝票番号クリックで、その伝票の元の画面を別ウィンドウで開く */}
      <a
        href={buildDocumentHref(stage, doc.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="block font-mono text-[11px] text-indigo-800 underline hover:text-indigo-950 break-all"
        title="元の伝票画面を別ウィンドウで開く"
      >
        {doc.id}
      </a>
      <StatusBadge label={spec.label} tone={spec.tone} />
      {doc.assigneeName && <div className="text-[10px] text-slate-700">担当: {doc.assigneeName}</div>}
      {doc.approval && <ApprovalLine approval={doc.approval} />}
    </div>
  );
}

// 案件の担当者割当のエディタ(この案件で担当を割当てられる工程を一覧し、社員マスタから選ぶ)
function AssignmentEditor({
  row,
  employees,
  onAssign,
}: {
  row: ProgressRow;
  employees: EmployeeOption[];
  onAssign: (rootKind: ProgressRootKind, rootId: string, stageKey: ProgressStageKey, employeeNumber: string | null) => void;
}) {
  const salesRooted = row.rootKind === "sales_order" || row.rootKind === "quote";
  const hasPurchaseDoc = PURCHASE_CHAIN.some((key) => row.stages[key].length > 0);
  const stageKeys = [...(salesRooted ? SALES_CHAIN : []), ...(!salesRooted || hasPurchaseDoc ? PURCHASE_CHAIN : [])];

  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[10px] font-semibold text-indigo-800 underline">担当設定</summary>
      <div className="mt-1 space-y-1 p-2 border border-slate-300 rounded bg-white">
        {stageKeys.map((key) => (
          <label key={key} className="flex items-center gap-1 text-[10px] text-slate-800">
            <span className="w-12 shrink-0 font-semibold">{PROGRESS_STAGE_LABELS[key]}</span>
            <select
              value={row.assignments[key]?.employeeNumber ?? ""}
              onChange={(e) => onAssign(row.rootKind, row.rootId, key, e.target.value || null)}
              className="border border-slate-400 rounded px-1 py-0.5 bg-white text-slate-900 w-32"
            >
              <option value="">既定に従う</option>
              {employees.map((emp) => (
                <option key={emp.employeeNumber} value={emp.employeeNumber}>
                  {emp.name}({emp.employeeNumber})
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </details>
  );
}

const STAGE_STATE_BADGE = {
  COMPLETED: { label: "完了", tone: "emerald" },
  IN_PROGRESS: { label: "進行中", tone: "sky" },
} as const;

// 工程セルの完了/進行中バッジ。手動設定(各伝票の画面で設定)がある場合は「手動」を付ける。
// 進捗確認は閲覧専用のため、ここから完了/進行中を変更することはできない
function StageStateLine({ row, stage }: { row: ProgressRow; stage: ProgressStageKey }) {
  const status = row.stageStatuses[stage];
  if (status.state === "NONE") return null;
  const badge = STAGE_STATE_BADGE[status.state];
  return (
    <div className="flex flex-wrap items-center gap-1 pb-1">
      <StatusBadge label={badge.label} tone={badge.tone} />
      {status.manual && (
        <span className="text-[10px] font-semibold text-slate-800" title="各伝票の画面で手動設定されています">
          手動
        </span>
      )}
    </div>
  );
}

interface ProgressTableProps {
  rows: ProgressRow[];
  // 指定すると各案件に「担当設定」を表示する(進捗確認画面の更新権限がある場合のみ渡す)
  assignment?: {
    employees: EmployeeOption[];
    onAssign: (rootKind: ProgressRootKind, rootId: string, stageKey: ProgressStageKey, employeeNumber: string | null) => void;
  };
}

export function ProgressTable({ rows, assignment }: ProgressTableProps) {
  return (
    <div className="overflow-auto max-h-[70vh] border border-slate-200 rounded-lg">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-100 text-slate-900">
          <tr>
            <th className="px-3 py-2 text-left sticky top-0 left-0 bg-slate-100 min-w-40 z-30">案件(起点伝票)</th>
            {PROGRESS_STAGE_KEYS.map((key) => (
              <th key={key} className="px-3 py-2 text-left min-w-32 whitespace-nowrap sticky top-0 bg-slate-100 z-20">
                {PROGRESS_STAGE_LABELS[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.length === 0 && (
            <tr>
              <td colSpan={PROGRESS_STAGE_KEYS.length + 1} className="px-3 py-8 text-center text-slate-700">
                該当する案件がありません
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={`${row.rootKind}:${row.rootId}`} className="align-top">
              <td className="px-3 py-2 sticky left-0 bg-white z-10 border-r border-slate-100">
                <a
                  href={buildDocumentHref(row.rootKind, row.rootId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block font-mono text-[11px] font-bold text-indigo-800 underline hover:text-indigo-950 break-all"
                  title="元の伝票画面を別ウィンドウで開く"
                >
                  {row.rootId}
                </a>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-slate-700">{ROOT_KIND_LABELS[row.rootKind]}</span>
                  <StatusBadge
                    label={STAGE_STATE_BADGE[row.caseState].label}
                    tone={STAGE_STATE_BADGE[row.caseState].tone}
                  />
                </div>
                {row.title && <div className="text-[11px] font-semibold text-slate-900 break-all">{row.title}</div>}
                {row.partnerName && <div className="text-[10px] text-slate-700">{row.partnerName}</div>}
                {row.projectName && <div className="text-[10px] text-slate-700">プロジェクト: {row.projectName}</div>}
                <div className="mt-1 space-y-0.5">
                  {row.nextSteps.length === 0 ? (
                    <div className="text-[10px] text-slate-700">次の処理: なし(最終工程まで完了)</div>
                  ) : (
                    row.nextSteps.map((next) => (
                      <div key={next.chain} className="text-[10px] text-slate-900">
                        <span className="font-semibold">次: {PROGRESS_STAGE_LABELS[next.stageKey]}</span>
                        <span className="text-slate-800">
                          {" / 担当: "}
                          {next.assigneeName ?? "未設定"}
                          {next.source === "case" ? "(個別)" : ""}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                {assignment && (
                  <AssignmentEditor row={row} employees={assignment.employees} onAssign={assignment.onAssign} />
                )}
              </td>
              {PROGRESS_STAGE_KEYS.map((key) => {
                const docs = row.stages[key];
                return (
                  <td key={key} className="px-3 py-2 border-r border-slate-50 last:border-r-0">
                    {docs.length === 0 ? (
                      <span className="text-slate-500">-</span>
                    ) : (
                      <>
                        <StageStateLine row={row} stage={key} />
                        {docs.map((doc) => (
                          <StageDocChip key={doc.id} stage={key} doc={doc} />
                        ))}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
