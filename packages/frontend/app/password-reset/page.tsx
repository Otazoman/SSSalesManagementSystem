"use client";

import { PublicPage } from "../_shared/ui/PublicPage";
import { PasswordResetForm } from "./_components/PasswordResetForm";

export default function PasswordResetPage() {
  return (
    // useSearchParams を使う子は Suspense で囲む必要がある(PublicPage が内包)
    <PublicPage fallback="トークンセッション読み込み中...">
      <PasswordResetForm />
    </PublicPage>
  );
}
