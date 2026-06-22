import { describe, it, expect } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it.each<[number, string]>([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024, "1.0 MB"],
    [1.4 * 1024 * 1024, "1.4 MB"],
    [17 * 1024 * 1024 + 384 * 1024, "17.4 MB"],
  ])("formats %i bytes as '%s'", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});
