import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "./theme";
import { DisplaySettingsForm } from "../profile/_components/DisplaySettingsForm";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let serverPrefs = { themeMode: "system", accentColor: "indigo" };
let systemDark = false;

const html = () => document.documentElement;

beforeEach(() => {
  serverPrefs = { themeMode: "system", accentColor: "indigo" };
  systemDark = false;
  localStorage.clear();
  delete html().dataset.theme;
  delete html().dataset.accent;
  vi.stubGlobal(
    "matchMedia",
    (q: string) =>
      ({
        matches: q.includes("dark") && systemDark,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url !== "/api/user-preferences") return json({}, 404);
    if (init?.method === "PUT") {
      serverPrefs = JSON.parse(String(init.body));
      return json(serverPrefs);
    }
    return json(serverPrefs);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const renderForm = (enabled = true) =>
  render(
    <ThemeProvider enabled={enabled}>
      <DisplaySettingsForm />
    </ThemeProvider>,
  );

describe("ThemeProvider(ユーザーごとの表示設定)", () => {
  it("ログイン後、サーバーに保存された設定を画面(html)に反映する", async () => {
    serverPrefs = { themeMode: "dark", accentColor: "emerald" };
    renderForm();
    await waitFor(() => expect(html().dataset.theme).toBe("dark"));
    expect(html().dataset.accent).toBe("emerald");
    // 次回の読み込みでちらつかないよう、控えも残す
    expect(JSON.parse(localStorage.getItem("ui-theme")!)).toEqual(serverPrefs);
  });

  it("「端末の設定に合わせる」は、端末がダークならダーク、そうでなければライト", async () => {
    systemDark = true;
    const { unmount } = renderForm();
    await waitFor(() => expect(html().dataset.theme).toBe("dark"));
    unmount();
    systemDark = false;
    renderForm();
    await waitFor(() => expect(html().dataset.theme).toBe("light"));
  });

  it("ログイン前(enabled=false)は API を呼ばず、前回の控えを使う", async () => {
    localStorage.setItem(
      "ui-theme",
      JSON.stringify({ themeMode: "dark", accentColor: "rose" }),
    );
    renderForm(false);
    await waitFor(() => expect(html().dataset.theme).toBe("dark"));
    expect(html().dataset.accent).toBe("rose");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("壊れた控えや取得の失敗では、既定(ライト相当・indigo)で動作を続ける", async () => {
    localStorage.setItem("ui-theme", "{broken");
    fetchMock.mockResolvedValueOnce(json({ message: "x" }, 500));
    renderForm();
    await waitFor(() => expect(html().dataset.accent).toBe("indigo"));
    expect(html().dataset.theme).toBe("light");
  });

  it("プロフィールの表示設定を保存すると、PUTして画面にも反映される", async () => {
    renderForm();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("radio", { name: "ダーク" }));
    await userEvent.click(screen.getByRole("radio", { name: /ローズ/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "表示設定を保存する" }),
    );
    expect(await screen.findByText("表示設定を保存しました")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/user-preferences",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ themeMode: "dark", accentColor: "rose" }),
      }),
    );
    expect(html().dataset.theme).toBe("dark");
    expect(html().dataset.accent).toBe("rose");
  });

  it("保存に失敗したらメッセージを出し、画面の色は変えない", async () => {
    renderForm();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fetchMock.mockResolvedValueOnce(json({ message: "保存できません" }, 400));
    await userEvent.click(screen.getByRole("radio", { name: "ダーク" }));
    await userEvent.click(
      screen.getByRole("button", { name: "表示設定を保存する" }),
    );
    expect(await screen.findByText("保存できません")).toBeVisible();
    expect(html().dataset.theme).toBe("light");
  });

  it("選択肢が backend の許可する値と同じ(表示モード3種・基調色8種)", () => {
    renderForm(false);
    expect(screen.getAllByRole("radio", { name: /./ })).toHaveLength(3 + 8);
  });
});
