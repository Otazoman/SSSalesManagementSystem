import { useEffect, useState } from "react";
import { usePermissionContext } from "../../context/permissioncontext";
import { buildApprovalDocumentHref } from "./document-link";
import { fetchTargetEditPath } from "./useWorkflowScreensAndUsers";

// REQ-016: 承認のプレビューの右上に出す「伝票を開く」(別タブ)のリンク。
// 参照する権限(read か menu。管理者は全て)が無い画面へのリンクは出さない。
export function OpenDocumentLink({ targetType, targetId }: { targetType: string; targetId: string }) {
  const { user, flatScreens } = usePermissionContext();
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let canceled = false;
    void fetchTargetEditPath(targetType, targetId).then((resolved) => {
      if (!canceled) setPath(resolved);
    });
    return () => {
      canceled = true;
    };
  }, [user, targetType, targetId]);

  const href = buildApprovalDocumentHref(targetType, path, targetId);
  if (!user || !path || !href) return null;

  const cleanPath = path.replace(/\/$/, "");
  const screen = flatScreens.find((s) => s.path.replace(/\/$/, "") === cleanPath);
  const isAdmin = user.roleId === "admin";
  const canRead =
    isAdmin ||
    (!!screen &&
      (user.permissions.includes(`${screen.resource}:read`) ||
        user.permissions.includes(`${screen.resource}:menu`)));
  if (!canRead) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-auto text-[11px] font-medium text-indigo-800 underline hover:text-indigo-950"
      title="元の伝票の画面を別タブで開く"
    >
      ↗ 伝票を開く
    </a>
  );
}
