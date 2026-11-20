import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuth } from "./useAuth";

// REQ-004: ログイン時の OTP。パスワードが合って otpRequired が返ったら、確認コードの入力へ進む
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: () => {} }),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const event = { preventDefault: () => {} } as React.SyntheticEvent;

function stubFetch(handlers: Record<string, () => Response>) {
  const spy = vi.fn(async (url: string) => {
    const handler = Object.entries(handlers).find(([path]) => url.toString() === path)?.[1];
    return handler ? handler() : json({ totalUsers: 1 });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => push.mockReset());
afterEach(() => vi.unstubAllGlobals());

async function signInWithOtp(result: { current: ReturnType<typeof useAuth> }) {
  act(() => {
    result.current.setEmail("a@example.com");
    result.current.setPassword("pw");
  });
  await act(async () => {
    await result.current.handleSignIn(event);
  });
}

const OTP_REQUIRED = {
  success: true,
  otpRequired: true,
  challengeId: "ch-1",
  channel: "slack",
  digitCount: 6,
  expiresInMinutes: 10,
  resendIntervalSeconds: 60,
};

describe("useAuth: ログイン時の OTP", () => {
  it("otpRequired なら画面遷移せず、確認コードの入力へ進む。再送はすぐには押せない", async () => {
    stubFetch({ "/api/auth/login": () => json(OTP_REQUIRED) });
    const { result } = renderHook(() => useAuth());
    await signInWithOtp(result);

    expect(push).not.toHaveBeenCalled();
    expect(result.current.otpChallenge).toMatchObject({ challengeId: "ch-1", channel: "slack", digitCount: 6 });
    expect(result.current.resendWaitSeconds).toBeGreaterThan(0);
  });

  it("確認コードが合えばダッシュボードへ進む", async () => {
    const spy = stubFetch({
      "/api/auth/login": () => json(OTP_REQUIRED),
      "/api/auth/login/otp/verify": () => json({ success: true, user: { id: "u", name: "u", role: "user" } }),
    });
    const { result } = renderHook(() => useAuth());
    await signInWithOtp(result);
    act(() => result.current.setOtpCode("123456"));
    await act(async () => {
      await result.current.handleVerifyOtp(event);
    });

    const verifyCall = spy.mock.calls.find(([u]) => u === "/api/auth/login/otp/verify") as unknown as [string, RequestInit];
    expect(JSON.parse(String(verifyCall[1].body))).toEqual({ challengeId: "ch-1", code: "123456" });
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("間違いは入力画面のままエラーを出す。やり直しが必要な場合はパスワードの入力に戻る", async () => {
    let verifyResponse = () => json({ success: false, message: "確認コードが正しくありません(あと4回入力できます)" }, 401);
    stubFetch({
      "/api/auth/login": () => json(OTP_REQUIRED),
      "/api/auth/login/otp/verify": () => verifyResponse(),
    });
    const { result } = renderHook(() => useAuth());
    await signInWithOtp(result);

    await act(async () => {
      await result.current.handleVerifyOtp(event);
    });
    expect(result.current.otpChallenge).not.toBeNull();
    expect(result.current.error).toContain("あと4回");

    verifyResponse = () => json({ success: false, restart: true, message: "もう一度ログインしてください" }, 400);
    await act(async () => {
      await result.current.handleVerifyOtp(event);
    });
    await waitFor(() => expect(result.current.otpChallenge).toBeNull());
    expect(result.current.error).toBe("もう一度ログインしてください");
  });
});
