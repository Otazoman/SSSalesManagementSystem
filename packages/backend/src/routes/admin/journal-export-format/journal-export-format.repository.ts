import { Env } from "../../../types/env";

// Item11-2: 仕訳CSV出力フォーマット設定の永続化。company-settings(KVキー"config"、
// 巨大な単一JSONで全社設定を保持)とはあえて独立させ、専用のKVキーに保存する
// (ユーザー確認済み: 専用画面に切り出すのに合わせ、既存の会社設定フォームとは疎結合にする)
const KV_KEY = "journal_export_format";

export class JournalExportFormatRepository {
  private kv: KVNamespace;

  constructor(env: Env) {
    this.kv = env.COMPANY_SETTINGS;
  }

  async getConfig(): Promise<string | null> {
    return await this.kv.get(KV_KEY);
  }

  async saveConfig(configJson: string): Promise<void> {
    await this.kv.put(KV_KEY, configJson);
  }
}
