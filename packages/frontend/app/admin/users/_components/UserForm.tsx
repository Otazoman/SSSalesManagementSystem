"use client";

import { useUserForm } from "../_hooks/useUserForm";
import { UserRecord, DepartmentRecord, RoleRecord } from "../_types";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";

interface UserFormProps {
  editingUserId: string | null;
  users: UserRecord[];
  departments: DepartmentRecord[];
  roles: RoleRecord[];
  hasCreate: boolean;
  hasUpdate: boolean;
  hasFormPermission: boolean;
  isSubmitting?: boolean;
  onSuccess: () => void;
  setError: (msg: string) => void;
  setMessage: (msg: string) => void;
}

export function UserForm({
  editingUserId,
  users,
  departments,
  roles,
  hasCreate,
  hasUpdate,
  hasFormPermission,
  isSubmitting = false,
  onSuccess,
  setError,
  setMessage,
}: UserFormProps) {
  const {
    empNum,
    setEmpNum,
    userName,
    setUserName,
    userEmail,
    setUserEmail,
    userPass,
    setUserPass,
    sendEmail,
    setSendEmail,
    slackUserId,
    setSlackUserId,
    notificationChannel,
    setNotificationChannel,
    formRelations,
    addRelationRow,
    removeRelationRow,
    updateRelationRow,
    handleUserSubmit,
  } = useUserForm({
    editingUserId,
    users,
    hasCreate,
    hasUpdate,
    hasFormPermission,
    onSuccess,
    setError,
    setMessage,
  });

  const inputClass = formFieldInputClass;

  return (
    <form
      onSubmit={handleUserSubmit}
      className="bg-white p-5 rounded-lg space-y-4 border border-slate-200 shadow-sm relative"
    >
      {!hasFormPermission && (
        <div className="absolute top-2 right-4 text-[10px] font-bold text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded">
          閲覧専用
        </div>
      )}

      <fieldset
        disabled={!hasFormPermission || isSubmitting}
        className="space-y-4 w-full"
      >
        <h3 className="text-xs font-bold text-slate-900 border-b pb-1">
          {editingUserId ? "ユーザー情報の編集" : "新規個別ユーザー登録"}
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="従業員番号">
            <input
              type="text"
              required
              disabled={!!editingUserId || !hasCreate}
              className={inputClass}
              placeholder="例: EMP202600"
              value={empNum}
              onChange={(e) => setEmpNum(e.target.value)}
            />
          </FormField>
          <FormField label="氏名">
            <input
              type="text"
              required
              className={inputClass}
              placeholder="例: 山田 太郎"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="メールアドレス">
            <input
              type="email"
              required
              className={inputClass}
              placeholder="例: yamada@example.com"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
            />
          </FormField>
          <FormField label="パスワード">
            <input
              type="password"
              className={inputClass}
              placeholder={
                editingUserId ? "変更時のみ入力" : "空欄なら自動生成"
              }
              value={userPass}
              onChange={(e) => setUserPass(e.target.value)}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="通知方法(パスワード再設定・承認通知)">
            <select
              className={inputClass}
              value={notificationChannel}
              onChange={(e) =>
                setNotificationChannel(e.target.value as "email" | "slack")
              }
            >
              <option value="email">メール</option>
              <option value="slack">Slack</option>
            </select>
          </FormField>
          <FormField label="SlackメンバーID(Slack選択時は必須)">
            <input
              type="text"
              className={inputClass}
              placeholder="例: U01ABCDEFGH"
              value={slackUserId}
              onChange={(e) => setSlackUserId(e.target.value)}
            />
          </FormField>
        </div>

        {!editingUserId && (
          <div className="flex items-center space-x-2 p-2 bg-slate-50 rounded border border-slate-200">
            <input
              type="checkbox"
              id="sendEmailCheckbox"
              disabled={!hasCreate}
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
            />
            <label
              htmlFor="sendEmailCheckbox"
              className="text-xs font-bold text-slate-700 cursor-pointer select-none disabled:text-slate-500"
            >
              ✉️
              登録完了時に、初期パスワード通知メールをユーザー宛に自動送信する
            </label>
          </div>
        )}

        <div className="border border-slate-200 p-3 rounded-lg bg-slate-50 space-y-2">
          <div className="flex justify-between items-center border-b pb-1 border-slate-200">
            <label className="text-[10px] font-bold text-slate-700">
              🏢 配属部署 ✕ 権限(ロール)の一体型設定
            </label>
            {hasFormPermission && (
              <button
                type="button"
                onClick={addRelationRow}
                className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-200 font-bold hover:bg-indigo-100 cursor-pointer"
              >
                ＋ 所属・権限を追加
              </button>
            )}
          </div>
          {formRelations.length === 0 ? (
            <div className="text-center py-4 bg-white border rounded text-xs text-slate-600 italic">
              所属および権限が登録されていません。
            </div>
          ) : (
            formRelations.map((row, idx) => {
              const isSysAdmin = row.roleId === "admin";
              return (
                <div
                  key={idx}
                  className="flex items-center space-x-2 bg-white p-2 rounded border border-slate-200 shadow-sm"
                >
                  <select
                    disabled={isSysAdmin || !hasFormPermission}
                    className={`${inputClass} flex-1 bg-white`}
                    value={row.departmentId}
                    onChange={(e) =>
                      updateRelationRow(idx, "departmentId", e.target.value)
                    }
                  >
                    <option value="">
                      {isSysAdmin
                        ? "全社共通(部署指定なし)"
                        : "配属部署を選択"}
                    </option>
                    {departments.map((d) => (
                      <option key={d.surrogateId || d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-600 text-xs">➔</span>
                  <select
                    className={`${inputClass} flex-1 bg-white`}
                    value={row.roleId}
                    onChange={(e) =>
                      updateRelationRow(idx, "roleId", e.target.value)
                    }
                  >
                    <option value="">権限(ロール)を選択 *</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  {hasFormPermission && (
                    <button
                      type="button"
                      onClick={() => removeRelationRow(idx)}
                      className="text-red-500 hover:text-red-700 font-bold text-xs px-1 cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </fieldset>

      <div className="pt-2">
        <button
          type="submit"
          disabled={!hasFormPermission || isSubmitting}
          className={`w-full py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${
            hasFormPermission && !isSubmitting
              ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
              : "bg-slate-300 text-slate-500 cursor-not-allowed"
          }`}
        >
          {isSubmitting ? "処理中..." : editingUserId ? "保存" : "登録"}
        </button>
      </div>
    </form>
  );
}
