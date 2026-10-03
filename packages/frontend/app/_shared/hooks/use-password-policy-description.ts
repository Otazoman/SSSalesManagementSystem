import { useState, useEffect } from "react";
import { apiFetch } from "./use-api-fetch";
import { describePasswordPolicy, toPasswordPolicy } from "../password-policy";

/**
 * BUG-046: 会社設定のパスワードのルールの説明(「12文字以上で、数字を含めてください」など)を取得する共通hook。
 * ログイン中の画面(プロフィール・初回のパスワード変更)で使う。取得できない場合は null(説明を出さない)。
 */
export function usePasswordPolicyDescription(): string | null {
  const [description, setDescription] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Record<string, unknown>>("/api/company-settings", {
      defaultErrorMessage: "会社設定の取得に失敗しました",
    })
      .then((settings) => {
        if (!cancelled) setDescription(describePasswordPolicy(toPasswordPolicy(settings)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return description;
}
