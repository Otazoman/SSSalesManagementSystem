import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BarcodeScanner } from "./BarcodeScanner";

describe("BarcodeScanner", () => {
  it("読み取った結果(成功)を、カメラの映像のすぐ下に表示する(スマートフォンで上部のメッセージ欄が見えないため)", () => {
    render(<BarcodeScanner label="品目バーコードスキャン" onDetect={() => {}} resultMessage="✅ 品目を読み取りました: ITEM-1001 (原材料A)" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("品目を読み取りました");
    // video の後ろ(下)に表示されていること
    const video = document.querySelector("video")!;
    expect(video.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("エラー(該当なし)がある時は、エラーを表示する", () => {
    render(
      <BarcodeScanner
        label="品目バーコードスキャン"
        onDetect={() => {}}
        resultMessage=""
        resultError="バーコード「123」に該当する品目が見つかりません"
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("該当する品目が見つかりません");
  });

  it("結果が無い時は、結果の欄を表示しない", () => {
    render(<BarcodeScanner label="品目バーコードスキャン" onDetect={() => {}} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
