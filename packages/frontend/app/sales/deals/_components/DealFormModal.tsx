"use client";

import { useState } from "react";
import {
  useDealForm,
  emptyProspectContact,
  NewProspectContact,
} from "../_hooks/useDealForm";
import {
  ATTENDEE_KIND_LABELS,
  DEAL_STATUS_LABELS,
  DealStatus,
  EmployeeOption,
  PartnerOption,
} from "../_types";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { Modal } from "../../../_shared/ui/Modal";
import { FormActions } from "../../../_shared/ui/FormActions";
import { FormGrid } from "../../../_shared/ui/FormGrid";
import { buttonClass } from "../../../_shared/ui/Button";

const INPUT_CLASS =
  "border border-slate-400 rounded px-2 py-1.5 bg-white text-slate-900 placeholder-slate-500 text-base sm:text-xs";
const SUB_BUTTON = buttonClass({ variant: "secondary", size: "sm" });
const MAIN_BUTTON = buttonClass({ variant: "primary", size: "sm" });
const SECTION = "border border-slate-300 rounded-lg p-3 space-y-2";

type DealForm = ReturnType<typeof useDealForm>;

interface DealFormModalProps {
  f: DealForm;
  partners: PartnerOption[];
  employees: EmployeeOption[];
  canEdit: boolean; // 登録(新規)または更新の権限がある
}

