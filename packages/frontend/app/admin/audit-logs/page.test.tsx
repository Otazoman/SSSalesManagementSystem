import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Page from "./page";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuditLogsSearchPage", () => {
  it("初期表示ではCSVダウンロードボタンが無効(該当0件)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.toString().includes("/api/audit-logs/resources")) return jsonResponse([]);
        return jsonResponse({});
      }),
    );

    render(<Page />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "📥 CSVダウンロード" })).toBeDisabled(),
    );
  });

  it("検索実行で一覧・該当件数が更新される", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.toString().includes("/api/audit-logs/resources")) return jsonResponse([]);
        if (url.toString().includes("/api/audit-logs/search")) {
          return jsonResponse([
            {
              id: "1",
              userId: "EMP001",
              action: "CREATE_UNIT",
              tableName: "units",
              screenName: "単位マスタ",
              recordId: "PCS",
              oldValues: null,
              newValues: null,
              performedAt: "2026-08-01T00:00:00.000Z",
            },
          ]);
        }
        return jsonResponse({});
      }),
    );

    render(<Page />);
    await userEvent.click(screen.getByRole("button", { name: "ログを検索 🔍" }));

    await waitFor(() => expect(screen.getByText("EMP001")).toBeInTheDocument());
    expect(screen.getByText("該当ログ件数:", { exact: false }).parentElement).toHaveTextContent(
      "該当ログ件数: 1 件",
    );
  });
});
