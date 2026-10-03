import { useState, useEffect, useCallback, useMemo } from "react";
import {
  StructureRecord,
  BomTreeNode,
  ItemLookup,
  BomParentLookup,
  FilterPeriodType,
  PeriodStatus,
} from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { useCsvImport } from "../../../_shared/hooks/use-csv-import";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import type { ApplicantDepartmentOption } from "../../../types";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

export const formatToInputDate = (
  dateVal: string | number | null | undefined,
): string => {
  if (!dateVal) return "";
  try {
    if (
      typeof dateVal === "string" &&
      dateVal.includes("-") &&
      dateVal.length >= 10
    ) {
      return dateVal.split("T")[0];
    }
    const parsed = new Date(
      typeof dateVal === "string" && !isNaN(Number(dateVal))
        ? Number(dateVal)
        : dateVal,
    );
    if (isNaN(parsed.getTime())) return "";
    return parsed.toISOString().split("T")[0];
  } catch (e) {
    console.error("日付パースエラー:", dateVal, e);
    return "";
  }
};

export const getPeriodStatus = (
  from: string | number,
  to: string | number | null,
): PeriodStatus => {
  const nowTime = Date.now();
  const fromTime = new Date(from).getTime();
  const toTime = to ? new Date(to).getTime() : null;
  if (nowTime < fromTime)
    return {
      code: "future",
      label: "🟡 将来適用",
      className: "bg-amber-50 text-amber-700 border-amber-200",
    };
  if (toTime && nowTime > toTime)
    return {
      code: "expired",
      label: "🔴 期限切れ",
      className: "bg-rose-50 text-red-700 border-rose-200",
    };
  return {
    code: "current",
    label: "🟢 現行有効",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
};

// 循環参照(データ不整合でA→B→Aのような構成が登録された場合)による無限再帰を避けるための上限
const MAX_BOM_TREE_DEPTH = 10;

// 対象品番+リビジョンの直下の子部品一覧(structuresから抽出)を、孫部品以下も含めて
// 再帰的にツリー化する。各子部品自身の構成展開には、その品目に登録されている
// 最新(数値最大)リビジョンを採用する(親ツリー選択時のリビジョン自動選択と同じ基準)。
function buildBomTree(
  parentItemId: string,
  revision: string,
  allStructures: StructureRecord[],
  parentEffectiveQuantity: number,
  depth: number,
  ancestorItemIds: Set<string>,
): BomTreeNode[] {
  if (depth >= MAX_BOM_TREE_DEPTH) return [];

  const directChildren = allStructures.filter(
    (s) => s.parentItemId === parentItemId && s.revision === revision,
  );

  return directChildren.map((node) => {
    const effectiveQuantity = parentEffectiveQuantity * node.quantityRequired;
    const effectiveSubTotal = effectiveQuantity * (node.childUnitPrice || 0);

    // 循環参照ガード: 既にこの経路上に出現した品目は展開しない
    let children: BomTreeNode[] = [];
    if (!ancestorItemIds.has(node.childItemId)) {
      const childRevisions = Array.from(
        new Set(
          allStructures
            .filter((s) => s.parentItemId === node.childItemId)
            .map((s) => s.revision),
        ),
      );
      if (childRevisions.length > 0) {
        const latestChildRevision = childRevisions.sort((a, b) =>
          b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }),
        )[0];
        children = buildBomTree(
          node.childItemId,
          latestChildRevision,
          allStructures,
          effectiveQuantity,
          depth + 1,
          new Set(ancestorItemIds).add(node.childItemId),
        );
      }
    }

    return { ...node, depth, effectiveQuantity, effectiveSubTotal, children };
  });
}

function flattenBomTree(nodes: BomTreeNode[]): BomTreeNode[] {
  return nodes.flatMap((n) => [n, ...flattenBomTree(n.children)]);
}

interface UseBomOperationsProps {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isItemStructureWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
}

