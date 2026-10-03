import { Context } from "hono";
import { PaymentRepository } from "./payment.repository";
import { PartnersRepository } from "../../master/partners/partners.repository";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import {
  generateZenginTransferFile,
  ZenginTransferHeaderInput,
  ZenginTransferLineInput,
  AccountType,
} from "../../../platform/firm-banking/generate-zengin-transfer-file";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { RESOURCE_KEY } from "./payment-constants";
import { Env } from "../../../types/env";

function toAccountType(value: unknown): AccountType {
  return value === "CURRENT" ? "CURRENT" : "ORDINARY";
}

// ファームバンキング: 選択した支払(payment_headers)を対象に、全銀協会「総合振込」フォーマットの
// 振込データファイルを生成する。金額は各ヘッダーの残額(totalAmount - reconciledAmount)を使う
// (既に一部手動消込済みの支払は、残りの未払分のみを振込対象にする)。
// CORSの都合上(exposeHeaders未設定のため、フロント側はfetchでカスタムレスポンスヘッダーを
// 読めない)、件数・金額・警告はファイル生成前にpreview()で別途JSON確認できるようにする
export class PaymentFirmBankingService {
  constructor(private repo: PaymentRepository) {}

  private async resolveHeaderAndLines(c: Context<{ Bindings: Env }>, paymentHeaderIds: string[]) {
    const settings = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const requiredFields: [string, string][] = [
      ["fb_committer_code", "委託者コード"],
      ["fb_bank_code", "仕向銀行番号"],
      ["fb_branch_code", "仕向支店番号"],
      ["fb_account_number", "自社口座番号"],
    ];
    const missing = requiredFields.filter(([key]) => !settings[key]);
    if (missing.length > 0) {
      throw new BadRequestError(
        `会社設定にファームバンキング用の自社口座情報が未設定です(${missing.map(([, label]) => label).join("・")})。管理者にご確認ください。`,
      );
    }

    const headers = await this.repo.findHeadersByIds(paymentHeaderIds);
    if (headers.length !== paymentHeaderIds.length) {
      throw new NotFoundError("指定された支払の一部が見つかりません");
    }

    const partnersRepo = new PartnersRepository(c.env.DB);
    const lines: ZenginTransferLineInput[] = [];
    const errors: string[] = [];

    for (const header of headers) {
      const remaining = header.totalAmount - header.reconciledAmount;
      if (remaining <= 0) {
        errors.push(`支払[${header.id}]は既に全額消込済みのため振込対象にできません`);
        continue;
      }

      const partner = await this.repo.findPartnerById(header.partnerId);
      if (!partner) {
        errors.push(`支払[${header.id}]の取引先が見つかりません`);
        continue;
      }

      const bankAccounts = await partnersRepo.findBankAccountsByPartnerId(header.partnerId);
      const account = bankAccounts.find((a) => a.isDefault) ?? bankAccounts[0];
      if (!account) {
        errors.push(`取引先[${partner.name}](支払[${header.id}])に振込先口座が登録されていません`);
        continue;
      }

      lines.push({
        partnerId: header.partnerId,
        bankCode: account.bankCode || "",
        bankName: account.bankName,
        branchCode: account.branchCode || "",
        branchName: account.branchName,
        accountType: toAccountType(account.accountType),
        accountNumber: account.accountNumber,
        accountHolderName: account.accountHolderName,
        amount: remaining,
      });
    }

    if (errors.length > 0) {
      throw new BadRequestError(`以下の理由により振込データを作成できません:\n${errors.join("\n")}`);
    }

    return { settings, lines };
  }

  private buildHeaderInput(settings: Record<string, any>, transferDate: string): ZenginTransferHeaderInput {
    return {
      committerCode: String(settings.fb_committer_code || ""),
      committerName: String(settings.fb_committer_name || ""),
      transferDate: new Date(transferDate),
      bankCode: String(settings.fb_bank_code || ""),
      bankName: String(settings.fb_bank_name || ""),
      branchCode: String(settings.fb_branch_code || ""),
      branchName: String(settings.fb_branch_name || ""),
      accountType: toAccountType(settings.fb_account_type),
      accountNumber: String(settings.fb_account_number || ""),
    };
  }

  // ファイル生成前の確認用(対象件数・合計金額・変換警告をJSONで返す。ファイルはまだ作らない)
  async previewTransferFile(
    c: Context<{ Bindings: Env }>,
    paymentHeaderIds: string[],
    transferDate: string,
  ) {
    const { settings, lines } = await this.resolveHeaderAndLines(c, paymentHeaderIds);
    const headerInput = this.buildHeaderInput(settings, transferDate);
    const result = generateZenginTransferFile(headerInput, lines);

    return {
      recordCount: result.recordCount,
      totalAmount: result.totalAmount,
      warnings: result.warnings,
      lines: lines.map((l) => ({ partnerId: l.partnerId, amount: l.amount })),
    };
  }

  async exportTransferFile(
    c: Context<{ Bindings: Env }>,
    paymentHeaderIds: string[],
    transferDate: string,
  ) {
    const { settings, lines } = await this.resolveHeaderAndLines(c, paymentHeaderIds);
    const headerInput = this.buildHeaderInput(settings, transferDate);
    const result = generateZenginTransferFile(headerInput, lines);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_PAYMENT_FIRM_BANKING_FILE", RESOURCE_KEY, "BULK_OPERATION", null, {
        paymentHeaderIds,
        recordCount: result.recordCount,
        totalAmount: result.totalAmount,
        warnings: result.warnings,
      }),
    );

    return result;
  }
}
