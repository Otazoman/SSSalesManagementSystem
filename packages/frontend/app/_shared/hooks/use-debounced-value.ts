import { useEffect, useState } from "react";

/** 検索条件の入力を、この時間(ミリ秒)待ってから検索に反映する(BUG-031) */
export const SEARCH_DEBOUNCE_MS = 400;

/**
 * 値の変化を、指定した時間だけ待ってから返す(入力が続いている間は古い値のまま)。
 * 検索欄に1文字入力するたびに API を呼ばないようにするために使う(D1 の読み取り行数の節約)。
 * 最初の値は待たずにそのまま返す。
 */
export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
