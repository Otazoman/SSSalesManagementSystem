// 業務マスタ(docs/manual/master/)のキャプチャ。一覧と、新規登録のフォームを撮る。
export const category = "master";

/** 一覧を撮り、「新規…」ボタンでフォームを開いて撮る(ボタンが無い画面は一覧だけ) */
function listAndForm(h) {
  return (async () => {
    await h.shot("list");
    await openForm(h);
  })();
}

/**
 * 「すべて」タブに切り替えてから一覧を撮る。CSV 取込で仮登録になったデータ(BUG-002・BUG-008)が
 * 「有効」タブに出ないため、一覧の見本として「すべて」を撮る
 */
function allTabListAndForm(h) {
  return (async () => {
    await h.click(/すべて$/);
    await h.shot("list");
    await openForm(h);
  })();
}

function openForm(h) {
  return (async () => {
    const newButton = h.page.getByRole("button", { name: /新規/ }).first();
    if (await newButton.isVisible().catch(() => false)) {
      await newButton.click();
      await h.settle();
      await h.shot("form");
    }
  })();
}

export default [
  { id: "partners", title: "取引先マスタ", path: "/master/partners", steps: listAndForm },
  { id: "partner-contacts", title: "取引先担当者マスタ", path: "/master/partner-contacts", steps: allTabListAndForm },
  { id: "products", title: "品目マスタ", path: "/master/products", steps: listAndForm },
  { id: "product-prices", title: "品目単価マスタ", path: "/master/product-prices", steps: listAndForm },
  { id: "product-structures", title: "品目構成マスタ", path: "/master/product-structures", steps: listAndForm },
  { id: "units", title: "単位マスタ", path: "/master/units", steps: allTabListAndForm },
  { id: "accounts", title: "勘定科目マスタ", path: "/master/accounts", steps: listAndForm },
  { id: "warehouses", title: "倉庫マスタ", path: "/master/warehouses", steps: listAndForm },
  { id: "locations", title: "ロケーションマスタ", path: "/master/locations", steps: listAndForm },
  { id: "projects", title: "プロジェクトマスタ", path: "/master/projects", steps: listAndForm },
  { id: "business-locations", title: "営業拠点マスタ", path: "/master/business-locations", steps: listAndForm },
  { id: "item-reorder-settings", title: "発注点/安全在庫マスタ", path: "/master/item-reorder-settings", steps: listAndForm },
];
