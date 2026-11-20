import React from "react";
import type { PreviewFieldSpec, PreviewSpec } from "./preview-specs";

// BUG-089: 承認のプレビューの共通の表示(ヘッダーの項目一覧 + 明細の表 + 添付の一覧)。
// 設定(preview-specs.ts)の全ての「表示する項目」を出し、設定に無い項目は末尾の「その他」に項目名のまま出す。
// 変更申請(変更前のデータがある時)は、変わった項目を強調して変更前の値を並べ、明細の追加・削除は行ごとに出す。

type Row = Record<string, unknown>;

interface SpecPreviewProps {
  spec: PreviewSpec;
  mode: "task" | "history";
  newData: unknown;
  oldData?: unknown;
  /** 「種類:番号」→名前(backend がまとめて引いたもの) */
  displayNames?: Record<string, string>;
}

interface Normalized {
  header: Row;
  items: Row[] | null;
  attachments: Row[] | null;
}

const isRow = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

/** データの形({header, items} か、平らな形)をそろえる */
export function normalizePreviewData(data: unknown): Normalized | null {
  if (!isRow(data)) return null;
  // 棚卸は {audit}、伝票・在庫は {header, items}、マスタ・申請時の保存データは平らな形
  const header = isRow(data.header) ? data.header : isRow(data.audit) ? data.audit : data;
  const itemsSource = Array.isArray(data.items) ? data.items : Array.isArray(header.items) ? header.items : null;
  const attachmentsSource = Array.isArray(data.attachments)
    ? data.attachments
    : Array.isArray(header.attachments)
      ? header.attachments
      : null;
  return {
    header,
    items: itemsSource ? (itemsSource.filter(isRow) as Row[]) : null,
    attachments: attachmentsSource ? (attachmentsSource.filter(isRow) as Row[]) : null,
  };
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "";

export function formatPreviewValue(
  value: unknown,
  field: PreviewFieldSpec | undefined,
  displayNames?: Record<string, string>,
): string {
  if (isEmpty(value)) return "-";
  if (field?.ref) {
    const name = displayNames?.[`${field.ref}:${String(value)}`];
    return name ? `${name}(${String(value)})` : String(value);
  }
  if (field?.options && typeof value !== "object") {
    return field.options[String(value)] ?? String(value);
  }
  switch (field?.format) {
    case "currency": {
      const num = Number(value);
      return Number.isNaN(num) ? String(value) : `${num.toLocaleString()} 円`;
    }
    case "number": {
      const num = Number(value);
      return Number.isNaN(num) ? String(value) : num.toLocaleString();
    }
    case "date": {
      const date = new Date(value as string | number);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("ja-JP");
    }
    case "boolean":
      return value === true || value === "true" || value === 1 ? "はい" : "いいえ";
    default:
      break;
  }
  if (Array.isArray(value)) return `${value.length}件`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function sameValue(a: unknown, b: unknown) {
  if (isEmpty(a) && isEmpty(b)) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function FieldCell({
  label,
  value,
  oldValue,
  changed,
}: {
  label: string;
  value: string;
  oldValue?: string;
  changed: boolean;
}) {
  return (
    <div className={changed ? "rounded bg-amber-50 px-1 ring-1 ring-amber-300" : ""} data-changed={changed || undefined}>
      <span className="block text-[10px] font-bold text-slate-600">{label}:</span>
      <span className="whitespace-pre-wrap break-words text-xs font-semibold text-slate-900">{value}</span>
      {changed && oldValue !== undefined && (
        <span className="block text-[10px] text-slate-700">
          変更前: <span className="line-through">{oldValue}</span>
        </span>
      )}
    </div>
  );
}

/** 設定に無い項目(その他)。配列は表、入れ子のデータは項目の一覧として出す */
function OtherValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    const rows = value.filter(isRow) as Row[];
    if (rows.length === 0) return <span className="text-xs text-slate-900">{value.length === 0 ? "-" : value.join(", ")}</span>;
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return (
      <table className="text-[11px] text-slate-800">
        <thead>
          <tr>{keys.map((k) => <th key={k} className="pr-2 text-left font-bold text-slate-700">{k}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{keys.map((k) => <td key={k} className="pr-2">{formatPreviewValue(r[k], undefined)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (isRow(value)) {
    return (
      <dl className="text-[11px] text-slate-800">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className="flex gap-1">
            <dt className="font-bold text-slate-700">{k}:</dt>
            <dd>{formatPreviewValue(v, undefined)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="text-xs text-slate-900">{formatPreviewValue(value, undefined)}</span>;
}

type ItemRowState = { row: Row; old?: Row; state: "same" | "added" | "removed" };

/** 明細の新旧を、明細の番号(id)、無ければ並び順で突き合わせる */
function pairItems(newItems: Row[], oldItems: Row[] | null): ItemRowState[] {
  if (!oldItems) return newItems.map((row) => ({ row, state: "same" }));
  const byId = newItems.every((r) => !isEmpty(r.id)) && oldItems.every((r) => !isEmpty(r.id));
  if (byId) {
    const oldById = new Map(oldItems.map((r) => [String(r.id), r]));
    const result: ItemRowState[] = newItems.map((row) => {
      const old = oldById.get(String(row.id));
      return old ? { row, old, state: "same" } : { row, state: "added" };
    });
    const newIds = new Set(newItems.map((r) => String(r.id)));
    for (const old of oldItems) if (!newIds.has(String(old.id))) result.push({ row: old, state: "removed" });
    return result;
  }
  const result: ItemRowState[] = newItems.map((row, i) => (i < oldItems.length ? { row, old: oldItems[i], state: "same" } : { row, state: "added" }));
  for (let i = newItems.length; i < oldItems.length; i++) result.push({ row: oldItems[i], state: "removed" });
  return result;
}

function ItemsTable({
  spec,
  items,
  oldItems,
  displayNames,
}: {
  spec: NonNullable<PreviewSpec["items"]>;
  items: Row[];
  oldItems: Row[] | null;
  displayNames?: Record<string, string>;
}) {
  const rows = pairItems(items, oldItems);
  const all = rows.flatMap((r) => (r.old ? [r.row, r.old] : [r.row]));
  // 値のある列だけを出す(設定に無い列は、末尾に項目名のまま出す)
  const configured = Object.keys(spec.columns).filter((k) => all.some((r) => !isEmpty(r[k])));
  const extra = [...new Set(all.flatMap((r) => Object.keys(r)))].filter(
    (k) => !(k in spec.columns) && !(k in spec.hidden) && all.some((r) => !isEmpty(r[k])),
  );
  const columns = [...configured, ...extra];
  const showState = !!oldItems;
  return (
    <div className="mt-2 space-y-1 border-t pt-2">
      <span className="block text-[10px] font-bold text-slate-600">明細({items.length}件):</span>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-left text-slate-700">
              {showState && <th className="pr-3 font-bold">変更</th>}
              {columns.map((k) => (
                <th key={k} className="pr-3 font-bold">{spec.columns[k]?.label ?? k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, old, state }, i) => (
              <tr
                key={i}
                data-row-state={state}
                className={
                  state === "added" ? "bg-emerald-50 text-slate-900" : state === "removed" ? "bg-rose-50 text-slate-700 line-through" : "text-slate-800"
                }
              >
                {showState && (
                  <td className="pr-3 font-bold no-underline">
                    {state === "added" ? <span className="text-emerald-800">追加</span> : state === "removed" ? <span className="text-rose-800">削除</span> : ""}
                  </td>
                )}
                {columns.map((k) => {
                  const field = spec.columns[k];
                  const value = formatPreviewValue(row[k], field, displayNames);
                  const changed = state === "same" && !!old && !sameValue(row[k], old[k]);
                  return (
                    <td key={k} className={`py-0.5 pr-3 ${changed ? "bg-amber-50 ring-1 ring-amber-300" : ""}`} data-changed={changed || undefined}>
                      {value}
                      {changed && (
                        <span className="block text-[10px] text-slate-700">
                          変更前: <span className="line-through">{formatPreviewValue(old![k], field, displayNames)}</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const attachmentName = (a: Row) => String(a.fileName ?? a.name ?? a.externalUrl ?? a.attachmentR2Path ?? a.id ?? "");

function AttachmentsList({ attachments, oldAttachments }: { attachments: Row[]; oldAttachments: Row[] | null }) {
  const names = attachments.map(attachmentName);
  const oldNames = oldAttachments ? oldAttachments.map(attachmentName) : null;
  const removed = oldNames ? oldNames.filter((n) => !names.includes(n)) : [];
  if (names.length === 0 && removed.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 border-t pt-2">
      <span className="block text-[10px] font-bold text-slate-600">添付:</span>
      <ul className="text-xs text-slate-900">
        {names.map((n, i) => (
          <li key={`n${i}`} data-row-state={oldNames && !oldNames.includes(n) ? "added" : "same"}>
            📎 {n}
            {oldNames && !oldNames.includes(n) && <span className="ml-1 font-bold text-emerald-800">追加</span>}
          </li>
        ))}
        {removed.map((n, i) => (
          <li key={`r${i}`} data-row-state="removed" className="text-slate-700 line-through">
            📎 {n}
            <span className="ml-1 font-bold text-rose-800 no-underline">削除</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SpecPreview({ spec, mode, newData, oldData, displayNames }: SpecPreviewProps) {
  const current = normalizePreviewData(newData);
  const previous = mode === "history" ? normalizePreviewData(oldData) : null;
  if (!current || (Object.keys(current.header).length === 0 && !current.items?.length)) {
    return <span className="italic text-slate-600">この申請のプレビュー表示は未対応です(内容のデータがありません)。</span>;
  }
  const { header } = current;
  const oldHeader = previous?.header ?? null;
  const otherKeys = Object.keys(header).filter(
    (k) => !(k in spec.header) && !(k in spec.hidden) && k !== "header" && !isEmpty(header[k]),
  );

  return (
    <div className="space-y-2">
      <div className={`grid gap-3 text-xs ${mode === "task" ? "grid-cols-2 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2"}`}>
        {Object.entries(spec.header).map(([key, field]) => {
          const changed = !!oldHeader && !sameValue(header[key], oldHeader[key]);
          // 一覧(振込先口座など)は、ラベルの下に表で出す
          if (field.format === "list") {
            return (
              <div key={key} className={`md:col-span-2 ${changed ? "rounded bg-amber-50 px-1 ring-1 ring-amber-300" : ""}`} data-changed={changed || undefined}>
                <span className="block text-[10px] font-bold text-slate-600">{field.label}:</span>
                <OtherValue value={isEmpty(header[key]) ? "-" : header[key]} />
              </div>
            );
          }
          return (
            <FieldCell
              key={key}
              label={field.label}
              value={formatPreviewValue(header[key], field, displayNames)}
              oldValue={oldHeader ? formatPreviewValue(oldHeader[key], field, displayNames) : undefined}
              changed={changed}
            />
          );
        })}
      </div>

      {spec.items && current.items && current.items.length + (previous?.items?.length ?? 0) > 0 && (
        <ItemsTable spec={spec.items} items={current.items} oldItems={previous?.items ?? null} displayNames={displayNames} />
      )}

      {current.attachments && (
        <AttachmentsList attachments={current.attachments} oldAttachments={previous?.attachments ?? null} />
      )}

      {otherKeys.length > 0 && (
        <div className="mt-2 space-y-1 border-t pt-2">
          <span className="block text-[10px] font-bold text-slate-600">その他:</span>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {otherKeys.map((k) => (
              <div key={k}>
                <span className="block text-[10px] font-bold text-slate-700">{k}:</span>
                <OtherValue value={header[k]} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
