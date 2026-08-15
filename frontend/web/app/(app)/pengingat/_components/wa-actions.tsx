"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { cancelWaMessage, markWaSent } from "@/lib/rpc";

/**
 * Dua tombol aksi untuk satu baris antrean.
 *
 * Sengaja Client Component sekecil mungkin: daftarnya sendiri tetap dirender di
 * server (RLS yang membatasi barisnya), yang butuh browser hanyalah membuka tab
 * WhatsApp dan memanggil RPC.
 */
export function WaActions({
  id,
  waUrl,
  memberName,
}: {
  id: string;
  waUrl: string;
  memberName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = busy || pending;

  async function kirim() {
    setBusy(true);
    setError(null);
    try {
      // Buka tab WhatsApp DULU, baru tandai terkirim. Popup blocker yang
      // menolak jendela baru ikut membatalkan penandaan, jadi pesan tetap
      // berada di antrean alih-alih hilang tanpa pernah terkirim.
      const tab = window.open(waUrl, "_blank", "noopener,noreferrer");
      if (!tab) {
        setError("Tab WhatsApp diblokir browser. Izinkan pop-up lalu ulangi.");
        return;
      }
      const supabase = createClient();
      await markWaSent(supabase, { id });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menandai terkirim.");
    } finally {
      setBusy(false);
    }
  }

  async function batalkan() {
    if (
      !window.confirm(
        `Batalkan pengingat untuk ${memberName}? Pesan ini tidak akan dikirim.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await cancelWaMessage(supabase, { id });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membatalkan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={kirim}
          disabled={disabled}
          className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          Kirim via WhatsApp
        </button>
        <button
          type="button"
          onClick={batalkan}
          disabled={disabled}
          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
        >
          Batalkan
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
