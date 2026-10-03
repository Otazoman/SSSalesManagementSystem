import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { WorkflowHistoryTask, PartnerSnapshot } from "../_types";
import { WorkflowTimeline } from "../../_shared/WorkflowTimeline";
import { PreviewRenderer } from "../../_shared/PreviewRenderer";
import { stackedTable } from "../../../_shared/ui/stacked-table";
import { buttonClass } from "../../../_shared/ui/Button";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface WorkflowTableProps {
  histories: WorkflowHistoryTask[];
  loadingData: boolean;
  isAdmin: boolean;
  userId: string | undefined;
  getTargetTypeJapanese: (englishName: string) => string;
  resolveTargetTypeEditPath: (
    targetType: string,
    targetId: string,
  ) => Promise<string | null>;
  getEligibleApprovers: (
    roleId: string,
    departmentId?: string | null,
    applicantDepartmentId?: string | null,
  ) => string;
  onCancelRequest?: (targetId: string, logId: string) => Promise<void> | void;
}

export function WorkflowTable({
  histories,
  loadingData,
  isAdmin,
  userId,
  getTargetTypeJapanese,
  resolveTargetTypeEditPath,
  getEligibleApprovers,
  onCancelRequest,
}: WorkflowTableProps) {
  const confirm = useConfirm();
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  // BUG-037: 操作の失敗は alert ではなく、一覧の上のメッセージで伝える
  const [actionError, setActionError] = useState("");
  const [resolvingEditPathId, setResolvingEditPathId] = useState<string | null>(
    null,
  );
  const router = useRouter();

  // 💡 targetId ごとに「一番最新の logId」を特定するマップを作成
  const latestLogIdMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of histories) {
      if (!map.has(item.targetId)) {
        map.set(item.targetId, item.logId);
      }
    }
    return map;
  }, [histories]);

  const toggleExpand = (logId: string) => {
    setExpandedLogId(expandedLogId === logId ? null : logId);
  };

  const handleCancel = async (targetId: string, logId: string) => {
    if (!onCancelRequest) return;
    const isConfirmed = (await confirm(
      "この申請を取下げますか？\n※取下げると申請処理が破棄(クローズ)されます。",
    ));
    if (!isConfirmed) return;

    setActionError("");
    try {
      setCancelingId(logId);
      await onCancelRequest(targetId, logId);
    } catch (error) {
      console.error("取下げに失敗しました:", error);
      setActionError(
        error instanceof Error && error.message
          ? error.message
          : "申請の取下げに失敗しました",
      );
    } finally {
      setCancelingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "APPROVED":
        return (
          <span className="bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold px-2.5 py-0.5 rounded-full text-[10px]">
            承認済み
          </span>
        );
      case "REMANDED":
        return (
          <span className="bg-rose-50 border border-rose-200 text-rose-800 font-bold px-2.5 py-0.5 rounded-full text-[10px]">
            差戻し
          </span>
        );
      case "CANCELED":
      case "CLOSED":
        return (
          <span className="bg-gray-100 border border-gray-300 text-gray-700 font-bold px-2.5 py-0.5 rounded-full text-[10px]">
            取下げ済み
          </span>
        );
      default:
        return (
          <span className="bg-slate-50 border border-slate-200 text-slate-600 font-bold px-2.5 py-0.5 rounded-full text-[10px]">
            処理中
          </span>
        );
    }
  };

  return (
    <>
    {actionError && <MessageBanner error={actionError} />}
    <div className="md:overflow-x-auto md:max-h-[600px] md:overflow-y-auto">
      <table
        className={`${stackedTable.table} md:min-w-[950px] md:border-collapse`}
      >
        <thead
          className={`${stackedTable.thead} sticky top-0 z-10 bg-slate-100 shadow-[0_1px_0_0_rgba(226,232,240,1)] text-slate-700 font-bold uppercase`}
        >
          <tr>
            <th className="px-4 py-3 bg-slate-100">
              申請対象マスタ / コード
            </th>
            <th className="px-4 py-3 bg-slate-100">申請種別 / 申請者</th>
            <th className="px-4 py-3 bg-slate-100">段階</th>
            <th className="px-4 py-3 bg-slate-100">処理状況</th>
            {isAdmin && <th className="px-4 py-3 bg-slate-100">処理担当者</th>}
            <th className="px-4 py-3 min-w-[250px] bg-slate-100">
              コメント / メモ
            </th>
            <th className="px-4 py-3 text-right bg-slate-100">処理日時</th>
          </tr>
        </thead>
        <tbody
          className={`${stackedTable.tbody} md:divide-y md:divide-slate-200 text-slate-700`}
        >
          {loadingData ? (
            <tr className={stackedTable.trBare}>
              <td
                colSpan={isAdmin ? 7 : 6}
                className={`${stackedTable.tdBare} text-center py-12 text-slate-600 italic bg-slate-50 rounded-lg`}
              >
                履歴データを読み込み中...
              </td>
            </tr>
          ) : histories.length > 0 ? (
            histories.map((history) => {
              const isExpanded = expandedLogId === history.logId;
              return (
                <React.Fragment key={history.logId}>
                  <tr
                    className={`${stackedTable.tr} hover:bg-slate-50 transition-colors ${isExpanded ? "bg-indigo-50/40 hover:bg-indigo-50/60" : ""}`}
                  >
                    {/* 対象マスタ情報 */}
                    <td
                      className={`${stackedTable.td} font-medium text-slate-900`}
                      data-label="申請対象マスタ / コード"
                    >
                      <div className="flex items-center space-x-2">
                        <span className="bg-slate-200 text-slate-800 text-[10px] px-1.5 py-0.5 rounded font-bold">
                          {getTargetTypeJapanese(history.targetType)}
                        </span>
                        <button
                          onClick={() => toggleExpand(history.logId)}
                          className={buttonClass({
                            variant: "secondary",
                            size: "sm",
                          })}
                        >
                          {isExpanded ? "▲ 閉じる" : "👁️ プレビュー"}
                        </button>
                      </div>
                      <span className="font-bold text-slate-900 block mt-1.5">
                        {history.targetName}
                      </span>
                      <div className="text-[10px] text-slate-600 font-mono mt-1 ml-4">
                        管理コード: {history.targetId}
                      </div>
                    </td>

                    <td
                      className={stackedTable.td}
                      data-label="申請種別 / 申請者"
                    >
                      <span className="px-1.5 py-0.5 rounded font-bold text-[10px] bg-indigo-50 border border-indigo-100 text-indigo-700">
                        {history.requestType}
                      </span>
                      <div className="text-slate-700 text-[11px] mt-1.5 font-medium">
                        {history.applicantId}
                      </div>
                    </td>

                    <td
                      className={`${stackedTable.td} font-mono text-slate-700 font-semibold`}
                      data-label="段階"
                    >
                      第 {history.layer} 段階
                    </td>

                    <td className={stackedTable.td} data-label="処理状況">
                      <div className="flex flex-col space-y-1.5 items-start">
                        {getStatusBadge(history.status)}

                        {/* 💡 申請者本人判定 ＆ 最新ログ判定 ＆ ボタン表示分岐 */}
                        {(() => {
                          const isMyApplicant = history.applicantId.includes(
                            userId?.substring(0, 8) || "NEVER_MATCH",
                          );
                          // 💡【追加】同一申請の中で最新のログであるか判定
                          const isLatestLog =
                            latestLogIdMap.get(history.targetId) ===
                            history.logId;

                          const isRemanded =
                            history.status === "REMANDED" &&
                            history.parentStatus === "REMANDED";
                          const isPending = history.status === "PENDING";

                          // 本人の申請でない、最新のログでない、または要対応でない場合はボタン非表示
                          if (
                            !isMyApplicant ||
                            !isLatestLog ||
                            (!isRemanded && !isPending)
                          ) {
                            return null;
                          }

                          return (
                            <div className="flex items-center gap-1.5 mt-1">
                              {/* 修正して再申請 (差戻しの時のみ) */}
                              {isRemanded && (
                                <button
                                  onClick={() => {
                                    setResolvingEditPathId(history.logId);
                                    void (async () => {
                                      try {
                                        const editPath =
                                          await resolveTargetTypeEditPath(
                                            history.targetType,
                                            history.targetId,
                                          );
                                        if (!editPath) {
                                          setActionError(
                                            `対象マスタ(${history.targetType})の編集画面が見つかりませんでした`,
                                          );
                                          return;
                                        }
                                        router.push(
                                          `${editPath}?editId=${history.targetId}`,
                                        );
                                      } finally {
                                        setResolvingEditPathId(null);
                                      }
                                    })();
                                  }}
                                  disabled={
                                    resolvingEditPathId === history.logId
                                  }
                                  className={buttonClass({
                                    variant: "danger",
                                    size: "sm",
                                  })}
                                >
                                  {resolvingEditPathId === history.logId
                                    ? "🛠️ 解決中..."
                                    : "🛠️ 修正して再申請"}
                                </button>
                              )}

                              {/* 申請を取り下げる (差戻し または 処理中の時) */}
                              {onCancelRequest && (
                                <button
                                  onClick={() =>
                                    handleCancel(
                                      history.targetId,
                                      history.logId,
                                    )
                                  }
                                  disabled={cancelingId === history.logId}
                                  className={buttonClass({
                                    variant: "secondary",
                                    size: "sm",
                                  })}
                                >
                                  {cancelingId === history.logId
                                    ? "処理中..."
                                    : "🚫 取下げ"}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </td>

                    {isAdmin && (
                      <td
                        className={`${stackedTable.td} text-slate-700 font-medium`}
                        data-label="処理担当者"
                      >
                        {history.approverName || (
                          <span className="text-slate-600 italic">未処理</span>
                        )}
                      </td>
                    )}

                    <td
                      className={`${stackedTable.td} md:max-w-[300px] md:truncate font-medium text-slate-700`}
                      data-label="コメント / メモ"
                    >
                      {history.comment ? (
                        <span title={history.comment}>{history.comment}</span>
                      ) : (
                        <span className="text-slate-600 italic">
                          コメントなし
                        </span>
                      )}
                    </td>

                    <td
                      className={`${stackedTable.td} md:text-right font-mono text-slate-700 md:whitespace-nowrap`}
                      data-label="処理日時"
                    >
                      {history.performedAt
                        ? new Date(history.performedAt).toLocaleString("ja-JP")
                        : "未処理"}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr
                      className={`${stackedTable.trBare} bg-slate-50/80 mb-3 md:mb-0`}
                    >
                      <td
                        colSpan={isAdmin ? 7 : 6}
                        className={`${stackedTable.tdBare} px-2 py-3 md:px-6 md:py-4 border-t border-b border-indigo-100`}
                      >
                        <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm space-y-4">
                          {history.flowProgress && (
                            <WorkflowTimeline
                              flowProgress={history.flowProgress}
                              getEligibleApprovers={(
                                roleId,
                                deptId,
                                applicantDeptId,
                              ) =>
                                getEligibleApprovers(
                                  roleId,
                                  deptId,
                                  applicantDeptId,
                                )
                              }
                              applicantDepartmentId={
                                history.applicantDepartmentId
                              }
                            />
                          )}

                          <h3 className="text-xs font-bold text-slate-800 border-b pb-1.5 flex items-center pt-2">
                            🔍 申請データの確定情報プレビュー
                            <span className="ml-2 text-[10px] text-slate-600 font-normal">
                              (管理コード: {history.targetId})
                            </span>
                          </h3>

                          <PreviewRenderer
                            targetType={history.targetType}
                            mode="history"
                            newData={history.snapshotNew}
                            oldData={history.snapshotOld}
                            isUpdate={history.requestType === "UPDATE"}
                          />

                          {/* 添付書類は取引先マスタ固有の項目のため、汎用プレビューとは別枠で表示する */}
                          {history.targetType === "master_partners" &&
                            (() => {
                              const attachments = (
                                history.snapshotNew as PartnerSnapshot | null
                              )?.attachments;
                              if (!attachments || attachments.length === 0)
                                return null;
                              return (
                                <div className="border-t pt-3 text-xs space-y-1.5">
                                  <span className="font-bold text-slate-700">
                                    📎 添付書類:
                                  </span>
                                  <div className="flex flex-wrap gap-2">
                                    {attachments.map((file) => (
                                      <a
                                        key={file.id}
                                        href={
                                          file.externalUrl ||
                                          `/api/partners/files/${file.id}`
                                        }
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-2.5 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-md font-medium text-[11px] hover:bg-indigo-100 transition-colors"
                                      >
                                        📄 {file.fileName}
                                      </a>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          ) : (
            <tr className={stackedTable.trBare}>
              <td
                colSpan={isAdmin ? 7 : 6}
                className={`${stackedTable.tdBare} text-center py-12 text-slate-600 italic bg-slate-50 rounded-lg`}
              >
                該当する決裁履歴はありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </>
  );
}
