// =============================================================================
// Edge Function: send-wa
//
// Mengirim satu baris `wa_outbox` lewat WhatsApp. Strukturnya menyalin
// `send-push`: verifikasi secret bersama, kerjakan, tulis hasilnya balik.
//
// ADAPTER — dipilih dari app_config key `wa_adapter`:
//   'manual'    (default, fase sekarang)
//       Fungsi ini TIDAK mengirim apa pun. Pengiriman dilakukan admin dari
//       layar Pengingat lewat tautan wa.me, lalu ditutup RPC `mark_wa_sent`.
//       Kerangka ini sengaja sudah ada supaya naik ke Cloud API nanti tidak
//       menyentuh SQL maupun UI sama sekali.
//   'cloud_api' (fase berikutnya, setelah verifikasi bisnis + approval template)
//       POST ke Graph API, lalu tulis provider_message_id / error ke wa_outbox.
//
// Secret yang dibutuhkan (set via `supabase secrets set`):
//   WA_WEBHOOK_SECRET     : secret bersama; pemanggil kirim header x-wa-secret
//   WA_TOKEN              : akses token permanen WhatsApp Business (cloud_api)
//   WA_PHONE_NUMBER_ID    : id nomor pengirim di Meta (cloud_api)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY : otomatis tersedia di runtime.
//
// Payload yang diterima (fleksibel, sama pola dengan send-push):
//   { record: { id, phone, body, kind } }   // bentuk webhook / pg_net
//   | { id, phone, body, kind }              // pemanggilan langsung
// =============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

interface OutboxRow {
  id: string;
  phone: string;
  body: string;
  kind?: string;
}

const GRAPH_VERSION = "v21.0";

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get("WA_WEBHOOK_SECRET");
    if (secret && req.headers.get("x-wa-secret") !== secret) {
      return new Response("unauthorized", { status: 401 });
    }

    const payload = await req.json().catch(() => null);
    const row: OutboxRow | null = payload?.record ?? payload ?? null;
    if (!row?.id || !row?.phone || !row?.body) {
      return new Response("bad payload", { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Adapter aktif dibaca dari DB, bukan dari env — supaya bisa diganti tanpa
    // redeploy fungsi, sama seperti `push_function_url` di app_config.
    const { data: cfg } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "wa_adapter")
      .maybeSingle();
    const adapter = cfg?.value ?? "manual";

    if (adapter !== "cloud_api") {
      // Fase manual: antrean sengaja dibiarkan `pending` supaya tetap muncul di
      // layar Pengingat dan dikirim admin lewat wa.me. Bukan kegagalan.
      return Response.json({ ok: true, skipped: "manual" });
    }

    const token = Deno.env.get("WA_TOKEN");
    const phoneNumberId = Deno.env.get("WA_PHONE_NUMBER_ID");
    if (!token || !phoneNumberId) {
      return new Response("WA_TOKEN / WA_PHONE_NUMBER_ID belum diset", {
        status: 500,
      });
    }

    // CATATAN saat mengaktifkan cloud_api: Meta TIDAK mengizinkan teks bebas di
    // luar jendela layanan 24 jam. Pengingat servis selalu di luar jendela itu,
    // jadi wajib memakai template kategori Utility yang sudah disetujui —
    // redaksinya diambil dari `build_wa_body()` di migrasi 0023, dengan bagian
    // yang berubah (nama, tanggal, daftar unit) sebagai parameter template.
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: row.phone,
          type: "text",
          text: { body: row.body },
        }),
      },
    );

    const result = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = result?.error?.message ?? `HTTP ${res.status}`;
      await supabase
        .from("wa_outbox")
        .update({ status: "gagal", error: message, provider: "cloud_api" })
        .eq("id", row.id);
      return Response.json({ ok: false, error: message }, { status: 502 });
    }

    await supabase
      .from("wa_outbox")
      .update({
        status: "terkirim",
        sent_at: new Date().toISOString(),
        provider: "cloud_api",
        provider_message_id: result?.messages?.[0]?.id ?? null,
      })
      .eq("id", row.id);

    return Response.json({ ok: true, id: row.id });
  } catch (e) {
    return new Response(`error: ${e instanceof Error ? e.message : e}`, {
      status: 500,
    });
  }
});
