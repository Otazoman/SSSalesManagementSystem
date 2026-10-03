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
