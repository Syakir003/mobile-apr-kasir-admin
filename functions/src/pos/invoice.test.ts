import { describe, it, expect } from "vitest";
import { formatInvoiceNumber, computeInvoiceStatus } from "./invoice";

describe("formatInvoiceNumber", () => {
  it("seq 1 menjadi INV-20260712-0001", () => {
    expect(formatInvoiceNumber(new Date(2026, 6, 12), 1)).toBe(
      "INV-20260712-0001"
    );
  });
  it("seq 1234 dengan pad 4 digit", () => {
    expect(formatInvoiceNumber(new Date(2026, 6, 12), 1234)).toBe(
      "INV-20260712-1234"
    );
  });
});

describe("computeInvoiceStatus", () => {
  it("grandTotal 100000, totalPaid 0 → belum_dibayar", () => {
    expect(computeInvoiceStatus(100000, 0)).toBe("belum_dibayar");
  });
  it("grandTotal 100000, totalPaid 40000 → dp", () => {
    expect(computeInvoiceStatus(100000, 40000)).toBe("dp");
  });
  it("grandTotal 100000, totalPaid 100000 → lunas", () => {
    expect(computeInvoiceStatus(100000, 100000)).toBe("lunas");
  });
  it("grandTotal 0, totalPaid 0 → lunas (termasuk grandTotal 0)", () => {
    expect(computeInvoiceStatus(0, 0)).toBe("lunas");
  });
});
