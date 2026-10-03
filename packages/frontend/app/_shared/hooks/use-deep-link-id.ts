"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

/**
 * 「URLでID指定して画面を開く」入口(ディープリンク)の共通フック。
 * 進捗確認など他画面から`?editId=xxx`/`?openId=xxx`付きで遷移してきたとき、`ready`(権限確認・
 * 初期データ読込済み)になった時点で1回だけ`onOpen`を呼び、URLからparamを除去する
 * (承認履歴の「修正して再提出」で使われている既存の`editId` effectと同じ挙動)。
 *
 * @param paramName 対象IDを持つクエリparam名(例: "editId" / "openId")
 * @param onOpen    IDが指定されたときに呼ぶ処理。第2引数は除去前のクエリ(openKind等の追加paramの参照用)
 * @param ready     trueになるまで待つ(権限・マスタ読込が終わっていない間に開かないため)
 * @param extraParamNames IDと同時にURLから除去する追加param名
 */
export function useDeepLinkId(
  paramName: string,
  onOpen: (id: string, params: URLSearchParams) => void | Promise<void>,
  ready: boolean,
  extraParamNames: string[] = [],
) {
  const searchParams = useSearchParams();
  const id = searchParams?.get(paramName) ?? null;
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id || !ready || handledRef.current === id) return;
    handledRef.current = id;

    void onOpen(id, new URLSearchParams(window.location.search));

    const url = new URL(window.location.href);
    url.searchParams.delete(paramName);
    for (const name of extraParamNames) url.searchParams.delete(name);
    window.history.replaceState({}, "", url.pathname + url.search);
    // onOpenは呼び出し側で毎回作り直されるため依存に含めない(idとreadyの変化時のみ実行する)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ready]);
}
