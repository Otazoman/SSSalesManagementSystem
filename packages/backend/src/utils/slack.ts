/**
 * Slack Bot経由でユーザーへDMを送信する。
 * `channel`にSlackメンバーID(例: "U012AB3CD")を直接指定すると、Slack側がDMを自動的に開いて送信する
 * (事前にconversations.openを呼ぶ必要はない)。
 */
export async function sendSlackDirectMessage(
  botToken: string,
  slackUserId: string,
  text: string,
): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: slackUserId, text }),
  });

  const data: { ok: boolean; error?: string } = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(`Slack送信に失敗しました: ${data.error || res.status}`);
  }
}
