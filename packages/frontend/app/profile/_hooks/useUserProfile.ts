import { useState, useEffect, useCallback } from "react";
import { BelongRelation, UserRecord } from "../_types";

export function useUserProfile() {
  const [userId, setUserId] = useState("");
  const [userRelations, setUserRelations] = useState<BelongRelation[]>([]);
  const [slackUserId, setSlackUserId] = useState<string | null>(null);
  const [notificationChannel, setNotificationChannel] = useState<
    "email" | "slack"
  >("email");
  const [loading, setLoading] = useState(true);

  const fetchUserProfile = useCallback(async (currentUserId: string) => {
    if (!currentUserId) return;
    try {
      const res = await fetch("/api/users?status=all", {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (res.ok) {
        const allUsers: UserRecord[] = await res.json();
        const me = allUsers.find((u) => u.id === currentUserId);
        if (me) {
          setUserRelations(me.relations || []);
          setLoading(false);
          return;
        }
      }
      setLoading(false);
    } catch (err) {
      console.error("ユーザープロフィールの取得に失敗しました", err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadMyId() {
      try {
        const res = await fetch("/api/auth/profile", {
          method: "GET",
          credentials: "include",
        });
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const data = await res.json();
        const myId = data.id || "";
        setUserId(myId);
        setSlackUserId(data.slackUserId || null);
        setNotificationChannel(data.notificationChannel || "email");
        if (myId) {
          void fetchUserProfile(myId);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error("ユーザーIDの取得に失敗しました", err);
        setLoading(false);
      }
    }
    void loadMyId();
  }, [fetchUserProfile]);

  return {
    userId,
    userRelations,
    slackUserId,
    notificationChannel,
    loading,
  };
}
