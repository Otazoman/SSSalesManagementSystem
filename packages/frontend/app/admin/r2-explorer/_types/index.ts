export interface R2BucketOption {
  key: string;
  label: string;
}

export interface R2ExplorerItem {
  name: string;
  path: string;
  type: "folder" | "file";
  size?: number;
  contentType?: string;
  uploaded?: string;
}

export interface R2ListResult {
  currentPrefix: string;
  parentPrefix: string | null;
  items: R2ExplorerItem[];
}
