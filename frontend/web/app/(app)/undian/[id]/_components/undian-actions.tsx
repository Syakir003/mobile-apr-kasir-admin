"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { drawUndian, cancelUndian } from "@/lib/rpc";

export function UndianActions({ undianId }: { undianId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function tarik() {
    if (!window.confirm("Tarik undian? Pemenang dipilih acak dan tidak bisa diulang.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const result = await drawUndian(supabase, { undianId });
      window.alert(`${result.winnerCount} pemenang terpilih.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menarik undian.");
    } finally {
      setBusy(false);
    }
  }

  async function batalkan() {
    if (!window.confirm("Batalkan undian ini?")) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await cancelUndian(supabase, { undianId });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membatalkan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={tarik}
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          Tarik Undian
        </button>
        <button
          type="button"
          onClick={batalkan}
          disabled={busy}
          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
        >
          Batalkan
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
