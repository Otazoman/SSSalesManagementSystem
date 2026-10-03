"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface ScreenDescriptionsValue {
  /** 画面のパス → 説明(サーバーで無害化済みのHTML)。未登録の画面は含まれない */
  descriptions: Record<string, string>;
  /** 今開いている画面のパス */
  pathname: string;
  /** 説明を編集した後などに、最新の内容を読み直す */
  refresh: () => Promise<void>;
}

const ScreenDescriptionsContext = createContext<ScreenDescriptionsValue>({
  descriptions: {},
  pathname: "",
  refresh: async () => {},
});

/** パスの末尾のスラッシュを除いた形(ルートは "/")にそろえる */
export const normalizeScreenPath = (pathname: string) =>
  pathname.replace(/\/+$/, "") || "/";

/**
 * 各画面の見出し下の説明(管理者が編集した内容)を、ログイン後に1度読み込んで配る。
 * 説明は PageHeader が読む。未登録の画面・読み込み失敗時は、コードに書かれた既定の説明を表示する。
 */
export function ScreenDescriptionProvider({
  pathname,
  enabled,
  children,
}: {
  pathname: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/screen-descriptions", {
        credentials: "include",
      });
      if (!res.ok) return;
      const list = (await res.json()) as {
        path: string;
        descriptionHtml: string;
      }[];
      setDescriptions(
        Object.fromEntries(list.map((d) => [d.path, d.descriptionHtml])),
      );
    } catch {
      // 取得できなくても画面は既定の説明で動作を続ける
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const value = useMemo(
    () => ({ descriptions, pathname, refresh }),
    [descriptions, pathname, refresh],
  );
  return (
    <ScreenDescriptionsContext.Provider value={value}>
      {children}
    </ScreenDescriptionsContext.Provider>
  );
}

export const useScreenDescriptions = () =>
  useContext(ScreenDescriptionsContext);

/** 今の画面に管理者が設定した説明(HTML)。未設定なら undefined */
export function useCurrentScreenDescription(): string | undefined {
  const { descriptions, pathname } = useScreenDescriptions();
  const html = descriptions[normalizeScreenPath(pathname)];
  return html && html.trim() !== "" ? html : undefined;
}
