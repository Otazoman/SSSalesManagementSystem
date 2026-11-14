import { WorkflowTasksRepository } from "../../routes/workflow/workflow-tasks/workflow-tasks.repository";

/**
 * BUG-089: マスタの承認のプレビュー。変更申請は、変更後の内容を申請の退避データ(masterApprovalContexts)に持ち、
 * 承認の時に反映する(承認待ちの間、今の行は変更前の内容のまま)。以前のプレビューは今の行だけを出していたため、
 * 承認待ちの間は変更前の内容しか見えなかった。
 * 退避データがあれば「今の行に退避データを重ねたもの」を新しい内容とし、今の行を変更前の内容として返す
 * (変更前の内容を出すのは、変更申請(UPDATE)の申請履歴だけ。呼び出し元が決める)。
 */
export async function resolveMasterPreview(
  db: any,
  requestId: string,
  live: unknown,
): Promise<{ newData: unknown; oldData: unknown }> {
  if (!live || typeof live !== "object") return { newData: live, oldData: null };
  const context = await WorkflowTasksRepository.getApprovalContext(db, requestId);
  if (!context?.generalMemo) return { newData: live, oldData: null };
  try {
    const snapshot = JSON.parse(context.generalMemo);
    if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
      return { newData: { ...(live as Record<string, unknown>), ...snapshot }, oldData: live };
    }
  } catch {
    // 退避データが壊れている時は、今の行だけを出す(以前と同じ)
  }
  return { newData: live, oldData: null };
}
