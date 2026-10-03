# -*- coding: utf-8 -*-
"""sampledata/ のサンプルCSVを、架空で一貫したデータセットから生成する。

使い方(リポジトリのどこからでも実行できる。出力先はこのファイルと同じ sampledata/):
    python sampledata/generate_sampledata.py
    python sampledata/generate_sampledata.py <出力先フォルダ>   # 別のフォルダへ出力する場合

CSVを変更したい場合は、CSVを直接編集せず、このスクリプトのデータ定義を直して再生成すること
(全ファイルが同じマスタを参照しているため、ID・金額・数量の整合をスクリプトで保つ)。
再生成後は、取込の検証テストで整合を確認する:
    cd packages/backend && npx vitest run test/sampledata-import.test.ts
権限CSV(role_permissions)は packages/backend/src/constants/screens.ts の画面マスタから作るため、
画面を追加・削除したときも再生成が必要。

方針
- 実在の企業・地名・ドメイン・電話番号・法人番号を使わない(社名は「サンプル〇〇」、住所は架空の区市名、
  メールは example.com、電話は 0000 の局番、郵便番号は 000-0000、適格請求書/法人番号は先頭0で実在しない形式)
- 全ファイルを同じ設定(マスタ)から作り、ID・金額・数量の整合を保つ
- 出力: UTF-8(BOM付き)・CRLF・全項目を二重引用符で囲む(Excelで開いても文字化けしない)
"""
import csv
import io
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT = sys.argv[1] if len(sys.argv) > 1 else HERE
os.makedirs(OUT, exist_ok=True)


def write(name, header, rows):
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    w.writerow(header)
    for r in rows:
        assert len(r) == len(header), (name, len(r), len(header), r)
        w.writerow(r)
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8"))
    print(f"{name}: {len(rows)} rows")


# ---------------------------------------------------------------- 単位・勘定科目・部署・ロール
UNITS = [("PCS", "個"), ("KG", "キログラム"), ("M", "メートル"), ("L", "リットル"), ("SET", "セット"),
         ("BOX", "箱"), ("PACK", "パック"), ("H", "時間"), ("DAY", "日"), ("LOT", "式")]
# 状態(status)を明示する(他のマスタの CSV と同じ。空欄なら、承認機能の有効/無効で決まる)
write("units_import_sample.csv", ["code", "name", "status"], [(c, n, "active") for c, n in UNITS])

ACCOUNTS = [
    ("1101", "現金預金", "", "active", "現金および預金の合算科目(サンプル)"),
    ("1301", "売掛金", "", "active", "売上計上に対応する債権"),
    ("1401", "前渡金", "", "active", "発注時の前払金"),
    ("1501", "原材料", "", "active", "製造に使う原材料・部品の棚卸資産"),
    ("1502", "商品", "", "active", "仕入れて販売する商品の棚卸資産"),
    ("1503", "製品", "", "active", "自社で組み立てた完成品の棚卸資産"),
    ("2101", "買掛金", "", "active", "仕入計上に対応する債務"),
    ("2201", "仮受消費税", "", "active", "売上に係る消費税"),
    ("2202", "仮払消費税", "", "active", "仕入に係る消費税"),
    ("4101", "商品売上高", "", "active", "商品の売上"),
    ("4102", "製品売上高", "", "active", "製品の売上"),
    ("4103", "サービス売上高", "", "active", "設置作業・保守などの役務の売上"),
    ("4201", "売上値引・返品", "", "active", "返品・値引による売上の減額"),
    ("5101", "仕入高", "", "active", "商品・原材料の仕入"),
    ("5102", "外注費", "", "active", "外部への作業委託費"),
    ("6101", "消耗品費", "", "active", "事務用品・消耗品"),
    ("6201", "旧・雑費", "", "suspended", "使用を停止した科目の例(利用停止)"),
]
write("accounts_import_sample.csv", ["code", "name", "externalMappingCode", "status", "memo"], ACCOUNTS)

D0 = "2025-04-01"
DEPTS = [
    ("0001", "総務部", "", "総務・人事・庶務を担当する部門", D0, ""),
    ("0002", "営業部", "", "国内営業を担当する部門", D0, ""),
    ("0003", "購買部", "", "調達・発注を担当する部門", D0, ""),
    ("0004", "物流部", "", "入出荷・在庫管理を担当する部門", D0, ""),
    ("0005", "経理部", "", "経理・請求・支払を担当する部門", D0, ""),
    ("0006", "情報システム部", "", "社内システムの運用を担当する部門", D0, ""),
    ("0021", "営業第一課", "0002", "既存顧客を担当する課", D0, ""),
    ("0022", "営業第二課", "0002", "新規開拓を担当する課", D0, ""),
    ("0031", "購買課", "0003", "発注・納期管理を担当する課", D0, ""),
    ("0041", "倉庫管理課", "0004", "倉庫の入出庫・棚卸を担当する課", D0, ""),
    ("0099", "旧・営業推進室", "0002", "組織変更により廃止した部署の例(有効期間終了)", D0, "2026-03-31"),
]
write("departments_import.csv", ["id", "name", "parentDepartmentId", "memo", "validFrom", "validTo"], DEPTS)

ROLES = [
    ("sys_admin", "管理者", "システム管理者(全権限)"),
    ("users", "一般社員", "一般の利用者。申請・起票を行う"),
    ("teaf", "チーフ", "チームリーダー。一般社員の権限に加えて一部の伝票を確定できる"),
    ("manager", "課長", "課の承認者"),
    ("generalmanager", "部長", "部の承認者"),
    ("approver", "承認者", "マスタ・伝票の内容確認を行う承認担当"),
    ("finance_checker", "経理確認者", "経理面の確認を行う担当"),
    ("ceo", "代表取締役", "経営層。全体の閲覧が中心"),
]
write("roles_import.csv", ["id", "name", "description"], ROLES)

# ---------------------------------------------------------------- 権限(画面マスタ × 5操作を、ロールごとの方針で割り当て)
screens = open(os.path.join(REPO, "packages", "backend", "src", "constants", "screens.ts"), encoding="utf-8").read()
SCREENS = re.findall(r'resource:\s*"([^"]+)",\s*name:\s*"[^"]*",\s*category:\s*"([^"]+)"', screens)
assert len(SCREENS) >= 40, len(SCREENS)
ACTIONS = ["menu", "read", "create", "update", "delete"]
cat = {r: c for r, c in SCREENS}
DAILY_DOCS = ["sales_deals", "sales_quotes", "sales_orders", "purchase_requisitions", "inventory_receiving",
              "inventory_shipping", "inventory_audit"]
DAILY_BACK = ["sales_invoices", "purchase_orders", "purchase_receipts"]
DAILY_MONEY = ["sales_billing", "purchase_payment"]


