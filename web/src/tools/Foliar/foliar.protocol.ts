import type { FoliarConfig } from "../../lib/foliar/types";

export type ProcessRequest = {
  type: "process";
  fileBytes: Uint8Array;
  config: FoliarConfig;
};

export type CancelRequest = { type: "cancel" };

export type FoliarRequest = ProcessRequest | CancelRequest;

export type ProgressMessage = { type: "progress"; current: number; total: number };
export type CompleteMessage = { type: "complete"; bytes: Uint8Array };
export type CancelledMessage = { type: "cancelled" };
export type ErrorMessage = { type: "error"; message: string };

export type FoliarResponse = ProgressMessage | CompleteMessage | CancelledMessage | ErrorMessage;
