"use client";

import { PublicPage } from "../_shared/ui/PublicPage";
import { OtpDownloadCard } from "../_shared/ui/OtpDownloadCard";

// 公開ダウンロード画面(確認コードの送信→確認コード→ダウンロード。REQ-007 でメールアドレスの入力をやめた)。共通部品 OtpDownloadCard に、
// この画面のタイトル・API・ID名・ファイル名だけを渡す
export default function BillingDownloadPage() {
  return (
    <PublicPage>
      <OtpDownloadCard
        title="🧾 請求書ダウンロード"
        apiBasePath="/api/sales-billing"
        idParam="billingId"
        fileNamePrefix="請求書"
        withAttachment={false}
      />
    </PublicPage>
  );
}
