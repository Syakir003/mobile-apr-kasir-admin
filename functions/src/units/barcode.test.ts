import { describe, it, expect } from "vitest";
import { formatBarcode } from "./barcode";

describe("formatBarcode", () => {
  it("membentuk ACUNIT-YYYYMMDD-XXXX dengan seq pad 4", () => {
    expect(formatBarcode(new Date(2026, 6, 6), 1)).toBe("ACUNIT-20260706-0001");
  });
  it("seq 4 digit tampil tanpa pad ekstra", () => {
    expect(formatBarcode(new Date(2026, 6, 6), 1234)).toBe("ACUNIT-20260706-1234");
  });
});
