import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WarehouseTable } from "./WarehouseTable";
import { WarehouseRecord } from "../_types";

const warehouses: WarehouseRecord[] = [
  {
    id: "WH-1",
    name: "本社倉庫",
    warehouseType: "INTERNAL",
    postalCode: "100-0001",
    address: "東京都千代田区",
    phoneNumber: "03-1111-2222",
    faxNumber: null,
    email: "wh1@example.com",
    businessStartTime: "09:00",
    businessEndTime: "18:00",
    storageRestrictions: "冷凍品不可",
    status: "active",
    memo: null,
    availableDays: [{ availabledayOfWeek: "MON", timeSlotMemo: "午前のみ" }],
    attachments: [{ fileName: "案内.pdf", storageType: "R2", attachmentR2Path: "x", fileType: "OTHER", id: "A1" }],
  },
  {
    id: "WH-2",
    name: "外部委託倉庫",
    warehouseType: "EXTERNAL",
    postalCode: null,
    address: null,
    phoneNumber: null,
    faxNumber: null,
    email: null,
    businessStartTime: null,
    businessEndTime: null,
    storageRestrictions: null,
    status: "suspended",
    memo: null,
    availableDays: [],
    attachments: [],
  },
];

function setup(overrides: Partial<Parameters<typeof WarehouseTable>[0]> = {}) {
  const onSelect = vi.fn();
  const onDelete = vi.fn();
  const onSuspend = vi.fn();
  const onManageContacts = vi.fn();
  render(
    <WarehouseTable
      warehouses={warehouses}
      editingId={null}
      onSelect={onSelect}
      onDelete={onDelete}
      onSuspend={onSuspend}
      onManageContacts={onManageContacts}
      canUpdate
      canDelete
      {...overrides}
    />,
  );
  return { onSelect, onDelete, onSuspend, onManageContacts };
}

describe("WarehouseTable", () => {
  it("倉庫名・状態バッジ・外部倉庫バッジを表示する", () => {
    setup();
    expect(screen.getByText("本社倉庫")).toBeInTheDocument();
    expect(screen.getByText("有効")).toBeInTheDocument();
    expect(screen.getByText("無効")).toBeInTheDocument();
    expect(screen.getByText("🚚 外部倉庫")).toBeInTheDocument();
  });

  it("受付曜日・添付ファイルリンクを表示する", () => {
    setup();
    expect(screen.getByText(/月/)).toBeInTheDocument();
    expect(screen.getByText("案内.pdf")).toBeInTheDocument();
  });

  it("受付曜日未設定の場合は「受付曜日 未設定」を表示する", () => {
    setup();
    expect(screen.getByText("受付曜日 未設定")).toBeInTheDocument();
  });

  it("行クリックでonSelectを呼ぶ", async () => {
    const { onSelect } = setup();
    await userEvent.click(screen.getByText("本社倉庫"));
    expect(onSelect).toHaveBeenCalledWith(warehouses[0]);
  });

  it("編集中の行は変更ボタンが「調整中」表示になる", () => {
    setup({ editingId: "WH-1" });
    expect(screen.getByRole("button", { name: "調整中" })).toBeInTheDocument();
  });

  it("連絡先ボタンでonManageContactsを呼ぶ", async () => {
    const { onManageContacts } = setup();
    await userEvent.click(screen.getAllByText("📇 連絡先")[0]);
    expect(onManageContacts).toHaveBeenCalledWith(warehouses[0]);
  });

  it("suspended行は完全削除ボタンでonDeleteをid/nameで呼ぶ", async () => {
    const { onDelete } = setup();
    await userEvent.click(screen.getByRole("button", { name: "完全に削除 🗑️" }));
    expect(onDelete).toHaveBeenCalledWith("WH-2", "外部委託倉庫");
  });

  it("空データの場合は空メッセージを表示する", () => {
    setup({ warehouses: [] });
    expect(screen.getByText("該当するデータはありません")).toBeInTheDocument();
  });
});
