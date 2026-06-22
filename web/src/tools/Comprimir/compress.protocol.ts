export type CompressLevel = "baja" | "media" | "alta";

export const COMPRESS_LEVELS: CompressLevel[] = ["baja", "media", "alta"];

export const DEFAULT_COMPRESS_LEVEL: CompressLevel = "media";

export type CompressRequest = {
  type: "compress";
  bytes: Uint8Array;
  level: CompressLevel;
};

export type CompressResponse =
  | { type: "progress"; pct: number }
  | { type: "complete"; bytes: Uint8Array }
  | { type: "error"; message: string };