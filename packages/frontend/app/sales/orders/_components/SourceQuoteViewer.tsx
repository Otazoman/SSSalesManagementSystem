import React, { useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface SourceQuoteAttachment {
  id?: string;
  fileName: string;
  storageType: "R2" | "GOOGLE_DRIVE" | "EXTERNAL_LINK";
  attachmentR2Path?: string | null;
  fileType?: string;
  uploadedAt?: string;
}

interface SourceQuoteDetail {
  id: string;
  attachments?: SourceQuoteAttachment[];
}

interface SourceQuoteViewerProps {
  quoteId: string;
}

function findLatestPdfAttachment(
  attachments: SourceQuoteAttachment[] | undefined,
): SourceQuoteAttachment | null {
  const pdfAttachments = (attachments || []).filter(
    (att) =>
      att.storageType === "R2" &&
      att.attachmentR2Path &&
      att.fileType === "PDF",
  );
  if (pdfAttachments.length === 0) return null;
  return pdfAttachments.reduce((latest, current) =>
    (current.uploadedAt || "") > (latest.uploadedAt || "") ? current : latest,
  );
}

// Item7: 見積から作成した受注から、対象見積の見積書PDFをそのままプレビューできるようにするための
// 軽量な参照モーダル。編集・承認申請等の操作は一切持たず、既に生成済みのPDF添付を表示するのみ
// (未生成の場合のみ、見積画面と同じ「PDFを生成する」操作を明示的な確認の上で実行する)
export function SourceQuoteViewer({ quoteId }: SourceQuoteViewerProps) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [hasNoPdf, setHasNoPdf] = useState(false);

  const loadPdf = async () => {
    setError("");
    setHasNoPdf(false);
    setLoading(true);
    try {
      const data = await apiFetch<SourceQuoteDetail>(`/api/quotes/${quoteId}`, {
        defaultErrorMessage: "見積の取得に失敗しました",
      });
      const latestPdf = findLatestPdfAttachment(data.attachments);
      if (latestPdf) {
        setPdfUrl(`/api/quotes/download/${quoteId}/${latestPdf.id}`);
      } else {
        setPdfUrl(null);
        setHasNoPdf(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "見積の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async () => {
    setOpen(true);
    setPdfUrl(null);
    await loadPdf();
  };

  const handleGeneratePdf = async () => {
    if (!(await confirm(`対象見積 [ ${quoteId} ] の見積書PDFを生成しますか？`))) return;
    setError("");
    setGenerating(true);
    try {
      await apiFetch(`/api/quotes/${quoteId}/generate-pdf`, {
        method: "POST",
        defaultErrorMessage: "PDF生成に失敗しました",
      });
      await loadPdf();
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF生成に失敗しました");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleOpen()}
        className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
      >
        📄 対象見積[{quoteId}]の見積書PDFをプレビュー
      </button>

      {open && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-4xl h-[90vh] p-4 space-y-3 flex flex-col">
            <div className="flex justify-between items-center border-b pb-2 shrink-0">
              <div>
                <h4 className="text-xs font-bold text-slate-600 uppercase font-mono">
                  {quoteId}
                </h4>
                <h3 className="text-sm font-black text-slate-800 mt-0.5">
                  対象見積の見積書PDFプレビュー(閲覧専用)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-slate-600 hover:text-slate-600 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {loading && (
              <p className="text-xs text-slate-600 text-center py-10">
                読み込み中...
              </p>
            )}

            {!loading && error && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg">
                ⚠️ {error}
              </div>
            )}

            {!loading && !error && hasNoPdf && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
                <p className="text-xs text-slate-500">
                  この見積の見積書PDFはまだ生成されていません。
                </p>
                <Button
                  onClick={() => void handleGeneratePdf()}
                  disabled={generating}
                >
                  {generating ? "生成中..." : "📄 見積書PDFを生成する"}
                </Button>
              </div>
            )}

            {!loading && !error && pdfUrl && (
              <iframe
                src={pdfUrl}
                title={`見積書PDFプレビュー(${quoteId})`}
                className="flex-1 w-full border border-slate-200 rounded-lg"
              />
            )}

            <div className="flex justify-end pt-2 border-t border-slate-100 shrink-0">
              <Button size="sm" onClick={() => setOpen(false)}>
                閉じる
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
