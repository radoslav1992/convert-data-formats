export interface ConvertResult {
  text?: string;
  bytes?: Uint8Array;
  blob?: Blob;
  warnings: string[];
  meta?: { rows?: number; columns?: number; sheets?: string[]; sheet?: string; delimiter?: string; delimiterName?: string; documents?: number; bom?: boolean };
  table?: { columns: string[]; rows: unknown[][] };
  stats: { inputBytes: number; outputBytes: number; rows?: number; columns?: number; ms: number };
}

export interface ConvertErrorLike {
  message: string;
  code?: string;
  line?: number;
  column?: number;
  display?: string;
}
