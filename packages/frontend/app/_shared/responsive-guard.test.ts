import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * スマホ/タブレット対応(docs/architecture/frontend.md「7-2. 画面幅への対応」)の「後戻りさせない」ための走査テスト。
 * 下記3種類の「崩れやすい書き方」の件数を、現状の値(BASELINE)で固定する。
 * - 新しく増やすとテストが失敗する(共通部品を使うこと: Modal / FormGrid / max-w付きの幅)
 * - 画面を共通部品へ移行して減らしたら、BASELINE を減らした値へ更新する(減っているのに更新しないと失敗する)
 * 最終的に全て0にするのが目標。
 */
const APP_DIR = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sourceFiles(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });
}

interface ClassUse {
  file: string;
  tokens: string[];
}

// className="..." と className={`...`} の静的な部分を対象にする
const CLASSNAME_RE = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

function collect(): ClassUse[] {
  const uses: ClassUse[] = [];
  for (const file of sourceFiles(APP_DIR)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(CLASSNAME_RE)) {
      uses.push({
        file: relative(APP_DIR, file).replace(/\\/g, "/"),
        tokens: (m[1] ?? m[2]).split(/\s+/),
      });
    }
  }
  return uses;
}

const uses = collect();

const RULES = {
  /** スマホ幅でも3列以上になる、ブレークポイントなしの grid-cols-N → FormGrid を使う */
  unresponsiveGrid: {
    baseline: 0,
    match: (u: ClassUse) => u.tokens.some((t) => /^grid-cols-[3-9]$/.test(t)),
    hint: "FormGrid(cols=...)を使うか、grid-cols-1 sm:grid-cols-2 lg:grid-cols-N の形にする",
  },
  /** 画面ごとに独自実装したモーダルの背景 → Modal を使う */
  ownModal: {
    baseline: 2,
    match: (u: ClassUse) =>
      u.file !== "_shared/ui/Modal.tsx" &&
      ["fixed", "inset-0", "justify-center"].every((t) =>
        u.tokens.includes(t),
      ) &&
      (u.tokens.includes("items-center") || u.tokens.includes("items-start")) &&
      u.tokens.some((t) => /^bg-(black|slate-900)\/\d+$/.test(t)),
    hint: "_shared/ui/Modal を使う",
  },
  /** ログイン前に開く画面などの、独自実装の全画面ラッパー(fixed inset-0 + 背景色) → PublicPage を使う */
  ownFullScreenPage: {
    baseline: 0,
    match: (u: ClassUse) =>
      u.file !== "_shared/ui/PublicPage.tsx" &&
      ["fixed", "inset-0"].every((t) => u.tokens.includes(t)) &&
      u.tokens.some((t) => t === "bg-slate-100" || t === "bg-slate-900"),
    hint: "_shared/ui/PublicPage を使う(内容が画面より高い時に縦スクロールできる)",
  },
  /** 画面ごとに色を直接書いた塗りボタン(bg-indigo-600 + text-white 等) → Button(variant)を使う。色をテーマで一括変更できなくなる */
  ownSolidButton: {
    baseline: 3,
    match: (u: ClassUse) =>
      u.tokens.includes("text-white") &&
      u.tokens.some((t) =>
        /^bg-(indigo|slate|emerald|green|red|rose|amber|blue)-(600|700|800|900)$/.test(
          t,
        ),
      ),
    hint: "_shared/ui/Button(variant=primary|success|danger)を使う。ボタン行は FormActions",
  },
  /** 画面ごとに独自実装した右側プレビュー(fixed inset-y-0 right-0) → SidePanel を使う(幅384px固定はスマホではみ出す) */
  ownSidePanel: {
    baseline: 0,
    match: (u: ClassUse) =>
      u.file !== "_shared/ui/SidePanel.tsx" &&
      ["fixed", "inset-y-0", "right-0"].every((t) => u.tokens.includes(t)),
    hint: "_shared/ui/SidePanel を使う",
  },
  /** z-40 はスマホのメニュー(ドロワー)専用。ページ内の固定見出し(sticky)は z-30 まで、モーダルは z-50 以上を使う。
   *  この幅を守らないと、メニューが固定見出しに隠れたり、モーダルより前面に出たりする */
  reservedZ40: {
    baseline: 0,
    match: (u: ClassUse) =>
      u.file !== "layout.tsx" &&
      u.tokens.some((t) => /^z-(40|\[4\d\])$/.test(t)),
    hint: "ページ内の重なりは z-10〜z-30(固定見出し)/ z-50 以上(モーダル)を使う。z-40 はメニュー専用",
  },
  /** 画面上部の見出しの手書き(h1 の text-2xl font-black text-slate-900) → PageHeader を使う */
  ownPageHeader: {
    baseline: 4,
    match: (u: ClassUse) =>
      u.file !== "_shared/ui/PageHeader.tsx" &&
      ["text-2xl", "font-black", "text-slate-900"].every((t) =>
        u.tokens.includes(t),
      ),
    hint: "_shared/ui/PageHeader を使う(スマホで縦積み・ボタン折り返し)",
  },
  /** 入力欄が text-xs のまま(スマホでiOSが入力時に画面を拡大する)。text-base sm:text-xs にするか、共通の formFieldInputClass を使う */
  phoneInputSize: {
    baseline: 0,
    match: (u: ClassUse) => {
      const t = u.tokens;
      if (
        !t.includes("text-xs") ||
        t.includes("sm:text-xs") ||
        t.includes("text-base") ||
        t.includes("text-white")
      )
        return false;
      if (!t.some((x) => /^border-slate-[34]00$/.test(x))) return false;
      if (t.some((x) => x.startsWith("focus:"))) return true;
      const buttonish = t.some(
        (x) =>
          x.startsWith("hover:bg") ||
          ["font-bold", "font-semibold", "cursor-pointer"].includes(x) ||
          x.startsWith("file:"),
      );
      return (
        t.some((x) => x === "bg-white" || x === "bg-slate-50") &&
        t.some((x) => x.startsWith("p-") || x.startsWith("px-")) &&
        !buttonish
      );
    },
    hint: "入力欄は text-base sm:text-xs(共通の formFieldInputClass を使う)",
  },
  /** 600px以上の min-w(幅の広い表)を画面ごとに書いている → TableScroll / DataTable(minWidth) を使う */
  wideMinWidth: {
    baseline: 0,
    match: (u: ClassUse) =>
      u.tokens.some(
        (t) =>
          /^min-w-\[(\d+)px\]$/.test(t) && Number(t.match(/\d+/)![0]) >= 600,
      ),
    hint: "TableScroll(minWidth=...) か DataTable(minWidth=...) を使う",
  },
  /** 400px以上の固定幅で、max-w も w-full も無い → スマホで横にはみ出す */
  wideFixedWidth: {
    baseline: 0,
    match: (u: ClassUse) =>
      u.tokens.some(
        (t) => /^w-\[(\d+)px\]$/.test(t) && Number(t.match(/\d+/)![0]) >= 400,
      ) && !u.tokens.some((t) => t.startsWith("max-w-") || t === "w-full"),
    hint: "w-full max-w-[...px] にするか、表なら TableScroll / DataTable(minWidth)を使う",
  },
} as const;

