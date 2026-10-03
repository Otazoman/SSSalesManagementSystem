"use client";

import { PublicPage } from "../_shared/ui/PublicPage";
import { ForcePasswordChangeForm } from "./_components/ForcePasswordChangeForm";

export default function ForcePasswordChangePage() {
  return (
    <PublicPage>
      <ForcePasswordChangeForm />
    </PublicPage>
  );
}
