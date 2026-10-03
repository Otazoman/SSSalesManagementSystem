/**
 * R2添付ファイル用のキーを生成する。
 * ISSUE-10の調査で判明した、機能ごとに異なっていた命名規則(弱い乱数・元ファイル名の破棄等)を
 * 統一したもの。ファイル配信がDB経由(attachmentId解決)になったことで、キー形式は
 * クライアントから一切参照されない完全な内部実装詳細になったため、今後の新規アップロード分は
 * このヘルパーで生成する形に統一する。
 *
 * 既存にアップロード済みのファイルのキー(DBの attachmentR2Path に保存済みの値)は
 * 変更不要で、そのまま引き続き有効に読み書きできる。
 */
export function generateAttachmentKey(prefix: string, fileName: string): string {
  return `${prefix}/${crypto.randomUUID()}_${fileName}`;
}
