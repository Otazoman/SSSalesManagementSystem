import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BusinessLocationSelect, buildCompanyInfo } from "./BusinessLocationSelect";

// REQ-003: 営業拠点から自社情報を展開する
const company = {
  company_name: "サンプル株式会社",
  company_zip: "000-0001",
  company_address: "本社の住所",
  company_tel: "00-0000-0001",
  company_fax: "00-0000-0002",
};
const osaka = { id: "BL-1", name: "大阪営業所", postalCode: "000-0010", address: "大阪の住所", phoneNumber: "00-1111-0001", faxNumber: null };

describe("buildCompanyInfo", () => {
  it("拠点を選ぶと会社名は「会社名 拠点名」、住所などは拠点の値(登録の無い項目は会社マスタの値)", () => {
    expect(buildCompanyInfo(company, osaka)).toEqual({
      companyName: "サンプル株式会社 大阪営業所",
      companyZip: "000-0010",
      companyAddress: "大阪の住所",
      companyTel: "00-1111-0001",
      companyFax: "00-0000-0002",
    });
  });

  it("拠点を選ばなければ会社マスタの値", () => {
    expect(buildCompanyInfo(company, null)).toEqual({
      companyName: "サンプル株式会社",
      companyZip: "000-0001",
      companyAddress: "本社の住所",
      companyTel: "00-0000-0001",
      companyFax: "00-0000-0002",
    });
  });
});

describe("BusinessLocationSelect", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("拠点を選ぶと展開した値を渡し、選択しないに戻すと会社マスタの値を渡す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.toString().includes("business-locations") ? [osaka] : company;
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    const onApply = vi.fn();
    render(<BusinessLocationSelect onApply={onApply} />);
    const select = screen.getByLabelText("営業拠点");
    await waitFor(() => expect(select).not.toBeDisabled());
    await waitFor(() => expect(screen.getByRole("option", { name: "大阪営業所" })).toBeInTheDocument());

    fireEvent.change(select, { target: { value: "BL-1" } });
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ companyName: "サンプル株式会社 大阪営業所" }));
    fireEvent.change(select, { target: { value: "" } });
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ companyName: "サンプル株式会社", companyAddress: "本社の住所" }));
  });
});
