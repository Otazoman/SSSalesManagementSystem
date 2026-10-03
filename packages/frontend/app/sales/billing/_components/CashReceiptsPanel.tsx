"use client";

import { useCashReceipts } from "../_hooks/useCashReceipts";
import { METHOD_LABELS, CashReceiptFilters } from "../_types/cash-receipts";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { LoadingGate } from "../../../_shared/ui/LoadingGate";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { Modal } from "../../../_shared/ui/Modal";
import { FormActions } from "../../../_shared/ui/FormActions";
import { buttonClass } from "../../../_shared/ui/Button";
import { selectablePartners } from "../../../_shared/partner-options";

const INPUT_CLASS =
  "border border-slate-400 rounded px-2 py-1.5 bg-white text-slate-900 placeholder-slate-500 text-base sm:text-xs";
const SUB_BUTTON = buttonClass({ variant: "secondary" });
const MAIN_BUTTON = buttonClass({ variant: "primary" });

interface CashReceiptsPanelProps {
  // 請求管理画面(sales_billing)の権限をそのまま使う(入金管理は請求管理の中の機能)
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

// 追加要望L-1-a: 請求管理の「入金(単体入金)」タブ。請求を介さない入金の登録・請求への紐づけ・削除・CSV出力
export function CashReceiptsPanel({
  canCreate,
  canUpdate,
  canDelete,
}: CashReceiptsPanelProps) {
  const c = useCashReceipts(true);

  const partnerName = (id: string) =>
    c.partners.find((p) => p.id === id)?.name || id;
  const canSubmitRegister =
    !!c.registerForm.partnerId &&
    !!c.registerForm.receiptDate &&
    Number(c.registerForm.amount) >= 1;

  return (
    <div className="w-full space-y-4">
      <div className="border-b pb-3 border-slate-200">
        <h2 className="text-lg font-black text-slate-900">💰 入金(単体入金)</h2>
        <p className="text-xs text-slate-700 mt-1">
          請求書を作成していなくても、取引先・入金日・金額を指定して入金を登録できます。登録後は、同じ取引先の請求に「紐づけ」て消込します
          (消込は請求画面の入金消込と同じ処理で、請求の消込状況に反映されます)。紐づけ前の入金は削除できます。
        </p>
      </div>

      <MessageBanner message={c.message} error={c.error} />

      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">取引先</span>
          <select
            value={c.draft.partnerId}
            onChange={(e) => c.changeDraft("partnerId", e.target.value)}
            className={`${INPUT_CLASS} w-56`}
          >
            <option value="">すべて</option>
            {c.partners.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.id}] {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">状態</span>
          <select
            value={c.draft.status}
            onChange={(e) =>
              c.changeDraft(
                "status",
                e.target.value as CashReceiptFilters["status"],
              )
            }
            className={INPUT_CLASS}
          >
            <option value="all">すべて</option>
            <option value="UNLINKED">未紐づけ</option>
            <option value="LINKED">紐づけ済み</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            入金日(開始)
          </span>
          <input
            type="date"
            value={c.draft.startDate}
            onChange={(e) => c.changeDraft("startDate", e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            入金日(終了)
          </span>
          <input
            type="date"
            value={c.draft.endDate}
            onChange={(e) => c.changeDraft("endDate", e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        {/* BUG-031: 条件は入力するとすぐ反映されるため、「検索」ボタンは置かない */}
        <button onClick={c.handleClear} className={SUB_BUTTON}>
          条件をクリア
        </button>
        <button
          onClick={() => void c.handleDownloadCsv()}
          disabled={c.downloading}
          className={SUB_BUTTON}
        >
          CSVダウンロード
        </button>
        {canCreate && (
          <button onClick={c.openRegister} className={MAIN_BUTTON}>
            ➕ 入金を登録
          </button>
        )}
      </div>

      {c.loading ? (
        <LoadingGate label="読み込み中..." />
      ) : (
        <div className="overflow-auto max-h-[70vh] border border-slate-200 rounded-lg bg-white">
          <table className="min-w-full text-xs text-slate-900">
            <thead className="bg-slate-100 text-slate-900">
              <tr>
                {[
                  "入金番号",
                  "取引先",
                  "入金日",
                  "金額",
                  "方法",
                  "状態",
                  "紐づけ先の請求",
                  "摘要",
                  "操作",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left whitespace-nowrap sticky top-0 bg-slate-100"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {c.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-8 text-center text-slate-700"
                  >
                    該当する入金がありません
                  </td>
                </tr>
              )}
              {c.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-mono font-bold whitespace-nowrap">
                    {r.id}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {partnerName(r.partnerId)}
                  </td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">
                    {r.receiptDate.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 font-mono font-bold text-right whitespace-nowrap">
                    ¥{r.amount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {METHOD_LABELS[r.method]}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.status === "LINKED" ? (
                      <StatusBadge label="紐づけ済み" tone="emerald" />
                    ) : (
                      <StatusBadge label="未紐づけ" tone="amber" />
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">
                    {r.billingHeaderId ?? ""}
                  </td>
                  <td className="px-3 py-2">{r.memo ?? ""}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.status === "UNLINKED" && canUpdate && (
                      <button
                        onClick={() => void c.openLink(r)}
                        className="px-2 py-0.5 mr-1 border border-indigo-600 text-indigo-800 rounded bg-white hover:bg-indigo-50 font-semibold"
                      >
                        請求へ紐づけ
                      </button>
                    )}
                    {r.status === "UNLINKED" && canDelete && (
                      <button
                        onClick={() => void c.remove(r)}
                        className="px-2 py-0.5 border border-red-600 text-red-800 rounded bg-white hover:bg-red-50 font-semibold"
                      >
                        削除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {c.showRegister && (
        <Modal
          title="入金を登録"
          onClose={() => c.setShowRegister(false)}
          warnOnDiscard
          footer={
            <FormActions
              mode="create"
              onCancel={() => c.setShowRegister(false)}
              onSubmit={() => void c.submitRegister()}
              loading={c.saving}
              submitDisabled={!canSubmitRegister}
            />
          }
        >
          <label className="block space-y-1">
            <span className="font-semibold text-slate-800">取引先 *</span>
            <select
              value={c.registerForm.partnerId}
              onChange={(e) =>
                c.setRegisterForm({
                  ...c.registerForm,
                  partnerId: e.target.value,
                })
              }
              className={`${INPUT_CLASS} w-full`}
            >
              <option value="">選択してください</option>
              {selectablePartners(c.partners, c.registerForm.partnerId).map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.id}] {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="font-semibold text-slate-800">入金日 *</span>
              <input
                type="date"
                value={c.registerForm.receiptDate}
                onChange={(e) =>
                  c.setRegisterForm({
                    ...c.registerForm,
                    receiptDate: e.target.value,
                  })
                }
                className={`${INPUT_CLASS} w-full`}
              />
            </label>
            <label className="block space-y-1">
              <span className="font-semibold text-slate-800">金額(円) *</span>
              <input
                type="number"
                min={1}
                value={c.registerForm.amount}
                onChange={(e) =>
                  c.setRegisterForm({
                    ...c.registerForm,
                    amount: e.target.value,
                  })
                }
                className={`${INPUT_CLASS} w-full`}
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="font-semibold text-slate-800">入金方法</span>
            <select
              value={c.registerForm.method}
              onChange={(e) =>
                c.setRegisterForm({
                  ...c.registerForm,
                  method: e.target.value as typeof c.registerForm.method,
                })
              }
              className={`${INPUT_CLASS} w-full`}
            >
              {Object.entries(METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-semibold text-slate-800">摘要</span>
            <input
              type="text"
              value={c.registerForm.memo}
              onChange={(e) =>
                c.setRegisterForm({ ...c.registerForm, memo: e.target.value })
              }
              className={`${INPUT_CLASS} w-full`}
            />
          </label>
        </Modal>
      )}

      {c.linkTarget && (
        <Modal
          title={
            <>
              入金[{c.linkTarget.id}](¥{c.linkTarget.amount.toLocaleString()}
              )を請求へ紐づけて消込
            </>
          }
          size="2xl"
          onClose={() => c.setLinkTarget(null)}
          footer={
            <FormActions mode="view" onCancel={() => c.setLinkTarget(null)} />
          }
        >
          <p className="text-slate-700">
            {partnerName(c.linkTarget.partnerId)}{" "}
            の、まだ全額消込されていない請求から選択してください。
          </p>
          <div className="overflow-auto max-h-72 border border-slate-200 rounded">
            <table className="min-w-full">
              <thead className="bg-slate-100">
                <tr>
                  {["請求番号", "請求日", "請求額", "消込済み", "状況", ""].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-3 py-1.5 text-left whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {c.billingCandidates.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-slate-700"
                    >
                      紐づけできる請求がありません
                    </td>
                  </tr>
                )}
                {c.billingCandidates.map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-1.5 font-mono font-bold">{b.id}</td>
                    <td className="px-3 py-1.5 font-mono">
                      {String(b.billingDate).slice(0, 10)}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-right">
                      ¥{b.totalAmount.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-right">
                      ¥{b.reconciledAmount.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5">
                      {b.reconciliationStatus === "PARTIALLY_RECONCILED"
                        ? "一部消込"
                        : "未消込"}
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => void c.submitLink(b.id)}
                        disabled={c.saving}
                        className="px-2 py-0.5 border border-indigo-600 text-indigo-800 rounded bg-white hover:bg-indigo-50 font-semibold disabled:opacity-50"
                      >
                        この請求に紐づける
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
