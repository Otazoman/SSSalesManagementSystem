"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { RichHtml } from "../../_shared/ui/RichHtml";

interface ActiveAnnouncement {
  id: string;
  title: string;
  body: string;
  publishDate: string;
  isImportant: boolean;
}

// ダッシュボード最上段の「システムからのお知らせ」。公開中・掲載期間内のものだけを、
// 重要なものを先頭に表示する(登録は /admin/announcements)。誰でも参照できる
export function AnnouncementsSection() {
  const [items, setItems] = useState<ActiveAnnouncement[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setItems(await apiFetch<ActiveAnnouncement[]>("/api/announcements/active"));
      } catch {
        // お知らせが取れなくてもダッシュボードの他の表示は継続する
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  if (!loaded) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold text-slate-800">📢 システムからのお知らせ</h2>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 text-xs">
        {items.length === 0 && <p className="px-4 py-4 text-slate-700">現在お知らせはありません</p>}
        {items.map((item) => (
          <details key={item.id} className="group px-4 py-3">
            <summary className="flex justify-between items-center gap-3 cursor-pointer list-none">
              <span className="text-slate-900 font-semibold">
                {item.isImportant && (
                  <span className="mr-2 px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-bold">重要</span>
                )}
                {item.title}
              </span>
              <span className="text-slate-700 font-mono text-[11px] whitespace-nowrap">
                {item.publishDate.replace(/-/g, "/")}
              </span>
            </summary>
            {item.body && <RichHtml html={item.body} className="mt-2 text-slate-800" />}
          </details>
        ))}
      </div>
    </div>
  );
}
