import React from "react";
import { getPreviewSpec, type PreviewSpec } from "./preview-specs";
import { SpecPreview } from "./SpecPreview";

interface PreviewRendererProps {
  targetType: string;
  /** "task": 承認タスク画面(単一値表示) / "history": 申請履歴画面(新旧比較表示) */
  mode: "task" | "history";
  newData: unknown;
  oldData?: unknown;
  isUpdate?: boolean;
  /** BUG-089: プレビューの中の番号の名前(「種類:番号」→名前。backend がまとめて引いたもの) */
  displayNames?: Record<string, string>;
}

// 設定の無い申請の種類(今後追加されるもの)の受け皿。全ての項目を「その他」に項目名のまま出す
const EMPTY_SPEC: PreviewSpec = { table: "", header: {}, hidden: {} };

/**
 * targetTypeごとの承認プレビュー表示を切り替える共有コンポーネント。
 * 承認タスク画面(_components/TaskPreviewRow.tsx)・申請履歴画面(_components/WorkflowTable.tsx)
 * の両方から利用する。BUG-089: 申請の種類ごとの設定(preview-specs.ts)で、全ての項目を共通の表示(SpecPreview)で出す。
 */
export function PreviewRenderer(props: PreviewRendererProps) {
  const { targetType, newData, mode } = props;

  if (!newData) {
    return (
      <span className="text-slate-600 italic">
        プレビュー情報がない、またはパースエラーです。
      </span>
    );
  }

  const spec = getPreviewSpec(targetType, newData ?? props.oldData) ?? EMPTY_SPEC;
  return (
    <SpecPreview
      spec={spec}
      mode={mode}
      newData={newData}
      oldData={props.isUpdate === false ? undefined : props.oldData}
      displayNames={props.displayNames}
    />
  );
}
