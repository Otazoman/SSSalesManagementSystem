export interface TaxCategoryRecord {
  code: string;
  name: string;
  taxType: "EXEMPT" | "STANDARD" | "VARIABLE";
  taxRate: number;
  validFrom: string | null;
  validTo: string | null;
}
