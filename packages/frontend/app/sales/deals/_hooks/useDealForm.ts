"use client";

import { useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import {
  AttendeeCandidates,
  DealAttendee,
  DealDetail,
  DealQuoteRef,
  DealStatus,
  DealTask,
  ProspectContact,
} from "../_types";
import { todayJst } from "../../../_shared/jst-date";

const BASE = "/api/sales-deals";

export interface DealFormState {
  id: string | null;
  partnerId: string;
  title: string;
  dealDate: string;
  startTime: string;
  endTime: string;
  location: string;
  memo: string;
  status: DealStatus;
  ownerEmployeeNumber: string;
  attendees: DealAttendee[];
  tasks: DealTask[];
  quoteIds: string[];
}


export const emptyDealForm = (): DealFormState => ({
  id: null,
  partnerId: "",
  title: "",
  dealDate: todayJst(),
  startTime: "",
  endTime: "",
  location: "",
  memo: "",
  status: "OPEN",
  ownerEmployeeNumber: "",
  attendees: [],
  tasks: [],
  quoteIds: [],
});

export interface NewProspectContact {
  name: string;
  departmentName: string;
  position: string;
  email: string;
  phone: string;
}

export const emptyProspectContact = (): NewProspectContact => ({
  name: "",
  departmentName: "",
  position: "",
  email: "",
  phone: "",
});

const nullIfEmpty = (value: string) => (value.trim() === "" ? null : value.trim());

// 商談の登録・編集フォーム。面談者(見込客担当者/取引先担当者/自社同席者/自由記入)・次回までのタスク・
// 見積の紐づけ・添付ファイルを扱う。見込客担当者は商談入力中にその場で登録できる
export function useDealForm(onSaved: () => Promise<void>) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<DealFormState>(emptyDealForm());
  const [detail, setDetail] = useState<DealDetail | null>(null); // 保存済みの添付・紐づけ見積の表示用
  const [candidates, setCandidates] = useState<AttendeeCandidates>({ partnerContacts: [], prospectContacts: [] });
  const [quoteCandidates, setQuoteCandidates] = useState<DealQuoteRef[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadCandidates = async (partnerId: string) => {
    if (!partnerId) {
      setCandidates({ partnerContacts: [], prospectContacts: [] });
      setQuoteCandidates([]);
      return;
    }
    try {
      const [attendeeList, quotes] = await Promise.all([
        apiFetch<AttendeeCandidates>(`${BASE}/attendee-candidates?partnerId=${encodeURIComponent(partnerId)}`),
        apiFetch<DealQuoteRef[]>(`${BASE}/quote-candidates?partnerId=${encodeURIComponent(partnerId)}`),
      ]);
      setCandidates(attendeeList);
      setQuoteCandidates(quotes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "候補の取得に失敗しました");
    }
  };

  const openNew = () => {
    setForm(emptyDealForm());
    setDetail(null);
    setCandidates({ partnerContacts: [], prospectContacts: [] });
    setQuoteCandidates([]);
    setError("");
    setMessage("");
    setOpen(true);
  };

  const openEdit = async (id: string) => {
    setError("");
    setMessage("");
    try {
      const d = await apiFetch<DealDetail>(`${BASE}/${id}`);
      setDetail(d);
      setForm({
        id: d.id,
        partnerId: d.partnerId,
        title: d.title,
        dealDate: d.dealDate,
        startTime: d.startTime ?? "",
        endTime: d.endTime ?? "",
        location: d.location ?? "",
        memo: d.memo ?? "",
        status: d.status,
        ownerEmployeeNumber: d.ownerEmployeeNumber ?? "",
        attendees: d.attendees,
        tasks: d.tasks,
        quoteIds: d.quotes.map((q) => q.id),
      });
      await loadCandidates(d.partnerId);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "商談の取得に失敗しました");
    }
  };

  const close = () => setOpen(false);

  const change = <K extends keyof DealFormState>(key: K, value: DealFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // 取引先を変えると、別の取引先の面談者・見積は紐づけられないためクリアする
  const changePartner = (partnerId: string) => {
    setForm((prev) => ({ ...prev, partnerId, attendees: [], quoteIds: [] }));
    void loadCandidates(partnerId);
  };

  // ---- 面談者 ----
  const addAttendee = (attendee: DealAttendee) =>
    setForm((prev) => {
      const duplicated = prev.attendees.some(
        (a) => a.kind === attendee.kind && (attendee.kind === "FREE" ? a.name === attendee.name : a.refId === attendee.refId),
      );
      return duplicated ? prev : { ...prev, attendees: [...prev.attendees, attendee] };
    });
  const removeAttendee = (index: number) =>
    setForm((prev) => ({ ...prev, attendees: prev.attendees.filter((_, i) => i !== index) }));

  // 見込客担当者をその場で登録し、そのまま面談者に追加する
  const createProspectContact = async (input: NewProspectContact): Promise<boolean> => {
    setError("");
    if (!form.partnerId) {
      setError("先に取引先(見込み客)を選択してください");
      return false;
    }
    if (!input.name.trim()) {
      setError("見込客担当者の氏名を入力してください");
      return false;
    }
    try {
      const res = await apiFetch<{ id: string }>(`${BASE}/prospect-contacts`, {
        method: "POST",
        json: {
          partnerId: form.partnerId,
          name: input.name.trim(),
          departmentName: nullIfEmpty(input.departmentName),
          position: nullIfEmpty(input.position),
          email: nullIfEmpty(input.email),
          phone: nullIfEmpty(input.phone),
        },
        defaultErrorMessage: "見込客担当者の登録に失敗しました",
      });
      const contact: ProspectContact = {
        id: res.id,
        partnerId: form.partnerId,
        name: input.name.trim(),
        departmentName: nullIfEmpty(input.departmentName),
        position: nullIfEmpty(input.position),
        email: nullIfEmpty(input.email),
        phone: nullIfEmpty(input.phone),
        memo: null,
      };
      setCandidates((prev) => ({ ...prev, prospectContacts: [...prev.prospectContacts, contact] }));
      addAttendee({
        kind: "PROSPECT_CONTACT",
        refId: contact.id,
        name: contact.name,
        note: [contact.departmentName, contact.position].filter(Boolean).join(" ") || null,
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "見込客担当者の登録に失敗しました");
      return false;
    }
  };

  // ---- タスク ----
  const addTask = () =>
    setForm((prev) => ({
      ...prev,
      tasks: [...prev.tasks, { title: "", dueDate: null, assigneeEmployeeNumber: prev.ownerEmployeeNumber || null, isDone: false }],
    }));
  const changeTask = (index: number, patch: Partial<DealTask>) =>
    setForm((prev) => ({ ...prev, tasks: prev.tasks.map((t, i) => (i === index ? { ...t, ...patch } : t)) }));
  const removeTask = (index: number) =>
    setForm((prev) => ({ ...prev, tasks: prev.tasks.filter((_, i) => i !== index) }));

  // ---- 見積の紐づけ ----
  const toggleQuote = (quoteId: string) =>
    setForm((prev) => ({
      ...prev,
      quoteIds: prev.quoteIds.includes(quoteId) ? prev.quoteIds.filter((id) => id !== quoteId) : [...prev.quoteIds, quoteId],
    }));

  // ---- 保存 ----
  const buildPayload = () => ({
    partnerId: form.partnerId,
    title: form.title.trim(),
    dealDate: form.dealDate,
    startTime: nullIfEmpty(form.startTime),
    endTime: nullIfEmpty(form.endTime),
    location: nullIfEmpty(form.location),
    memo: nullIfEmpty(form.memo),
    status: form.status,
    ownerEmployeeNumber: nullIfEmpty(form.ownerEmployeeNumber),
    attendees: form.attendees.map((a) => ({ kind: a.kind, refId: a.refId, name: a.name, note: a.note })),
    tasks: form.tasks
      .filter((t) => t.title.trim() !== "")
      .map((t) => ({
        id: t.id,
        title: t.title.trim(),
        dueDate: t.dueDate || null,
        assigneeEmployeeNumber: t.assigneeEmployeeNumber || null,
        isDone: t.isDone,
      })),
    quoteIds: form.quoteIds,
  });

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (form.id) {
        await apiFetch(`${BASE}/${form.id}`, {
          method: "PUT",
          json: buildPayload(),
          defaultErrorMessage: "商談の更新に失敗しました",
        });
        setMessage("商談を更新しました");
        await onSaved();
        await openEdit(form.id);
      } else {
        const res = await apiFetch<{ id: string }>(`${BASE}/register`, {
          method: "POST",
          json: buildPayload(),
          defaultErrorMessage: "商談の登録に失敗しました",
        });
        await onSaved();
        // 登録後は編集状態にして、そのまま添付ファイルを追加できるようにする
        await openEdit(res.id);
        setMessage("商談を登録しました。続けて添付ファイルを追加できます");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "商談の保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  // ---- 添付ファイル(保存済みの商談のみ) ----
  const uploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !form.id) return;
    setUploading(true);
    setError("");
    const data = new FormData();
    data.append("file", file);
    try {
      await apiFetch(`${BASE}/${form.id}/attachments`, {
        method: "POST",
        body: data,
        defaultErrorMessage: "ファイルの添付に失敗しました",
      });
      setDetail(await apiFetch<DealDetail>(`${BASE}/${form.id}`));
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ファイルの添付に失敗しました");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removeAttachment = async (attachmentId: string) => {
    if (!form.id) return;
    setError("");
    try {
      await apiFetch(`${BASE}/${form.id}/attachments/${attachmentId}`, {
        method: "DELETE",
        defaultErrorMessage: "添付ファイルの削除に失敗しました",
      });
      setDetail(await apiFetch<DealDetail>(`${BASE}/${form.id}`));
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添付ファイルの削除に失敗しました");
    }
  };

  const canSave = !!form.partnerId && form.title.trim() !== "" && !!form.dealDate;

  return {
    open,
    form,
    detail,
    candidates,
    quoteCandidates,
    saving,
    uploading,
    error,
    message,
    canSave,
    openNew,
    openEdit,
    close,
    change,
    changePartner,
    addAttendee,
    removeAttendee,
    createProspectContact,
    addTask,
    changeTask,
    removeTask,
    toggleQuote,
    save,
    uploadAttachment,
    removeAttachment,
  };
}