export function useBomOperations({
  canRead,
  canCreate,
  canUpdate,
  canDelete,
  isItemStructureWfEnabled = false,
  departments = [],
}: UseBomOperationsProps) {
  const confirm = useConfirm();
  // 追加要望F: 複数部門所属時の申請部門選択(初期値は所属部門の先頭=従来の暗黙動作と同じ)。
  // departmentsはusePagePermissions()から非同期に取得されるため、useState初期値だけでは
  // 反映されない場合がある。ロード完了後にuseEffectで未選択(null)の場合のみ先頭部門を
  // 補完する(ユーザーが既に選択した値は上書きしない)。
  const [applicantDepartmentSurrogateId, setApplicantDepartmentSurrogateId] =
    useState<string | null>(null);
  useEffect(() => {
    if (applicantDepartmentSurrogateId === null && departments.length > 0) {
      setApplicantDepartmentSurrogateId(departments[0].surrogateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments]);
  const [structures, setStructures] = useState<StructureRecord[]>([]);
  const [allItems, setAllItems] = useState<ItemLookup[]>([]);
  const [bomParents, setBomParents] = useState<BomParentLookup[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState<StructureRecord | null>(
    null,
  );
  const [parentItemId, setParentItemId] = useState("");
  const [childItemId, setChildItemId] = useState("");
  const [quantityRequired, setQuantityRequired] = useState<number>(1);
  const [revision, setRevision] = useState("1.0");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [memo, setMemo] = useState("");
  const [status, setStatus] = useState<string>(
    isItemStructureWfEnabled ? "temporary" : "active",
  );
  const [wfStatus, setWfStatus] = useState<string | null>(null);

  const [searchParentId, setSearchParentId] = useState("");
  const [searchChildId, setSearchChildId] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>(
    isItemStructureWfEnabled ? "temporary" : "active",
  );
  const [treeTargetParentId, setTreeTargetParentId] = useState("");
  const [treeTargetRevision, setTreeTargetRevision] = useState("1.0");
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriodType>("all");

  // ヘッダクリックソート(追加要望D)。structuresの取得順序を変えるだけなので、ツリー(フィルタベース)には影響しない。
  // 追加要望J-1-a(複合ソート): Shift+クリック(additive)で複数キーを追加できるよう、
  // `_shared/hooks/use-paginated-list.ts`と同じ設計(キー配列)に合わせる
  const [sortKeys, setSortKeys] = useState<{ key: string; direction: "asc" | "desc" }[]>([]);
  const setSort = useCallback((key: string, additive = false) => {
    setSortKeys((prev) => {
      if (additive) {
        const index = prev.findIndex((s) => s.key === key);
        if (index === -1) return [...prev, { key, direction: "asc" }];
        return prev.map((s, i) =>
          i === index ? { key, direction: s.direction === "asc" ? "desc" : "asc" } : s,
        );
      }
      const isOnlyKey = prev.length === 1 && prev[0].key === key;
      return isOnlyKey
        ? [{ key, direction: prev[0].direction === "asc" ? "desc" : "asc" }]
        : [{ key, direction: "asc" }];
    });
  }, []);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canCsvAction = canCreate || canUpdate;

  // ワークフロー有効フラグを監視して、Stateの初期値を安全に合わせる(他マスタと同じパターン)
  useEffect(() => {
    if (isItemStructureWfEnabled === true) {
      setFilterStatus("temporary");
      setStatus("temporary");
    }
  }, [isItemStructureWfEnabled]);

  // 💡 取引先マスタ等と同じロック機構: 編集中の構成が承認ワークフロー審査中(PENDING)なら、
  // フォームを完全ロックする(上書き・再編集防止)
  const isStructureCurrentlyLocked =
    !!editingId &&
    isItemStructureWfEnabled &&
    status === "temporary" &&
    wfStatus === "PENDING";

  useEffect(() => {
    if (!editingId || !isItemStructureWfEnabled) {
      setWfStatus(null);
      return;
    }
    const fetchWfStatus = async () => {
      try {
        const data = await apiFetch<{ status: string }>(
          `/api/workflow-tasks/request-status/${editingId}?targetType=master_structures`,
        );
        setWfStatus(data.status);
      } catch (err) {
        console.error("最新の申請状態の取得に失敗しました", err);
      }
    };
    void fetchWfStatus();
  }, [editingId, isItemStructureWfEnabled, status]);

  const loadLookups = useCallback(async () => {
    if (!canRead) return;
    try {
      const [allItemsData, bomParentsData] = await Promise.all([
        apiFetch<ItemLookup[]>("/api/products"),
        apiFetch<BomParentLookup[]>("/api/item-structures/active-parents"),
      ]);
      setAllItems(allItemsData);
      setBomParents(bomParentsData);
    } catch (e) {
      console.error("マスタデータの取得失敗", e);
    }
  }, [canRead]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  // 💡 statusはあえてサーバー側フィルタに含めない。structuresは商品構成ツリー(孫部品以下の
  // 再帰展開)の元データとしても使われており、ここでステータス絞り込みをかけると
  // 経路の途中で別ステータスの構成に当たった時点でツリーが途切れてしまう。
  // ステータス絞り込みは下のdisplayedStructures側でクライアント側フィルタとして適用する。
  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedParentId = useDebouncedValue(searchParentId);
  const debouncedChildId = useDebouncedValue(searchChildId);
  const syncStructures = useCallback(async () => {
    if (!canRead) return;
    const params = new URLSearchParams({
      parentItemId: debouncedParentId,
      childItemId: debouncedChildId,
    });
    if (sortKeys.length > 0) {
      params.set("sortBy", sortKeys.map((s) => s.key).join(","));
      params.set("sortOrder", sortKeys.map((s) => s.direction).join(","));
    }
    try {
      const data = await apiFetch<StructureRecord[]>(
        `/api/item-structures?${params.toString()}`,
      );
      setStructures(data);
    } catch (e) {
      console.error(e);
    }
  }, [debouncedParentId, debouncedChildId, canRead, sortKeys]);

  useEffect(() => {
    void syncStructures();
  }, [syncStructures]);

  const displayedStructures = useMemo(() => {
    return structures.filter((s) => {
      if (filterStatus && filterStatus !== "all" && s.status !== filterStatus) {
        return false;
      }
      const periodStatus = getPeriodStatus(s.validFrom, s.validTo);
      if (filterPeriod === "all") return true;
      return periodStatus.code === filterPeriod;
    });
  }, [structures, filterPeriod, filterStatus]);

  const totalCount = structures.length;
  const filteredCount = displayedStructures.length;

  // 💡 孫部品以下も含めた多階層ツリー。以前は直下の子部品しか参照できなかったため、
  // 選択中の親品番+リビジョンを起点に、子部品自身の構成をさらに再帰的に展開する。
  const bomTree = useMemo(() => {
    if (!treeTargetParentId || !treeTargetRevision) return [];
    return buildBomTree(
      treeTargetParentId,
      treeTargetRevision,
      structures,
      1,
      0,
      new Set([treeTargetParentId]),
    );
  }, [structures, treeTargetParentId, treeTargetRevision]);

  // ツリー全階層分の実効原価(累積員数 × 単価)を合算する
  const totalTreeBomCost = useMemo(() => {
    return flattenBomTree(bomTree).reduce(
      (sum, node) => sum + (node.effectiveSubTotal || 0),
      0,
    );
  }, [bomTree]);

  const handleClearSearch = useCallback(() => {
    setSearchParentId("");
    setSearchChildId("");
  }, []);

  const handleClearForm = useCallback(() => {
    setEditingId(null);
    setEditingRecord(null);
    setParentItemId("");
    setChildItemId("");
    setQuantityRequired(1);
    setRevision("1.0");
    setValidFrom("");
    setValidTo("");
    setMemo("");
    setStatus(isItemStructureWfEnabled ? "temporary" : "active");
    setWfStatus(null);
  }, [isItemStructureWfEnabled]);

  const handleSelectEdit = useCallback((s: StructureRecord) => {
    setEditingId(s.id);
    setEditingRecord(s);
    setParentItemId(s.parentItemId);
    setChildItemId(s.childItemId);
    setQuantityRequired(s.quantityRequired);
    setRevision(s.revision);
    setValidFrom(formatToInputDate(s.validFrom));
    setValidTo(s.validTo ? formatToInputDate(s.validTo) : "");
    setMemo(s.memo || "");
    setStatus(s.status || "active");
    setShowForm(true);

    // 💡 テーブルで選択した親品番と「該当リビジョン(s.revision)」をツリービューアーへダイレクトにセット
    setTreeTargetParentId(s.parentItemId);
    setTreeTargetRevision(s.revision);
  }, []);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (
      (editingId && !canUpdate) ||
      (!editingId && !canCreate) ||
      isSubmitting
    ) {
      setError("この操作をする権限がありません");
      return;
    }

    setError("");
    setMessage("");
    if (parentItemId === childItemId) {
      setError("エラー: 親品番と子部品に同一の品目は指定できません");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        parentItemId,
        childItemId,
        quantityRequired: Number(quantityRequired),
        revision,
        validFrom,
        validTo,
        memo: memo || null,
      };

      if (isItemStructureWfEnabled) {
        // 💡 承認機能有効時は、まずマスタ本体へ「仮登録(temporary)」状態として
        // 先行して直接書き込み・更新を行う(取引先・単位等と同じ二段階方式)。
        // 変更申請時は変更後の値を本体に書き込んではいけないため、既存レコード
        // (editingRecord)の値をそのまま使い、statusだけをtemporary(ロック)にして送信する。
        const preSavePayload =
          editingId && editingRecord
            ? {
                parentItemId: editingRecord.parentItemId,
                childItemId: editingRecord.childItemId,
                revision: editingRecord.revision,
                quantityRequired: editingRecord.quantityRequired,
                validFrom: formatToInputDate(editingRecord.validFrom),
                validTo: editingRecord.validTo
                  ? formatToInputDate(editingRecord.validTo)
                  : null,
                memo: editingRecord.memo,
                status: "temporary" as const,
              }
            : { ...payload, status: "temporary" as const };

        // 💡 品目構成のIDはサーバー側で自動採番されるため(他マスタのようにユーザー入力の
        // codeを事前に確定できない)、仮登録レスポンスのidを承認申請のtargetIdとして使う。
        const preSaveResult = await apiFetch<{ id: string }>(
          "/api/item-structures/register",
          {
            method: "POST",
            json: preSavePayload,
            defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
          },
        );
        const targetId = editingId || preSaveResult.id;

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_structures",
            targetId,
            requestType: editingId ? "UPDATE" : "REGISTER",
            payload: { ...payload, status: editingId ? status : "active" },
            applicantDepartmentSurrogateId,
            comment: editingId
              ? `品目構成[${targetId}] 情報変更申請`
              : `品目構成 新規登録申請`,
          },
          defaultErrorMessage: "承認の申請に失敗しました",
        });

        setMessage(
          editingId
            ? "品目構成の変更承認をワークフローへ申請しました(承認待ちロック)"
            : "品目構成を仮登録し、承認を申請しました(承認待ち)",
        );
      } else {
        await apiFetch("/api/item-structures/register", {
          method: "POST",
          json: editingId ? { ...payload, status } : payload,
          defaultErrorMessage: "登録に失敗しました",
        });
        setMessage(`リビジョン [${revision}] の品目構成(BOM)を保存しました`);
      }

      setShowForm(false);
      handleClearForm();
      void loadLookups();
      void syncStructures();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteLink = async (id: string) => {
    if (!canDelete || isSubmitting) return;
    if (!(await confirm("この品目構成マスタの割り当て関係を削除しますか？"))) return;
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await apiFetch(`/api/item-structures/${id}`, {
        method: "DELETE",
        defaultErrorMessage: "削除に失敗しました",
      });
      setMessage("構成マスタの割り当て関係を解除しました");
      if (editingId === id) handleClearForm();
      void loadLookups();
      void syncStructures();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 無効化。取引先・単位等と同じく、承認機能有効時は直接無効化せず承認申請を経由する。
  const handleSuspend = async (s: StructureRecord) => {
    if (!canDelete || isSubmitting) return;
    if (
      !(await confirm(
        `品目構成 [${s.parentItemId} → ${s.childItemId} / REV ${s.revision}] を無効化しますか？`,
      ))
    )
      return;

    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      const currentPayload = {
        parentItemId: s.parentItemId,
        childItemId: s.childItemId,
        revision: s.revision,
        quantityRequired: s.quantityRequired,
        validFrom: formatToInputDate(s.validFrom),
        validTo: s.validTo ? formatToInputDate(s.validTo) : null,
        memo: s.memo,
      };

      if (isItemStructureWfEnabled) {
        await apiFetch("/api/item-structures/register", {
          method: "POST",
          json: { ...currentPayload, status: "temporary" },
          defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
        });

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_structures",
            targetId: s.id,
            requestType: "UPDATE",
            payload: { ...currentPayload, status: "suspended" },
            applicantDepartmentSurrogateId,
            comment: `品目構成[${s.id}] 無効化申請`,
          },
          defaultErrorMessage: "無効化の申請に失敗しました",
        });

        setMessage("品目構成の無効化をワークフローへ申請しました(承認待ちロック)");
      } else {
        await apiFetch(`/api/item-structures/${s.id}/suspend`, {
          method: "POST",
          defaultErrorMessage: "無効化に失敗しました",
        });
        setMessage("品目構成を無効化しました");
      }

      if (editingId === s.id) handleClearForm();
      void loadLookups();
      void syncStructures();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "products_bom_master",
    onError: () => setError("CSVダウンロードに失敗しました"),
  });
  const handleDownloadCsv = async () => {
    if (!canCsvAction || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const params = new URLSearchParams({
        parentItemId: searchParentId,
        childItemId: searchChildId,
        periodStatus: filterPeriod,
      });
      await downloadCsv(`/api/item-structures/csv-download?${params.toString()}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const { importCsv } = useCsvImport({
    onSuccess: () => {
      void loadLookups();
      void syncStructures();
    },
    onMessage: setMessage,
    onError: setError,
  });
  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (
      !e.target.files?.[0] ||
      !canCsvAction ||
      isSubmitting ||
      isItemStructureWfEnabled
    )
      return;
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await importCsv("/api/item-structures/bulk-register", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    structures,
    allItems,
    bomParents,
    displayedStructures,
    bomTree,
    totalTreeBomCost,
    totalCount,
    filteredCount,
    sortBy: sortKeys[0]?.key ?? null,
    sortDirection: sortKeys[0]?.direction ?? "asc",
    sortKeys,
    setSort,
    isSubmitting,
    showForm,
    setShowForm,
    editingId,
    editingRecord,
    isStructureCurrentlyLocked,
    parentItemId,
    setParentItemId,
    childItemId,
    setChildItemId,
    quantityRequired,
    setQuantityRequired,
    revision,
    setRevision,
    validFrom,
    setValidFrom,
    validTo,
    setValidTo,
    memo,
    setMemo,
    status,
    setStatus,
    searchParentId,
    setSearchParentId,
    searchChildId,
    setSearchChildId,
    filterStatus,
    setFilterStatus,
    treeTargetParentId,
    setTreeTargetParentId,
    treeTargetRevision,
    setTreeTargetRevision,
    filterPeriod,
    setFilterPeriod,
    message,
    error,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    canCsvAction,
    handleClearSearch,
    handleClearForm,
    handleSelectEdit,
    handleSubmit,
    handleDeleteLink,
    handleSuspend,
    handleDownloadCsv,
    handleImportCsv,
  };
}
