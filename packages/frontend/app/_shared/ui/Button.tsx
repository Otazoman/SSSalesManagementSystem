import type { ButtonHTMLAttributes } from "react";

/**
 * 用途別の色。色そのものは globals.css の変数(--primary 等)で決まるので、
 * ダークモードや画面色の指定は変数を上書きするだけで全ボタンに効く。
 */
const VARIANT = {
  /** 主要操作(登録・保存・送信) */
  primary: "bg-primary text-white hover:bg-primary-hover shadow-sm",
  /** 完了・確定・ダウンロード */
  success: "bg-success text-white hover:bg-success-hover shadow-sm",
  /** 削除など元に戻せない操作 */
  danger: "bg-danger text-white hover:bg-danger-hover shadow-sm",
  /** 副次的な操作(キャンセル・閉じる・戻る) */
  secondary:
    "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50",
  /** 枠なしの文字ボタン(「やり直す」などの補助リンク) */
  text: "bg-transparent text-slate-700 hover:text-slate-900 hover:underline",
} as const;

/** md: 通常(スマホは指で押せる44px以上)/ sm: 表の行内など密な場所 */
const SIZE = {
  md: "px-4 py-3 sm:py-2.5 text-sm sm:text-xs",
  sm: "px-3 py-1.5 text-xs",
} as const;

interface ButtonStyleOptions {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  fullWidth?: boolean;
}

/** ボタンのクラス。<a> など button 以外の要素を同じ見た目にする時にも使う */
export function buttonClass({
  variant = "primary",
  size = "md",
  fullWidth = false,
}: ButtonStyleOptions = {}) {
  return [
    "inline-flex items-center justify-center rounded-lg font-bold text-center transition-colors cursor-pointer",
    "disabled:opacity-60 disabled:cursor-not-allowed",
    VARIANT[variant],
    SIZE[size],
    fullWidth ? "w-full" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

type ButtonProps = ButtonStyleOptions & ButtonHTMLAttributes<HTMLButtonElement>;

/** 共通ボタン。既定は type="button"(form内でも意図せず送信しない)。送信は type="submit" を明示する */
export function Button({
  variant,
  size,
  fullWidth,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${buttonClass({ variant, size, fullWidth })} ${className}`.trim()}
      {...rest}
    />
  );
}
