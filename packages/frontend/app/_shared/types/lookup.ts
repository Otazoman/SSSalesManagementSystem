// 複数機能で重複定義されている「選択肢」用の共通形状。
// 既存の重複定義（コード体系のマスタ用・ID体系のマスタ用）の置き換えはPhase4で該当featureに触れる際に行う。

export interface CodeNameLookup {
  code: string;
  name: string;
}

export interface IdNameLookup {
  id: string;
  name: string;
}
