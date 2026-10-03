import { describe, it, expect } from "vitest";
import { appendOrInjectDownloadLink } from "./quote-mail.service";

describe("Item4-c: appendOrInjectDownloadLink", () => {
  it("テンプレートに{download_link}が無い場合は本文末尾にリンクを追記する", () => {
    const body = "いつもお世話になっております。見積書を送付いたします。";
    const result = appendOrInjectDownloadLink(
      body,
      { site_url: "https://example.com" },
      "QT-0001",
      "ATT-0001",
    );

    expect(result).toContain(body);
    expect(result).toContain(
      "https://example.com/quote-download?quoteId=QT-0001&attachmentId=ATT-0001",
    );
  });

  it("テンプレートに{download_link}がある場合はその位置に置換する(追記しない)", () => {
    const body = "ダウンロードはこちら: {download_link}\nよろしくお願いします。";
    const result = appendOrInjectDownloadLink(
      body,
      { site_url: "https://example.com" },
      "QT-0002",
      "ATT-0002",
    );

    expect(result).toBe(
      "ダウンロードはこちら: https://example.com/quote-download?quoteId=QT-0002&attachmentId=ATT-0002\nよろしくお願いします。",
    );
    expect(result).not.toContain("{download_link}");
  });

  it("site_url未設定時はlocalhostにフォールバックする", () => {
    const result = appendOrInjectDownloadLink(
      "本文",
      {},
      "QT-0003",
      "ATT-0003",
    );
    expect(result).toContain("http://localhost:3000/quote-download");
  });

  it("site_urlの末尾スラッシュは除去される", () => {
    const result = appendOrInjectDownloadLink(
      "{download_link}",
      { site_url: "https://example.com/" },
      "QT-0004",
      "ATT-0004",
    );
    expect(result).toBe(
      "https://example.com/quote-download?quoteId=QT-0004&attachmentId=ATT-0004",
    );
  });
});
