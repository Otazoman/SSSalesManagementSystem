"use client";

import { useEffect, useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { DocumentTypeChecklist } from "../../../_shared/ui/DocumentTypeChecklist";
import {
  WAREHOUSE_CONTACT_DOCUMENT_TYPE_OPTIONS,
  summarizeDocumentTypes,
} from "../../../_shared/contact-document-types";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

const ALL_DOCUMENT_TYPES = WAREHOUSE_CONTACT_DOCUMENT_TYPE_OPTIONS.map(
  (o) => o.value,
);

interface WarehouseContactRecord {
  id: string;
  warehouseId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  isEmailTarget: boolean;
  /** メールで送る帳票(V-5) */
  documentTypes?: string[];
  memo: string | null;
  status: string;
}

interface WarehouseContactsModalProps {
  warehouseId: string;
  warehouseName: string;
  canUpdate: boolean;
  onClose: () => void;
}

const inputClass =
  "w-full text-sm border border-slate-300 rounded px-2 py-2 bg-white text-slate-900";

// Item6 Phase6-4: 倉庫マスタの複数連絡先(出荷指示書/入荷指示書のOTPダウンロード宛先)管理モーダル。
// partner-contacts画面の簡易版(承認ワークフローは持たない)
export function WarehouseContactsModal({
  warehouseId,
  warehouseName,
  canUpdate,
  onClose,
}: WarehouseContactsModalProps) {
  const confirm = useConfirm();
  const [contacts, setContacts] = useState<WarehouseContactRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isEmailTarget, setIsEmailTarget] = useState(true);
  const [documentTypes, setDocumentTypes] = useState<string[]>(ALL_DOCUMENT_TYPES);
  // 登録済みの連絡先の「メールで送る帳票」を編集中の連絡先ID
  const [editingDocumentTypesId, setEditingDocumentTypesId] = useState<string | null>(null);
  const [draftDocumentTypes, setDraftDocumentTypes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const refetch = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<WarehouseContactRecord[]>(
        `/api/warehouse-contacts?warehouseId=${encodeURIComponent(warehouseId)}&status=all`,
      );
      setContacts(data);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "連絡先の取得に失敗しました",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      await refetch();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId]);

  const handleAdd = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!email.trim()) {
      setError("メールアドレスを入力してください");
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiFetch<{ message: string }>(
        "/api/warehouse-contacts/register",
        {
          method: "POST",
          json: {
            warehouseId,
            name: name || null,
            email,
            phone: phone || null,
            isEmailTarget,
            documentTypes,
            memo: null,
          },
          defaultErrorMessage: "連絡先の登録に失敗しました",
        },
      );
      setMessage(result.message);
      setName("");
      setEmail("");
      setPhone("");
      setIsEmailTarget(true);
      setDocumentTypes(ALL_DOCUMENT_TYPES);
      await refetch();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "連絡先の登録に失敗しました",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDocumentTypes = async (ct: WarehouseContactRecord) => {
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<{ message: string }>(
        `/api/warehouse-contacts/${ct.id}`,
        {
          method: "PUT",
          json: {
            name: ct.name,
            email: ct.email,
            phone: ct.phone,
            isEmailTarget: ct.isEmailTarget,
            documentTypes: draftDocumentTypes,
            memo: ct.memo,
            status: ct.status,
          },
          defaultErrorMessage: "メールで送る帳票の変更に失敗しました",
        },
      );
      setMessage(result.message);
      setEditingDocumentTypesId(null);
      await refetch();
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "メールで送る帳票の変更に失敗しました",
      );
    }
  };

  const handleSuspend = async (id: string) => {
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<{ message: string }>(
        `/api/warehouse-contacts/${id}/suspend`,
        {
          method: "POST",
          defaultErrorMessage: "連絡先の無効化に失敗しました",
        },
      );
      setMessage(result.message);
      await refetch();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "連絡先の無効化に失敗しました",
      );
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm("この連絡先を完全に削除しますか？"))) return;
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<{ message: string }>(
        `/api/warehouse-contacts/${id}`,
        {
          method: "DELETE",
          defaultErrorMessage: "連絡先の削除に失敗しました",
        },
      );
      setMessage(result.message);
      await refetch();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "連絡先の削除に失敗しました",
      );
    }
  };

  return (
    <Modal
      title={
        <>
          📇 連絡先管理: {warehouseName} ({warehouseId})
        </>
      }
      size="2xl"
      onClose={onClose}
    >
      <p className="text-xs text-slate-600">
        ここに登録した連絡先が、出荷指示書・入荷指示書のOTPダウンロードリンク・確認コードの送信先になります(複数登録可)。
        未登録の場合は倉庫マスタのメールアドレス1件へフォールバックします。
        担当者ごとに、メールで送る帳票(出荷指示書・入荷指示書)を選べます。
      </p>

      <MessageBanner message={message} error={error} />

      {canUpdate && (
        <form
          onSubmit={handleAdd}
          className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="担当者名(任意)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
            <input
              type="email"
              placeholder="メールアドレス"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="電話番号(任意)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
            />
          </div>
          <DocumentTypeChecklist
            legend="メールで送る帳票"
            idPrefix="warehouse-contact-new-document-type"
            options={WAREHOUSE_CONTACT_DOCUMENT_TYPE_OPTIONS}
            value={documentTypes}
            onChange={setDocumentTypes}
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs text-slate-800 font-bold">
              <input
                type="checkbox"
                checked={isEmailTarget}
                onChange={(e) => setIsEmailTarget(e.target.checked)}
                className="w-4 h-4 cursor-pointer"
              />
              システム通知の対象にする
            </label>
            <Button type="submit" disabled={submitting}>
              {submitting ? "登録中..." : "＋ 連絡先を追加"}
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {loading && (
          <p className="text-xs text-slate-600 italic">読み込み中...</p>
        )}
        {!loading && contacts.length === 0 && (
          <p className="text-xs text-slate-600 italic">
            登録済みの連絡先がありません。
          </p>
        )}
        {contacts.map((ct) => (
          <div
            key={ct.id}
            className={`p-3 rounded-lg border space-y-2 ${
              ct.status === "suspended"
                ? "bg-slate-50 border-slate-200 opacity-60"
                : "bg-white border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <p className="font-bold text-slate-900">
                  {ct.name || "(名称未設定)"}{" "}
                  {!ct.isEmailTarget && (
                    <span className="text-[10px] text-slate-600 font-normal">
                      (システム通知の対象外)
                    </span>
                  )}
                  {ct.status === "suspended" && (
                    <span className="text-[10px] text-red-500 font-bold ml-1">
                      無効化済み
                    </span>
                  )}
                </p>
                <p className="text-slate-600 text-xs">
                  ✉️ {ct.email || "-"} {ct.phone ? `/ TEL: ${ct.phone}` : ""}
                </p>
                <p className="text-slate-700 text-xs">
                  メールで送る帳票:{" "}
                  {summarizeDocumentTypes(
                    ct.documentTypes ??
                      (ct.isEmailTarget ? ALL_DOCUMENT_TYPES : []),
                    WAREHOUSE_CONTACT_DOCUMENT_TYPE_OPTIONS,
                  )}
                </p>
              </div>
              {canUpdate && (
                <div className="space-x-3 shrink-0">
                  {ct.status !== "suspended" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingDocumentTypesId(ct.id);
                          setDraftDocumentTypes(
                            ct.documentTypes ??
                              (ct.isEmailTarget ? ALL_DOCUMENT_TYPES : []),
                          );
                        }}
                        className="text-xs font-bold text-indigo-600 hover:underline cursor-pointer"
                      >
                        帳票を変更
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSuspend(ct.id)}
                        className="text-xs font-bold text-amber-600 hover:underline cursor-pointer"
                      >
                        無効化
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleDelete(ct.id)}
                      className="text-xs font-bold text-red-600 hover:underline cursor-pointer"
                    >
                      完全に削除
                    </button>
                  )}
                </div>
              )}
            </div>
            {editingDocumentTypesId === ct.id && (
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
                <DocumentTypeChecklist
                  legend="メールで送る帳票"
                  idPrefix={`warehouse-contact-${ct.id}-document-type`}
                  options={WAREHOUSE_CONTACT_DOCUMENT_TYPE_OPTIONS}
                  value={draftDocumentTypes}
                  onChange={setDraftDocumentTypes}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setEditingDocumentTypesId(null)}
                  >
                    キャンセル
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleSaveDocumentTypes(ct)}
                  >
                    保存
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
