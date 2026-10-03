import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useQuoteForm } from "./useQuoteForm";
import { PartnerMaster, ProductMaster, UserOption, QuoteItem } from "../_types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch() {
  const fetchSpy = vi.fn(async (url: string) => {
    if (url.toString().includes("/api/partner-contacts")) {
      return jsonResponse([]);
    }
    if (url.toString().includes("/api/company-settings")) {
      return jsonResponse({});
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

const partners: PartnerMaster[] = [
  { id: "CUST-1", name: "得意先A", address: "東京都千代田区1-1" },
];

// customers等はuseQuoteFormの初期化effectの依存配列に含まれるため、renderHookのレンダー
// コールバック内でbaseProps()を呼ぶテストで`customers: []`のような配列リテラルを直接
// 上書きすると、レンダーの度に新しい参照が生成されてeffectが無限に再発火してしまう。
// 「customersがまだ空」を表す上書き値は、必ずこの安定した参照を使うこと。
const EMPTY_CUSTOMERS: PartnerMaster[] = [];

const products: ProductMaster[] = [
  { id: "PROD-1", name: "品目A", price: 1000, baseUnitCode: "PCS", taxCategoryCode: "TAX10" },
];

const userMaster: UserOption[] = [
  { id: "u1", name: "山田太郎", employeeNumber: "E001" },
];

function baseProps(overrides: Partial<Parameters<typeof useQuoteForm>[0]> = {}) {
  return {
    editingId: null,
    quoteId: "",
    partners,
    products,
    userMaster,
    departments: [{ id: "d1", name: "営業部" }],
    taxCategories: [
      { code: "TAX10", name: "標準10%", taxType: "STANDARD" as const, taxRate: 0.1 },
      { code: "TAX8", name: "軽減8%", taxType: "STANDARD" as const, taxRate: 0.08 },
    ],
    onSubmit: vi.fn(),
    fetchSpecialPrice: vi.fn(async () => null),
    ...overrides,
  };
}

const DEFAULT_ITEM: QuoteItem = {
  itemId: "",
  itemName: "",
  inputType: "MASTER",
  quantity: 1,
  unitPrice: 0,
  unitCode: "",
  taxCategoryCode: "",
};

/**
 * 明細操作・集計計算・送信のテストは、初期化ロジックそのものではなく各handlerの挙動を
 * 検証したいので、あえて「編集モード」(editingId+initialData)で明細1行を確定的に投入する。
 *
 * 💡 initialData/departments/taxCategories等はuseQuoteFormの初期化effectの依存配列に
 * 含まれるため、`renderHook(() => useQuoteForm(baseProps({...})))`のように毎レンダーで
 * baseProps()を呼び直す形にすると、effectの再発火→無限ループを引き起こす
 * (「初期化(新規作成)」のコメントと同種の問題)。ここではpropsをこの関数の呼び出し時に
 * 一度だけ組み立て、`initialProps`として渡すことで参照を安定させる。
 */
function renderEditingQuoteForm(overrides: Partial<Parameters<typeof useQuoteForm>[0]> = {}) {
  const props = baseProps({
    editingId: "Q-1",
    quoteId: "Q-1",
    initialData: {
      title: "",
      customerId: "CUST-1",
      quoteDate: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-02-01T00:00:00.000Z",
      status: "DRAFT",
      memo: "",
      salesPersonEmployeeNumber: "E001",
      items: [DEFAULT_ITEM],
      attachments: [],
    },
    ...overrides,
  });
  return renderHook((p: Parameters<typeof useQuoteForm>[0]) => useQuoteForm(p), {
    initialProps: props,
  });
}

beforeEach(() => {
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useQuoteForm", () => {
  describe("初期化(新規登録、editingId:null)", () => {
    it("見積日を本日、有効期限を1ヶ月後、明細1行(空)で初期化する", async () => {
      mockFetch();
      // customersは最初は空でマウント後に非同期で入ってくる想定(useQuotes.tsの実運用と同じ)
      const { result, rerender } = renderHook(
        (props: Parameters<typeof useQuoteForm>[0]) => useQuoteForm(props),
        { initialProps: baseProps({ partners: EMPTY_CUSTOMERS }) },
      );

      expect(result.current.items).toHaveLength(1);

      rerender(baseProps({ partners }));

      await waitFor(() => expect(result.current.customerId).toBe("CUST-1"));
      expect(result.current.quoteDate).toBe(new Date().toISOString().split("T")[0]);
      expect(result.current.status).toBe("DRAFT");
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0]).toMatchObject({ itemId: "", quantity: 1, unitPrice: 0 });
    });

    it("回帰: partnersが最初から取得済みの状態でマウントしても、既定の明細1行が消えない", async () => {
      // 修正前バグ: 新規作成時の初期化effect末尾で発火するhandleCustomerChange(fire-and-forget)が
      // 呼び出し時点(customersが既にある=defaultCustomerIdが決まる)のitems stateをクロージャで
      // 参照するため、直前にsetItemsした既定の明細1行が非同期解決後に古いitems(空配列)で
      // 上書きされ消えてしまっていた。handleCustomerChangeにitemsを明示的に渡す修正で解消済み。
      mockFetch();
      const { result } = renderHook(() => useQuoteForm(baseProps({ partners })));

      await waitFor(() => expect(result.current.customerId).toBe("CUST-1"));
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0]).toMatchObject({ itemId: "", quantity: 1, unitPrice: 0 });
    });

    it("currentUserEmployeeNumber指定時はそれを営業担当・入力担当の既定値にする", async () => {
      mockFetch();
      const { result } = renderHook(() =>
        useQuoteForm(baseProps({ partners: EMPTY_CUSTOMERS, currentUserEmployeeNumber: "E001" })),
      );

      await waitFor(() => expect(result.current.salesPersonEmployeeNumber).toBe("E001"));
      expect(result.current.inputPersonEmployeeNumber).toBe("E001");
    });
  });

  describe("初期化(編集、editingId+initialData)", () => {
    it("initialDataの内容をフォームへ復元する", async () => {
      mockFetch();
      const initialData = {
        title: "見積タイトル",
        customerId: "CUST-1",
        quoteDate: "2026-01-15T00:00:00.000Z",
        validUntil: "2026-02-15T00:00:00.000Z",
        status: "APPROVED",
        memo: "社内メモ",
        salesPersonEmployeeNumber: "E001",
        items: [
          { itemId: "PROD-1", quantity: 2, unitPrice: 1000 },
          { itemId: "FREE-1", itemName: "自由入力品", quantity: 1, unitPrice: 500 },
        ],
        attachments: [
          { id: "A1", fileName: "spec.pdf", storageType: "R2", attachmentR2Path: "x" },
        ],
      };

      const { result } = renderHook(() =>
        useQuoteForm(
          baseProps({ editingId: "Q-1", quoteId: "Q-1", initialData }),
        ),
      );

      await waitFor(() => expect(result.current.items).toHaveLength(2));
      expect(result.current.status).toBe("APPROVED");
      expect(result.current.memo).toBe("社内メモ");
      // マスタに存在するPROD-1はinputType:MASTER、存在しないFREE-1はDIRECTと推定される
      expect(result.current.items[0].inputType).toBe("MASTER");
      expect(result.current.items[1].inputType).toBe("DIRECT");
      expect(result.current.attachments).toEqual([
        {
          id: "A1",
          fileName: "spec.pdf",
          storageType: "R2",
          attachmentR2Path: "x",
          externalUrl: null,
          fileType: "OTHER",
        },
      ]);
    });
  });

  describe("明細行の操作", () => {
    it("handleAddItemRowは空の明細行を追加する", async () => {
      mockFetch();
      const { result } = renderEditingQuoteForm();
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      act(() => result.current.handleAddItemRow());
      expect(result.current.items).toHaveLength(2);
    });

    it("handleRemoveItemRowは指定indexの行を削除する", async () => {
      mockFetch();
      const { result } = renderEditingQuoteForm();
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      act(() => result.current.handleAddItemRow());
      expect(result.current.items).toHaveLength(2);

      act(() => result.current.handleRemoveItemRow(0));
      expect(result.current.items).toHaveLength(1);
    });

    it("handleItemTypeChangeはinputType変更時にitemId/価格関連をリセットする", async () => {
      mockFetch();
      const { result } = renderEditingQuoteForm();
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      await act(async () => {
        await result.current.handleItemChange(0, "itemId", "PROD-1");
      });

      act(() => result.current.handleItemTypeChange(0, "DIRECT"));

      expect(result.current.items[0]).toMatchObject({
        inputType: "DIRECT",
        itemId: "",
        itemName: "",
        unitPrice: 0,
      });
    });

    it("handleMoveItemUp/Downは行の並び順を入れ替える(境界ではno-op)", async () => {
      mockFetch();
      const { result } = renderEditingQuoteForm();
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      act(() => result.current.handleAddItemRow());
      await act(async () => {
        await result.current.handleItemChange(0, "itemId", "PROD-1");
      });
      await act(async () => {
        await result.current.handleItemChange(1, "itemId", "FREE-X");
      });

      act(() => result.current.handleMoveItemUp(0)); // 先頭でno-op
      expect(result.current.items[0].itemId).toBe("PROD-1");

      act(() => result.current.handleMoveItemDown(0));
      expect(result.current.items[0].itemId).toBe("FREE-X");
      expect(result.current.items[1].itemId).toBe("PROD-1");
    });

    it("MASTER品目でitemId選択時、fetchSpecialPriceが値を返せばそれを単価に採用する", async () => {
      mockFetch();
      const fetchSpecialPrice = vi.fn(async () => 800);
      const { result } = renderEditingQuoteForm({ fetchSpecialPrice });
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      await act(async () => {
        await result.current.handleItemChange(0, "itemId", "PROD-1");
      });

      expect(result.current.items[0].unitPrice).toBe(800);
      expect(result.current.items[0].itemName).toBe("品目A");
      expect(result.current.items[0].unitCode).toBe("PCS");
      expect(result.current.items[0].taxCategoryCode).toBe("TAX10");
    });

    it("MASTER品目でfetchSpecialPriceがnullの場合は品目マスタの定価を採用する", async () => {
      mockFetch();
      const { result } = renderEditingQuoteForm();
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      await act(async () => {
        await result.current.handleItemChange(0, "itemId", "PROD-1");
      });

      expect(result.current.items[0].unitPrice).toBe(1000);
    });
  });

  describe("集計計算", () => {
    it("値引き行(マイナス金額)を分離して小計・値引き合計を計算する", async () => {
      mockFetch();
      const { result } = renderEditingQuoteForm();
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      // 💡 各handleItemChangeはsetItems(updated)を「直接値」で呼ぶ実装(関数更新形ではない)
      // のため、同一act()内で複数回連続して呼ぶと、いずれも同じバッチ前のitemsを
      // クロージャで参照してしまい、後続の呼び出しが前の更新を上書きしてしまう。
      // 実際のUIでは各フィールド編集が個別のイベント(≒別レンダーサイクル)で発生するため
      // 問題にならないが、テストではその区切りを再現するため1呼び出し=1act()に分ける。
      await act(async () => {
        await result.current.handleItemChange(0, "itemId", "PROD-1");
      });
      await act(async () => {
        await result.current.handleItemChange(0, "quantity", 2); // 2 * 1000 = 2000
      });
      act(() => result.current.handleAddItemRow());
      act(() => {
        result.current.handleItemTypeChange(1, "DIRECT");
      });
      await act(async () => {
        await result.current.handleItemChange(1, "quantity", 1);
      });
      await act(async () => {
        await result.current.handleItemChange(1, "unitPrice", -300);
      });

      expect(result.current.calcGrossSubTotal()).toBe(2000);
      expect(result.current.calcDiscountTotal()).toBe(-300);
      expect(result.current.calcSubTotal()).toBe(1700);
    });

    it("taxCategoryCode別に消費税を10%/8%/非課税で振り分ける", async () => {
      mockFetch();
      const { result } = renderEditingQuoteForm();
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      await act(async () => {
        await result.current.handleItemChange(0, "quantity", 1);
      });
      await act(async () => {
        await result.current.handleItemChange(0, "unitPrice", 1000);
      });
      await act(async () => {
        await result.current.handleItemChange(0, "taxCategoryCode", "TAX8");
      });

      const breakdown = result.current.calcTaxBreakdown();
      expect(breakdown.rate8).toEqual({ excl: 1000, tax: 80 });
      expect(breakdown.rate10).toEqual({ excl: 0, tax: 0 });
      expect(result.current.calcTax()).toBe(80);
      expect(result.current.calcTotal()).toBe(1080);
    });
  });

  describe("送信・メール送信", () => {
    it("handleFormSubmitはpreventDefaultしonSubmit(payload, isRevisionUp)を呼ぶ", async () => {
      mockFetch();
      const onSubmit = vi.fn();
      const { result } = renderEditingQuoteForm({ onSubmit });
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      const preventDefault = vi.fn();
      act(() => {
        result.current.handleFormSubmit(
          { preventDefault } as unknown as React.FormEvent,
          true,
        );
      });

      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: "CUST-1" }),
        true,
      );
    });

    it("handleSingleMailSendActionは不正なメールアドレスの場合、alert を出さずに送信しない(送信ボタンはモーダル側で押せない。BUG-037)", async () => {
      mockFetch();
      const handleSingleMailSend = vi.fn();
      const { result } = renderEditingQuoteForm({ handleSingleMailSend });
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      act(() => result.current.setRecipientEmail("not-an-email"));
      await act(async () => {
        await result.current.handleSingleMailSendAction();
      });

      expect(global.alert).not.toHaveBeenCalled();
      expect(handleSingleMailSend).not.toHaveBeenCalled();
    });

    it("確認ダイアログでキャンセルした場合は送信しない", async () => {
      mockFetch();
      vi.stubGlobal("confirm", vi.fn(() => false));
      const handleSingleMailSend = vi.fn();
      const { result } = renderEditingQuoteForm({ handleSingleMailSend });
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      act(() => result.current.setRecipientEmail("test@example.com"));
      await act(async () => {
        await result.current.handleSingleMailSendAction();
      });

      expect(handleSingleMailSend).not.toHaveBeenCalled();
    });

    it("送信成功時はhandleSingleMailSendを呼びモーダルを閉じる", async () => {
      mockFetch();
      const handleSingleMailSend = vi.fn(async () => true);
      const { result } = renderEditingQuoteForm({ handleSingleMailSend });
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      act(() => {
        result.current.setRecipientEmail("test@example.com");
        result.current.setShowMailModal(true);
      });
      await act(async () => {
        await result.current.handleSingleMailSendAction();
      });

      expect(handleSingleMailSend).toHaveBeenCalledWith({
        quoteId: "Q-1",
        recipientEmail: "test@example.com",
      });
      expect(result.current.showMailModal).toBe(false);
    });
  });
});