describe("レスポンシブ対応の後戻り防止(件数の固定)", () => {
  for (const [name, rule] of Object.entries(RULES)) {
    it(`${name}: ${rule.hint}`, () => {
      const hits = uses.filter(rule.match);
      const byFile = new Map<string, number>();
      for (const h of hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
      const detail = [...byFile].map(([f, n]) => `${f}(${n})`).join(", ");
      expect(
        hits.length,
        hits.length > rule.baseline
          ? `${name} が増えました(${hits.length} > ${rule.baseline})。${rule.hint}\n${detail}`
          : `${name} が減りました(${hits.length} < ${rule.baseline})。BASELINE を ${hits.length} に更新してください`,
      ).toBe(rule.baseline);
    });
  }

  it("走査対象が空でない(走査が壊れていない)", () => {
    expect(uses.length).toBeGreaterThan(1000);
  });
});

// BUG-055: <fieldset> は中身の最小幅(幅の広い明細表など)に合わせて広がるため、min-w-0 が無いと
// 明細表の横スクロールが効かず、フォーム全体が画面・枠の外へはみ出す(見積・受注・売上・仕入で発生)。
// min-w-0 の無い <fieldset> の件数を固定する(増やさない。min-w-0 を付けて減らしたら BASELINE を下げる)
describe("BUG-055: min-w-0 の無い <fieldset> の件数の固定", () => {
  const FIELDSET_BASELINE = 19;
  const FIELDSET_RE = /<fieldset\b[^>]*>/g;

  it("min-w-0 の無い <fieldset> を増やさない(明細表を入れる場合は必ず min-w-0 を付ける)", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(APP_DIR)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(FIELDSET_RE)) {
        if (!m[0].includes("min-w-0")) hits.push(relative(APP_DIR, file).replace(/\\/g, "/"));
      }
    }
    expect(
      hits.length,
      hits.length > FIELDSET_BASELINE
        ? `min-w-0 の無い <fieldset> が増えました(${hits.length} > ${FIELDSET_BASELINE})。className に min-w-0 を付けてください\n${hits.join(", ")}`
        : `min-w-0 の無い <fieldset> が減りました(${hits.length} < ${FIELDSET_BASELINE})。FIELDSET_BASELINE を ${hits.length} に更新してください`,
    ).toBe(FIELDSET_BASELINE);
  });
});
