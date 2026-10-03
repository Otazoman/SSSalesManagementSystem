import React from "react";
import {
  ATTENDEE_KIND_LABELS,
  DEAL_STATUS_LABELS,
  DealDetail,
  DealStatus,
} from "../_types";
import { StatusBadge, StatusTone } from "../../../_shared/ui/StatusBadge";
import { SidePanel } from "../../../_shared/ui/SidePanel";

const STATUS_TONE: Record<DealStatus, StatusTone> = {
  OPEN: "sky",
  WON: "emerald",
  LOST: "red",
};

interface DealPreviewProps {
  previewDeal: DealDetail | null;
  onClose: () => void;
}

const LABEL = "text-slate-700 font-bold block text-[10px]";

// 見積・仕入などの「プレビュー」と同じ、右側にスライドして表示する読み取り専用の確認パネル
export function DealPreview({ previewDeal, onClose }: DealPreviewProps) {
  if (!previewDeal) return null;
  const time = previewDeal.startTime
    ? `${previewDeal.startTime}${previewDeal.endTime ? `〜${previewDeal.endTime}` : ""}`
    : "";

  return (
    <SidePanel
      eyebrow={previewDeal.id}
      title="商談プレビュー内容の最終確認"
      ariaLabel="商談プレビュー"
      closeAriaLabel="プレビューを閉じる"
      onClose={onClose}
    >
      <div>
        <label className={LABEL}>商談名</label>
        <div className="font-bold text-slate-900 text-sm mt-0.5">
          {previewDeal.title || "(無題の商談)"}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>取引先</label>
          <div className="font-bold text-slate-900 mt-0.5">
            {previewDeal.partnerName ?? previewDeal.partnerId}
          </div>
        </div>
        <div>
          <label className={LABEL}>状態</label>
          <div className="mt-0.5">
            <StatusBadge
              label={DEAL_STATUS_LABELS[previewDeal.status]}
              tone={STATUS_TONE[previewDeal.status]}
            />
          </div>
        </div>
        <div>
          <label className={LABEL}>商談日・時間</label>
          <div className="font-bold text-slate-900 mt-0.5">
            {previewDeal.dealDate}
            {time && ` ${time}`}
          </div>
        </div>
        <div>
          <label className={LABEL}>場所</label>
          <div className="font-bold text-slate-900 mt-0.5">
            {previewDeal.location || "未設定"}
          </div>
        </div>
        <div>
          <label className={LABEL}>商談担当</label>
          <div className="font-bold text-slate-900 mt-0.5">
            {previewDeal.ownerName || "未設定"}
          </div>
        </div>
      </div>

      {previewDeal.memo && (
        <div className="border-t border-slate-100 pt-3">
          <label className={LABEL}>メモ</label>
          <div className="mt-0.5 whitespace-pre-wrap text-slate-900">
            {previewDeal.memo}
          </div>
        </div>
      )}

      <div className="border-t border-slate-100 pt-3">
        <label className={`${LABEL} mb-1`}>
          面談者({previewDeal.attendees.length}名)
        </label>
        {previewDeal.attendees.length === 0 ? (
          <div className="text-slate-700">登録なし</div>
        ) : (
          <div className="divide-y border border-slate-200 rounded-lg overflow-hidden">
            {previewDeal.attendees.map((a, idx) => (
              <div key={a.id ?? idx} className="p-2 bg-white">
                <div className="font-bold text-slate-900">
                  {a.name}
                  <span className="ml-2 font-normal text-slate-700">
                    ({ATTENDEE_KIND_LABELS[a.kind]})
                  </span>
                </div>
                {a.note && (
                  <div className="text-[10px] text-slate-700">{a.note}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 pt-3">
        <label className={`${LABEL} mb-1`}>
          次回までのタスク({previewDeal.tasks.length}件)
        </label>
        {previewDeal.tasks.length === 0 ? (
          <div className="text-slate-700">登録なし</div>
        ) : (
          <div className="divide-y border border-slate-200 rounded-lg overflow-hidden">
            {previewDeal.tasks.map((t, idx) => (
              <div
                key={t.id ?? idx}
                className="p-2 flex justify-between items-center bg-white"
              >
                <div className="pr-2">
                  <div
                    className={`font-bold ${t.isDone ? "line-through text-slate-700" : "text-slate-900"}`}
                  >
                    {t.title}
                  </div>
                  <div className="text-[10px] text-slate-700">
                    {t.dueDate ? `期限 ${t.dueDate}` : "期限なし"}
                    {(t.assigneeName ?? t.assigneeEmployeeNumber) &&
                      ` / 担当 ${t.assigneeName ?? t.assigneeEmployeeNumber}`}
                  </div>
                </div>
                <StatusBadge
                  label={t.isDone ? "完了" : "未完了"}
                  tone={t.isDone ? "emerald" : "amber"}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 pt-3">
        <label className={`${LABEL} mb-1`}>
          紐づけ見積({previewDeal.quotes.length}件)
        </label>
        {previewDeal.quotes.length === 0 ? (
          <div className="text-slate-700">なし</div>
        ) : (
          <div className="divide-y border border-slate-200 rounded-lg overflow-hidden">
            {previewDeal.quotes.map((q) => (
              <div
                key={q.id}
                className="p-2 flex justify-between items-center bg-white"
              >
                <div className="truncate pr-2">
                  <div className="font-mono font-bold text-slate-900">
                    {q.id}
                  </div>
                  <div className="text-[10px] text-slate-700 truncate">
                    {q.title ?? ""}
                  </div>
                </div>
                <div className="font-mono font-bold text-slate-900">
                  ¥{q.totalAmount.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 pt-3">
        <label className={`${LABEL} mb-1`}>
          添付ファイル({previewDeal.attachments.length}件)
        </label>
        {previewDeal.attachments.length === 0 ? (
          <div className="text-slate-700">なし</div>
        ) : (
          <ul className="space-y-1">
            {previewDeal.attachments.map((f) => (
              <li key={f.id} className="text-slate-900">
                📎 {f.fileName}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SidePanel>
  );
}
