"use client";

import { usePagePermissions } from "../../hooks/use-page-permission";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import {
  useProgressStageOwners,
  OwnerType,
  splitDeptRole,
} from "./_hooks/useProgressStageOwners";
import {
  PROGRESS_STAGE_KEYS,
  PROGRESS_STAGE_LABELS,
} from "../../progress/_types";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";

const INPUT_CLASS =
  "border border-slate-400 rounded px-2 py-1.5 bg-white text-slate-900";
const SUB_BUTTON =
  "px-4 py-1.5 border border-slate-400 rounded bg-white text-slate-800 hover:bg-slate-100 disabled:opacity-50 text-xs";

export default function ProgressStageOwnersPage() {
  const { canRead, canUpdate, loading: permsLoading } = usePagePermissions();
  const {
    settings,
    employees,
    roles,
    departments,
    loading,
    saving,
    error,
    message,
    change,
    save,
    downloading,
    handleDownloadCsv,
    importing,
    importError,
    clearImportError,
    handleImportCsv,
  } = useProgressStageOwners(canRead);

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
    <div className="w-full space-y-4">
      <PageHeader
        title="👥 進捗確認: 工程ごとの担当設定"
        description={
          <>
            「どの工程は誰(またはどのロール)が担当するか」を設定します。進捗確認画面の「次:
            〇〇 / 担当: △△」に表示されます。
            案件ごとに個別の担当者を割当てた場合は、そちらが優先されます。
            担当者はユーザーマスタから選択し、ロールを指定した場合は「ロール:
            〇〇」、部署+ロールを指定した場合は「部署/ロール: 〇〇 /
            △△」と表示されます(未設定の工程は「未設定」)。
          </>
        }
      />

      <MessageBanner message={message} error={error} />
      {importError && (
        <div
          role="alert"
          className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded border border-red-100 space-y-1"
        >
          <div className="whitespace-pre-line">{importError}</div>
          <button
            type="button"
            onClick={clearImportError}
            className="underline text-red-800 font-semibold"
          >
            閉じる
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void handleDownloadCsv()}
          disabled={downloading || loading}
          className={SUB_BUTTON}
        >
          CSVダウンロード
        </button>
        {canUpdate && (
          <label
            className={`${SUB_BUTTON} cursor-pointer ${importing ? "opacity-50 pointer-events-none" : ""}`}
          >
            {importing ? "インポート中..." : "CSVインポート"}
            <input
              type="file"
              accept=".csv"
              className="hidden"
              disabled={importing}
              onChange={(e) => void handleImportCsv(e)}
            />
          </label>
        )}
      </div>

      <details className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-3">
        <summary className="cursor-pointer font-semibold text-slate-800">
          CSVの書き方(「CSVダウンロード」したファイルをそのまま取り込めます)
        </summary>
        <ul className="list-disc pl-5 mt-2 space-y-1 leading-relaxed">
          <li>
            出力は全12工程が1行ずつです(未設定の工程は担当が空欄)。
            <b>stageLabel・assigneeName</b>
            は見やすくするための参考列で、CSVインポートでは無視します (
            <b>stageKey・assigneeType・assigneeRef</b>
            の3列があれば取り込めます)。
          </li>
          <li>
            assigneeTypeは USER(assigneeRef=従業員番号)/ ROLE(ロールID)/
            DEPT_ROLE(「部署コード:ロールID」。例: 0041:manager)。
            部署コードは部署マスタのidです(部署の有効期間が複数ある場合は、現在有効なものが使われます)。
          </li>
          <li>
            CSVに含まれる工程だけを更新します(CSVに無い工程は変更しません)。
            <b>assigneeType・assigneeRefを両方空欄</b>
            にした工程は未設定に戻ります。
          </li>
          <li>
            存在しないユーザー・ロール・部署や、形式の不正な行があると、1件も反映されません(不正な行は行番号つきで表示されます)。
          </li>
        </ul>
      </details>

      {loading ? (
        <LoadingGate label="読み込み中..." />
      ) : (
        <div className="border border-slate-200 rounded-lg bg-white overflow-auto">
          <table className="min-w-full text-xs text-slate-900">
            <thead className="bg-slate-100 text-slate-900">
              <tr>
                <th className="px-3 py-2 text-left">工程</th>
                <th className="px-3 py-2 text-left">指定方法</th>
                <th className="px-3 py-2 text-left">担当者 / ロール</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {PROGRESS_STAGE_KEYS.map((key) => {
                const setting = settings[key];
                return (
                  <tr key={key}>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">
                      {PROGRESS_STAGE_LABELS[key]}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={setting.type}
                        disabled={!canUpdate}
                        onChange={(e) =>
                          change(key, { type: e.target.value as OwnerType })
                        }
                        className={`${INPUT_CLASS} disabled:opacity-50`}
                      >
                        <option value="">未設定</option>
                        <option value="USER">担当者(ユーザーマスタ)</option>
                        <option value="ROLE">ロール</option>
                        <option value="DEPT_ROLE">部署+ロール</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {setting.type === "USER" && (
                        <select
                          value={setting.ref}
                          disabled={!canUpdate}
                          onChange={(e) => change(key, { ref: e.target.value })}
                          className={`${INPUT_CLASS} w-64 disabled:opacity-50`}
                        >
                          <option value="">選択してください</option>
                          {employees.map((emp) => (
                            <option
                              key={emp.employeeNumber}
                              value={emp.employeeNumber}
                            >
                              {emp.name}({emp.employeeNumber})
                            </option>
                          ))}
                        </select>
                      )}
                      {setting.type === "ROLE" && (
                        <select
                          value={setting.ref}
                          disabled={!canUpdate}
                          onChange={(e) => change(key, { ref: e.target.value })}
                          className={`${INPUT_CLASS} w-64 disabled:opacity-50`}
                        >
                          <option value="">選択してください</option>
                          {roles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {setting.type === "DEPT_ROLE" && (
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={splitDeptRole(setting.ref).deptId}
                            disabled={!canUpdate}
                            onChange={(e) =>
                              change(key, {
                                ref: `${e.target.value}:${splitDeptRole(setting.ref).roleId}`,
                              })
                            }
                            className={`${INPUT_CLASS} w-48 disabled:opacity-50`}
                          >
                            <option value="">部署を選択</option>
                            {departments.map((dept) => (
                              <option
                                key={dept.surrogateId}
                                value={dept.surrogateId}
                              >
                                {dept.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={splitDeptRole(setting.ref).roleId}
                            disabled={!canUpdate}
                            onChange={(e) =>
                              change(key, {
                                ref: `${splitDeptRole(setting.ref).deptId}:${e.target.value}`,
                              })
                            }
                            className={`${INPUT_CLASS} w-48 disabled:opacity-50`}
                          >
                            <option value="">ロールを選択</option>
                            {roles.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Button
        size="sm"
        onClick={() => void save()}
        disabled={saving || !canUpdate || loading}
      >
        {saving ? "保存中..." : "保存"}
      </Button>
    </div>
  );
}
