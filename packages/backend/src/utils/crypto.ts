// パスワードのハッシュ化と照合(PBKDF2-SHA256)。
// BUG-021: 以前は全ユーザー共通の固定ソルトだった(同じパスワードは同じハッシュ値になり、まとめて解読されやすい)。
// 新しく保存する値は、ユーザーごとの乱数ソルトを含む「方式$回数$ソルト$ハッシュ」の形にする。
// DBの列は変えずに移行するため、古い形(固定ソルトの16進64文字)も照合でき、ログイン成功時に新しい形へ書き換える。

const SCHEME = "pbkdf2-sha256";
// Cloudflare Workers の PBKDF2 は10万回が上限
const ITERATIONS = 100000;
const SALT_BYTES = 16;
const LEGACY_SALT = "salese-management-salt-2026";
const LEGACY_HASH_PATTERN = /^[0-9a-f]{64}$/;

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function pbkdf2Hex(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    baseKey,
    256,
  );
  return toHex(new Uint8Array(bits));
}

// 比較にかかる時間から一致した文字数を推測されないよう、長さが同じなら常に全文字を比べる
function timingSafeEqualText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 保存用のハッシュ値を作る(ユーザーごとの乱数ソルト)。形式: "pbkdf2-sha256$100000$<ソルト16進>$<ハッシュ16進>" */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2Hex(password, salt, ITERATIONS);
  return `${SCHEME}$${ITERATIONS}$${toHex(salt)}$${hash}`;
}

/**
 * 入力したパスワードが保存値と一致するかを確かめる。
 * needsRehash: 一致したが古い形(固定ソルト)で保存されている。呼び出し側で hashPassword() の値に書き換える。
 * 保存値そのもの(ハッシュ値)を入力しても一致しない(以前あった平文との比較は廃止した)。
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (!stored) return { ok: false, needsRehash: false };

  const parts = stored.split("$");
  if (parts.length === 4 && parts[0] === SCHEME) {
    const iterations = Number(parts[1]);
    const salt = fromHex(parts[2]);
    if (!Number.isInteger(iterations) || iterations <= 0 || iterations > ITERATIONS || !salt) {
      return { ok: false, needsRehash: false };
    }
    const ok = timingSafeEqualText(await pbkdf2Hex(password, salt, iterations), parts[3]);
    return { ok, needsRehash: ok && iterations < ITERATIONS };
  }

  if (LEGACY_HASH_PATTERN.test(stored)) {
    const legacy = await pbkdf2Hex(password, new TextEncoder().encode(LEGACY_SALT), ITERATIONS);
    const ok = timingSafeEqualText(legacy, stored);
    return { ok, needsRehash: ok };
  }

  return { ok: false, needsRehash: false };
}
