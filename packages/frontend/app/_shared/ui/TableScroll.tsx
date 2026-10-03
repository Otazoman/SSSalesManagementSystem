import type { ReactNode } from "react";

interface TableScrollProps {
  /** 表の最小幅(px)。これより狭い画面では、ページではなく表の枠内で横スクロールにする */
  minWidth?: number;
  /** true: 枠(角丸・罫線・背景・影)を付けない。外側のカードが既に枠を持つ場合に使う */
  bare?: boolean;
  /** 追加のクラス(例: 縦スクロールにする "overflow-y-auto max-h-[600px]") */
  className?: string;
  children: ReactNode;
}

/** 表の外枠(角丸・罫線)と横スクロール。幅の広い<table>を包むだけで、スマホでもページが横にはみ出さなくなる */
export function TableScroll({
  minWidth,
  bare = false,
  className = "",
  children,
}: TableScrollProps) {
  const frame = bare
    ? ""
    : "rounded-xl border border-slate-200 bg-white shadow-sm";
  return (
    <div
      className={`overflow-x-auto ${frame} ${className}`
        .replace(/\s+/g, " ")
        .trim()}
    >
      <div style={minWidth ? { minWidth } : undefined}>{children}</div>
    </div>
  );
}
