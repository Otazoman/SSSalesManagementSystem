"use client";

import { PublicPage } from "../_shared/ui/PublicPage";
import { InstructionDownloadForm } from "../_shared/ui/InstructionDownloadForm";

// 公開ダウンロード画面(入荷指示書ダウンロード)。共通部品にタイトル・API・ファイル名だけを渡す薄いラッパー
export default function ReceiptInstructionDownloadPage() {
  return (
    <PublicPage>
      <InstructionDownloadForm
        apiBasePath="/api/receipt-instructions"
        title="入荷指示書ダウンロード"
        fileNamePrefix="入荷指示書"
      />
    </PublicPage>
  );
}
