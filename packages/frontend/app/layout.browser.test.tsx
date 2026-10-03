import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import RootLayout from "./layout";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
} from "../test-support/responsive";

// 実ブラウザ: 実物の RootLayout で、スマホのメニュー(ドロワー)がヘッダーや、ページ内の固定見出し
// (表の sticky な th。z-10〜z-30 を使う画面が多い)と重ならないこと。
// 従来は、進捗確認などの表の固定見出し(z-30)がドロワー(z-20)より前面に出て、メニューと重なっていた
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: () => {} }),
  usePathname: () => "/progress",
  useSearchParams: () => new URLSearchParams(),
}));

const screens = Array.from({ length: 24 }, (_, i) => ({
  name: `画面${i}`,
  icon: "📄",
  path: i === 0 ? "/progress" : `/screen-${i}`,
  resource: i === 0 ? "progress" : `screen_${i}`,
  category: i % 2 === 0 ? "daily_work" : "business_master",
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.includes("/api/auth/profile")
        ? {
            id: "u1",
            name: "テスト 太郎",
            roleId: "admin",
            companyName: "サンプル株式会社",
            permissions: [],
            departments: [],
          }
        : url.includes("/api/permissions/screens")
          ? screens
          : {};
      return {
        ok: true,
        status: 200,
        json: async () => body,
        headers: new Headers(),
      } as unknown as Response;
    }),
  );
});

