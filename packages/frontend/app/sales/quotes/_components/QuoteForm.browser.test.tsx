import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuoteFormHeader } from "./QuoteFormHeader";
import { QuoteCompanyAndTermsFields } from "./QuoteCompanyAndTermsFields";
import { QuoteBasicFields } from "./QuoteBasicFields";
import { QuoteAttachmentsSection } from "./QuoteAttachmentsSection";
import { QuoteStatusAndActions } from "./QuoteStatusAndActions";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
} from "../../../../test-support/responsive";

// 実ブラウザ: 見積の入力フォームの各部品が、スマホ・タブレット・PCで横にはみ出さず、
// 見出しの操作ボタンは折り返し、主要ボタン(登録/保存)は指で押せる大きさ(スマホ44px以上)になる
const noop = () => {};
const long =
  "とても長い会社名・住所・ファイル名のサンプル文字列がここに入る場合でも折り返される".repeat(
    2,
  );

const attachments: any[] = [
  { storageType: "R2", fileName: long, attachmentR2Path: "x", id: "a1" },
  {
    storageType: "GOOGLE_DRIVE",
    fileName: "共有資料",
    externalUrl: "https://example.com/" + "a".repeat(120),
  },
];

function Form({ editing }: { editing: boolean }) {
  return (
    <form
      className="space-y-4 p-4 bg-white"
      onSubmit={(e) => e.preventDefault()}
    >
      <QuoteFormHeader
        editingId={editing ? "QT-20260901-001-2" : null}
        quoteId="QT-20260901-001-2"
        status="APPROVED"
        isMailSending={false}
        siblingVersions={
          editing
            ? ([
                { id: "QT-20260901-001-1" },
                { id: "QT-20260901-001-2" },
              ] as any)
            : []
        }
        onOpenEditForm={noop}
        onOpenMailModal={noop}
        onGeneratePDF={noop}
      />
      <QuoteCompanyAndTermsFields
        companyName={long}
        setCompanyName={noop}
        companyZip="100-0000"
        setCompanyZip={noop}
        companyAddress={long}
        setCompanyAddress={noop}
        companyTel="03-0000-0000"
        setCompanyTel={noop}
        companyFax="03-0000-0001"
        setCompanyFax={noop}
        deliveryDate="2026-10-01"
        setDeliveryDate={noop}
        deliveryPlace={long}
        setDeliveryPlace={noop}
        paymentTerms={long}
        setPaymentTerms={noop}
      />
      <QuoteBasicFields
        quoteId="QT-20260901-001-2"
        quoteTitle={long}
        setQuoteTitle={noop}
        customerId="P1"
        onPartnerChange={noop}
        partners={[{ id: "P1", name: long }] as any}
        quoteDate="2026-09-01"
        setQuoteDate={noop}
        validUntil="2026-09-30"
        setValidUntil={noop}
        salesPersonEmployeeNumber="E1"
        onSalesPersonChange={noop}
        userMaster={
          [{ id: "u1", name: "サンプル 太郎", employeeNumber: "E1" }] as any
        }
        salesPersonDepartment=""
        setSalesPersonDepartment={noop}
        departments={[]}
        inputPersonEmployeeNumber="E1"
        setInputPersonEmployeeNumber={noop}
        projectId=""
        setProjectId={noop}
        projects={[]}
      />
      <QuoteAttachmentsSection
        quoteId="QT-1"
        attachments={attachments}
        onAddAttachmentRow={noop}
        onRemoveAttachmentRow={noop}
        onFileSelection={noop}
        onFileNameChange={noop}
        onExternalUrlChange={noop}
      />
      <QuoteStatusAndActions
        memo=""
        setMemo={noop}
        status="DRAFT"
        setStatus={noop}
        isQuoteWfEnabled
        isSubmitting={false}
        editingId={editing ? "QT-20260901-001-2" : null}
        onSubmitRevisionUp={vi.fn()}
        onSubmitForApproval={noop}
        onSubmitApprovedEdit={noop}
      />
    </form>
  );
}

describe.each([
  ["phone", WIDTHS.phone, 800],
  ["tablet", WIDTHS.tablet, 1024],
  ["desktop", 990, 800],
] as const)("見積フォーム(%s)", (_n, width, height) => {
  it.each([[true], [false]])("編集=%s: 横にはみ出さない", async (editing) => {
    await setWidth(width, height);
    render(<Form editing={editing} />);
    expect(pageOverflowsHorizontally()).toBe(false);
  });

  it("ヘッダーの操作ボタンは、すべて画面幅の内側に収まる(折り返す)", async () => {
    await setWidth(width, height);
    render(<Form editing />);
    for (const name of [/見積書をメール送信/, /PDF見積書を発行/]) {
      const r = screen.getByRole("button", { name }).getBoundingClientRect();
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(width);
    }
  });
});

describe("見積フォームの操作ボタン(スマホ)", () => {
  it("登録/保存ボタンは高さ44px以上・全幅で縦に並び、統一の文言になる", async () => {
    await setWidth(WIDTHS.phone, 800);
    render(<Form editing />);
    const save = screen.getByRole("button", { name: "保存" });
    expect(save.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(save.getBoundingClientRect().width).toBeGreaterThan(300);
    const revision = screen.getByRole("button", { name: /新版として改定登録/ });
    expect(revision.getBoundingClientRect().top).toBeGreaterThan(
      save.getBoundingClientRect().top,
    ); // 縦積み
  });

  it("入力欄は16px以上(iOSの自動拡大を防ぐ)", async () => {
    await setWidth(WIDTHS.phone, 800);
    const { container } = render(<Form editing />);
    const fields = Array.from(
      container.querySelectorAll(
        "input:not([type=file]):not([type=checkbox]), select, textarea",
      ),
    );
    expect(fields.length).toBeGreaterThan(8);
    const small = fields.filter(
      (el) =>
        parseFloat(getComputedStyle(el).fontSize) < 16 &&
        el.closest(".flex.items-center.gap-1\\.5") === null,
    );
    expect(small.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
  });
});
