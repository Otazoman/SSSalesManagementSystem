import { describe, it, expect } from "vitest";
import { plainTextToHtml, sanitizeHtml } from "./sanitize-html";

describe("sanitizeHtml: 許可した書式は残す", () => {
  it("段落・強調・リスト・見出しなどをそのまま通す", () => {
    const html = "<h3>見出し</h3><p>本文 <b>太字</b> <i>斜体</i> <u>下線</u></p><ul><li>項目1</li><li>項目2</li></ul>";
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("表・引用・コードも通す。colspan は数字のみ", () => {
    const html = '<table><thead><tr><th colspan="2">見出し</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table><blockquote>引用</blockquote><pre><code>x</code></pre>';
    expect(sanitizeHtml(html)).toBe(html);
    expect(sanitizeHtml('<td colspan="2;x">a</td>')).toBe("<td>a</td>");
  });

  it("外部リンクには target=_blank と rel=noopener noreferrer を付ける。相対リンク・mailto・アンカーはそのまま", () => {
    expect(sanitizeHtml('<a href="https://example.com/a?x=1&y=2">リンク</a>')).toBe(
      '<a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">リンク</a>',
    );
    expect(sanitizeHtml('<a href="/sales/quotes">見積</a>')).toBe('<a href="/sales/quotes">見積</a>');
    expect(sanitizeHtml('<a href="mailto:a@example.com">メール</a>')).toBe('<a href="mailto:a@example.com">メール</a>');
    expect(sanitizeHtml('<a href="#top">上へ</a>')).toBe('<a href="#top">上へ</a>');
  });

  it("リンクの target を自分で指定しても上書きされる(_self などは無視)", () => {
    expect(sanitizeHtml('<a href="https://example.com" target="_self" rel="opener">x</a>')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it("画像: http(s)・相対の src、alt、数字の width/height を通す", () => {
    expect(sanitizeHtml('<img src="https://example.com/a.png" alt="説明" width="100" height="50">')).toBe(
      '<img src="https://example.com/a.png" alt="説明" width="100" height="50">',
    );
  });

  it("style: 見た目に関する安全なプロパティだけ残す", () => {
    expect(sanitizeHtml('<span style="color: #c00; font-weight: bold; position: fixed; top: 0">x</span>')).toBe(
      '<span style="color: #c00; font-weight: bold">x</span>',
    );
  });

  it("閉じ忘れのタグは補い、対応しない閉じタグは捨てる", () => {
    expect(sanitizeHtml("<p><b>太字")).toBe("<p><b>太字</b></p>");
    expect(sanitizeHtml("文字</p></div>")).toBe("文字");
    expect(sanitizeHtml("<b><i>a</b>b")).toBe("<b><i>a</i></b>b");
  });

  it("未許可のタグは、タグだけ捨てて文字を残す", () => {
    expect(sanitizeHtml("<font color=red>赤</font><center>中央</center>")).toBe("赤中央");
  });

  it("大文字のタグ名も同様に扱う", () => {
    expect(sanitizeHtml("<P>a</P><B>b</B>")).toBe("<p>a</p><b>b</b>");
  });

  it("タグでない「<」「>」は文字として無害化する", () => {
    expect(sanitizeHtml("1 < 2 and 3 > 2")).toBe("1 &lt; 2 and 3 &gt; 2");
    expect(sanitizeHtml("<p>a &amp; b</p>")).toBe("<p>a &amp; b</p>");
  });

  it("空・未定義でも例外にならない", () => {
    expect(sanitizeHtml("")).toBe("");
    expect(sanitizeHtml(undefined as unknown as string)).toBe("");
  });
});

describe("sanitizeHtml: 危険な入力(XSS)を無害化する", () => {
  const dangerous = (html: string) => {
    const out = sanitizeHtml(html);
    // 出力にスクリプト実行につながる要素・属性・スキームが一切残らない
    expect(out).not.toMatch(/<\s*(script|iframe|object|embed|svg|style|link|meta|form|input|button)\b/i);
    expect(out).not.toMatch(/\son[a-z]+\s*=/i);
    expect(out).not.toMatch(/javascript:|vbscript:|data:text\/html/i);
    return out;
  };

  it("script タグは中身ごと消える", () => {
    expect(dangerous("前<script>alert(1)</script>後")).toBe("前後");
    expect(dangerous("<SCRIPT SRC=//evil.example/x.js></SCRIPT>")).toBe("");
    expect(dangerous("<script>alert(1)")).toBe("");
  });

  it("イベント属性(onerror/onclick/onload)を落とす", () => {
    expect(dangerous("<img src=x onerror=alert(1)>")).toBe("<img>");
    expect(dangerous('<a href="https://e.example" onclick="alert(1)">x</a>')).toBe(
      '<a href="https://e.example" target="_blank" rel="noopener noreferrer">x</a>',
    );
    expect(dangerous('<div onmouseover="alert(1)">x</div>')).toBe("<div>x</div>");
  });

  it("javascript: のリンクを捨てる(大文字・空白・改行・エンティティでの偽装も)", () => {
    for (const href of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\nscript:alert(1)",
      "java&#x0A;script:alert(1)",
      "java&#09;script:alert(1)",
      "&#106;avascript:alert(1)",
      "&#x6A;&#x61;vascript&colon;alert(1)",
      "\u0001javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    ]) {
      const out = dangerous(`<a href="${href}">x</a>`);
      expect(out, href).toBe("<a>x</a>");
    }
  });

  it("img の src に javascript:/data: は通さない", () => {
    expect(dangerous('<img src="javascript:alert(1)">')).toBe("<img>");
    expect(dangerous('<img src="data:image/svg+xml;base64,AAAA">')).toBe("<img>");
  });

  it("style の url()・expression・@import・未許可プロパティを捨てる", () => {
    expect(sanitizeHtml('<div style="background: url(javascript:alert(1))">x</div>')).toBe("<div>x</div>");
    expect(sanitizeHtml('<div style="width: expression(alert(1))">x</div>')).toBe("<div>x</div>");
    expect(sanitizeHtml('<div style="color: red; behavior: url(x.htc)">x</div>')).toBe('<div style="color: red">x</div>');
    expect(sanitizeHtml('<div style="color: red\\; background: red">x</div>')).toBe("<div>x</div>");
  });

  it("svg・iframe・object・embed・form・style・link・meta は中身ごと消える", () => {
    expect(dangerous('<svg><script>alert(1)</script><circle onload="x"></circle></svg>')).toBe("");
    expect(dangerous('<iframe src="https://evil.example"></iframe>')).toBe("");
    expect(dangerous('<object data="x"></object><embed src="x">')).toBe("");
    expect(dangerous('<form action="https://evil.example"><input name="pw"><button>送信</button></form>')).toBe("");
    expect(dangerous("<style>body{display:none}</style>可視")).toBe("可視");
    expect(dangerous('<link rel="stylesheet" href="x"><meta http-equiv="refresh" content="0;url=x">')).toBe("");
  });

  it("コメント・DOCTYPE・CDATA・処理命令に隠した攻撃を消す", () => {
    expect(dangerous("<!--<script>alert(1)</script>-->表示")).toBe("表示");
    // CDATA の中のタグは実行されない。残るのは無害な文字だけ(要素にはならない)
    expect(dangerous("<!DOCTYPE html><![CDATA[<script>alert(1)</script>]]>x")).toBe("alert(1)]]&gt;x");
    expect(dangerous("<?xml version='1.0'?>x")).toBe("x");
  });

  it("タグの入れ子・崩れを使った回避(<<script>、引用符内の > など)", () => {
    expect(dangerous("<<script>script>alert(1)<</script>/script>")).not.toContain("<script");
    expect(dangerous('<a title="x>y" href="javascript:alert(1)">z</a>')).toBe('<a title="x&gt;y">z</a>');
    expect(dangerous("<img/src=x/onerror=alert(1)>")).toBe("<img>");
    expect(dangerous('<div/onclick="alert(1)">x</div>')).toBe("<div>x</div>");
    expect(dangerous("<scr<script>ipt>alert(1)</scr</script>ipt>")).not.toContain("<script");
  });

  it("引用符を閉じない属性・閉じていないタグでも、以降を文字として無害化する", () => {
    const out = dangerous('<a href="https://e.example>リンク<script>alert(1)</script>');
    expect(out).not.toContain("<script");
    // 閉じていないタグは、タグとして扱わず文字になる(要素・属性にはならない)
    expect(sanitizeHtml("<b onmouseover=alert(1)")).toBe("&lt;b onmouseover=alert(1)");
  });

  it("属性値の中の < > \" は無害化して出力する(属性の外へ出せない)", () => {
    const out = sanitizeHtml('<a href="/x" title=\'"><script>alert(1)</script>\'>t</a>');
    expect(out).not.toContain("<script");
    expect(out).toContain('title="&quot;&gt;');
  });

  it("入れ子の深さを制限する(極端な入力でも破綻しない)", () => {
    const deep = "<div>".repeat(500) + "x" + "</div>".repeat(500);
    const out = sanitizeHtml(deep);
    expect((out.match(/<div>/g) ?? []).length).toBeLessThanOrEqual(30);
    expect(out.match(/<div>/g)?.length).toBe(out.match(/<\/div>/g)?.length);
  });

  it("再度サニタイズしても結果が変わらない(冪等)", () => {
    const inputs = [
      '<p>a <a href="https://e.example/?a=1&b=2">x</a></p>',
      "<b>閉じ忘れ",
      '<img src="/a.png" alt="&quot;">',
      "1 < 2 <script>x</script>",
    ];
    for (const html of inputs) {
      const once = sanitizeHtml(html);
      expect(sanitizeHtml(once)).toBe(once);
    }
  });
});

describe("plainTextToHtml(従来の平文本文の移行用)", () => {
  it("文字を無害化し、改行を <br> にする", () => {
    expect(plainTextToHtml("1行目\n2行目\r\n3行目")).toBe("1行目<br>2行目<br>3行目");
    expect(plainTextToHtml("<script>alert(1)</script> & a")).toBe("&lt;script&gt;alert(1)&lt;/script&gt; &amp; a");
  });
});
