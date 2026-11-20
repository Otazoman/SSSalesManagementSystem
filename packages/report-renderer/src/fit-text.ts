// Item4-a Stage2: セル幅を超える長いテキスト(会社名等)が隣のセルへ重なって見えるのを防ぐための
// 純粋関数(pdf-lib非依存)。実際の文字幅計測(pdf-libのfont.widthOfTextAtSize)は呼び出し元が
// measureWidthとして注入する。テスト時は単純な近似関数を注入できる。
const CELL_PADDING_PT = 2;
const MIN_FONT_SIZE_PT = 6;
// フォントサイズ縮小後の幅再計算は浮動小数点の丸め誤差でmaxWidthをごく僅かに超えることがある
// (実測: 338 vs 338.00000000000006)。この誤差だけで不要な文字切り詰めが発動しないよう許容誤差を設ける
const WIDTH_EPSILON_PT = 0.05;

export interface FittedText {
  text: string;
  size: number;
  width: number;
}

export function fitTextToWidth(
  measureWidth: (text: string, size: number) => number,
  text: string,
  requestedSize: number,
  cellWidthPt: number,
): FittedText {
  const maxWidth = Math.max(cellWidthPt - CELL_PADDING_PT * 2, 0);

  let size = requestedSize;
  let width = measureWidth(text, size);

  // (1) 幅に収まるまでフォントサイズを縮小する(下限あり)
  if (width > maxWidth + WIDTH_EPSILON_PT && maxWidth > 0) {
    const scaledSize = (size * maxWidth) / width;
    size = Math.max(scaledSize, MIN_FONT_SIZE_PT);
    width = measureWidth(text, size);
  }

  // (2) 最小サイズでもなお収まらない場合は末尾を省略記号に置き換える
  if (width > maxWidth + WIDTH_EPSILON_PT && maxWidth > 0) {
    let truncated = text;
    while (truncated.length > 1) {
      truncated = truncated.slice(0, -1);
      const candidate = `${truncated}...`;
      const candidateWidth = measureWidth(candidate, size);
      if (candidateWidth <= maxWidth) {
        return { text: candidate, size, width: candidateWidth };
      }
    }
  }

  return { text, size, width };
}

/**
 * BUG-115: 長い値(所在地など)を、セルの幅で折り返して最大 maxLines 行にする(日本語のため1文字ずつ測る)。
 * 行に収まらない分は、最後の行の末尾を省略記号にする。空白は折り返しの位置の目安にする(英数字の語の途中で切らないように)
 */
export function wrapTextToWidth(
  measureWidth: (text: string, size: number) => number,
  text: string,
  size: number,
  cellWidthPt: number,
  maxLines = 2,
): string[] {
  const maxWidth = Math.max(cellWidthPt - CELL_PADDING_PT * 2, 0);
  if (!text || maxWidth <= 0 || measureWidth(text, size) <= maxWidth + WIDTH_EPSILON_PT) return [text];
  const lines: string[] = [];
  let rest = text;
  while (rest.length > 0 && lines.length < maxLines) {
    if (measureWidth(rest, size) <= maxWidth + WIDTH_EPSILON_PT) {
      lines.push(rest);
      rest = "";
      break;
    }
    let cut = 1;
    while (cut < rest.length && measureWidth(rest.slice(0, cut + 1), size) <= maxWidth + WIDTH_EPSILON_PT) cut++;
    // 空白があれば、その手前で折り返す(行の半分より後ろにある時だけ)
    const space = rest.slice(0, cut).lastIndexOf(" ");
    if (space > cut / 2 && cut < rest.length) cut = space + 1;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = fitTextToWidth(measureWidth, `${last}${rest}`, size, cellWidthPt).text;
    // 文字は縮めない(行の高さを揃えるため)。省略記号つきの形を、元の大きさで作り直す
    let truncated = last;
    while (truncated.length > 1 && measureWidth(`${truncated}...`, size) > maxWidth) truncated = truncated.slice(0, -1);
    lines[lines.length - 1] = `${truncated}...`;
  }
  return lines;
}
