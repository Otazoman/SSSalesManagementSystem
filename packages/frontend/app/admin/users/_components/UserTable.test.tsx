import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserTable } from "./UserTable";
import { UserRecord } from "../_types";

const activeUser: UserRecord = {
  id: "u1",
  employeeNumber: "EMP001",
  name: "山田 太郎",
  email: "yamada@example.com",
  isActive: true,
  relations: [
    { departmentId: "d1", departmentName: "開発部", roleId: "general_user", roleName: "一般" },
  ],
};

const adminUser: UserRecord = {
  id: "u2",
  employeeNumber: "admin",
  name: "システム管理者",
  email: "admin@example.com",
  isActive: true,
  relations: [],
};

const inactiveUser: UserRecord = {
  id: "u3",
  employeeNumber: "EMP003",
  name: "退職 花子",
  email: "taisyoku@example.com",
  isActive: false,
  relations: [],
};

function setup(users: UserRecord[], overrides: Partial<Parameters<typeof UserTable>[0]> = {}) {
  const onSelectRow = vi.fn();
  const onPurgeClick = vi.fn();
  const syncMasterData = vi.fn();
  render(
    <UserTable
      users={users}
      hasUpdate
      hasDelete
      onSelectRow={onSelectRow}
      onPurgeClick={onPurgeClick}
      syncMasterData={syncMasterData}
      {...overrides}
    />,
  );
  return { onSelectRow, onPurgeClick, syncMasterData };
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UserTable", () => {
  it("adminアカウントにはROOTバッジを表示する", () => {
    setup([adminUser]);
    expect(screen.getByText("ROOT")).toBeInTheDocument();
  });

  it("無効ユーザーには「無効」バッジを表示する", () => {
    setup([inactiveUser]);
    expect(screen.getByText("無効")).toBeInTheDocument();
  });

  it("所属・権限マトリクスを表示する", () => {
    setup([activeUser]);
    expect(screen.getByText("開発部")).toBeInTheDocument();
    expect(screen.getByText("一般")).toBeInTheDocument();
  });

  it("relations未設定の場合は「未設定」表示になる", () => {
    setup([adminUser]);
    expect(screen.getByText("未設定(所属・権限なし)")).toBeInTheDocument();
  });

  it("行クリックでonSelectRowを呼ぶ", async () => {
    const { onSelectRow } = setup([activeUser]);
    await userEvent.click(screen.getByText("山田 太郎"));
    expect(onSelectRow).toHaveBeenCalledWith(activeUser);
  });

  it("有効ユーザーには「無効化」ボタンを表示し、確認後POSTしてsyncMasterDataを呼ぶ", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { syncMasterData } = setup([activeUser]);

    await userEvent.click(screen.getByRole("button", { name: "無効化" }));

    await waitFor(() => expect(syncMasterData).toHaveBeenCalledTimes(1));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/users/u1/suspend",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("adminアカウントには「無効化」ボタンを表示しない", () => {
    setup([adminUser]);
    expect(screen.queryByRole("button", { name: "無効化" })).not.toBeInTheDocument();
  });

  it("無効ユーザーには「復元」「削除」ボタンを表示する", () => {
    setup([inactiveUser]);
    expect(screen.getByRole("button", { name: "復元" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
  });

  it("relationsが空の無効ユーザーは削除ボタンが有効(完全削除可能)", () => {
    setup([inactiveUser]);
    expect(screen.getByRole("button", { name: "削除" })).toBeEnabled();
  });

  it("削除ボタンクリックでonPurgeClickを呼ぶ", async () => {
    const { onPurgeClick } = setup([inactiveUser]);
    await userEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(onPurgeClick).toHaveBeenCalledWith("u3", "退職 花子");
  });

  it("データが空の場合は空メッセージを表示する", () => {
    setup([]);
    expect(screen.getByText("該当するデータはありません")).toBeInTheDocument();
  });
});
