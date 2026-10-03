/**
 * R2バケットアクセスの統一ラッパー。
 * 現状は各serviceが `c.env.XXX_BUCKET.put/get/delete` を直接呼んでおり、
 * 署名付きURL発行(見積書PDFの一時共有URL等、将来機能。docs/target-architecture.md 18章参照)の
 * ような横断的なR2機能を置く場所が存在しない。
 * Phase1では新設のみ行い、既存の各serviceのR2呼び出し方は変更しない(挙動は変わらない)。
 * Phase2以降、各featureのR2アクセスをこのラッパー経由に統一していく想定。
 */
export class R2ObjectClient {
  constructor(private readonly bucket: R2Bucket) {}

  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: R2PutOptions,
  ): Promise<R2Object> {
    return this.bucket.put(key, value, options);
  }

  get(key: string): Promise<R2ObjectBody | null> {
    return this.bucket.get(key);
  }

  delete(key: string): Promise<void> {
    return this.bucket.delete(key);
  }
}