def grants(role):
    g = set()

    def add(resources, actions):
        for r in resources:
            for a in actions:
                g.add(f"{r}:{a}")

    everything = [r for r, _ in SCREENS]
    view = ["menu", "read"]
    daily = [r for r, c in SCREENS if c == "daily_work"]
    apply_ = [r for r, c in SCREENS if c == "apply_approve"]
    masters = [r for r, c in SCREENS if c == "business_master"]
    accounting = [r for r, c in SCREENS if c == "accounting"]
    logs = [r for r, c in SCREENS if c == "log"]
    if role == "sys_admin":
        add(everything, ACTIONS)
    elif role == "users":
        add(apply_ + daily + masters, view)
        add(["wf_tasks"], ["update"])
        add(DAILY_DOCS, ["create", "update"])
    elif role == "teaf":
        add(apply_ + daily + masters, view)
        add(["wf_tasks"], ["update"])
        add(DAILY_DOCS + DAILY_BACK, ["create", "update"])
    elif role == "manager":
        add(apply_ + daily + masters, view)
        add(["wf_tasks"], ["update"])
        add(DAILY_DOCS + DAILY_BACK + DAILY_MONEY, ["create", "update"])
        add(DAILY_DOCS + DAILY_BACK, ["delete"])
        add(masters, ["create", "update"])
    elif role == "generalmanager":
        add(apply_ + daily + masters + accounting, view)
        add(["wf_tasks"], ["update"])
        add(DAILY_DOCS + DAILY_BACK + DAILY_MONEY, ["create", "update", "delete"])
        add(masters, ["create", "update"])
        add(["audit_logs"], view)
    elif role == "approver":
        add(apply_ + daily + masters, view)
        add(["wf_tasks"], ["update"])
        add(masters, ["update"])
    elif role == "finance_checker":
        add(apply_ + daily + masters + accounting, view)
        add(["wf_tasks"], ["update"])
        add(DAILY_MONEY + accounting, ["create", "update"])
        add(["accounting_journal", "accounting_journal_rules", "accounting_journal_export_format"], ["delete"])
    elif role == "ceo":
        add(apply_ + daily + masters + accounting, view)
        add(["progress_overview"], view)
    return sorted(g)


ROLE_PERMS = [(r[0], p) for r in ROLES for p in grants(r[0])]
write("role_permissions_import_sample.csv", ["role_id", "permission_id"], ROLE_PERMS)

# ---------------------------------------------------------------- ユーザー
PW = "Sample#2026"
USERS = [
    ("EMP0001", "山田 太郎", "0002", "generalmanager"),
    ("EMP0002", "佐藤 花子", "0021", "manager"),
    ("EMP0002", "佐藤 花子", "0022", "users"),  # 兼務の例(同じ社員番号で2行目=もう1つの所属・ロール)
    ("EMP0003", "鈴木 一郎", "0021", "users"),
    ("EMP0004", "高橋 美咲", "0022", "users"),
    ("EMP0005", "田中 健太", "0031", "manager"),
    ("EMP0006", "伊藤 由美", "0031", "users"),
    ("EMP0007", "渡辺 大輔", "0041", "teaf"),
    ("EMP0008", "中村 さくら", "0041", "users"),
    ("EMP0009", "小林 誠", "0005", "finance_checker"),
    ("EMP0010", "加藤 亮", "0001", "approver"),
    ("EMP0011", "吉田 優子", "0006", "users"),
    ("EMP0012", "松本 隆", "0001", "ceo"),
]
seen = set()
user_rows = []
for emp, name, dept, role in USERS:
    first = emp not in seen
    seen.add(emp)
    user_rows.append((emp, name, f"{emp.lower()}@example.com", dept, role, PW if first else ""))
write("users_import.csv", ["employeeNumber", "name", "email", "departmentId", "roleId", "passwordRaw"], user_rows)

# ---------------------------------------------------------------- 倉庫・ロケーション
WAREHOUSES = [
    ("WH-001", "第一倉庫(自社・常温)", "000-0001", "東京都サンプル区サンプル町1-1-1", "03-0000-0001", "03-0000-0002", "wh1@example.com",
     "09:00", "18:00", "常温管理。4t車まで入庫可", "INTERNAL", "active", "完成品・商品を保管するメインの倉庫"),
    ("WH-002", "第二倉庫(自社・冷蔵)", "000-0002", "大阪府サンプル市サンプル区2-2-2", "06-0000-0001", "06-0000-0002", "wh2@example.com",
     "08:30", "17:30", "冷蔵対応。危険物不可", "INTERNAL", "active", "原材料・温度管理が必要な品目を保管する倉庫"),
    ("WH-003", "外部倉庫A(委託)", "000-0003", "愛知県サンプル市サンプル町3-3-3", "052-0000-0001", "", "", "09:00", "17:00",
     "常温管理のみ", "EXTERNAL", "active", "出荷業務を委託している外部倉庫(指示書の発行・実績取込で運用)"),
    ("WH-009", "旧倉庫(閉鎖)", "000-0009", "北海道サンプル市サンプル町9-9-9", "", "", "", "", "", "", "INTERNAL", "suspended",
     "閉鎖済みの倉庫の例(利用停止)"),
]
write("warehouses_import_sample.csv",
      ["id", "name", "postalCode", "address", "phoneNumber", "faxNumber", "email", "businessStartTime", "businessEndTime",
       "storageRestrictions", "warehouseType", "status", "memo"], WAREHOUSES)

LOCS = [
    ("LOC-A-01", "WH-001", "Aラック 1段目", "active", "出荷頻度の高い品目の固定ロケーション"),
    ("LOC-A-02", "WH-001", "Aラック 2段目", "active", "出荷頻度が中程度の品目用"),
    ("LOC-A-03", "WH-001", "Aラック 3段目", "active", "予備"),
    ("LOC-B-01", "WH-001", "Bラック 1段目", "active", "かさばる完成品用"),
    ("LOC-C-01", "WH-002", "冷蔵棚 1", "active", "原材料(要冷蔵)用"),
    ("LOC-C-02", "WH-002", "冷蔵棚 2", "active", "原材料用"),
    ("LOC-C-03", "WH-002", "常温棚 1", "active", "部品・梱包資材用"),
    ("LOC-X-01", "WH-003", "外部倉庫A 区画1", "active", "外部倉庫の管理区画"),
    ("LOC-X-02", "WH-003", "外部倉庫A 区画2", "active", "外部倉庫の管理区画"),
    ("LOC-Z-01", "WH-009", "旧倉庫 棚1", "suspended", "閉鎖した倉庫のロケーション(利用停止)"),
]
write("locations_import_sample.csv", ["id", "warehouseId", "name", "status", "memo"], LOCS)

# ---------------------------------------------------------------- 取引先・担当者・プロジェクト
CUS_TERMS = ("振込払", 31, 1, 31)
PARTNERS = [
    # id, name, type, address, tel, credit, closing, monthOffset, payDay, method, status, memo
    ("CUST-0001", "サンプル得意先A株式会社", "CUSTOMER", "東京都サンプル区サンプル町10-1", "03-0000-1001", 5000000, 31, 1, 31, "振込払", "active", "主要な得意先(月末締め翌月末払い)"),
    ("CUST-0002", "サンプル得意先B株式会社", "CUSTOMER", "神奈川県サンプル市サンプル町20-2", "045-0000-1002", 3000000, 20, 1, 25, "振込払", "active", "20日締め翌月25日払い"),
    ("CUST-0003", "サンプル得意先C商会", "CUSTOMER", "埼玉県サンプル市サンプル町30-3", "048-0000-1003", 1000000, 31, 2, 10, "振込払", "active", "月末締め翌々月10日払い"),
    ("CUST-0004", "サンプル得意先D工業株式会社", "CUSTOMER", "千葉県サンプル市サンプル町40-4", "043-0000-1004", 2000000, 15, 1, 15, "口座振替", "active", "15日締め翌月15日払い(口座振替)"),
    ("CUST-0005", "サンプル得意先E販売株式会社", "CUSTOMER", "大阪府サンプル市サンプル町50-5", "06-0000-1005", 500000, 31, 1, 31, "現金", "active", "少額取引の得意先"),
    ("SUPP-0001", "サンプル仕入先A材料株式会社", "SUPPLIER", "愛知県サンプル市サンプル町11-1", "052-0000-2001", 0, 20, 1, 20, "振込払", "active", "原材料の主要な仕入先"),
    ("SUPP-0002", "サンプル仕入先B部品株式会社", "SUPPLIER", "静岡県サンプル市サンプル町22-2", "054-0000-2002", 0, 31, 1, 31, "振込払", "active", "部品の仕入先"),
    ("SUPP-0003", "サンプル仕入先C資材株式会社", "SUPPLIER", "岐阜県サンプル市サンプル町33-3", "058-0000-2003", 0, 31, 2, 10, "振込払", "active", "梱包資材の仕入先"),
    ("SUPP-0004", "サンプル仕入先D商事", "SUPPLIER", "京都府サンプル市サンプル町44-4", "075-0000-2004", 0, 25, 1, 25, "振込払", "active", "商品の仕入先"),
    ("SUPP-0005", "サンプル仕入先E(取引停止)", "SUPPLIER", "兵庫県サンプル市サンプル町55-5", "078-0000-2005", 0, 31, 1, 31, "振込払", "suspended", "取引を停止した仕入先の例(利用停止)"),
    ("BOTH-0001", "サンプル取引先F株式会社", "BOTH", "福岡県サンプル市サンプル町66-6", "092-0000-3001", 1000000, 31, 1, 31, "振込払", "active", "得意先と仕入先の両方の取引がある取引先"),
    ("PROS-0001", "サンプル見込み客G株式会社", "PROSPECT", "宮城県サンプル市サンプル町77-7", "022-0000-4001", 0, 0, 0, 0, "", "active", "商談中の見込み客(商談管理で使用)"),
    ("PROS-0002", "サンプル見込み客H株式会社", "PROSPECT", "北海道サンプル市サンプル町88-8", "011-0000-4002", 0, 0, 0, 0, "", "active", "初回面談を予定している見込み客"),
]
partner_rows = []
for i, p in enumerate(PARTNERS, start=1):
    pid, name, typ, addr, tel, credit, closing, off, payday, method, status, memo = p
    fax = tel[:-4] + "9" + tel[-3:] if tel else ""
    pn = f"{i:013d}"  # 先頭が0のため、実在の法人番号(先頭は1〜9)とは一致しない
    partner_rows.append((pid, name, typ, f"000-{i:04d}", addr, tel, fax, credit, closing, off, payday, method, status, memo,
                         f"T{pn}" if typ != "PROSPECT" else "", pn if typ != "PROSPECT" else ""))
