export type ManageUserInput = {
  action: "create" | "disable" | "enable";
  uid?: string;
  email?: string;
  password?: string;
  displayName?: string;
  role?: string;
};

export type ValidationResult =
  | { ok: true; value: ManageUserInput }
  | { ok: false; error: string };

const ROLES = ["admin", "kasir", "teknisi"] as const;

export function validateManageUserInput(input: ManageUserInput): ValidationResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Input kosong" };
  if (!["create", "disable", "enable"].includes(input.action))
    return { ok: false, error: "Action tidak dikenal" };

  if (input.action === "create") {
    if (!input.email || !/^\S+@\S+\.\S+$/.test(input.email))
      return { ok: false, error: "Email tidak valid" };
    if (!input.password || input.password.length < 8)
      return { ok: false, error: "Password minimal 8 karakter" };
    if (!input.displayName?.trim()) return { ok: false, error: "Nama wajib diisi" };
    if (!ROLES.includes(input.role as (typeof ROLES)[number]))
      return { ok: false, error: "Role harus admin/kasir/teknisi" };
  } else {
    if (!input.uid) return { ok: false, error: "uid wajib untuk disable/enable" };
  }
  return { ok: true, value: input };
}
