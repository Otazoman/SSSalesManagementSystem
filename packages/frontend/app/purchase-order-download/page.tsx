"use client";

import { PublicPage } from "../_shared/ui/PublicPage";
import { OtpDownloadCard } from "../_shared/ui/OtpDownloadCard";

// 公開ダウンロード画面(確認コードの送信→確認コード→ダウンロード。REQ-007 でメールアドレスの入力をやめた)。共通部品 OtpDownloadCard に、
// この画面のタイトル・API・ID名・ファイル名だけを渡す
export default function PurchaseOrderDownloadPage() {
  return (
    <PublicPage>
      <OtpDownloadCard
        title="🛒 発注書ダウンロード"
        apiBasePath="/api/purchase-orders"
        idParam="orderId"
        fileNamePrefix="発注書"
      />
    </PublicPage>
  );
}
