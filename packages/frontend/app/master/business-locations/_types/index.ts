export interface BusinessLocationRecord {
  id: string;
  name: string;
  postalCode: string | null;
  address: string | null;
  phoneNumber: string | null;
  // REQ-003: 見積・受注・売上に展開する自社の FAX
  faxNumber?: string | null;
  status: string;
  memo: string | null;
}
