"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { todayJst } from "../../../_shared/jst-date";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  publishDate: string;
  endDate: string | null;
  isImportant: boolean;
  isPublished: boolean;
  updatedAt: string;
}

export interface AnnouncementForm {
  title: string;
  body: string;
  publishDate: string;
  endDate: string;
  isImportant: boolean;
  isPublished: boolean;
}


export const emptyForm = (): AnnouncementForm => ({
  title: "",
  body: "",
  publishDate: todayJst(),
  endDate: "",
  isImportant: false,
  isPublished: true,
});

// ダッシュボード「システムからのお知らせ」の管理(登録・編集・削除)
export function useAnnouncements(enabled: boolean) {
  const confirm = useConfirm();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AnnouncementForm>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await apiFetch<Announcement[]>("/api/announcements"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "お知らせの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      await load();
    })();
  }, [enabled, load]);

  const changeForm = <K extends keyof AnnouncementForm>(key: K, value: AnnouncementForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const startEdit = (item: Announcement) => {
    setEditingId(item.id);
    setMessage("");
    setError("");
    setForm({
      title: item.title,
      body: item.body,
      publishDate: item.publishDate,
      endDate: item.endDate ?? "",
      isImportant: item.isImportant,
      isPublished: item.isPublished,
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm());
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = { ...form, endDate: form.endDate || null };
      if (editingId) {
        await apiFetch(`/api/announcements/${editingId}`, { method: "PUT", json: payload });
        setMessage("お知らせを更新しました");
      } else {
        await apiFetch("/api/announcements/register", { method: "POST", json: payload });
        setMessage("お知らせを登録しました");
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: Announcement) => {
    if (!(await confirm(`お知らせ「${item.title}」を削除します。よろしいですか？`))) return;
    setError("");
    setMessage("");
    try {
      await apiFetch(`/api/announcements/${item.id}`, { method: "DELETE" });
      setMessage("お知らせを削除しました");
      if (editingId === item.id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  return { items, loading, error, message, editingId, form, saving, changeForm, startEdit, resetForm, save, remove };
}
