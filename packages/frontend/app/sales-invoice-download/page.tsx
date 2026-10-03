"use client";

import { PublicPage } from "../_shared/ui/PublicPage";
import { OtpDownloadCard } from "../_shared/ui/OtpDownloadCard";

// 公開ダウンロード画面(メールアドレス→確認コード→ダウンロード)。共通部品 OtpDownloadCard に、
// この画面のタイトル・API・ID名・ファイル名だけを渡す
export default function SalesInvoiceDownloadPage() {
  return (
    <PublicPage>
      <OtpDownloadCard
        title="📄 売上関連書類ダウンロード"
        apiBasePath="/api/sales-invoices"
        idParam="invoiceId"
        fileNamePrefix="売上関連書類"
      />
    </PublicPage>
  );
}
