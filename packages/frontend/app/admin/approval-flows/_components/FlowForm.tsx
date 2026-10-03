"use client";

import {
  DepartmentOption,
  RoleRecord,
  ScreenRecord,
  BuilderStep,
} from "../_types";
import { Button } from "../../../_shared/ui/Button";

interface FlowFormProps {
  canCreate: boolean;
  canUpdate: boolean;
  editingFlowId: string | null;
  isSubmitting?: boolean;
  flowName: string;
  setFlowName: (val: string) => void;
  requestType: string;
  setRequestType: (val: string) => void;
  minAmount: string;
  setMinAmount: (val: string) => void;
  maxAmount: string;
  setMaxAmount: (val: string) => void;
  matchField: string;
  setMatchField: (val: string) => void;
  matchValue: string;
  setMatchValue: (val: string) => void;
  roles: RoleRecord[];
  selectedRoleId: string;
  setSelectedRoleId: (val: string) => void;
  departmentOptions: DepartmentOption[];
  selectedDepartmentSurrogateId: string | null;
  setSelectedDepartmentSurrogateId: (val: string | null) => void;
  stepName: string;
  setStepName: (val: string) => void;
  stepMemo: string;
  setStepMemo: (val: string) => void;
  builderSteps: BuilderStep[];
  addStepToBuilder: () => void;
  removeStepFromBuilder: (idx: number) => void;
  handleSubmitFlow: (e: React.SyntheticEvent) => void;
  handleCancelEdit: () => void;
  screens: ScreenRecord[];
}

