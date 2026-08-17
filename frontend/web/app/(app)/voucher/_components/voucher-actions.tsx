"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cancelVoucher } from "@/lib/rpc";

export function VoucherActions({ id, code }: { id: string; code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function batalkan() {
    if (!window.confirm(`Batalkan voucher ${code}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await cancelVoucher(supabase, { voucherId: id });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membatalkan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={batalkan}
        disabled={busy}
        className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
      >
        Batalkan
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
