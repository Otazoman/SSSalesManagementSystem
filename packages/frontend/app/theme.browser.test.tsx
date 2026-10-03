import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./_shared/ui/Button";

// 実ブラウザ: 実際の CSS(globals.css + theme.css)で、ダークモード・基調色が効くことと、
// どの組み合わせでも文字が読める(コントラスト比 4.5 以上)こと

const canvas = document.createElement("canvas");
canvas.width = canvas.height = 1;
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

/** ブラウザが解釈した任意のCSS色(oklab等も含む)を sRGB の [r,g,b,a] にする */
function toRgba(css: string): [number, number, number, number] {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3] / 255];
}

/** 要素の背景色。透明なら親をたどる(最後は html の背景) */
function backgroundOf(el: Element): [number, number, number] {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const [r, g, b, a] = toRgba(getComputedStyle(e).backgroundColor);
    if (a > 0.99) return [r, g, b];
  }
  return [255, 255, 255];
}

const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const contrastOf = (el: Element) =>
  contrast(toRgba(getComputedStyle(el).color), backgroundOf(el));

const setTheme = (theme: "light" | "dark", accent = "indigo") => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = accent;
};

afterEach(() => {
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.accent;
  document.body.innerHTML = "";
});

// 画面でよく使う組み合わせ(CLAUDE.md #20 の濃さの下限を含む)
const Samples = () => (
  <main className="bg-slate-50 text-slate-900 p-4">
    <div className="bg-white p-4" data-testid="card">
      <p className="text-slate-700">本文</p>
      <p className="text-slate-600">補足</p>
      <p className="text-slate-800 font-bold">ラベル</p>
      <p className="text-slate-500">無効・空欄</p>
      <input
        aria-label="入力"
        className="bg-white text-slate-900 border border-slate-300"
        placeholder="入力"
      />
      <button className="bg-white text-slate-800 border border-slate-300">
        通常ボタン
      </button>
      <button className="bg-slate-900 text-white">濃いボタン</button>
      <a href="#x" className="text-indigo-600">
        リンク
      </a>
      <span className="bg-indigo-50 text-indigo-700">情報</span>
      <span className="bg-red-50 text-red-700">エラー</span>
      <span className="bg-amber-50 text-amber-800">注意</span>
      <span className="bg-emerald-50 text-emerald-700">成功</span>
      <span className="bg-sky-50 text-sky-800">案内</span>
      <span className="bg-rose-50 text-rose-700">警告</span>
      <span className="bg-violet-50 text-violet-700">その他</span>
      <span className="bg-blue-50 text-blue-800">青</span>
      <span className="bg-indigo-600 text-white">塗り</span>
    </div>
    <Button>登録</Button>
    <Button variant="danger">削除</Button>
    <Button variant="secondary">キャンセル</Button>
  </main>
);

describe("ダークモード(実CSS)", () => {
  it("ライトでは今までどおり(白いカード・濃い文字)", () => {
    setTheme("light");
    render(<Samples />);
    expect(getComputedStyle(screen.getByTestId("card")).backgroundColor).toBe(
      "rgb(255, 255, 255)",
    );
  });

  it("ダークではカードが暗い面になり、入力欄・ボタンも暗い(白いまま浮かない)", () => {
    setTheme("dark");
    render(<Samples />);
    for (const el of [
      screen.getByTestId("card"),
      screen.getByLabelText("入力"),
      screen.getByRole("button", { name: "通常ボタン" }),
      screen.getByRole("button", { name: "キャンセル" }),
    ]) {
      expect(lum(backgroundOf(el))).toBeLessThan(0.05);
    }
    expect(getComputedStyle(document.documentElement).colorScheme).toBe("dark");
  });

  it("ダークで、入力欄を選択(フォーカス)しても白くならず、文字が読める(focus:bg-white 対応)", () => {
    setTheme("dark");
    render(
      <div className="bg-white">
        <textarea
          aria-label="説明"
          className="bg-slate-50 text-slate-900 focus:bg-white"
          defaultValue="本文"
        />
      </div>,
    );
    const box = screen.getByLabelText("説明") as HTMLTextAreaElement;
    box.focus();
    expect(document.activeElement).toBe(box);
    expect(lum(backgroundOf(box))).toBeLessThan(0.05);
    expect(contrastOf(box)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["light", "dark"] as const)(
    "%s: 主な文字色・背景の組み合わせが、すべてコントラスト比 4.5 以上",
    (theme) => {
      setTheme(theme);
      const { container } = render(<Samples />);
      const failures: string[] = [];
      container.querySelectorAll("p, input, button, a, span").forEach((el) => {
        const c = contrastOf(el);
        if (c < 4.5) {
          failures.push(
            `${el.textContent || el.getAttribute("aria-label")} ${c.toFixed(2)}`,
          );
        }
      });
      expect(failures).toEqual([]);
    },
  );

  it("ダークで、プレースホルダ以外の薄いグレー文字(slate-300/400)の色が暗い面で読めない色にならない", () => {
    setTheme("dark");
    render(
      <div className="bg-white">
        <p className="text-slate-700">a</p>
      </div>,
    );
    expect(contrastOf(screen.getByText("a"))).toBeGreaterThan(7);
  });
});

describe("基調色(実CSS)", () => {
  it.each(["blue", "emerald", "rose", "gray"])(
    "%s: 主要ボタンとリンク等(画面全体のindigo)が、既定と違う同じ基調色になる",
    (accent) => {
      // ボタンは色の変化にアニメーションが付くので、色を変えた後は描画し直して確認する
      const show = (accent: string) => {
        setTheme("light", accent);
        const view = render(
          <>
            <Button>登録</Button>
            <a href="#x" className="text-indigo-600">
              リンク
            </a>
          </>,
        );
        const colorOf = (el: HTMLElement, prop: "backgroundColor" | "color") =>
          toRgba(getComputedStyle(el)[prop]).slice(0, 3);
        const result = {
          primary: colorOf(
            screen.getByRole("button", { name: "登録" }),
            "backgroundColor",
          ),
          link: colorOf(screen.getByText("リンク"), "color"),
        };
        view.unmount();
        return result;
      };
      const defaults = show("indigo");
      const chosen = show(accent);
      expect(chosen.primary).not.toEqual(defaults.primary);
      expect(chosen.link).toEqual(chosen.primary);
    },
  );

  it.each([
    "indigo",
    "blue",
    "sky",
    "emerald",
    "violet",
    "rose",
    "amber",
    "gray",
  ])("%s: ライト・ダークとも、主要ボタン(白文字)が読める", (accent) => {
    for (const theme of ["light", "dark"] as const) {
      setTheme(theme, accent);
      const { unmount } = render(<Button>登録</Button>);
      expect(
        contrastOf(screen.getByRole("button", { name: "登録" })),
      ).toBeGreaterThanOrEqual(4.5);
      unmount();
    }
  });
});