write("partners_import_sample.csv",
      ["id", "name", "type", "postalCode", "address", "phone", "fax", "creditLimit", "closingDay", "paymentMonthOffset",
       "paymentDay", "paymentMethod", "status", "memo", "qualifiedInvoiceNumber", "corporateNumber"], partner_rows)

CONTACTS = [
    ("CON-0001", "CUST-0001", "CUSTOMER_CONTACT", "得意先 一郎", "info-a1@example.com", "03-0000-1011", "購買部", 1, "発注・納期のメイン窓口"),
    ("CON-0002", "CUST-0001", "CUSTOMER_CONTACT", "得意先 二郎", "info-a2@example.com", "03-0000-1012", "経理部", 0, "請求書の送付先(メール送信の対象外)"),
    ("CON-0003", "CUST-0002", "CUSTOMER_CONTACT", "得意先 花子", "info-b1@example.com", "045-0000-1021", "資材課", 1, ""),
    ("CON-0004", "CUST-0003", "CUSTOMER_CONTACT", "得意先 三郎", "info-c1@example.com", "048-0000-1031", "", 1, ""),
    ("CON-0005", "CUST-0004", "CUSTOMER_CONTACT", "得意先 四郎", "info-d1@example.com", "043-0000-1041", "製造部", 1, ""),
    ("CON-0006", "CUST-0005", "CUSTOMER_CONTACT", "得意先 五郎", "info-e1@example.com", "06-0000-1051", "", 1, ""),
    ("CON-0011", "SUPP-0001", "SUPPLIER_CONTACT", "仕入先 一郎", "sales-a1@example.com", "052-0000-2011", "営業部", 1, "納期・価格交渉の窓口"),
    ("CON-0012", "SUPP-0001", "SUPPLIER_CONTACT", "仕入先 一美", "sales-a2@example.com", "052-0000-2012", "出荷課", 1, "出荷連絡の窓口"),
    ("CON-0013", "SUPP-0002", "SUPPLIER_CONTACT", "仕入先 二郎", "sales-b1@example.com", "054-0000-2021", "営業部", 1, ""),
    ("CON-0014", "SUPP-0003", "SUPPLIER_CONTACT", "仕入先 三郎", "sales-c1@example.com", "058-0000-2031", "", 1, ""),
    ("CON-0015", "SUPP-0004", "SUPPLIER_CONTACT", "仕入先 四郎", "sales-d1@example.com", "075-0000-2041", "", 1, ""),
    ("CON-0021", "BOTH-0001", "CUSTOMER_CONTACT", "取引先 太郎", "info-f1@example.com", "092-0000-3011", "営業部", 1, "得意先としての窓口"),
    ("CON-0022", "BOTH-0001", "SUPPLIER_CONTACT", "取引先 太郎", "info-f1@example.com", "092-0000-3011", "営業部", 1, "仕入先としての窓口(同じ担当者が両方を兼ねる例)"),
    ("CON-0031", "PROS-0001", "CUSTOMER_CONTACT", "見込客 一郎", "prospect-g1@example.com", "022-0000-4011", "情報システム部", 1, "商談の主な面談相手"),
    ("CON-0032", "PROS-0001", "CUSTOMER_CONTACT", "見込客 二郎", "prospect-g2@example.com", "022-0000-4012", "購買部", 1, "決裁に関わる担当"),
    ("CON-0033", "PROS-0002", "CUSTOMER_CONTACT", "見込客 花子", "prospect-h1@example.com", "011-0000-4021", "", 1, ""),
]
write("partner_contacts_import_sample.csv",
      ["id", "partnerId", "contactType", "internalUserId", "name", "email", "phone", "fax", "departmentName", "isEmailTarget", "memo"],
      [(c[0], c[1], c[2], "", c[3], c[4], c[5], c[5][:-4] + "9" + c[5][-3:], c[6], c[7], c[8]) for c in CONTACTS])

PROJECTS = [
    ("PRJ-2026-001", "サンプル設備導入プロジェクト", "active", "2026-04-01", "2026-12-31", "得意先向けの設備導入案件(受注・売上を紐づけて採算を確認する)"),
    ("PRJ-2026-002", "サンプル年間保守契約", "active", "2026-04-01", "2027-03-31", "年間の保守サービス契約"),
    ("PRJ-2026-003", "サンプル新製品開発", "active", "2026-06-01", "", "終了日未定の社内プロジェクト(開発用の仕入を紐づける)"),
    ("PRJ-2025-001", "サンプル前期案件(終了)", "suspended", "2025-04-01", "2026-03-31", "完了済みのプロジェクトの例(利用停止)"),
]
write("projects_import_sample.csv", ["id", "name", "status", "startDate", "endDate", "memo"], PROJECTS)

# ---------------------------------------------------------------- 品目
def jan(first12):
    """JAN(EAN-13)のチェックデジットを付ける。20〜29 で始まるのは、店舗・社内で使うインストアコード"""
    total = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(first12))
    return first12 + str((10 - total % 10) % 10)


