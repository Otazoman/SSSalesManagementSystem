"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { useCsvImport } from "../../../_shared/hooks/use-csv-import";
import { PROGRESS_STAGE_KEYS, ProgressStageKey } from "../../../progress/_types";

export type OwnerType = "" | "USER" | "ROLE" | "DEPT_ROLE";

export interface OwnerSetting {
  type: OwnerType;
  ref: string;
}

interface OwnerRow {
  stageKey: ProgressStageKey;
  assigneeType: "USER" | "ROLE" | "DEPT_ROLE";
  assigneeRef: string; // DEPT_ROLE は "部門surrogateId:ロールID"
}

export interface DepartmentOption {
  surrogateId: string;
  id: string;
  name: string;
}

// 部門+ロールは1つのassigneeRef("部門surrogateId:ロールID")で保存する
export function splitDeptRole(ref: string): { deptId: string; roleId: string } {
  const index = ref.indexOf(":");
  return index < 0 ? { deptId: ref, roleId: "" } : { deptId: ref.slice(0, index), roleId: ref.slice(index + 1) };
}

export interface EmployeeOption {
  employeeNumber: string;
  name: string;
}

export interface RoleOption {
  id: string;
  name: string;
}

const emptySettings = () =>
  Object.fromEntries(PROGRESS_STAGE_KEYS.map((k) => [k, { type: "", ref: "" }])) as Record<ProgressStageKey, OwnerSetting>;

// 進捗確認の「工程ごとの既定担当(誰が何をするか)」の設定。個人(社員マスタ)またはロールを工程ごとに指定する
export function useProgressStageOwners(enabled: boolean) {
  const [settings, setSettings] = useState<Record<ProgressStageKey, OwnerSetting>>(emptySettings());
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      try {
        const [owners, users, roleList, deptList] = await Promise.all([
          apiFetch<OwnerRow[]>("/api/progress/stage-owners"),
          apiFetch<(EmployeeOption & { isActive?: boolean })[]>("/api/users"),
          apiFetch<RoleOption[]>("/api/roles"),
          apiFetch<DepartmentOption[]>("/api/departments?filter=active_and_future"),
        ]);
        const next = emptySettings();
        for (const o of owners) next[o.stageKey] = { type: o.assigneeType, ref: o.assigneeRef };
        setSettings(next);
        setEmployees(
          users
            .filter((u) => u.isActive !== false && !!u.employeeNumber)
            .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber)),
        );
        setRoles(roleList);
        setDepartments(Array.isArray(deptList) ? deptList : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "設定の取得に失敗しました");
      } finally {
        setLoading(false);
      }
    })();
  }, [enabled]);

  // CSV取込後に、保存済みの担当設定だけを取得し直して画面に反映する
  const reloadOwners = async () => {
    const owners = await apiFetch<OwnerRow[]>("/api/progress/stage-owners");
    const next = emptySettings();
    for (const o of owners) next[o.stageKey] = { type: o.assigneeType, ref: o.assigneeRef };
    setSettings(next);
  };

  // CSV出力(全工程。そのまま編集して再取込できる)と取込。不正行の一覧は複数行のため、通常のエラーとは別に保持する
  const { download, downloading } = useCsvDownload({ fileNamePrefix: "progress_stage_owners", onError: setError });
  const handleDownloadCsv = () => download("/api/progress/stage-owners/csv-download");
  const [importError, setImportError] = useState("");
  const { importCsv, importing } = useCsvImport({
    onSuccess: reloadOwners,
    onMessage: setMessage,
    onError: setImportError,
  });
  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError("");
    setError("");
    setMessage("");
    await importCsv("/api/progress/stage-owners/bulk-register", e);
  };

  const change = (stageKey: ProgressStageKey, patch: Partial<OwnerSetting>) => {
    setSettings((prev) => {
      const current = prev[stageKey];
      // 種別を変えたら、前の種別の指定値は無効になるためクリアする
      const next = patch.type !== undefined && patch.type !== current.type ? { type: patch.type, ref: "" } : { ...current, ...patch };
      return { ...prev, [stageKey]: next };
    });
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const owners = PROGRESS_STAGE_KEYS.filter((k) => settings[k].type && settings[k].ref).map((k) => ({
        stageKey: k,
        assigneeType: settings[k].type,
        assigneeRef: settings[k].ref,
      }));
      const incomplete = PROGRESS_STAGE_KEYS.filter((k) => settings[k].type && !settings[k].ref);
      if (incomplete.length > 0) {
        setError("種別を選んだ工程は、担当者・ロール・部署+ロールのいずれかも選択してください");
        return;
      }
      await apiFetch("/api/progress/stage-owners", {
        method: "PUT",
        json: { owners },
        defaultErrorMessage: "保存に失敗しました",
      });
      setMessage("工程ごとの既定担当を保存しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return {
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
    clearImportError: () => setImportError(""),
    handleImportCsv,
  };
}
