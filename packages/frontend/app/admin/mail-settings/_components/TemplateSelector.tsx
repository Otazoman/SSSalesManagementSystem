"use client";

import { MailTemplateSetting } from "../_types";

interface TemplateSelectorProps {
  templates: MailTemplateSetting[];
  activeTab: string;
  onSelectTab: (id: string) => void;
}

export function TemplateSelector({
  templates,
  activeTab,
  onSelectTab,
}: TemplateSelectorProps) {
  return (
    <div className="w-full md:w-64 shrink-0 flex flex-col space-y-1">
      <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider px-2 mb-2 select-none">
        対象帳票の選択
      </div>
      {templates.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelectTab(t.id)}
          className={`w-full text-left px-3 py-2.5 text-xs rounded-lg font-medium transition-all flex items-center justify-between cursor-pointer ${
            activeTab === t.id
              ? "bg-indigo-50 text-indigo-700 font-bold border-l-4 border-indigo-500 rounded-l-none"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <span>{t.name}</span>
          <span className="text-slate-600">📄</span>
        </button>
      ))}
    </div>
  );
}