# 商品バーコード(BUG-007): スキャンの確認用に、JAN(EAN-13)と CODE128(英数字)の両方を用意する。
# JAN はチェックデジットが正しい値にする(ラベルは JAN として表示・印刷される)。英数字の値は CODE128 になる。
# 商品バーコードが空の品目は、品目コードが CODE128 で表示・印刷される。
# id, name, purchased, sales, service, unit, tax, barcode, account, supplier, supplierPart, memo, salesPrice, purchasePrice
ITEMS = [
    ("ITEM-1001", "原材料A(粉体)", "true", "false", "false", "KG", "TAX_10", jan("200000001001"), "1501", "SUPP-0001", "MAT-A", "製品の主原料。冷蔵保管", 0, 1200),
    ("ITEM-1002", "原材料B(液体)", "true", "false", "false", "L", "TAX_10", jan("200000001002"), "1501", "SUPP-0001", "MAT-B", "製品の副原料。冷蔵保管", 0, 800),
    ("ITEM-1003", "部品C(制御基板)", "true", "false", "false", "PCS", "TAX_10", "SMP-PRT-C001", "1501", "SUPP-0002", "PRT-C", "組立に使う制御基板", 0, 2500),
    ("ITEM-1004", "梱包資材D(箱)", "true", "false", "false", "BOX", "TAX_10", "SMP-PKG-D001", "1501", "SUPP-0003", "PKG-D", "出荷用の梱包箱", 0, 150),
    ("ITEM-2001", "製品X(標準型)", "false", "true", "false", "PCS", "TAX_10", jan("200000002001"), "1503", "", "", "自社で組み立てる標準モデル", 12000, 0),
    ("ITEM-2002", "製品Y(高機能型)", "false", "true", "false", "PCS", "TAX_10", jan("200000002002"), "1503", "", "", "自社で組み立てる高機能モデル", 25000, 0),
    ("ITEM-2003", "製品Z(小型)", "false", "true", "false", "PCS", "TAX_10", jan("200000002003"), "1503", "", "", "自社で組み立てる小型モデル", 8000, 0),
    ("ITEM-2004", "オプション部品セット", "false", "true", "false", "SET", "TAX_10", jan("200000002004"), "1503", "", "", "製品に追加する部品のセット販売", 3500, 0),
    ("ITEM-3001", "仕入商品P", "true", "true", "false", "PCS", "TAX_10", jan("200000003001"), "1502", "SUPP-0004", "GDS-P", "仕入れてそのまま販売する商品", 1800, 1100),
    ("ITEM-3002", "仕入商品Q(飲料水)", "true", "true", "false", "BOX", "TAX_8_REDUCED", jan("200000003002"), "1502", "SUPP-0004", "GDS-Q", "軽減税率(8%)の対象になる商品の例", 2400, 1600),
    ("ITEM-9001", "設置作業", "false", "true", "true", "H", "TAX_10", "", "4103", "", "", "現地での設置作業(時間単位)", 6000, 0),
    ("ITEM-9002", "保守サービス(月額)", "false", "true", "true", "LOT", "TAX_10", "", "4103", "", "", "月額の保守契約", 20000, 0),
    ("ITEM-9003", "運賃", "false", "true", "true", "LOT", "TAX_10", "", "4103", "", "", "配送料(式)", 1500, 0),
]
write("products_import_sample.csv",
      ["id", "name", "isPurchased", "isSales", "isService", "baseUnitCode", "taxCategoryCode", "productBarcode", "accountCode",
       "supplierId", "supplierPartNumber", "memo", "standardSalesPrice", "standardPurchasePrice", "status"],
      [i + ("active",) for i in ITEMS])
ITEM = {i[0]: i for i in ITEMS}
PRICE = {i[0]: i[12] if i[3] == "true" else i[13] for i in ITEMS}
TAXRATE = {"TAX_10": 0.10, "TAX_8_REDUCED": 0.08}

# 得意先別・数量別の販売単価、仕入先別の仕入単価(標準単価は品目マスタの取込時に作られる)
PRICES = [
    ("PRC-S-2001-CUST0001", "ITEM-2001", "SALES", "CUST-0001", 0, 11000, "PCS", "active"),
    ("PRC-S-2001-QTY10", "ITEM-2001", "SALES", "", 10, 11500, "PCS", "active"),
    ("PRC-S-2002-CUST0002", "ITEM-2002", "SALES", "CUST-0002", 0, 23500, "PCS", "active"),
    ("PRC-S-2003-QTY5", "ITEM-2003", "SALES", "", 5, 7500, "PCS", "active"),
    ("PRC-S-3001-CUST0005", "ITEM-3001", "SALES", "CUST-0005", 0, 1700, "PCS", "active"),
    ("PRC-P-1001-QTY100", "ITEM-1001", "PURCHASE", "SUPP-0001", 100, 1100, "KG", "active"),
    ("PRC-P-1003-QTY50", "ITEM-1003", "PURCHASE", "SUPP-0002", 50, 2300, "PCS", "active"),
    ("PRC-P-1004-QTY200", "ITEM-1004", "PURCHASE", "SUPP-0003", 200, 130, "BOX", "active"),
]
write("product_prices_import_sample.csv", ["id", "itemId", "priceType", "customerId", "minQuantity", "unitPrice", "unitCode", "status"], PRICES)

BOM = [
    ("BOM-2001-1001", "ITEM-2001", "ITEM-1001", "0.5", "1.0", "2026-01-01", "", "製品X 1個あたりの原材料A使用量(KG)", "active"),
    ("BOM-2001-1003", "ITEM-2001", "ITEM-1003", "1", "1.0", "2026-01-01", "", "制御基板1枚", "active"),
    ("BOM-2001-1004", "ITEM-2001", "ITEM-1004", "1", "1.0", "2026-01-01", "", "梱包箱1箱", "active"),
    ("BOM-2002-1001", "ITEM-2002", "ITEM-1001", "0.8", "1.0", "2026-01-01", "", "製品Y 1個あたりの原材料A使用量(KG)", "active"),
    ("BOM-2002-1002", "ITEM-2002", "ITEM-1002", "0.3", "1.0", "2026-01-01", "", "製品Y 1個あたりの原材料B使用量(L)", "active"),
    ("BOM-2002-1003", "ITEM-2002", "ITEM-1003", "2", "1.0", "2026-01-01", "", "制御基板2枚", "active"),
    ("BOM-2003-1003", "ITEM-2003", "ITEM-1003", "1", "1.0", "2026-01-01", "", "制御基板1枚", "active"),
    ("BOM-2004-2003", "ITEM-2004", "ITEM-2003", "1", "1.0", "2026-01-01", "", "オプションセットに含める小型製品", "active"),
    ("BOM-2001-1001-R2", "ITEM-2001", "ITEM-1001", "0.45", "2.0", "2026-10-01", "", "改訂版(原材料Aの使用量を削減)。有効開始日が先の例", "temporary"),
]
write("products_bom_import_sample.csv", ["id", "parentItemId", "childItemId", "quantityRequired", "revision", "validFrom", "validTo", "memo", "status"], BOM)

REORDER = [
    ("ITEM-1001", "WH-002", 50, 20, "冷蔵保管の主原料。欠品すると組立が止まるため発注点を高めに設定"),
    ("ITEM-1002", "WH-002", 30, 10, ""),
    ("ITEM-1003", "WH-001", 40, 15, "納期が長い部品のため余裕を持たせる"),
    ("ITEM-1004", "WH-001", 100, 30, ""),
    ("ITEM-3001", "WH-001", 20, 5, "仕入商品の定期補充"),
]
write("item_reorder_settings_import_sample.csv", ["itemId", "warehouseId", "reorderPoint", "safetyStock", "memo"], REORDER)

# ---------------------------------------------------------------- 承認フロー
FLOWS = []


def flow(name, rtype, steps, mn=0, mx=0, mf="", mv=""):
    for role, dept, step, memo in steps:
        FLOWS.append((name, rtype, mn, mx, 1, mf, mv, role, dept, step, memo))


