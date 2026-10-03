"use client";

import { ContactRecord, PartnerLookup, UserLookup } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";
import {
  PARTNER_CONTACT_DOCUMENT_TYPE_OPTIONS,
  summarizeDocumentTypes,
} from "../../../_shared/contact-document-types";

interface ContactTableProps {
  contacts: ContactRecord[];
  partners: PartnerLookup[];
  users: UserLookup[];
  canUpdate: boolean;
  canDelete: boolean;
  onEditClick: (contact: ContactRecord) => void;
  onDeleteClick: (id: string) => void;
  onSuspendClick?: (id: string) => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function ContactTable({
  contacts,
  partners,
  users,
  canUpdate,
  canDelete,
  onEditClick,
  onDeleteClick,
  onSuspendClick,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: ContactTableProps) {
  return (
    <DataTable
      columns={[
        { key: "partnerId", label: "取引先", sortable: true },
        { key: "contactType", label: "区分", sortable: true },
        { key: "name", label: "氏名 / ユーザー名", sortable: true },
        { key: "contact", label: "連絡先等" },
        { key: "documentTypes", label: "メールで送る帳票" },
        { key: "actions", label: "操作", align: "center" },
      ]}
      data={contacts}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(c) => {
        const cust = partners.find((cu) => cu.id === c.partnerId);
        const usr = users.find((u) => u.id === c.internalUserId);
        return (
          <tr
            key={c.id}
            className={`hover:bg-slate-50 transition-colors ${
              cust?.status === "suspended"
                ? "opacity-60 bg-slate-50 text-slate-600"
                : "cursor-pointer"
            }`}
            onClick={() => onEditClick(c)}
          >
            <td className="px-4 py-3 font-semibold">
              {cust ? cust.name : c.partnerId}
              {cust?.status === "suspended" && (
                <span className="ml-2 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold border border-red-200">
                  無効
                </span>
              )}
            </td>
            <td className="px-4 py-3">
              <span className="text-[10px] bg-slate-100 font-bold px-1.5 py-0.5 rounded border border-slate-200 whitespace-nowrap">
                {c.contactType}
              </span>
            </td>
            <td className="px-4 py-3 font-bold text-indigo-600 whitespace-nowrap">
              {c.internalUserId
                ? `[自社] ${usr?.name || c.internalUserId}`
                : c.name}
              {c.status === "temporary" && (
                <span className="ml-2 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold border border-amber-200">
                  仮登録/申請中
                </span>
              )}
              {c.status === "suspended" && (
                <span className="ml-2 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold border border-red-200">
                  無効
                </span>
              )}
            </td>
            <td className="px-4 py-3">
              <div>
                {c.email || "メールなし"}{" "}
                {c.isEmailTarget && (
                  <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1 rounded ml-1 border border-indigo-100 whitespace-nowrap">
                    📧システム通知対象
                  </span>
                )}
              </div>
              {(c.phone || c.fax) && (
                <div className="text-[10px] text-slate-600 font-medium">
                  {c.phone && <span>TEL: {c.phone}</span>}
                  {c.phone && c.fax && <span className="mx-1.5">/</span>}
                  {c.fax && <span>FAX: {c.fax}</span>}
                </div>
              )}

              <div className="text-[10px] text-slate-600">
                {c.departmentName}
              </div>
            </td>
            <td className="px-4 py-3 text-xs text-slate-700">
              {summarizeDocumentTypes(
                c.documentTypes ??
                  (c.isEmailTarget
                    ? PARTNER_CONTACT_DOCUMENT_TYPE_OPTIONS.map((o) => o.value)
                    : []),
                PARTNER_CONTACT_DOCUMENT_TYPE_OPTIONS,
              )}
            </td>
            <td
              className="px-4 py-3 text-center space-x-2 whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              {canUpdate ? (
                <button
                  onClick={() => onEditClick(c)}
                  className="text-indigo-600 font-bold hover:underline cursor-pointer"
                >
                  変更
                </button>
              ) : (
                <span className="text-slate-500 opacity-70 font-bold cursor-not-allowed select-none">
                  変更
                </span>
              )}

              {c.status !== "suspended"
                ? onSuspendClick &&
                  (canDelete ? (
                    <button
                      onClick={() => onSuspendClick(c.id)}
                      className="text-amber-600 font-bold hover:underline cursor-pointer"
                    >
                      無効化
                    </button>
                  ) : (
                    <span className="text-slate-500 opacity-70 font-bold cursor-not-allowed select-none">
                      無効化
                    </span>
                  ))
                : (canDelete ? (
                  <button
                    onClick={() => onDeleteClick(c.id)}
                    className="text-red-600 font-bold hover:underline cursor-pointer"
                  >
                    完全に削除 🗑️
                  </button>
                ) : (
                  <span className="text-slate-500 opacity-70 font-bold cursor-not-allowed select-none">
                    完全に削除 🗑️
                  </span>
                ))}
            </td>
          </tr>
        );
      }}
    />
  );
}
