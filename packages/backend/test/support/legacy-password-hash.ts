// 以前の形(全ユーザー共通の固定ソルト・16進64文字)のハッシュ値を作る(移行の確認用)
export async function legacyHash(password: string): Promise<string> {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode("salese-management-salt-2026"), iterations: 100000, hash: "SHA-256" },
    baseKey,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
}