REQ = ("users", "", "申請", "")
flow("倉庫マスタ登録", "master_warehouses", [REQ, ("manager", "0004", "物流部確認", "物流部の課長による確認")])
flow("勘定科目マスタ", "master_accounts", [REQ, ("finance_checker", "0005", "経理確認", "経理担当による確認"), ("generalmanager", "0005", "経理部承認", "経理部長による最終承認")])
flow("取引先マスタ登録", "master_partners", [REQ, ("manager", "", "課長承認", "申請者の所属課の課長による確認"), ("manager", "0002", "営業部確認", "営業部の課長による確認")])
flow("標準商品マスタ登録", "master_products", [REQ, ("approver", "", "担当承認", "承認担当による内容確認")])
flow("商品単価マスタ登録", "master_prices", [REQ, ("manager", "", "課長承認", ""), ("generalmanager", "", "部長承認", "単価変更の最終承認")])
flow("標準見積(100万円未満)", "sales_quotes", [("users", "", "作成・申請", ""), ("manager", "", "課長承認", "")], 0, 1000000)
flow("標準見積(1000万円未満)", "sales_quotes", [("users", "", "作成・申請", ""), ("manager", "", "一次承認", ""), ("generalmanager", "", "二次承認", "")], 1000000, 10000000)
flow("購買申請(通常)", "purchase_requisitions", [REQ, ("manager", "", "課長承認", "購買内容の確認")])
flow("購買申請(前払)", "purchase_requisitions", [REQ, ("manager", "", "課長承認", ""), ("generalmanager", "0003", "購買部承認", "前払は購買部長の承認を必須にする")], 0, 0, "requestType", "PREPAYMENT")
flow("発注申請", "purchase_orders", [REQ, ("generalmanager", "0003", "購買部承認", "発注内容の最終確認")])
flow("単位マスタ登録", "master_units", [REQ, ("manager", "", "課長承認", "")])
flow("ロケーションマスタ登録", "master_locations", [REQ, ("manager", "0041", "倉庫管理課承認", "")])
flow("取引先担当者マスタ登録", "master_contacts", [REQ, ("manager", "", "課長承認", "")])
flow("部品構成(BOM)マスタ登録", "master_structures", [REQ, ("approver", "", "技術承認", "")])
flow("受注申請(高額)", "sales_orders", [("users", "", "作成・申請", ""), ("manager", "", "一次承認", ""), ("generalmanager", "", "二次承認", "")], 1000000, 0)
flow("棚卸計上申請", "inventory_audit", [REQ, ("manager", "0041", "倉庫責任者承認", "")])
write("approval_flows_import_sample.csv",
      ["name", "requestType", "minAmount", "maxAmount", "isActive", "matchField", "matchValue", "approverRoleId", "targetDepartmentId", "stepName", "stepMemo"], FLOWS)

# ---------------------------------------------------------------- 在庫(入庫 → 出庫 → 棚卸 → 廃棄 → 返品)。数量は整合する範囲で
RECEIPTS = [  # headerId, date, invoiceNo, memo, item, wh, loc, lot, qty
    ("RCPT-0001", "2026-08-03", "INV-A-0801", "原材料の定期入庫", "ITEM-1001", "WH-002", "LOC-C-01", "LOT-260803", 400),
    ("RCPT-0001", "2026-08-03", "INV-A-0801", "原材料の定期入庫", "ITEM-1002", "WH-002", "LOC-C-02", "LOT-260803", 150),
    ("RCPT-0002", "2026-08-04", "INV-B-0802", "部品の入庫", "ITEM-1003", "WH-001", "LOC-A-01", "LOT-260804", 300),
    ("RCPT-0002", "2026-08-04", "INV-B-0802", "部品の入庫", "ITEM-1004", "WH-002", "LOC-C-03", "LOT-260804", 600),
    ("RCPT-0003", "2026-08-05", "INV-D-0803", "商品の入庫", "ITEM-3001", "WH-001", "LOC-A-02", "LOT-260805", 100),
    ("RCPT-0003", "2026-08-05", "INV-D-0803", "商品の入庫", "ITEM-3002", "WH-001", "LOC-A-03", "LOT-260805", 60),
    ("RCPT-0004", "2026-08-10", "", "組立完成品の入庫(製品X)", "ITEM-2001", "WH-001", "LOC-B-01", "LOT-260810", 120),
    ("RCPT-0004", "2026-08-10", "", "組立完成品の入庫(製品Y)", "ITEM-2002", "WH-001", "LOC-B-01", "LOT-260810", 60),
    ("RCPT-0004", "2026-08-10", "", "組立完成品の入庫(製品Z)", "ITEM-2003", "WH-001", "LOC-A-03", "LOT-260810", 80),
    ("RCPT-0004", "2026-08-10", "", "組立完成品の入庫(オプション)", "ITEM-2004", "WH-001", "LOC-A-03", "LOT-260810", 40),
]
write("stock_receipts_import_sample.csv",
      ["headerId", "receivedDate", "supplierInvoiceNumber", "memo", "itemId", "warehouseId", "locationId", "lotNumber", "quantity"], RECEIPTS)

SHIPMENTS = [  # headerId, date, memo, loc, item, qty, lot, quality, partner
    ("SHIP-0001", "2026-08-20", "得意先Aへの出荷", "LOC-B-01", "ITEM-2001", 30, "", "", "CUST-0001"),
    ("SHIP-0001", "2026-08-20", "得意先Aへの出荷", "LOC-A-03", "ITEM-2004", 10, "", "", "CUST-0001"),
    ("SHIP-0002", "2026-08-22", "得意先Bへの出荷", "LOC-B-01", "ITEM-2002", 10, "", "", "CUST-0002"),
    ("SHIP-0003", "2026-08-25", "得意先Eへの出荷", "LOC-A-02", "ITEM-3001", 20, "", "", "CUST-0005"),
]
write("stock_shipments_import_sample.csv",
      ["headerId", "shippedDate", "memo", "locationId", "itemId", "quantity", "lotNumber", "qualityStatus", "partnerId"], SHIPMENTS)

AUDITS = [  # item, wh, loc, lot, account, quality, counted, memo
    ("ITEM-1001", "WH-002", "LOC-C-01", "LOT-260803", "", "NORMAL", 400, "定期棚卸。理論在庫と一致"),
    ("ITEM-1003", "WH-001", "LOC-A-01", "LOT-260804", "", "NORMAL", 298, "定期棚卸。理論在庫より2個少ない(要確認)"),
    ("ITEM-3001", "WH-001", "LOC-A-02", "LOT-260805", "", "NORMAL", 80, "定期棚卸。理論在庫と一致"),
]
write("stock_audits_import_sample.csv",
      ["itemId", "warehouseId", "locationId", "lotNumber", "accountCode", "qualityStatus", "countedQuantity", "memo"], AUDITS)

DISPOSALS = [
    ("ITEM-3002", "WH-001", "LOC-A-03", "LOT-260805", "", "NORMAL", 3, "賞味期限切れのため廃棄"),
    ("ITEM-1004", "WH-002", "LOC-C-03", "LOT-260804", "", "NORMAL", 5, "水濡れで使えなくなった梱包箱を廃棄"),
]
write("stock_disposals_import_sample.csv",
      ["itemId", "warehouseId", "locationId", "lotNumber", "accountCode", "qualityStatus", "quantity", "memo"], DISPOSALS)

RETURNS = [
    ("ITEM-1003", "WH-001", "LOC-A-01", "LOT-260804", "", "NORMAL", "OUTBOUND", 5, "仕様違いのため仕入先へ返品", "2026-08-28", "仕入先Bへ返品"),
    ("ITEM-2003", "WH-001", "LOC-A-03", "NONE", "", "NORMAL", "INBOUND", 2, "サイズ違いのため返品受入", "2026-08-29", "得意先からの返品受入"),
]
write("stock_returns_import_sample.csv",
      ["itemId", "warehouseId", "locationId", "lotNumber", "accountCode", "qualityStatus", "direction", "quantity", "returnReason", "returnDate", "memo"], RETURNS)


# ---------------------------------------------------------------- 伝票の金額計算
def totals(lines):
    """lines: [(item_id, qty, unit_price)]。税率ごとに小計→消費税(切り捨て)。戻り値=(税込合計, 消費税)"""
    by_rate = {}
    for item_id, qty, price in lines:
        rate = TAXRATE[ITEM[item_id][6]]
        by_rate[rate] = by_rate.get(rate, 0) + qty * price
    tax = sum(math.floor(amount * rate) for rate, amount in by_rate.items())
    subtotal = sum(by_rate.values())
    return int(subtotal + tax), int(tax)


