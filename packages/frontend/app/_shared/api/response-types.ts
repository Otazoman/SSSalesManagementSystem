// Backendの platform/http/response.ts / pagination.ts と対称の型定義。
// 実装(fetch関数)はここには置かず、featureごとの_hooksか_shared/hooksに置く。

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiListResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}
