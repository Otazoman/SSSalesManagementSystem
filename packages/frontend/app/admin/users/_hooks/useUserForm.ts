import { useState, useEffect } from "react";
import { UserRecord, DepartmentRecord } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";

interface UseUserFormProps {
  editingUserId: string | null;
  users: UserRecord[];
  hasCreate: boolean;
  hasUpdate: boolean;
  hasFormPermission: boolean;
  onSuccess: () => void;
  setError: (msg: string) => void;
  setMessage: (msg: string) => void;
}

export function useUserForm({
  editingUserId,
  users,
  hasCreate,
  hasUpdate,
  hasFormPermission,
  onSuccess,
  setError,
  setMessage,
}: UseUserFormProps) {
  const [empNum, setEmpNum] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPass, setUserPass] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [slackUserId, setSlackUserId] = useState("");
  const [notificationChannel, setNotificationChannel] = useState<"email" | "slack">("email");
  const [formRelations, setFormRelations] = useState<
    { departmentId: string; roleId: string }[]
  >([{ departmentId: "", roleId: "" }]);

  // 編集モード時の初期値セット
  useEffect(() => {
    if (editingUserId) {
      const u = users.find((user) => user.id === editingUserId);
      if (u) {
        setEmpNum(u.employeeNumber);
        setUserName(u.name);
        setUserEmail(u.email);
        setUserPass("");
        setSlackUserId(u.slackUserId || "");
        setNotificationChannel(u.notificationChannel || "email");
        setFormRelations(
          u.relations.map((r) => ({
            departmentId: r.departmentId || "",
            roleId: r.roleId,
          })),
        );
      }
    } else {
      setEmpNum("");
      setUserName("");
      setUserEmail("");
      setUserPass("");
      setSendEmail(false);
      setSlackUserId("");
      setNotificationChannel("email");
      setFormRelations([{ departmentId: "", roleId: "" }]);
    }
  }, [editingUserId, users]);

  const addRelationRow = () => {
    if (!hasFormPermission) return;
    setFormRelations([...formRelations, { departmentId: "", roleId: "" }]);
  };

  const removeRelationRow = (index: number) => {
    if (!hasFormPermission) return;
    setFormRelations(formRelations.filter((_, i) => i !== index));
  };

  const updateRelationRow = (
    index: number,
    key: "departmentId" | "roleId",
    value: string,
  ) => {
    if (!hasFormPermission) return;
    const updated = formRelations.map((item, i) => {
      if (i === index) {
        const nextItem = { ...item, [key]: value };
        if (key === "roleId" && value === "admin") {
          nextItem.departmentId = "";
        }
        return nextItem;
      }
      return item;
    });
    setFormRelations(updated);
  };

  const handleUserSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();

    if (editingUserId && !hasUpdate) {
      setError("⚠️ 更新する権限がありません");
      return;
    }
    if (!editingUserId && !hasCreate) {
      setError("⚠️ 新規登録する権限がありません");
      return;
    }

    setError("");
    setMessage("");

    if (
      formRelations.length > 0 &&
      formRelations.some((r) => r.roleId === "")
    ) {
      setError("⚠️ 追加したすべての行に「権限」を必ず設定してください");
      return;
    }

    if (notificationChannel === "slack" && !slackUserId.trim()) {
      setError("⚠️ 通知方法を「Slack」にする場合はSlackメンバーIDを入力してください");
      return;
    }

    try {
      const payload = {
        slackUserId: slackUserId.trim() || null,
        notificationChannel,
        name: userName,
        email: userEmail,
        relations: formRelations.filter((r) => r.roleId !== ""),
        password: userPass || undefined,
        sendEmail: sendEmail,
      };

      if (editingUserId) {
        const currentUser = users.find((u) => u.id === editingUserId);
        await apiFetch(`/api/users/${editingUserId}`, {
          method: "PUT",
          json: {
            ...payload,
            isActive: currentUser ? currentUser.isActive : true,
          },
          defaultErrorMessage: "更新に失敗しました",
        });
        setMessage("ユーザーマスタを更新しました");
      } else {
        await apiFetch("/api/users/register", {
          method: "POST",
          json: { ...payload, employeeNumber: empNum },
          defaultErrorMessage: "登録に失敗しました",
        });
        setMessage("新規ユーザーを登録しました");
      }

      onSuccess();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  return {
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
  };
}
