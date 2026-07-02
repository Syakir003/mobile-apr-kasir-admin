import { describe, it, expect } from "vitest";
import { validateManageUserInput } from "./validation";

describe("validateManageUserInput", () => {
  it("menerima input valid", () => {
    const r = validateManageUserInput({
      action: "create", email: "kasir@toko.id", password: "rahasia123",
      displayName: "Kasir Satu", role: "kasir",
    });
    expect(r.ok).toBe(true);
  });
  it("menolak role tidak dikenal", () => {
    const r = validateManageUserInput({
      action: "create", email: "a@b.c", password: "12345678",
      displayName: "X", role: "superadmin",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/role/i);
  });
  it("menolak password pendek saat create", () => {
    const r = validateManageUserInput({
      action: "create", email: "a@b.c", password: "123",
      displayName: "X", role: "teknisi",
    });
    expect(r.ok).toBe(false);
  });
  it("menerima disable tanpa password", () => {
    const r = validateManageUserInput({ action: "disable", uid: "abc123" });
    expect(r.ok).toBe(true);
  });
});
