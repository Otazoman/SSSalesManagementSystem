"use client";

import { PublicPage } from "../_shared/ui/PublicPage";
import { OtpDownloadCard } from "../_shared/ui/OtpDownloadCard";

// 公開ダウンロード画面(メールアドレス→確認コード→ダウンロード)。共通部品 OtpDownloadCard に、
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
