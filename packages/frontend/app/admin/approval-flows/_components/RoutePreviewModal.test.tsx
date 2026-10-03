import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoutePreviewModal } from "./RoutePreviewModal";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const screens = [
  { resource: "master_partners", name: "取引先マスタ", category: "business_master" },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("RoutePreviewModal", () => {
  it("マウント時にユーザー一覧を取得し、選択肢として表示する", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.toString().includes("/api/users")) {
        return jsonResponse([{ id: "u1", name: "申請太郎" }]);
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<RoutePreviewModal screens={screens} onClose={vi.fn()} />);

    expect(await screen.findByText("申請太郎")).toBeInTheDocument();
  });

  it("シミュレーション実行で採用フロー・ステップ・承認候補者を表示する", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/users")) {
        return jsonResponse([{ id: "u1", name: "申請太郎" }]);
      }
      if (u.includes("/api/approval-flows/preview-route")) {
        return jsonResponse({
          matched: true,
          message: "申請経路をシミュレーションしました",
          flowName: "標準フロー",
          matchReason: "書類種別・金額帯が一致する唯一の候補フロー「標準フロー」が採用されました",
          steps: [
            {
              stepOrder: 1,
              stepName: "起票確認",
              approverRoleId: "requester",
              roleName: "申請者ロール",
              approverNames: ["申請太郎"],
              autoPassed: true,
            },
            {
              stepOrder: 2,
              stepName: null,
              approverRoleId: "manager",
              roleName: "マネージャー",
              approverNames: ["承認花子"],
              autoPassed: false,
            },
          ],
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<RoutePreviewModal screens={screens} onClose={vi.fn()} />);
    await screen.findByText("申請太郎");

    await user.click(screen.getByRole("button", { name: "経路をシミュレーションする" }));

    expect(await screen.findByText("標準フロー")).toBeInTheDocument();
    expect(screen.getByText(/起票確認/)).toBeInTheDocument();
    expect(screen.getByText("申請時に自動通過")).toBeInTheDocument();
    expect(screen.getByText(/承認花子/)).toBeInTheDocument();
  });

  it("条件に合致するフローが無い場合は案内メッセージを表示する", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/users")) {
        return jsonResponse([{ id: "u1", name: "申請太郎" }]);
      }
      if (u.includes("/api/approval-flows/preview-route")) {
        return jsonResponse({
          matched: false,
          message: "条件(書類種別: master_partners, 金額: 1,000円)に合致する有効な承認フローが定義されていません",
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<RoutePreviewModal screens={screens} onClose={vi.fn()} />);
    await screen.findByText("申請太郎");

    await user.click(screen.getByRole("button", { name: "経路をシミュレーションする" }));

    expect(
      await screen.findByText(/合致する有効な承認フローが定義されていません/),
    ).toBeInTheDocument();
  });

  it("✕ボタンでonCloseが呼ばれる", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchSpy);
    const onClose = vi.fn();

    render(<RoutePreviewModal screens={screens} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));

    expect(onClose).toHaveBeenCalled();
  });
});