// ページ内容: 固定見出しの各 z-index を、ドロワーと同じ左上に縦に並べる(進捗確認・権限マトリクス・各一覧と同じ状況)。
// RootLayout は子に props を渡すため、受け取って捨てる部品にしている
function PageContent(props: Record<string, unknown>) {
  void props;
  return (
    <div>
      {[
        ["z30", "z-30", "bg-rose-200"],
        ["z20", "z-20", "bg-emerald-200"],
        ["z10", "z-10", "bg-sky-200"],
      ].map(([label, z, bg]) => (
        <table key={label} className="mb-4">
          <thead>
            <tr>
              <th className={`sticky top-0 left-0 ${z} ${bg} min-w-40 h-10`}>
                {label}
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, i) => (
              <tr key={i}>
                <td className="sticky left-0 z-10 bg-white">{`行${i}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

async function renderLayout() {
  const view = render(
    <RootLayout>
      <PageContent />
    </RootLayout>,
  );
  await waitFor(() =>
    expect(view.container.querySelector("aside")).not.toBeNull(),
  );
  return view;
}

const inside = (el: Element | null, ancestor: Element) =>
  !!el && ancestor.contains(el);

describe("スマホのメニュー(ドロワー)の重なり", () => {
  it("開くと、ヘッダーの下から始まり、画面下端まで届く。ヘッダーは隠されない", async () => {
    await setWidth(WIDTHS.phone, 667);
    const { container } = await renderLayout();
    fireEvent.click(screen.getByRole("button", { name: "☰" }));
    const aside = container.querySelector("aside") as HTMLElement;
    const header = container.querySelector("header") as HTMLElement;
    const headerBottom = header.getBoundingClientRect().bottom;
    await waitFor(() => expect(aside.getBoundingClientRect().left).toBe(0)); // スライドの終了

    expect(Math.round(aside.getBoundingClientRect().top)).toBe(
      Math.round(headerBottom),
    );
    expect(Math.round(aside.getBoundingClientRect().bottom)).toBe(667);
    // 「業務メニュー」の見出し(ドロワーの先頭)が、ヘッダーに隠れず見えている位置にある
    const title = screen.getByText("業務メニュー").getBoundingClientRect();
    expect(title.top).toBeGreaterThanOrEqual(headerBottom);
    // ヘッダーの ✕ は、暗幕に覆われず押せる
    const closeBtn = screen.getByRole("button", { name: "✕" });
    const r = closeBtn.getBoundingClientRect();
    expect(
      document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2),
    ).toBe(closeBtn);
  });

  it("ドロワーの領域は、ページ内の固定見出し(z-10/z-20/z-30)より前面にある", async () => {
    await setWidth(WIDTHS.phone, 667);
    const { container } = await renderLayout();
    fireEvent.click(screen.getByRole("button", { name: "☰" }));
    const aside = container.querySelector("aside") as HTMLElement;
    await waitFor(() => expect(aside.getBoundingClientRect().left).toBe(0));
    const headerBottom = (
      container.querySelector("header") as HTMLElement
    ).getBoundingClientRect().bottom;

    // 固定見出しは、ドロワーと同じ位置(左上)に描画されている(前提)
    const sticky = Array.from(
      container.querySelectorAll("th"),
    ) as HTMLElement[];
    expect(sticky).toHaveLength(3);
    for (const th of sticky) {
      const tr = th.getBoundingClientRect();
      expect(tr.left).toBeLessThan(256); // ドロワー(w-64=256px)の範囲内
      expect(tr.top).toBeGreaterThanOrEqual(headerBottom);
    }
    // その位置で最前面にあるのは、固定見出しではなくドロワー
    for (const th of sticky) {
      const tr = th.getBoundingClientRect();
      const top = document.elementFromPoint(
        tr.left + 20,
        tr.top + tr.height / 2,
      );
      expect(inside(top, aside), `${th.textContent} の位置で最前面`).toBe(true);
    }
  });

  it("ドロワーの外(暗幕の部分)には、ページの固定見出しや内容が最前面に出ない。閉じると暗幕は消える", async () => {
    await setWidth(WIDTHS.phone, 667);
    const { container } = await renderLayout();
    fireEvent.click(screen.getByRole("button", { name: "☰" }));
    const aside = container.querySelector("aside") as HTMLElement;
    await waitFor(() => expect(aside.getBoundingClientRect().left).toBe(0));
    const outside = document.elementFromPoint(340, 300) as HTMLElement;
    expect(outside.className).toContain("bg-slate-900/40"); // 暗幕
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    await waitFor(() =>
      expect(container.querySelector(".bg-slate-900\\/40")).toBeNull(),
    );
  });

  it("メニュー項目を選ぶと、その画面へ移動し、メニューは閉じる(従来は開いたまま画面に重なっていた)", async () => {
    await setWidth(WIDTHS.phone, 667);
    push.mockClear();
    const { container } = await renderLayout();
    fireEvent.click(screen.getByRole("button", { name: "☰" }));
    const aside = container.querySelector("aside") as HTMLElement;
    await waitFor(() => expect(aside.getBoundingClientRect().left).toBe(0));
    fireEvent.click(screen.getByRole("button", { name: /画面2$/ }));
    expect(push).toHaveBeenCalledWith("/screen-2");
    await waitFor(() =>
      expect(aside.getBoundingClientRect().right).toBeLessThanOrEqual(0),
    ); // 画面外へ戻る
    expect(container.querySelector(".bg-slate-900\\/40")).toBeNull(); // 暗幕も消える
  });

  it("閉じている時は画面外にあり、ページは横にはみ出さない", async () => {
    await setWidth(WIDTHS.phone, 667);
    const { container } = await renderLayout();
    const aside = container.querySelector("aside") as HTMLElement;
    expect(aside.getBoundingClientRect().right).toBeLessThanOrEqual(0);
    expect(pageOverflowsHorizontally()).toBe(false);
  });
});

describe("PC のサイドバー(md以上)", () => {
  it("左カラムとして表示され(ヘッダーの下)、暗幕はなく、ページ内の固定見出しはサイドバーに重ならない", async () => {
    await setWidth(WIDTHS.desktop, 800);
    const { container } = await renderLayout();
    const aside = container.querySelector("aside") as HTMLElement;
    const header = container.querySelector("header") as HTMLElement;
    const ar = aside.getBoundingClientRect();
    expect(ar.left).toBe(0);
    expect(Math.round(ar.top)).toBe(
      Math.round(header.getBoundingClientRect().bottom),
    );
    expect(container.querySelector(".bg-slate-900\\/40")).toBeNull();
    for (const th of Array.from(container.querySelectorAll("th"))) {
      expect(th.getBoundingClientRect().left).toBeGreaterThanOrEqual(
        ar.right - 1,
      );
    }
  });
});
