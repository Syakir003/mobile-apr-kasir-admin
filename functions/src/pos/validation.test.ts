import { describe, it, expect } from "vitest";
import { validateCheckoutInput, validateRecordPaymentInput } from "./validation";

function baseCustomer() {
  return { name: "Budi Santoso", phone: "0812-3456-7890", address: "Jl. Mawar No. 1" };
}

describe("validateCheckoutInput", () => {
  it("menerima input valid lengkap (item + jasa + pemasangan)", () => {
    const r = validateCheckoutInput({
      customer: baseCustomer(),
      items: [
        { kind: "product", refId: "prod1", qty: 2 },
        { kind: "service", refId: "srv1", qty: 1 },
      ],
      discount: 10000,
      taxPercent: 11,
      transportFee: 20000,
      notes: "Pasang di lantai 2",
      installations: [
        { itemIndex: 0, roomLocation: "Ruang Tamu", technicianId: "tek1" },
        { itemIndex: 0, roomLocation: "Kamar Utama" },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("menolak jika tanpa items", () => {
    const r = validateCheckoutInput({
      customer: baseCustomer(),
      items: [],
    });
    expect(r.ok).toBe(false);
  });

  it("menolak qty 0", () => {
    const r = validateCheckoutInput({
      customer: baseCustomer(),
      items: [{ kind: "product", refId: "prod1", qty: 0 }],
    });
    expect(r.ok).toBe(false);
  });

  it("menolak installations.itemIndex yang menunjuk item jasa", () => {
    const r = validateCheckoutInput({
      customer: baseCustomer(),
      items: [{ kind: "service", refId: "srv1", qty: 1 }],
      installations: [{ itemIndex: 0, roomLocation: "Ruang Tamu" }],
    });
    expect(r.ok).toBe(false);
  });

  it("menolak 3 entri installations untuk item dengan qty 2", () => {
    const r = validateCheckoutInput({
      customer: baseCustomer(),
      items: [{ kind: "product", refId: "prod1", qty: 2 }],
      installations: [
        { itemIndex: 0, roomLocation: "A" },
        { itemIndex: 0, roomLocation: "B" },
        { itemIndex: 0, roomLocation: "C" },
      ],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateRecordPaymentInput", () => {
  it("menerima input valid", () => {
    const r = validateRecordPaymentInput({
      invoiceId: "inv1",
      method: "tunai",
      amount: 50000,
      note: "Bayar DP",
    });
    expect(r.ok).toBe(true);
  });

  it("menolak amount 0", () => {
    const r = validateRecordPaymentInput({
      invoiceId: "inv1",
      method: "tunai",
      amount: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("menolak method 'kartu' (tidak dikenal)", () => {
    const r = validateRecordPaymentInput({
      invoiceId: "inv1",
      method: "kartu",
      amount: 50000,
    });
    expect(r.ok).toBe(false);
  });
});
