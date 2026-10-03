// httpOnly cookieに載せる署名付きセッションペイロードの生成・検証。
// クライアントJSからは読めず、改ざんがあれば検証時に必ず弾かれる(HMAC-SHA256)。

export interface SessionPayload {
  userId: string;
  employeeNumber: string; // Item1: createdBy/updatedBy等の操作者記録に使う。ログイン時に発行、以後不変
  name: string;
  role: string;
  deptName: string;
  companyName: string;
  isAuditEnabled: boolean;
  exp: number; // unix seconds
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// 有効期限(秒)を指定してペイロードに署名し、"payload.signature"形式のトークン文字列を生成する。
export async function signSessionToken(
  payload: Omit<SessionPayload, "exp">,
  secret: string,
  maxAgeSeconds: number,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const full: SessionPayload = { ...payload, exp };
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(full)));

  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64),
  );

  return `${payloadB64}.${base64urlEncode(signature)}`;
}

// 署名検証と有効期限チェックを行い、有効であればペイロードを返す。改ざん・期限切れ・形式不正はすべてnull。
export async function verifySessionToken(
  token: string | undefined | null,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signatureB64] = parts;

  try {
    const key = await importHmacKey(secret);
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64urlDecode(signatureB64),
      new TextEncoder().encode(payloadB64),
    );
    if (!isValid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadB64)),
    ) as SessionPayload;

    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
