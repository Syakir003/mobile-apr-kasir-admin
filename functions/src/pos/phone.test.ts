import { describe, it, expect } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("konversi 0812-3456-7890 ke +6281234567890", () => {
    expect(normalizePhone("0812-3456-7890")).toBe("+6281234567890");
  });
  it("konversi 6281234567890 ke +6281234567890", () => {
    expect(normalizePhone("6281234567890")).toBe("+6281234567890");
  });
  it("konversi +62 812-3456-7890 ke +6281234567890", () => {
    expect(normalizePhone("+62 812-3456-7890")).toBe("+6281234567890");
  });
  it("tetap 021 555 1234 tanpa +62 (telepon rumah)", () => {
    expect(normalizePhone("021 555 1234")).toBe("0215551234");
  });
});
