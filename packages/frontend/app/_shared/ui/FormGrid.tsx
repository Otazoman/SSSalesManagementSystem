import type { ReactNode } from "react";

/**
 * 列数ごとのグリッド。スマホは1列、sm以上は2列、lg以上で指定列数(Tailwindは動的クラスを解釈できないため固定の文字列で持つ)。
 * lg以上の見た目は従来の grid-cols-N と同じ。
 */
const COLUMNS = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
} as const;

const GAP = { 2: "gap-2", 3: "gap-3", 4: "gap-4" } as const;

interface FormGridProps {
  cols?: keyof typeof COLUMNS;
  gap?: keyof typeof GAP;
  /** 余白など追加のクラス(例: "mt-2") */
  className?: string;
  children: ReactNode;
}

export function FormGrid({
  cols = 2,
  gap = 3,
  className = "",
  children,
}: FormGridProps) {
  return (
    <div className={`grid ${COLUMNS[cols]} ${GAP[gap]} ${className}`.trim()}>
      {children}
    </div>
  );
}