def item_cols(item_id, qty, price, memo=""):
    it = ITEM[item_id]
    return [item_id, it[1], "MASTER", qty, price, it[5], it[6], memo]


# ---------------------------------------------------------------- 販売: 見積 → 受注 → 売上 → 請求 → 入金
DEPT_SALES = "0021"
# 見積の番号は、画面で登録した見積と同じく末尾に版数(-1)を付ける(BUG-019)。版数が無いと、見積の一覧が
# 番号の最後の「-」以降を版数とみなし、別々の見積を1行にまとめてしまう
Q = [  # id, title, partner, date, until, status, sales, lines, memo
    ("QT-2026-0001-1", "製品X・オプション 導入見積", "CUST-0001", "2026-08-01", "2026-08-31", "APPROVED", "EMP0002",
     [("ITEM-2001", 30, 11000), ("ITEM-2004", 10, 3500), ("ITEM-9001", 8, 6000)], "設置作業込みの標準見積"),
    ("QT-2026-0002-1", "製品Y 見積", "CUST-0002", "2026-08-05", "2026-09-05", "APPROVED", "EMP0003",
     [("ITEM-2002", 10, 23500), ("ITEM-9003", 1, 1500)], "得意先B専用単価を適用"),
    ("QT-2026-0003-1", "製品Z 大口見積", "CUST-0003", "2026-08-12", "2026-09-12", "DRAFT", "EMP0003",
     [("ITEM-2003", 20, 7500)], "数量5個以上の単価を適用(承認申請前)"),
    ("QT-2026-0004-1", "見込み客向け 製品X 見積", "PROS-0001", "2026-08-18", "2026-09-30", "DRAFT", "EMP0004",
     [("ITEM-2001", 5, 12000), ("ITEM-9001", 4, 6000)], "商談中の見込み客向け(商談管理と紐づけ)"),
    ("QT-2026-0005-1", "商品P・Q 見積", "CUST-0005", "2026-08-20", "2026-09-20", "APPROVED", "EMP0004",
     [("ITEM-3001", 20, 1700), ("ITEM-3002", 5, 2400)], "少額取引の見積(軽減税率の品目を含む)"),
]
qrows = []
for qid, title, pid, d, until, st, sp, lines, memo in Q:
    tot, tax = totals(lines)
    for ln in lines:
        qrows.append((qid, title, pid, DEPT_SALES, d, until, st, tot, tax, memo, "", sp, sp, *item_cols(*ln)))
QHEAD = ["id", "title", "partnerId", "companyDepartment", "quoteDate", "validUntil", "status", "totalAmount", "taxAmount", "memo", "terms",
         "updatedBy", "inputPersonEmployeeNumber", "itemId", "itemName", "inputType", "quantity", "unitPrice", "unitCode", "taxCategoryCode", "itemMemo"]
write("quotes_import_sample.csv", QHEAD, qrows)

SO = [  # id, title, partner, sourceQuote, date, status, sales, lines, memo
    ("SO-2026-0001", "サンプル設備導入(製品X)", "CUST-0001", "QT-2026-0001-1", "2026-08-10", "APPROVED", "EMP0002",
     [("ITEM-2001", 30, 11000), ("ITEM-2004", 10, 3500), ("ITEM-9001", 8, 6000)], "見積QT-2026-0001-1からの受注"),
    ("SO-2026-0002", "製品Y 納入", "CUST-0002", "QT-2026-0002-1", "2026-08-15", "APPROVED", "EMP0003",
     [("ITEM-2002", 10, 23500), ("ITEM-9003", 1, 1500)], "見積QT-2026-0002-1からの受注"),
    ("SO-2026-0003", "商品P・Q 納入", "CUST-0005", "QT-2026-0005-1", "2026-08-24", "APPROVED", "EMP0004",
     [("ITEM-3001", 20, 1700)], "見積QT-2026-0005-1の一部(商品P)を受注"),
    ("SO-2026-0004", "製品Z 追加受注(下書き)", "CUST-0003", "", "2026-09-02", "DRAFT", "EMP0003",
     [("ITEM-2003", 15, 8000)], "見積を経由しない直接受注(承認申請前)"),
]
srows = []
for sid, title, pid, sq, d, st, sp, lines, memo in SO:
    tot, tax = totals(lines)
    for ln in lines:
        it = item_cols(*ln)
        srows.append((sid, title, pid, sq, DEPT_SALES, d, st, tot, tax, memo, "", sp, sp, it[0], it[1], "", it[2], it[3], it[4], it[5], it[6], it[7]))
SHEAD = ["id", "title", "partnerId", "sourceQuoteId", "companyDepartment", "orderDate", "status", "totalAmount", "taxAmount", "memo", "terms",
         "updatedBy", "inputPersonEmployeeNumber", "itemId", "itemName", "sourceQuoteItemId", "inputType", "quantity", "unitPrice", "unitCode",
         "taxCategoryCode", "itemMemo"]
write("sales_orders_import_sample.csv", SHEAD, srows)

INV = [  # id, title, partner, order, date, status, doctype, original, billing, sales, lines, memo
    ("SI-2026-0001", "サンプル設備導入 売上", "CUST-0001", "SO-2026-0001", "2026-08-25", "APPROVED", "SALE", "", "BILLED", "EMP0002",
     [("ITEM-2001", 30, 11000), ("ITEM-2004", 10, 3500), ("ITEM-9001", 8, 6000)], "全量を売上計上し請求済み"),
    ("SI-2026-0002", "製品Y 売上", "CUST-0002", "SO-2026-0002", "2026-08-26", "APPROVED", "SALE", "", "BILLED", "EMP0003",
     [("ITEM-2002", 10, 23500), ("ITEM-9003", 1, 1500)], "全量を売上計上し請求済み"),
    ("SI-2026-0003", "商品P 売上(分納1回目)", "CUST-0005", "SO-2026-0003", "2026-08-28", "APPROVED", "SALE", "", "UNBILLED", "EMP0004",
     [("ITEM-3001", 12, 1700)], "受注数量20のうち12を売上計上(分納)。未請求"),
    ("SI-2026-0004", "設置作業の値引", "CUST-0001", "", "2026-08-30", "APPROVED", "DISCOUNT", "SI-2026-0001", "UNBILLED", "EMP0002",
     [("ITEM-9001", 1, 6000)], "値引の赤伝(金額は正で入力し、区分で減算として扱われる)。元の売上を指定"),
    ("SI-2026-0005", "製品Z 売上(下書き)", "CUST-0003", "", "2026-09-03", "DRAFT", "SALE", "", "UNBILLED", "EMP0003",
     [("ITEM-2003", 5, 8000)], "受注を経由しない直接の売上(承認申請前)"),
]
irows = []
inv_total = {}
for iid, title, pid, so, d, st, dt, orig, bs, sp, lines, memo in INV:
    tot, tax = totals(lines)
    inv_total[iid] = (tot, tax)
    for ln in lines:
        it = item_cols(*ln)
        irows.append((iid, title, pid, so, DEPT_SALES, d, st, dt, orig, tot, tax, memo, bs, sp, sp, it[0], it[1], "MASTER", "", it[3], it[4], it[5], it[6], it[7]))
IHEAD = ["id", "title", "partnerId", "salesOrderId", "companyDepartment", "invoiceDate", "status", "documentType", "originalInvoiceId", "totalAmount",
         "taxAmount", "memo", "billingStatus", "salesPersonEmployeeNumber", "inputPersonEmployeeNumber", "itemId", "itemName", "inputType",
         "sourceOrderItemId", "quantity", "unitPrice", "unitCode", "taxCategoryCode", "itemMemo"]