// 面談者の追加(見込客担当者・取引先担当者・自社同席者・自由記入)と、見込客担当者のその場登録
function AttendeeSection({
  f,
  employees,
  canEdit,
}: {
  f: DealForm;
  employees: EmployeeOption[];
  canEdit: boolean;
}) {
  const [free, setFree] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newContact, setNewContact] = useState<NewProspectContact>(
    emptyProspectContact(),
  );

  const select = (
    label: string,
    options: { value: string; text: string }[],
    onPick: (value: string) => void,
  ) => (
    <label className="flex flex-col gap-1 sm:flex-row sm:items-center">
      <span className="sm:w-28 shrink-0 font-semibold text-slate-800">
        {label}
      </span>
      <select
        value=""
        disabled={!canEdit || !f.form.partnerId}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        className={`${INPUT_CLASS} w-full sm:w-56 disabled:opacity-50`}
      >
        <option value="">選択して追加</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.text}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className={SECTION}>
      <h3 className="font-bold text-slate-900">🧑‍🤝‍🧑 面談者(誰と会ったか)</h3>
      {f.form.attendees.length === 0 ? (
        <p className="text-slate-700">面談者はまだ追加されていません</p>
      ) : (
        <ul className="space-y-1">
          {f.form.attendees.map((a, index) => (
            <li
              key={`${a.kind}:${a.refId ?? a.name}`}
              className="flex items-center gap-2"
            >
              <span className="px-1.5 py-0.5 rounded border border-slate-400 bg-slate-50 text-slate-900 font-semibold">
                {ATTENDEE_KIND_LABELS[a.kind]}
              </span>
              <span className="font-semibold text-slate-900">{a.name}</span>
              {a.note && <span className="text-slate-700">{a.note}</span>}
              {canEdit && (
                <button
                  onClick={() => f.removeAttendee(index)}
                  className="ml-auto text-red-800 underline font-semibold"
                >
                  外す
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="space-y-1 pt-1">
          {select(
            "見込客担当者",
            f.candidates.prospectContacts.map((c) => ({
              value: c.id,
              text: `${c.name}${c.departmentName ? `(${c.departmentName})` : ""}`,
            })),
            (id) => {
              const c = f.candidates.prospectContacts.find((p) => p.id === id);
              if (c) {
                f.addAttendee({
                  kind: "PROSPECT_CONTACT",
                  refId: c.id,
                  name: c.name,
                  note:
                    [c.departmentName, c.position].filter(Boolean).join(" ") ||
                    null,
                });
              }
            },
          )}
          {select(
            "取引先担当者",
            f.candidates.partnerContacts.map((c) => ({
              value: c.id,
              text: `${c.name}${c.departmentName ? `(${c.departmentName})` : ""}`,
            })),
            (id) => {
              const c = f.candidates.partnerContacts.find((p) => p.id === id);
              if (c)
                f.addAttendee({
                  kind: "PARTNER_CONTACT",
                  refId: c.id,
                  name: c.name,
                  note: c.departmentName,
                });
            },
          )}
          <label className="flex flex-col gap-1 sm:flex-row sm:items-center">
            <span className="sm:w-28 shrink-0 font-semibold text-slate-800">
              自社同席者
            </span>
            <select
              value=""
              onChange={(e) => {
                const emp = employees.find(
                  (x) => x.employeeNumber === e.target.value,
                );
                if (emp)
                  f.addAttendee({
                    kind: "EMPLOYEE",
                    refId: emp.employeeNumber,
                    name: emp.name,
                    note: null,
                  });
              }}
              className={`${INPUT_CLASS} w-full sm:w-56`}
            >
              <option value="">選択して追加</option>
              {employees.map((emp) => (
                <option key={emp.employeeNumber} value={emp.employeeNumber}>
                  {emp.name}({emp.employeeNumber})
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
            <span className="sm:w-28 shrink-0 font-semibold text-slate-800">
              その他(未登録)
            </span>
            <input
              type="text"
              value={free}
              onChange={(e) => setFree(e.target.value)}
              placeholder="氏名を入力(担当者未登録の相手)"
              className={`${INPUT_CLASS} w-full sm:w-56`}
            />
            <button
              disabled={free.trim() === ""}
              onClick={() => {
                f.addAttendee({
                  kind: "FREE",
                  refId: null,
                  name: free.trim(),
                  note: null,
                });
                setFree("");
              }}
              className={SUB_BUTTON}
            >
              追加
            </button>
          </div>

          <div className="pt-1">
            <button
              type="button"
              disabled={!f.form.partnerId}
              onClick={() => setShowNew((v) => !v)}
              className="font-semibold text-indigo-800 underline disabled:opacity-50"
            >
              {showNew
                ? "▼ 見込客担当者の新規登録を閉じる"
                : "▶ 見込客担当者を新規登録して面談者に追加"}
            </button>
            {showNew && (
              <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 border border-slate-300 rounded bg-white">
                {(
                  [
                    ["name", "氏名 *"],
                    ["departmentName", "部署"],
                    ["position", "役職"],
                    ["email", "メール"],
                    ["phone", "電話"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="space-y-0.5">
                    <span className="block font-semibold text-slate-800">
                      {label}
                    </span>
                    <input
                      type="text"
                      value={newContact[key]}
                      onChange={(e) =>
                        setNewContact({ ...newContact, [key]: e.target.value })
                      }
                      className={`${INPUT_CLASS} w-full`}
                    />
                  </label>
                ))}
                <div className="sm:col-span-2 flex justify-end">
                  <button
                    onClick={async () => {
                      if (await f.createProspectContact(newContact)) {
                        setNewContact(emptyProspectContact());
                        setShowNew(false);
                      }
                    }}
                    className={MAIN_BUTTON}
                  >
                    登録して面談者に追加
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 追加要望M-1: 商談の登録・編集モーダル
export function DealFormModal({
  f,
  partners,
  employees,
  canEdit,
}: DealFormModalProps) {
  if (!f.open) return null;
  const isNew = f.form.id === null;

  return (
    <Modal
      title={`🤝 ${isNew ? "商談を登録" : `商談 ${f.form.id}`}`}
      size="4xl"
      onClose={f.close}
      warnOnDiscard
      footer={
        <FormActions
          mode={!canEdit ? "view" : isNew ? "create" : "edit"}
          onCancel={f.close}
          onSubmit={() => void f.save()}
          loading={f.saving}
          submitDisabled={!f.canSave}
        />
      }
    >
      <MessageBanner message={f.message} error={f.error} />

      <div className={SECTION}>
        <FormGrid cols={3}>
          <label className="sm:col-span-2 space-y-1">
            <span className="font-semibold text-slate-800">
              取引先(見込み客) *
            </span>
            <select
              value={f.form.partnerId}
              disabled={!canEdit || !isNew}
              onChange={(e) => f.changePartner(e.target.value)}
              className={`${INPUT_CLASS} w-full disabled:opacity-60`}
            >
              <option value="">選択してください</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.id}] {p.name}
                  {p.type === "PROSPECT" ? "(見込み客)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-slate-800">状態</span>
            <select
              value={f.form.status}
              disabled={!canEdit}
              onChange={(e) => f.change("status", e.target.value as DealStatus)}
              className={`${INPUT_CLASS} w-full`}
            >
              {Object.entries(DEAL_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2 lg:col-span-3 space-y-1">
            <span className="font-semibold text-slate-800">商談名 *</span>
            <input
              type="text"
              value={f.form.title}
              disabled={!canEdit}
              onChange={(e) => f.change("title", e.target.value)}
              className={`${INPUT_CLASS} w-full`}
            />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-slate-800">商談日 *</span>
            <input
              type="date"
              value={f.form.dealDate}
              disabled={!canEdit}
              onChange={(e) => f.change("dealDate", e.target.value)}
              className={`${INPUT_CLASS} w-full`}
            />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-slate-800">開始時刻</span>
            <input
              type="time"
              value={f.form.startTime}
              disabled={!canEdit}
              onChange={(e) => f.change("startTime", e.target.value)}
              className={`${INPUT_CLASS} w-full`}
            />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-slate-800">終了時刻</span>
            <input
              type="time"
              value={f.form.endTime}
              disabled={!canEdit}
              onChange={(e) => f.change("endTime", e.target.value)}
              className={`${INPUT_CLASS} w-full`}
            />
          </label>
          <label className="sm:col-span-2 space-y-1">
            <span className="font-semibold text-slate-800">場所</span>
            <input
              type="text"
              value={f.form.location}
              disabled={!canEdit}
              onChange={(e) => f.change("location", e.target.value)}
              className={`${INPUT_CLASS} w-full`}
            />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-slate-800">商談担当(自社)</span>
            <select
              value={f.form.ownerEmployeeNumber}
              disabled={!canEdit}
              onChange={(e) => f.change("ownerEmployeeNumber", e.target.value)}
              className={`${INPUT_CLASS} w-full`}
            >
              <option value="">未設定</option>
              {employees.map((emp) => (
                <option key={emp.employeeNumber} value={emp.employeeNumber}>
                  {emp.name}({emp.employeeNumber})
                </option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2 lg:col-span-3 space-y-1">
            <span className="font-semibold text-slate-800">メモ(商談内容)</span>
            <textarea
              value={f.form.memo}
              disabled={!canEdit}
              onChange={(e) => f.change("memo", e.target.value)}
              rows={5}
              className={`${INPUT_CLASS} w-full`}
            />
          </label>
        </FormGrid>
      </div>

      <AttendeeSection f={f} employees={employees} canEdit={canEdit} />

      <div className={SECTION}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-900">✅ 次回までのタスク</h3>
          {canEdit && (
            <button onClick={f.addTask} className={SUB_BUTTON}>
              ➕ タスクを追加
            </button>
          )}
        </div>
        {f.form.tasks.length === 0 && (
          <p className="text-slate-700">タスクはありません</p>
        )}
        {f.form.tasks.map((t, index) => (
          <div
            key={t.id ?? `new-${index}`}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="checkbox"
              checked={t.isDone}
              disabled={!canEdit}
              onChange={(e) =>
                f.changeTask(index, { isDone: e.target.checked })
              }
              aria-label="完了"
            />
            <input
              type="text"
              value={t.title}
              disabled={!canEdit}
              placeholder="タスク名"
              onChange={(e) => f.changeTask(index, { title: e.target.value })}
              className={`${INPUT_CLASS} w-full sm:w-64`}
            />
            <input
              type="date"
              value={t.dueDate ?? ""}
              disabled={!canEdit}
              onChange={(e) =>
                f.changeTask(index, { dueDate: e.target.value || null })
              }
              className={INPUT_CLASS}
              aria-label="期限"
            />
            <select
              value={t.assigneeEmployeeNumber ?? ""}
              disabled={!canEdit}
              onChange={(e) =>
                f.changeTask(index, {
                  assigneeEmployeeNumber: e.target.value || null,
                })
              }
              className={`${INPUT_CLASS} w-full sm:w-44`}
              aria-label="担当者"
            >
              <option value="">担当者未設定</option>
              {employees.map((emp) => (
                <option key={emp.employeeNumber} value={emp.employeeNumber}>
                  {emp.name}
                </option>
              ))}
            </select>
            {canEdit && (
              <button
                onClick={() => f.removeTask(index)}
                className="text-red-800 underline font-semibold"
              >
                削除
              </button>
            )}
          </div>
        ))}
      </div>

      <div className={SECTION}>
        <h3 className="font-bold text-slate-900">
          📄 紐づける見積(同じ取引先の見積)
        </h3>
        {!f.form.partnerId ? (
          <p className="text-slate-700">
            取引先を選択すると、その取引先の見積を紐づけできます
          </p>
        ) : f.quoteCandidates.length === 0 ? (
          <p className="text-slate-700">
            この取引先の見積はまだありません(見積管理で見積を作成すると、ここから紐づけできます)
          </p>
        ) : (
          <ul className="space-y-1 max-h-40 overflow-auto">
            {f.quoteCandidates.map((q) => (
              <li key={q.id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={f.form.quoteIds.includes(q.id)}
                    onChange={() => f.toggleQuote(q.id)}
                  />
                  <span className="font-mono font-bold">{q.id}</span>
                  <span>{q.title ?? "(件名なし)"}</span>
                  <span className="text-slate-700">
                    {q.quoteDate ?? ""} / ¥{q.totalAmount.toLocaleString()} /{" "}
                    {q.status}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={SECTION}>
        <h3 className="font-bold text-slate-900">
          📎 添付ファイル(議事録・資料など。専用の保管先に保存されます)
        </h3>
        {isNew ? (
          <p className="text-slate-700">
            商談を登録すると、添付ファイルを追加できます
          </p>
        ) : (
          <>
            {(f.detail?.attachments ?? []).length === 0 && (
              <p className="text-slate-700">添付ファイルはありません</p>
            )}
            <ul className="space-y-1">
              {(f.detail?.attachments ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <a
                    href={`/api/sales-deals/${f.form.id}/attachments/${a.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-800 underline font-semibold"
                  >
                    {a.fileName}
                  </a>
                  <span className="text-slate-700">
                    {a.uploadedAt.slice(0, 10)}
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => void f.removeAttachment(a.id)}
                      className="text-red-800 underline font-semibold"
                    >
                      削除
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <label className="block">
                <span className="mr-2 font-semibold text-slate-800">
                  ファイルを追加(20MBまで)
                </span>
                <input
                  type="file"
                  disabled={f.uploading}
                  onChange={(e) => void f.uploadAttachment(e)}
                />
              </label>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
