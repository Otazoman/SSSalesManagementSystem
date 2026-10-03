import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { safeFileResponse } from "./apply-safe-file-headers";

// 添付ファイルの応答と同じ形(R2から読んだ本体+保存時の形式+Content-Disposition)を返す、確認用のアプリ
function appReturning(contentType: string, disposition: string | null) {
  const app = new Hono();
  app.use("*", safeFileResponse);
  app.get("/file", (c) =>
    c.body("<script>alert(1)</script>", 200, {
      "Content-Type": contentType,
      ...(disposition ? { "Content-Disposition": disposition } : {}),
    }),
  );
  return app;
}

const fetchFile = (contentType: string, disposition: string | null) =>
  appReturning(contentType, disposition).request("/file");

describe("ファイルの応答を安全な形にそろえる(BUG-023)", () => {
  it("HTMLの添付は、画面内で開かせず保存させ、スクリプトを動かさない", async () => {
    const res = await fetchFile("text/html", "inline; filename*=UTF-8''evil.html");
    expect(res.headers.get("Content-Disposition")).toBe("attachment; filename*=UTF-8''evil.html");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
  });

  it("SVG画像(中にスクリプトを入れられる)も、画面内で開かせない", async () => {
    const res = await fetchFile("image/svg+xml", "inline");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
  });

  it("PDFは画面内で開ける(ChromeのPDFビューアのため、CSPは付けない)。形式の推測は禁止する", async () => {
    const res = await fetchFile("application/pdf", "inline; filename*=UTF-8''quote.pdf");
    expect(res.headers.get("Content-Disposition")).toBe("inline; filename*=UTF-8''quote.pdf");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("PNG・JPEGなどの画像は画面内で開ける", async () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      const res = await fetchFile(type, "inline");
      expect(res.headers.get("Content-Disposition")).toBe("inline");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("保存させる応答(CSVなど)はそのまま保存させ、形式の推測を禁止する", async () => {
    const res = await fetchFile("text/csv; charset=utf-8", 'attachment; filename="partners.csv"');
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="partners.csv"');
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe("<script>alert(1)</script>");
  });

  it("ファイル名の無い通常のAPIの応答は変えない", async () => {
    const res = await fetchFile("application/json", null);
    expect(res.headers.get("X-Content-Type-Options")).toBeNull();
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });
});
