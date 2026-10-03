"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../hooks/use-api-fetch";
import { Button } from "./Button";
import { formFieldInputClass } from "./FormField";
import { RichHtml } from "./RichHtml";

interface HtmlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** プレビュー用API(POST。body: {body: string} → {html: string})。実際に表示される無害化後のHTMLを返す */
  previewUrl: string;
  disabled?: boolean;
  rows?: number;
  maxLength?: number;
}

/** 選択した文字を囲む/差し込む書式ボタン。HTMLを知らなくても、リンク・太字・リストを入れられるようにする */
const TOOLS: {
  label: string;
  title: string;
  before: string;
  after: string;
  placeholder: string;
}[] = [
  {
    label: "B",
    title: "太字",
    before: "<b>",
    after: "</b>",
    placeholder: "太字にする文字",
  },
  {
    label: "I",
    title: "斜体",
    before: "<i>",
    after: "</i>",
    placeholder: "斜体にする文字",
  },
  {
    label: "見出し",
    title: "見出し",
    before: "<h3>",
    after: "</h3>",
    placeholder: "見出し",
  },
  {
    label: "箇条書き",
    title: "箇条書き",
    before: "<ul>\n  <li>",
    after: "</li>\n  <li>項目2</li>\n</ul>",
    placeholder: "項目1",
  },
  {
    label: "改行",
    title: "改行",
    before: "<br>\n",
    after: "",
    placeholder: "",
  },
];

/**
 * HTMLを書けるエディタ(お知らせ本文・画面の説明用)。
 * 上: 書式ボタンとHTML入力欄、下(PCは右): 実際に表示される内容のプレビュー。
 * プレビューはAPIで無害化した結果を表示するので、保存後の見た目(危険なタグが除かれた状態)と一致する。
 */
export function HtmlEditor({
  value,
  onChange,
  previewUrl,
  disabled = false,
  rows = 6,
  maxLength = 20000,
}: HtmlEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState("");

  // 入力が止まってからプレビューを更新する(打鍵ごとにAPIを呼ばない)
  useEffect(() => {
    const handle = setTimeout(() => {
      if (value.trim() === "") {
        setPreviewHtml("");
        setPreviewError("");
        return;
      }
      apiFetch<{ html: string }>(previewUrl, {
        method: "POST",
        json: { body: value },
      })
        .then((r) => {
          setPreviewHtml(r.html);
          setPreviewError("");
        })
        .catch((err) =>
          setPreviewError(
            err instanceof Error ? err.message : "プレビューに失敗しました",
          ),
        );
    }, 400);
    return () => clearTimeout(handle);
  }, [value, previewUrl]);

  const apply = (before: string, after: string, placeholder: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || placeholder;
    onChange(
      value.slice(0, start) + before + selected + after + value.slice(end),
    );
    requestAnimationFrame(() => el?.focus());
  };

  const insertLink = () => {
    const url = window.prompt(
      "リンク先のURL(https://...)を入力してください",
      "https://",
    );
    if (!url) return;
    apply(`<a href="${url.replace(/"/g, "&quot;")}">`, "</a>", "リンクの文字");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="書式">
        {TOOLS.map((t) => (
          <Button
            key={t.title}
            variant="secondary"
            size="sm"
            title={t.title}
            disabled={disabled}
            onClick={() => apply(t.before, t.after, t.placeholder)}
          >
            {t.label}
          </Button>
        ))}
        <Button
          variant="secondary"
          size="sm"
          title="リンクを挿入"
          disabled={disabled}
          onClick={insertLink}
        >
          🔗 リンク
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <textarea
          ref={ref}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={`${formFieldInputClass} font-mono`}
          rows={rows}
          maxLength={maxLength}
          aria-label="本文(HTML)"
          placeholder={
            '例: 詳細は<a href="https://example.com">こちら</a>をご覧ください。'
          }
        />
        <div
          className="rounded border border-slate-300 bg-white p-2.5 text-slate-900"
          aria-label="プレビュー"
        >
          <div className="mb-1 text-[10px] font-bold text-slate-600">
            プレビュー(実際の表示)
          </div>
          {previewError ? (
            <p className="text-xs text-red-700">{previewError}</p>
          ) : previewHtml ? (
            <RichHtml html={previewHtml} className="text-sm" />
          ) : (
            <p className="text-xs text-slate-600">
              入力するとここに表示されます
            </p>
          )}
        </div>
      </div>
      <p className="text-[11px] text-slate-600">
        使えるタグ:
        太字・斜体・見出し・箇条書き・リンク・表・画像など。スクリプトや不明な属性は自動的に取り除かれます(プレビューが保存後の表示です)。
      </p>
    </div>
  );
}
