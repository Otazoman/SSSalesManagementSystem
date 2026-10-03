import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JournalSourceSection } from "./JournalSourceSection";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SALES = [
  {
    kind: "sales_invoice",
    kindLabel: "売上",
    sourceRefId: "SI-1",
    eventType: "SALES",
    date: "2026-09-08T00:00:00.000Z",
    partnerId: "P-1",
    partnerName: "得意先A",
    amount: 1100,
    description: "売上[SI-1]",
    documentType: "SALE",
  },
  {
    kind: "sales_invoice",
    kindLabel: "売上",
    sourceRefId: "SI-2",
    eventType: "SALES",
    date: "2026-09-09T00:00:00.000Z",
    partnerId: "P-1",
    partnerName: "得意先A",
    amount: 550,
    description: "返品[SI-2]",
    documentType: "RETURN",
  },
];

const ADVANCE_CANDIDATES = [
  {
    cashReceiptId: "CR-1",
    receiptDate: "2026-09-01T00:00:00.000Z",
    amount: 3000,
    appliedAmount: 0,
    remainingAmount: 3000,
    memo: null,
  },
];

type PostBody = {
  kind: string;
  sourceRefId: string;
  advanceApplications?: { cashReceiptId: string; amount: number }[];
};
type Call = { url: string; method: string; body: PostBody | null };

