import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "./types";

/**
 * Ambil role dari klaim JWT `user_role` (disisipkan hook
 * custom_access_token_hook). BUKAN dari query tabel — otorisasi menu berbasis
 * klaim; keamanan data tetap dijaga RLS di server.
 */
export async function getUserRole(
  supabase: SupabaseClient,
): Promise<Role | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return decodeRole(session.access_token);
}

function decodeRole(accessToken: string): Role | null {
  try {
    const payload = accessToken.split(".")[1];
    const json = JSON.parse(
      Buffer.from(payload, "base64").toString("utf-8"),
    ) as { user_role?: string };
    const r = json.user_role;
    return r === "admin" || r === "kasir" || r === "teknisi" ? r : null;
  } catch {
    return null;
  }
}

// ---- Menu per peran (mirror app/lib/core/widgets/adaptive_scaffold.dart) ----

export type MenuItem = { label: string; href: string; icon: string };

const dashboard: MenuItem = { label: "Dashboard", href: "/", icon: "grid" };
const pos: MenuItem = { label: "Transaksi", href: "/pos", icon: "cart" };
const riwayat: MenuItem = { label: "Riwayat", href: "/transaksi", icon: "receipt" };
const order: MenuItem = { label: "Order", href: "/orders", icon: "clipboard" };
const job: MenuItem = { label: "Job", href: "/jobs", icon: "wrench" };
const profil: MenuItem = { label: "Profil", href: "/profil", icon: "user" };
// Antrean pengingat servis WhatsApp — admin & kasir saja; RLS `wa_outbox`
// menutup data pelanggan dari teknisi.
const pengingat: MenuItem = {
  label: "Pengingat",
  href: "/pengingat",
  icon: "bell",
};

export function menuForRole(role: Role | null): MenuItem[] {
  switch (role) {
    case "admin":
      return [
        dashboard,
        pos,
        riwayat,
        { label: "Produk", href: "/produk", icon: "box" },
        { label: "Sparepart", href: "/sparepart", icon: "tool" },
        { label: "Jasa", href: "/jasa", icon: "service" },
        { label: "Paket", href: "/paket", icon: "package" },
        { label: "Member", href: "/member", icon: "users" },
        order,
        job,
        pengingat,
        profil,
      ];
    case "kasir":
      return [dashboard, pos, riwayat, order, pengingat, profil];
    case "teknisi":
      return [dashboard, job, { label: "Scan", href: "/scan", icon: "qr" }, profil];
    default:
      return [dashboard, profil];
  }
}