write("sales_invoices_import_sample.csv", IHEAD, irows)

BILL = [  # id, title, partner, date, mode, status, invoices, recon status, memo
    ("BL-2026-0001", "8月分 請求(サンプル得意先A)", "CUST-0001", "2026-08-31", "PERIODIC", "ISSUED", ["SI-2026-0001"], "RECONCILED", "月末締めの請求。入金消込済み"),
    ("BL-2026-0002", "製品Y 請求(サンプル得意先B)", "CUST-0002", "2026-08-31", "PER_TRANSACTION", "ISSUED", ["SI-2026-0002"], "PARTIALLY_RECONCILED", "都度請求。一部のみ入金済み"),
]
RECEIPT_ROWS = [
    ("BL-2026-0001", "2026-09-25", inv_total["SI-2026-0001"][0], "BANK_TRANSFER", "全額入金"),
    ("BL-2026-0002", "2026-09-20", 100000, "BANK_TRANSFER", "内金の入金(残額は入金待ち)"),
]
rec_amt = {}
for b, _, amt, _, _ in RECEIPT_ROWS:
    rec_amt[b] = rec_amt.get(b, 0) + amt
brows = []
for bid, title, pid, d, mode, st, invs, rs, memo in BILL:
    tot = sum(inv_total[i][0] for i in invs)
    tax = sum(inv_total[i][1] for i in invs)
    for n, i in enumerate(invs):
        brows.append((bid, title, pid, d, mode, "2026-08-01" if mode == "PERIODIC" else "", "2026-08-31" if mode == "PERIODIC" else "", st, tot, tax,
                      rec_amt.get(bid, 0), rs, memo, i, inv_total[i][0], inv_total[i][1]))
write("billing_import_sample.csv",
      ["id", "title", "partnerId", "billingDate", "mode", "periodStart", "periodEnd", "status", "totalAmount", "taxAmount", "reconciledAmount",
       "reconciliationStatus", "memo", "salesInvoiceId", "itemAmount", "itemTaxAmount"], brows)
write("billing_payment_receipts_import_sample.csv", ["billingHeaderId", "receivedDate", "amount", "method", "memo"], RECEIPT_ROWS)

# ---------------------------------------------------------------- 購買: 購買申請 → 発注 → 仕入 → 支払
PRQ = [  # id, title, dept, applicant, type, status, partner, project, lines(item,qty,price), memo
    ("PR-2026-0001", "原材料Aの定期購入", "0031", "EMP0006", "ONE_TIME", "APPROVED", "SUPP-0001", "", [("ITEM-1001", 300, 1100)], "承認済み。発注PO-2026-0001につながる"),
    ("PR-2026-0002", "制御基板の追加購入", "0031", "EMP0006", "ONE_TIME", "APPROVED", "SUPP-0002", "PRJ-2026-003", [("ITEM-1003", 100, 2300)], "新製品開発用(プロジェクトに紐づけ)。発注PO-2026-0002につながる"),
    ("PR-2026-0003", "梱包資材の前払購入", "0031", "EMP0005", "PREPAYMENT", "DRAFT", "SUPP-0003", "", [("ITEM-1004", 500, 130)], "前払が必要な購入(承認申請前)"),
]
prows = []
for rid, title, dept, app, rt, st, pid, prj, lines, memo in PRQ:
    tot, tax = totals(lines)
    for ln in lines:
        it = item_cols(ln[0], ln[1], ln[2])
        prows.append((rid, title, dept, app, app, rt, st, pid, "", "MASTER", "5101", prj, tot, tax, memo, it[0], it[1], "MASTER", it[3], it[4], it[5], it[6], ""))
write("purchase_requisitions_import_sample.csv",
      ["id", "title", "departmentSurrogateId", "applicantId", "inputPersonEmployeeNumber", "requestType", "status", "partnerId", "partnerName",
       "partnerInputType", "accountCode", "projectId", "totalAmount", "taxAmount", "memo", "itemId", "itemName", "inputType", "quantity",
       "estimatedUnitPrice", "unitCode", "taxCategoryCode", "itemMemo"], prows)

CO = dict(companyName="サンプル株式会社", companyDepartment="購買部", companyAddress="東京都サンプル区サンプル町1-1-1", companyTel="03-0000-0000", companyFax="03-0000-0009")
PO = [  # id, request, partner, title, date, status, delivery, place, terms, buyer, isPaid, lines, memo
    ("PO-2026-0001", "PR-2026-0001", "SUPP-0001", "原材料A 定期発注", "2026-08-01", "APPROVED", "2026-08-03", "第二倉庫(自社・冷蔵)", "振込払(20日締め翌月20日払い)", "EMP0006", "FALSE",
     [("ITEM-1001", 300, 1100)], "月次の定期発注分"),
    ("PO-2026-0002", "PR-2026-0002", "SUPP-0002", "制御基板 追加発注", "2026-08-03", "APPROVED", "2026-08-04", "第一倉庫(自社・常温)", "振込払(月末締め翌月末払い)", "EMP0006", "FALSE",
     [("ITEM-1003", 100, 2300)], "新製品開発用の前倒し発注"),
    ("PO-2026-0003", "", "SUPP-0004", "商品P・Q 発注", "2026-08-05", "APPROVED", "2026-08-05", "第一倉庫(自社・常温)", "振込払", "EMP0005", "TRUE",
     [("ITEM-3001", 100, 1100), ("ITEM-3002", 60, 1600)], "購買申請を経由しない発注。前払済み(isPaid)の例"),
    ("PO-2026-0004", "", "SUPP-0003", "梱包資材 発注(下書き)", "2026-09-02", "DRAFT", "2026-09-15", "第二倉庫(自社・冷蔵)", "振込払", "EMP0005", "FALSE",
     [("ITEM-1004", 500, 130)], "発注前の下書き"),
]
porows = []
po_total = {}
for pid_, req, sup, title, d, st, dd, place, terms, buyer, paid, lines, memo in PO:
    tot, tax = totals(lines)
    po_total[pid_] = (tot, tax)
    for ln in lines:
        it = item_cols(*ln)
        porows.append((pid_, req, sup, title, d, st, "5101", tot, tax, memo, CO["companyName"], CO["companyDepartment"], CO["companyAddress"], CO["companyTel"],
                       CO["companyFax"], dd, place, terms, buyer, buyer, paid, it[0], it[1], "MASTER", it[3], it[4], it[5], it[6], ""))
write("purchase_orders_import_sample.csv",
      ["id", "requestId", "partnerId", "title", "orderDate", "status", "accountCode", "totalAmount", "taxAmount", "memo", "companyName", "companyDepartment",
       "companyAddress", "companyTel", "companyFax", "deliveryDate", "deliveryPlace", "paymentTerms", "purchasePersonEmployeeNumber",
       "inputPersonEmployeeNumber", "isPaid", "itemId", "itemName", "inputType", "quantity", "unitPrice", "unitCode", "taxCategoryCode", "itemMemo"], porows)

