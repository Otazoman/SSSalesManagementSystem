"use client";

import { usePagePermissions } from "../../hooks/use-page-permission";
import { useJournalPostingRules } from "./_hooks/useJournalPostingRules";
import { JournalPostingRuleSection } from "./_components/JournalPostingRuleSection";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";

export default function JournalPostingRulesPage() {
  const { canRead, canUpdate, loading: permsLoading } = usePagePermissions();
  const { eventTypes, rules, accounts, loading, savingEventType, message, errors, updateRule, updatePattern, saveRule } =
    useJournalPostingRules(!permsLoading && canRead);

  if (permsLoading) return <LoadingGate />;
  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="border-b pb-4 border-slate-200">
        <h1 className="text-2xl font-black text-slate-900">⚙️ 仕訳ルールマスタ</h1>
        <p className="text-sm text-slate-600 mt-1">
          前払・仕入計上・前受・売上計上・入金・支払の各会計事象について、仕訳を作成するときに使う勘定科目を設定します(仕訳は仕訳データ出力画面で伝票を選んで作成します)。
          仕訳は「借方〇〇/貸方〇〇」の組で作ります。組(売上・返品・値引などの区分ごとの本体・消費税など)ごとに、借方と貸方の勘定科目を選んでください。
        </p>
        {!canUpdate && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-2">
            この画面は閲覧のみ可能です(変更には更新権限が必要です)。
          </p>
        )}
      </div>

      <MessageBanner message={message} />

      {loading || !rules ? (
        <p className="text-xs text-slate-600">読み込み中...</p>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {eventTypes.map((eventType) => (
            <JournalPostingRuleSection
              key={eventType}
              eventType={eventType}
              rule={rules[eventType]}
              accounts={accounts}
              saving={savingEventType === eventType}
              error={errors[eventType]}
              disabled={!canUpdate}
              onChange={(patch) => updateRule(eventType, patch)}
              onPatternChange={(index, patch) => updatePattern(eventType, index, patch)}
              onSave={() => void saveRule(eventType)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
