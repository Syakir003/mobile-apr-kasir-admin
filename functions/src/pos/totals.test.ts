import { describe, it, expect } from "vitest";
import { computeTotals } from "./totals";

describe("computeTotals", () => {
  it("hitung tanpa diskon dan pajak", () => {
    const result = computeTotals(
      [{ qty: 2, unitPrice: 10000 }],
      0,
      0,
      0
    );
    expect(result).toEqual({
      subtotal: 20000,
      taxAmount: 0,
      grandTotal: 20000,
    });
  });

  it("hitung dengan diskon + pajak 11% + transport (transport tidak kena pajak)", () => {
    // Subtotal: (1 × 100000) = 100000
    // Diskon: 10000
    // TaxBase: 100000 - 10000 = 90000
    // TaxAmount: round(90000 * 11 / 100) = round(9900) = 9900
    // Transport: 5000 (tidak kena pajak)
    // GrandTotal: 90000 + 9900 + 5000 = 104900
    const result = computeTotals(
      [{ qty: 1, unitPrice: 100000 }],
      10000,
      11,
      5000
    );
    expect(result).toEqual({
      subtotal: 100000,
      taxAmount: 9900,
      grandTotal: 104900,
    });
  });

  it("qty pecahan: 2.5 m × 15000 = 37500", () => {
    // lineTotal: round(2.5 × 15000) = round(37500) = 37500
    // Subtotal: 37500
    // TaxBase: 37500 - 0 = 37500
    // TaxAmount: round(37500 * 0 / 100) = 0
    // GrandTotal: 37500 + 0 + 0 = 37500
    const result = computeTotals(
      [{ qty: 2.5, unitPrice: 15000 }],
      0,
      0,
      0
    );
    expect(result).toEqual({
      subtotal: 37500,
      taxAmount: 0,
      grandTotal: 37500,
    });
  });
});
