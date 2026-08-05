// =============================================================================
// Edge Function: send-push
//
// Mengirim FCM push saat baris `notifications` dibuat. Dipicu oleh trigger DB
// (pg_net, lihat migrasi 0012) ATAU Database Webhook Supabase pada INSERT
// tabel `notifications`. Backend tetap Supabase; fungsi ini hanya memanggil
// FCM HTTP v1 sebagai transport ke perangkat.
//
// Secret yang dibutuhkan (set via `supabase secrets set`):
//   FCM_SERVICE_ACCOUNT  : isi JSON service account Firebase (satu baris)
//   PUSH_WEBHOOK_SECRET  : secret bersama; pemanggil kirim header x-push-secret
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY : otomatis tersedia di runtime.
//
// Payload yang diterima (fleksibel):
//   { record: { user_id, title, body, type, target } }   // bentuk webhook
//   | { user_id, title, body, type, target }              // pemanggilan langsung
// =============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

interface NotifRow {
  user_id: string;
  title: string;
  body: string;
  type?: string;
  target?: string | null;
}

// --- OAuth2 access token dari service account (RS256, Web Crypto) -------------
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string"
    ? new TextEncoder().encode(data)
    : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(sa: {
  client_email: string;
  private_key: string;
  token_uri?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(unsigned),
    ),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth gagal: ${res.status} ${await res.text()}`);
  }
  return (await res.json()).access_token as string;
}

// --- Kirim satu pesan FCM v1; kembalikan false bila token tak valid ----------
async function sendOne(
  projectId: string,
  accessToken: string,
  token: string,
  n: NotifRow,
): Promise<{ ok: boolean; stale: boolean }> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: n.title, body: n.body },
          data: {
            type: n.type ?? "info",
            target: n.target ?? "",
          },
          android: { priority: "high" },
        },
      }),
    },
  );
  if (res.ok) return { ok: true, stale: false };
  const text = await res.text();
  // Token mati/tak terdaftar → tandai untuk dihapus.
  const stale = res.status === 404 ||
    /UNREGISTERED|INVALID_ARGUMENT/.test(text);
  console.error(`FCM ${res.status} utk token ${token.slice(0, 12)}…: ${text}`);
  return { ok: false, stale };
}

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get("PUSH_WEBHOOK_SECRET");
    if (secret && req.headers.get("x-push-secret") !== secret) {
      return new Response("unauthorized", { status: 401 });
    }

    const payload = await req.json();
    const rec: NotifRow = payload.record ?? payload;
    if (!rec?.user_id || !rec?.title) {
      return new Response("bad payload", { status: 400 });
    }

    const sa = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "{}");
    if (!sa.project_id || !sa.client_email || !sa.private_key) {
      return new Response("FCM_SERVICE_ACCOUNT belum diset", { status: 500 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: tokens, error } = await supabase
      .from("device_tokens")
      .select("token")
      .eq("user_id", rec.user_id);
    if (error) throw error;
    if (!tokens?.length) {
      return Response.json({ ok: true, sent: 0, note: "no device tokens" });
    }

    const accessToken = await getAccessToken(sa);
    let sent = 0;
    const stale: string[] = [];
    for (const { token } of tokens) {
      const r = await sendOne(sa.project_id, accessToken, token, rec);
      if (r.ok) sent++;
      if (r.stale) stale.push(token);
    }
    if (stale.length) {
      await supabase.from("device_tokens").delete().in("token", stale);
    }

    return Response.json({ ok: true, sent, removed: stale.length });
  } catch (e) {
    console.error(e);
    return new Response(`error: ${e instanceof Error ? e.message : e}`, {
      status: 500,
    });
  }
});
