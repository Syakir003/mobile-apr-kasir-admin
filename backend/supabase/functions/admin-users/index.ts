// =============================================================================
// Edge Function: admin-users
//
// Membuat akun baru & mereset password — dua operasi yang WAJIB lewat
// service_role karena menulis ke skema `auth`, dan service_role tidak boleh
// ikut ke dalam aplikasi. Perubahan peran / status aktif TIDAK di sini: itu
// ditangani RPC `update_user_account` (migrasi 0017) yang sudah punya penjaga
// "minimal satu admin aktif".
//
// Otorisasi: pemanggil harus login DAN ber-peran admin. Token pemanggil dibaca
// dari header Authorization (supabase.functions.invoke mengirimnya otomatis),
// lalu perannya dicek ke `public.users` — bukan dari klaim JWT saja, supaya
// admin yang baru dinonaktifkan langsung kehilangan akses.
//
// Env yang dipakai (otomatis tersedia di runtime Supabase):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//
// Payload:
//   { action: "create", email, password, displayName?, role }
//   { action: "resetPassword", userId, password }
// =============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROLES = ["admin", "kasir", "teknisi"];

function fail(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function ok(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("Metode tidak didukung", 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // --- 1. Identitas pemanggil dari token-nya sendiri ---------------------
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return fail("Belum login", 401);

    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: caller, error: callerErr } = await asCaller.auth.getUser();
    if (callerErr || !caller?.user) return fail("Sesi tidak valid", 401);

    // --- 2. Peran dicek ke tabel, bukan ke klaim JWT -----------------------
    const admin = createClient(url, serviceKey);
    const { data: profile, error: profileErr } = await admin
      .from("users")
      .select("role, active")
      .eq("id", caller.user.id)
      .maybeSingle();
    if (profileErr) throw profileErr;
    if (!profile?.active || profile.role !== "admin") {
      return fail("Hanya Admin yang boleh mengelola akun", 403);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return fail("Input kosong");
    const action = String(body.action ?? "");

    // --- 3a. Buat akun baru ------------------------------------------------
    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const role = String(body.role ?? "").trim();
      const displayName = String(body.displayName ?? "").trim();

      if (!email.includes("@")) return fail("Email tidak valid");
      if (password.length < 6) return fail("Password minimal 6 karakter");
      if (!ROLES.includes(role)) return fail("Peran harus admin/kasir/teknisi");

      const { data: created, error: createErr } = await admin.auth.admin
        .createUser({
          email,
          password,
          email_confirm: true, // tanpa SMTP: akun langsung bisa dipakai
          user_metadata: { display_name: displayName },
        });
      if (createErr) {
        const msg = /already|registered|exists/i.test(createErr.message)
          ? "Email sudah terdaftar"
          : createErr.message;
        return fail(msg, 409);
      }

      const newId = created.user.id;
      // Trigger handle_new_user sudah membuat baris profil dengan role default
      // 'kasir'; timpa dengan peran & nama yang diminta.
      const { error: updErr } = await admin
        .from("users")
        .update({ role, display_name: displayName, active: true })
        .eq("id", newId);
      if (updErr) {
        // Jangan tinggalkan akun auth yatim kalau profilnya gagal diset.
        await admin.auth.admin.deleteUser(newId);
        throw updErr;
      }

      await admin.from("audit_logs").insert({
        actor_uid: caller.user.id,
        action: "user.create",
        target: newId,
        detail: { email, role, displayName },
      });

      return ok({ ok: true, userId: newId, email, role });
    }

    // --- 3b. Reset password ------------------------------------------------
    if (action === "resetPassword") {
      const userId = String(body.userId ?? "").trim();
      const password = String(body.password ?? "");
      if (!userId) return fail("userId wajib diisi");
      if (password.length < 6) return fail("Password minimal 6 karakter");

      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        password,
      });
      if (updErr) return fail(updErr.message, 400);

      await admin.from("audit_logs").insert({
        actor_uid: caller.user.id,
        action: "user.reset_password",
        target: userId,
        detail: {},
      });

      return ok({ ok: true, userId });
    }

    return fail("Aksi tidak dikenal");
  } catch (e) {
    console.error(e);
    return fail(`Gagal: ${e instanceof Error ? e.message : e}`, 500);
  }
});
