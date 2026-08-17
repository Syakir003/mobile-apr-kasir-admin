"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createUndian } from "@/lib/rpc";
import type { VoucherDiscountType } from "@/lib/types";

export default function UndianBaruPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [winnerCount, setWinnerCount] = useState("1");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [mustHaveAc, setMustHaveAc] = useState(false);
  const [discountType, setDiscountType] = useState<VoucherDiscountType>("nominal");
  const [discountValue, setDiscountValue] = useState("");
  const [maxCap, setMaxCap] = useState("");
  const [minPurchase, setMinPurchase] = useState("");
  const [validDays, setValidDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const result = await createUndian(supabase, {
        title,
        description: description.trim() || undefined,
        criteria: {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          mustHaveAcPurchase: mustHaveAc,
        },
        winnerCount: Number(winnerCount),
        discountType,
        discountValue: Number(discountValue),
        maxDiscountCap: maxCap ? Number(maxCap) : undefined,
        minPurchase: minPurchase ? Number(minPurchase) : undefined,
        voucherValidDays: Number(validDays),
      });
      router.push(`/undian/${result.undianId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat undian.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg p-6 md:p-8">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Buat Undian</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Judul
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Deskripsi (opsional)
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Jumlah Pemenang
          <input
            required
            type="number"
            min={1}
            value={winnerCount}
            onChange={(e) => setWinnerCount(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Dari Tanggal (opsional)
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Sampai Tanggal (opsional)
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={mustHaveAc}
            onChange={(e) => setMustHaveAc(e.target.checked)}
          />
          Harus pernah beli AC baru
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Tipe Diskon
          <select
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as VoucherDiscountType)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          >
            <option value="nominal">Nominal (Rp)</option>
            <option value="persen">Persen (%)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Nilai {discountType === "persen" ? "(%)" : "(Rp)"}
          <input
            required
            type="number"
            min={1}
            max={discountType === "persen" ? 100 : undefined}
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        {discountType === "persen" ? (
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Maks Potongan (Rp, opsional)
            <input
              type="number"
              min={1}
              value={maxCap}
              onChange={(e) => setMaxCap(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Minimal Pembelian (Rp, opsional)
          <input
            type="number"
            min={0}
            value={minPurchase}
            onChange={(e) => setMinPurchase(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Masa Berlaku Voucher Pemenang (hari)
          <input
            required
            type="number"
            min={1}
            value={validDays}
            onChange={(e) => setValidDays(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Menyimpan..." : "Buat Undian"}
        </button>
      </form>
    </div>
  );
}
