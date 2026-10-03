"use client";

import { PublicPage } from "../_shared/ui/PublicPage";
import { InstructionDownloadForm } from "../_shared/ui/InstructionDownloadForm";

// 公開ダウンロード画面(納品書ダウンロード)。共通部品にタイトル・API・ファイル名だけを渡す薄いラッパー
export default function DeliveryNoteDownloadPage() {
  return (
    <PublicPage>
      <InstructionDownloadForm
        apiBasePath="/api/stock-shipments"
        title="納品書ダウンロード"
        fileNamePrefix="納品書"
      />
    </PublicPage>
  );
}