export function FlowForm({
  canCreate,
  canUpdate,
  editingFlowId,
  isSubmitting = false,
  flowName,
  setFlowName,
  requestType,
  setRequestType,
  minAmount,
  setMinAmount,
  maxAmount,
  setMaxAmount,
  matchField,
  setMatchField,
  matchValue,
  setMatchValue,
  roles,
  selectedRoleId,
  setSelectedRoleId,
  departmentOptions,
  selectedDepartmentSurrogateId,
  setSelectedDepartmentSurrogateId,
  stepName,
  setStepName,
  stepMemo,
  setStepMemo,
  builderSteps,
  addStepToBuilder,
  removeStepFromBuilder,
  handleSubmitFlow,
  handleCancelEdit,
  screens,
}: FlowFormProps) {
  const isEditable = editingFlowId ? canUpdate : canCreate;

  const inputClass =
    "w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none transition-colors placeholder:text-slate-500 font-medium disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed";

  return (
    <form
      onSubmit={handleSubmitFlow}
      className="bg-white p-5 rounded-lg space-y-4 border border-slate-200 shadow-sm relative"
    >
      {!isEditable && (
        <div className="absolute top-2 right-4 text-[10px] font-bold text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded">
          閲覧専用
        </div>
      )}

      <fieldset
        disabled={!isEditable || isSubmitting}
        className="space-y-4 w-full"
      >
        <h3 className="text-xs font-bold text-slate-900 border-b pb-1">
          {editingFlowId ? "承認フロー情報の編集" : "新規個別ルート定義"}
        </h3>

        <div>
          <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
            フロー識別名称
          </label>
          <input
            type="text"
            required
            className={inputClass}
            placeholder="例: 購買申請_大口(100万超)"
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
              対象申請種別
            </label>
            <select
              required
              className={`${inputClass} cursor-pointer bg-white`}
              value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
            >
              <option value="">-- 対象業務を選択 --</option>
              {screens.map((s) => (
                <option key={s.resource} value={s.resource}>
                  {s.category === "business_master" ? "【マスタ】" : "【業務】"}
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
              下限金額 (円以上)
            </label>
            <input
              type="number"
              required
              className={inputClass}
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
            上限金額 (円未満)
          </label>
          <input
            type="number"
            required
            className={inputClass}
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
          />
        </div>

        <div className="border border-slate-200 p-3 rounded-lg bg-slate-50 space-y-2">
          <span className="block text-[10px] font-bold text-slate-700">
            🎯 詳細マッチ条件(任意)
          </span>
          <p className="text-[10px] text-slate-600">
            金額レンジに加え、申請データ内の特定フィールドが指定した値の場合のみこのフローを適用したい場合に設定します。両方空欄なら金額レンジのみで判定します。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
                対象フィールド名
              </label>
              <input
                type="text"
                className={inputClass}
                placeholder="例: requestType"
                value={matchField}
                onChange={(e) => setMatchField(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
                期待値
              </label>
              <input
                type="text"
                className={inputClass}
                placeholder="例: CONSUMABLE"
                value={matchValue}
                onChange={(e) => setMatchValue(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="border border-slate-200 p-3 rounded-lg bg-slate-50 space-y-2">
          <span className="block text-[10px] font-bold text-slate-700">
            ⛓️ 承認ステップのビルダー組み立て
          </span>

          <div>
            <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
              ステップ名称 (例: 部長決裁、経理確認)
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="未入力の場合は自動割り当て"
              value={stepName}
              onChange={(e) => setStepName(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <select
              className={`${inputClass} flex-1 bg-white cursor-pointer`}
              value={selectedRoleId}
              onChange={(e) => setSelectedRoleId(e.target.value)}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <Button
              className="shrink-0"
              onClick={addStepToBuilder}
              disabled={!isEditable || isSubmitting}
            >
              ＋ 追加
            </Button>
          </div>

          <select
            className={`${inputClass} bg-white cursor-pointer`}
            value={selectedDepartmentSurrogateId || ""}
            onChange={(e) =>
              setSelectedDepartmentSurrogateId(e.target.value || null)
            }
          >
            <option value="">指定なし (申請者の自部署ロールに依頼)</option>
            {departmentOptions.map((d) => {
              const isFuture = new Date(d.validFrom) > new Date();
              const futureLabel = isFuture
                ? ` [先行登録: ${new Date(d.validFrom).toLocaleDateString()}〜]`
                : "";
              return (
                <option key={d.surrogateId} value={d.surrogateId}>
                  {d.name} ({d.id}){futureLabel}
                </option>
              );
            })}
          </select>

          <input
            type="text"
            className={inputClass}
            placeholder="ステップ補足メモ(省略可)"
            value={stepMemo}
            onChange={(e) => setStepMemo(e.target.value)}
          />

          <div className="pt-2 space-y-1">
            {builderSteps.map((s, idx) => {
              const roleObj = roles.find((r) => r.id === s.approverRoleId);
              const deptObj = departmentOptions.find(
                (d) => d.surrogateId === s.targetDepartmentSurrogateId,
              );
              return (
                <div
                  key={idx}
                  className="flex justify-between items-center bg-white border border-slate-200 p-2 rounded text-xs shadow-xs"
                >
                  <span className="font-bold text-slate-700 font-mono">
                    {s.stepName ? (
                      <span className="text-indigo-600 font-sans font-bold bg-indigo-50 px-1.5 py-0.5 rounded mr-1">
                        {s.stepName}
                      </span>
                    ) : (
                      `第 ${idx + 1} 段階`
                    )}
                    :{" "}
                    <span className="text-slate-800 font-sans font-normal">
                      {roleObj?.name || s.approverRoleId}
                    </span>
                    {deptObj && (
                      <span className="text-[10px] text-slate-500 font-normal ml-1">
                        ({deptObj.name})
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeStepFromBuilder(idx)}
                    className="text-red-500 font-bold text-xs hover:underline cursor-pointer"
                  >
                    削除
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </fieldset>

      <div className="pt-2 flex gap-2">
        <button
          type="submit"
          disabled={!isEditable || isSubmitting}
          className={`flex-1 py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${
            isEditable && !isSubmitting
              ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
              : "bg-slate-300 text-slate-500 cursor-not-allowed"
          }`}
        >
          {isSubmitting ? "処理中..." : editingFlowId ? "保存" : "登録"}
        </button>
        {editingFlowId && (
          <button
            type="button"
            onClick={handleCancelEdit}
            className="border border-slate-200 text-slate-600 bg-white px-3 py-2 rounded text-xs font-bold hover:bg-slate-50 cursor-pointer"
          >
            キャンセル
          </button>
        )}
      </div>
    </form>
  );
}
