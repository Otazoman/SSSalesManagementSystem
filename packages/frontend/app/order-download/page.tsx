"use client";

import { PublicPage } from "../_shared/ui/PublicPage";
import { OtpDownloadCard } from "../_shared/ui/OtpDownloadCard";

// 公開ダウンロード画面(メールアドレス→確認コード→ダウンロード)。共通部品 OtpDownloadCard に、
// この画面のタイトル・API・ID名・ファイル名だけを渡す
export default function OrderDownloadPage() {
  return (
    <PublicPage>
      <OtpDownloadCard
        title="📋 注文請書ダウンロード"
        apiBasePath="/api/sales-orders"
        idParam="orderId"
        fileNamePrefix="注文請書"
      />
    </PublicPage>
  );
}
