import { Env } from "../../../types/env";

export class CompanySettingsRepository {
  private kv: KVNamespace;

  constructor(env: Env) {
    this.kv = env.COMPANY_SETTINGS;
  }

  // KVから設定データを取得
  async getConfig(): Promise<string | null> {
    return await this.kv.get("config");
  }

  // KVへ設定データを保存
  async saveConfig(configJson: string): Promise<void> {
    await this.kv.put("config", configJson);
  }
}
