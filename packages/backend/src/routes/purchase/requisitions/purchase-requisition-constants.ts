// 監査ログ(logAuditEvent)のresourceKey、および承認フローTargetAdapter登録キー(registry.ts)として
// 購買申請機能の全サブサービスから共通で参照する。screens.tsの既存resource値"purchase_requisitions"と
// 一致させる(admin/approval-flows画面の「対象業務」選択肢がscreens.tsのresource値をそのまま使う仕様のため)。
export const RESOURCE_KEY = "purchase_requisitions";