RC = [  # id, title, partner, order, date, status, doctype, original, payStatus, buyer, lines, memo
    ("PC-2026-0001", "原材料A 仕入", "SUPP-0001", "PO-2026-0001", "2026-08-31", "APPROVED", "PURCHASE", "", "PAID", "EMP0006", [("ITEM-1001", 300, 1100)], "入庫済みの全量を仕入計上。支払済み"),
    ("PC-2026-0002", "制御基板 仕入", "SUPP-0002", "PO-2026-0002", "2026-08-31", "APPROVED", "PURCHASE", "", "UNPAID", "EMP0006", [("ITEM-1003", 100, 2300)], "全量を仕入計上。未払い"),
    ("PC-2026-0003", "制御基板 返品", "SUPP-0002", "", "2026-09-01", "APPROVED", "RETURN", "PC-2026-0002", "UNPAID", "EMP0006", [("ITEM-1003", 5, 2300)], "仕様違いの返品(赤伝)。元の仕入を指定"),
    ("PC-2026-0004", "商品P・Q 仕入(下書き)", "SUPP-0004", "PO-2026-0003", "2026-09-03", "DRAFT", "PURCHASE", "", "UNPAID", "EMP0005", [("ITEM-3001", 100, 1100), ("ITEM-3002", 60, 1600)], "前払済みの発注に対する仕入(承認申請前)"),
]
rrows = []
rc_total = {}
for rid, title, sup, order, d, st, dt, orig, ps, buyer, lines, memo in RC:
    tot, tax = totals(lines)
    rc_total[rid] = (tot, tax)
    for ln in lines:
        it = item_cols(*ln)
        rrows.append((rid, title, sup, order, "0031", d, st, dt, orig, tot, tax, memo, ps, buyer, buyer, it[0], it[1], "MASTER", "", it[3], it[4], it[5], it[6], ""))
write("purchase_recognitions_import_sample.csv",
      ["id", "title", "partnerId", "orderId", "companyDepartment", "recognitionDate", "status", "documentType", "originalRecognitionId", "totalAmount", "taxAmount",
       "memo", "paymentStatus", "purchasePersonEmployeeNumber", "inputPersonEmployeeNumber", "itemId", "itemName", "inputType", "sourceOrderItemId",
       "quantity", "unitPrice", "unitCode", "taxCategoryCode", "itemMemo"], rrows)

PAY = [("PAY-2026-0001", "原材料A 支払", "SUPP-0001", "2026-09-20", "PER_TRANSACTION", "ISSUED", ["PC-2026-0001"], "RECONCILED", "20日締めの支払。消込済み")]
DISB = [("PAY-2026-0001", "2026-09-20", rc_total["PC-2026-0001"][0], "BANK_TRANSFER", "全額を銀行振込で支払")]
disb_amt = {}
for p, _, a, _, _ in DISB:
    disb_amt[p] = disb_amt.get(p, 0) + a
payrows = []
for pid_, title, sup, d, mode, st, recs, rs, memo in PAY:
    tot = sum(rc_total[r][0] for r in recs)
    tax = sum(rc_total[r][1] for r in recs)
    for r in recs:
        payrows.append((pid_, title, sup, d, mode, "", "", st, tot, tax, disb_amt.get(pid_, 0), rs, memo, r, rc_total[r][0], rc_total[r][1]))
write("purchase_payments_import_sample.csv",
      ["id", "title", "partnerId", "paymentDate", "mode", "periodStart", "periodEnd", "status", "totalAmount", "taxAmount", "reconciledAmount",
       "reconciliationStatus", "memo", "purchaseRecognitionId", "itemAmount", "itemTaxAmount"], payrows)
write("purchase_payment_disbursements_import_sample.csv", ["paymentHeaderId", "paidDate", "amount", "method", "memo"], DISB)

# ---------------------------------------------------------------- 商談(1商談を複数行に展開。面談者・タスクは行ごとに1件まで)
DH = ["groupKey", "dealId", "partnerId", "title", "dealDate", "startTime", "endTime", "location", "memo", "status", "ownerEmployeeNumber", "quoteIds",
      "attendeeKind", "attendeeValue", "attendeeNote", "taskTitle", "taskDueDate", "taskAssigneeEmployeeNumber", "taskIsDone"]
E = [""] * 11


def deal(key, partner, title, date, st, et, loc, memo, status, owner, quotes, attendees, tasks):
    rows = []
    n = max(1, len(attendees), len(tasks))
    for i in range(n):
        head = [key, "", partner, title, date, st, et, loc, memo, status, owner, quotes] if i == 0 else [key] + [""] * 11
        a = list(attendees[i]) if i < len(attendees) else ["", "", ""]
        t = list(tasks[i]) if i < len(tasks) else ["", "", "", ""]
        rows.append(head + a + t)
    return rows


DEAL_ROWS = []
DEAL_ROWS += deal("D1", "PROS-0001", "初回ヒアリング", "2026-08-10", "10:00", "11:30", "先方本社 会議室",
                  "現状の課題と予算感をヒアリング。\r\n次回までに製品Xの見積を提示する。", "OPEN", "EMP0004", "",
                  [("PARTNER_CONTACT", "見込客 一郎", ""), ("PARTNER_CONTACT", "見込客 二郎", "決裁に関わる"), ("EMPLOYEE", "EMP0002", "同席(課長)")],
                  [("見積の作成", "2026-08-17", "EMP0004", "1"), ("製品Xのカタログ送付", "2026-08-12", "EMP0004", "1")])
DEAL_ROWS += deal("D2", "PROS-0001", "見積提示・デモ", "2026-08-24", "14:00", "15:30", "オンライン",
                  "見積QT-2026-0004-1を提示し、製品Xのデモを実施。価格の再検討を依頼された。", "OPEN", "EMP0004", "QT-2026-0004-1",
                  [("PARTNER_CONTACT", "見込客 一郎", ""), ("FREE", "先方の情報システム担当", "オンライン参加"), ("EMPLOYEE", "EMP0011", "デモ担当")],
                  [("値引き条件の社内確認", "2026-09-05", "EMP0002", "0"), ("導入スケジュール案の作成", "2026-09-08", "EMP0004", "0")])
DEAL_ROWS += deal("D3", "PROS-0002", "初回面談(電話)", "2026-09-01", "16:00", "16:30", "電話",
                  "展示会で名刺交換した先。製品Zに関心あり。", "OPEN", "EMP0003", "",
                  [("PARTNER_CONTACT", "見込客 花子", "")],
                  [("資料送付", "2026-09-03", "EMP0003", "1"), ("訪問日程の調整", "2026-09-10", "EMP0003", "0")])
DEAL_ROWS += deal("D4", "CUST-0001", "追加導入のご相談", "2026-09-05", "11:00", "12:00", "得意先A 本社",
                  "既存の導入案件に続く追加導入の相談。製品Yを検討中。", "WON", "EMP0002", "",
                  [("PARTNER_CONTACT", "得意先 一郎", ""), ("EMPLOYEE", "EMP0001", "同席(部長)")],
                  [("受注登録", "2026-09-12", "EMP0002", "0")])
write("sales_deals_import_sample.csv", DH, DEAL_ROWS)

# ---------------------------------------------------------------- 進捗確認: 工程ごとの既定担当
OWNERS = [
    ("quote", "見積", "USER", "EMP0002", "佐藤 花子"),
    ("sales_order", "受注", "USER", "EMP0003", "鈴木 一郎"),
    ("purchase_request", "購買申請", "ROLE", "manager", "課長"),
    ("purchase_order", "発注", "USER", "EMP0005", "田中 健太"),
    ("receipt_instruction", "入荷", "USER", "EMP0007", "渡辺 大輔"),
    ("item_receipt", "入庫", "USER", "EMP0008", "中村 さくら"),
    ("purchase_recognition", "仕入", "USER", "EMP0006", "伊藤 由美"),
    ("shipment_instruction", "出荷", "DEPT_ROLE", "0041:manager", "倉庫管理課 / 課長"),  # 部門+ロールは「部署コード:ロールID」で指定
    ("item_shipment", "出庫", "USER", "EMP0008", "中村 さくら"),
    ("sales_invoice", "売上", "USER", "EMP0004", "高橋 美咲"),
    ("billing", "請求", "ROLE", "finance_checker", "経理確認者"),
    ("payment", "支払", "USER", "EMP0009", "小林 誠"),
]
write("progress_stage_owners_import_sample.csv", ["stageKey", "stageLabel", "assigneeType", "assigneeRef", "assigneeName"], OWNERS)
