"use client";

import { PublicPage } from "../_shared/ui/PublicPage";
import { SetupAdminForm } from "./_components/SetupAdminForm";

export default function SetupInitAdminPage() {
  return (
    <PublicPage tone="dark" className="select-none">
      <SetupAdminForm />
    </PublicPage>
  );
}
