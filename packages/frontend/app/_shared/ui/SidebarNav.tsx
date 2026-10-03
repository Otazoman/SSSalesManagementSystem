"use client";

import type { MenuSection } from "../../types";

interface SidebarNavProps {
  sections: MenuSection[];
  /** 画面(resource)のメニューを開ける権限があるか。無い項目は表示しない */
  canOpen: (resource: string) => boolean;
  currentPath: string;
  onNavigate: (path: string) => void;
}

/**
 * サイドバーの業務メニュー。権限の無い項目は無効表示ではなく**表示しない**。
 * 項目が1つも残らないセクションは見出しごと出さない。
 * (表示だけの制御。画面への直接アクセスの拒否は PermissionGuard が行う)
 */
export function SidebarNav({
  sections,
  canOpen,
  currentPath,
  onNavigate,
}: SidebarNavProps) {
  return (
    <nav className="space-y-5">
      {sections.map((section, sIdx) => {
        const items = section.items.filter((item) => canOpen(item.resource));
        if (items.length === 0) return null;
        return (
          <div key={sIdx} className="space-y-1.5">
            <div className="px-2 text-xs font-bold text-slate-600 select-none">
              {section.sectionTitle}
            </div>
            <div className="space-y-0.5 pl-1">
              {items.map((item) => {
                const isActive = currentPath === item.path;
                return (
                  <button
                    key={item.resource}
                    // 名前が長くて途中で切れても、マウスを重ねるとメニュー名の全体を表示する
                    title={item.title}
                    onClick={() => onNavigate(item.path)}
                    className={`w-full flex items-center space-x-2.5 px-3 py-3 md:py-2 text-xs rounded-lg transition-all text-left font-medium cursor-pointer ${
                      isActive
                        ? "bg-indigo-50 text-indigo-700 font-bold border-l-4 border-indigo-500 rounded-l-none"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <span className="text-sm shrink-0">{item.icon}</span>
                    <span className="truncate flex-1">{item.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
