import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { HtmlEditor } from "./HtmlEditor";
import { RichHtml } from "./RichHtml";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true) {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "application/json" },
  });
}

function Harness({ initial = "" }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <HtmlEditor
        value={v}
        onChange={setV}
        previewUrl="/api/announcements/preview"
      />
      <output data-testid="value">{v}</output>
    </>
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { body: string };
    // サーバーの無害化の代わりに、scriptを除いた形を返す
    return jsonResponse({
      html: body.body.replace(/<script>.*?<\/script>/g, ""),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const textarea = () =>
  screen.getByLabelText("本文(HTML)") as HTMLTextAreaElement;

describe("HtmlEditor", () => {
  it("書式ボタン: 選択した文字を太字タグで囲む", () => {
    render(<Harness initial="重要なお知らせ" />);
    textarea().setSelectionRange(0, 2);
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(screen.getByTestId("value").textContent).toBe(
      "<b>重要</b>なお知らせ",
    );
  });

  it("選択が無い時は、見本の文字を差し込む", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "箇条書き" }));
    expect(screen.getByTestId("value").textContent).toContain("<ul>");
    expect(screen.getByTestId("value").textContent).toContain("<li>項目1</li>");
  });

  it("リンクを挿入: 入力したURLで <a href> を作る", () => {
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com/manual");
    render(<Harness initial="詳細はこちら" />);
    textarea().setSelectionRange(3, 6);
    fireEvent.click(screen.getByRole("button", { name: /リンク/ }));
    expect(screen.getByTestId("value").textContent).toBe(
      '詳細は<a href="https://example.com/manual">こちら</a>',
    );
  });

  it("リンクの入力を取り消したら何も挿入しない", () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<Harness initial="abc" />);
    fireEvent.click(screen.getByRole("button", { name: /リンク/ }));
    expect(screen.getByTestId("value").textContent).toBe("abc");
  });

  it("入力が止まったらプレビューAPIを1回だけ呼び、返ってきた(無害化後の)HTMLを表示する", async () => {
    render(<Harness />);
    fireEvent.change(textarea(), { target: { value: "<b>a</b>" } });
    fireEvent.change(textarea(), {
      target: { value: "<b>ab</b><script>x()</script>" },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/announcements/preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: "<b>ab</b><script>x()</script>" }),
      }),
    );
    // サーバーが無害化した結果が表示され、scriptは表示に含まれない
    await waitFor(() =>
      expect(
        screen.getByLabelText("プレビュー").querySelector("b")?.textContent,
      ).toBe("ab"),
    );
    expect(
      screen.getByLabelText("プレビュー").querySelector("script"),
    ).toBeNull();
  });

  it("空のときはAPIを呼ばず、案内を表示する。エラー時はメッセージを表示する", async () => {
    render(<Harness initial="" />);
    await new Promise((r) => setTimeout(r, 500));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByText("入力するとここに表示されます"),
    ).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "本文は20000文字以内です" }, false),
    );
    fireEvent.change(textarea(), { target: { value: "x" } });
    expect(
      await screen.findByText("本文は20000文字以内です"),
    ).toBeInTheDocument();
  });

  it("disabled: 入力欄と書式ボタンが操作できない", () => {
    render(
      <HtmlEditor value="" onChange={() => {}} previewUrl="/x" disabled />,
    );
    expect(textarea()).toBeDisabled();
    expect(screen.getByRole("button", { name: "B" })).toBeDisabled();
  });

  it("文字色: 薄いグレー文字(slate-400以下)を使わない(CLAUDE.md #20)", () => {
    const { container } = render(<Harness />);
    expect(container.innerHTML).not.toMatch(/text-slate-[1-4]00/);
  });
});

describe("RichHtml", () => {
  it("渡された(無害化済みの)HTMLを描画する", () => {
    render(
      <RichHtml html='<p>本文 <a href="https://e.example">リンク</a></p>' />,
    );
    expect(screen.getByRole("link", { name: "リンク" })).toHaveAttribute(
      "href",
      "https://e.example",
    );
  });

  it("rich-html クラスを持つ(リスト・見出し等の見た目を補う)", () => {
    const { container } = render(
      <RichHtml html="<ul><li>a</li></ul>" className="mt-2" />,
    );
    expect((container.firstElementChild as HTMLElement).className).toBe(
      "rich-html mt-2",
    );
  });
});
