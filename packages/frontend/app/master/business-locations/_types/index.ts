export interface BusinessLocationRecord {
  id: string;
  name: string;
  postalCode: string | null;
  address: string | null;
  phoneNumber: string | null;
  status: string;
  memo: string | null;
}