function stubApi(
  postResponse: (body: PostBody) => Response | Promise<Response> = () =>
    jsonResponse({
      success: true,
      status: "POSTED",
      message: "仕訳を作成しました",
    }),
) {
  const calls: Call[] = [];
  let sourcesLoaded = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = url.toString();
      const body = init?.body ? JSON.parse(init.body as string) : null;
      calls.push({ url: u, method: init?.method ?? "GET", body });
      if (u.includes("/api/partners"))
        return jsonResponse([{ id: "P-1", name: "得意先A" }]);
      if (u.includes("/advance-candidates"))
        return jsonResponse(ADVANCE_CANDIDATES);
      if (u.includes("/api/journal-sources/post")) return postResponse(body);
      if (u.includes("/api/journal-sources/preview"))
        return jsonResponse({
          description: "売上[SI-1]",
          entryDate: "2026-09-08T00:00:00.000Z",
          pairs: [
            {
              amount: 1000,
              debit: { accountCode: "1131", accountName: "売掛金" },
              credit: { accountCode: "4101", accountName: "売上高", itemName: "品目A", taxCategoryCode: "TAX_10" },
            },
            {
              amount: 100,
              debit: { accountCode: "1131", accountName: "売掛金" },
              credit: { accountCode: "2301", accountName: "仮受消費税" },
            },
          ],
        });
      if (u.includes("/api/journal-sources")) {
        sourcesLoaded++;
        // 仕訳の作成後の再読み込みでは、作成済みの伝票が一覧から消える
        return jsonResponse(sourcesLoaded === 1 ? SALES : []);
      }
      return jsonResponse([]);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSection(
  props: Partial<React.ComponentProps<typeof JournalSourceSection>> = {},
) {
  const onPosted = vi.fn();
  render(
    <JournalSourceSection enabled canUpdate onPosted={onPosted} {...props} />,
  );
  return { onPosted };
}

describe("JournalSourceSection: 伝票を選んで仕訳を作成", () => {
  it("初期表示で売上の未転記一覧を取得し、区分(返品など)・税込金額を表示する", async () => {
    const calls = stubApi();
    renderSection();
    expect(await screen.findByText("SI-1")).toBeInTheDocument();
    expect(
      calls.some((c) =>
        c.url.includes("/api/journal-sources?kind=sales_invoice"),
      ),
    ).toBe(true);
    expect(screen.getByText("¥1,100")).toBeInTheDocument();
    expect(screen.getByText("返品")).toBeInTheDocument();
  });

  it("種別を切り替えると、その種別の一覧を取得する", async () => {
    const calls = stubApi();
    renderSection();
    await screen.findByText("SI-1");
    await userEvent.click(
      screen.getByRole("button", { name: "入金(入金消込)" }),
    );
    await waitFor(() =>
      expect(
        calls.some((c) =>
          c.url.includes("/api/journal-sources?kind=payment_receipt"),
        ),
      ).toBe(true),
    );
  });

  it("検索条件(日付・取引先)を入力すると、少し待ってからその条件で検索する(BUG-031: 「検索」ボタンは無い)", async () => {
    const calls = stubApi();
    renderSection();
    await screen.findByText("SI-1");
    expect(screen.queryByRole("button", { name: "検索" })).toBeNull();
    await userEvent.type(screen.getByLabelText("日付(から)"), "2026-09-01");
    await userEvent.selectOptions(screen.getByLabelText("取引先"), "P-1");
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.includes("kind=sales_invoice") &&
            c.url.includes("startDate=2026-09-01") &&
            c.url.includes("partnerId=P-1"),
        ),
      ).toBe(true),
    );
  });

  it("選んだ伝票を1件ずつ仕訳にし、結果を表示して、一覧を読み直す", async () => {
    const calls = stubApi();
    const { onPosted } = renderSection();
    await screen.findByText("SI-1");

    await userEvent.click(screen.getByLabelText("すべて選択(2件)"));
    expect(screen.getByText(/選択中: 2件 \/ 合計 ¥1,650/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "📝 選択した伝票の仕訳を作成(2件)" }),
    );

    await waitFor(() =>
      expect(screen.getByText(/成功 2件 \/ 失敗 0件/)).toBeInTheDocument(),
    );
    const posts = calls.filter((c) =>
      c.url.endsWith("/api/journal-sources/post"),
    );
    expect(posts.map((p) => p.body)).toEqual([
      { kind: "sales_invoice", sourceRefId: "SI-1" },
      { kind: "sales_invoice", sourceRefId: "SI-2" },
    ]);
    expect(onPosted).toHaveBeenCalled();
    // 作成済みの伝票は一覧から消える
    await waitFor(() =>
      expect(screen.queryByLabelText("SI-1を選択")).not.toBeInTheDocument(),
    );
  });

  it("1件が失敗しても残りを続けて処理し、失敗の理由を表示する", async () => {
    stubApi((body) =>
      body.sourceRefId === "SI-1"
        ? jsonResponse(
            {
              success: false,
              message: "仕訳ルール(SALES)が未設定、または無効です",
            },
            400,
          )
        : jsonResponse({
            success: true,
            status: "POSTED",
            message: "仕訳を作成しました",
          }),
    );
    renderSection();
    await screen.findByText("SI-1");
    await userEvent.click(screen.getByLabelText("すべて選択(2件)"));
    await userEvent.click(
      screen.getByRole("button", { name: "📝 選択した伝票の仕訳を作成(2件)" }),
    );

    await waitFor(() =>
      expect(screen.getByText(/成功 1件 \/ 失敗 1件/)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/仕訳ルール\(SALES\)が未設定、または無効です/),
    ).toBeInTheDocument();
  });

  it("売上へ単体入金の前受金を充当すると、充当額をadvanceApplicationsで送る(返品には充当欄が出ない)", async () => {
    const calls = stubApi();
    renderSection();
    await screen.findByText("SI-1");

    const buttons = screen.getAllByRole("button", { name: "充当する" });
    expect(buttons).toHaveLength(1); // 売上(SALE)だけ。返品は対象外
    await userEvent.click(buttons[0]);

    const input = await screen.findByLabelText("CR-1の充当額");
    expect(screen.getByText("未充当残 ¥3,000")).toBeInTheDocument();
    await userEvent.type(input, "800");
    expect(
      screen.getByRole("button", { name: "充当 ¥800" }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("SI-1を選択"));
    await userEvent.click(
      screen.getByRole("button", { name: "📝 選択した伝票の仕訳を作成(1件)" }),
    );

    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith("/api/journal-sources/post")),
      ).toBe(true),
    );
    const post = calls.find((c) =>
      c.url.endsWith("/api/journal-sources/post"),
    )!;
    expect(post.body).toEqual({
      kind: "sales_invoice",
      sourceRefId: "SI-1",
      advanceApplications: [{ cashReceiptId: "CR-1", amount: 800 }],
    });
  });

  it("「仕訳を確認」で、作成される仕訳を借方・貸方の組で表示する(保存はしない)", async () => {
    const calls = stubApi();
    renderSection();
    await screen.findByText("SI-1");

    await userEvent.click(screen.getAllByRole("button", { name: "仕訳を確認" })[0]);

    expect(await screen.findByText("作成される仕訳(売上[SI-1])")).toBeInTheDocument();
    const taxRow = screen.getByText("仮受消費税").closest("tr")!;
    expect(within(taxRow).getByText("売掛金")).toBeInTheDocument();
    expect(screen.getByText("品目A / 税区分 TAX_10")).toBeInTheDocument();
    const preview = calls.find((c) => c.url.endsWith("/api/journal-sources/preview"))!;
    expect(preview.body).toEqual({ kind: "sales_invoice", sourceRefId: "SI-1" });
    expect(calls.some((c) => c.url.endsWith("/api/journal-sources/post"))).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByText("作成される仕訳(売上[SI-1])")).not.toBeInTheDocument();
  });

  it("更新権限が無い場合、仕訳の作成ボタンは無効", async () => {
    stubApi();
    renderSection({ canUpdate: false });
    await screen.findByText("SI-1");
    await userEvent.click(screen.getByLabelText("SI-1を選択"));
    expect(
      screen.getByRole("button", { name: "📝 選択した伝票の仕訳を作成(1件)" }),
    ).toBeDisabled();
  });

  it("仕訳にしていない伝票が無い場合は、その旨を表示する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([])),
    );
    renderSection();
    expect(
      await screen.findByText("仕訳にしていない伝票はありません。"),
    ).toBeInTheDocument();
    expect(
      within(document.body).getByRole("button", {
        name: "📝 選択した伝票の仕訳を作成(0件)",
      }),
    ).toBeDisabled();
  });
});
