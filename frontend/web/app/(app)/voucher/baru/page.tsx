"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createVoucher } from "@/lib/rpc";
import type { VoucherDiscountType } from "@/lib/types";

export default function VoucherBaruPage() {
  const router = useRouter();
  const [memberPhone, setMemberPhone] = useState("");
  const [discountType, setDiscountType] = useState<VoucherDiscountType>("nominal");
  const [discountValue, setDiscountValue] = useState("");
  const [maxCap, setMaxCap] = useState("");
  const [minPurchase, setMinPurchase] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: member, error: memberError } = await supabase
        .from("members")
        .select("id")
        .eq("phone", memberPhone.trim())
        .maybeSingle();
      if (memberError) throw new Error(memberError.message);
      if (!member) {
        throw new Error(
          "Pelanggan dengan nomor HP itu tidak ditemukan (format tersimpan: +62...).",
        );
      }
      await createVoucher(supabase, {
        memberId: member.id,
        discountType,
        discountValue: Number(discountValue),
        maxDiscountCap: maxCap ? Number(maxCap) : undefined,
        minPurchase: minPurchase ? Number(minPurchase) : undefined,
        expiresAt,
        note: note.trim() || undefined,
      });
      router.push("/voucher");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat voucher.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg p-6 md:p-8">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Buat Voucher</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Nomor HP Pelanggan
          <input
            required
            value={memberPhone}
            onChange={(e) => setMemberPhone(e.target.value)}
            placeholder="+62812xxxxxxx"
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
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
          Berlaku Sampai
          <input
            required
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Catatan (opsional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Menyimpan..." : "Buat Voucher"}
        </button>
      </form>
    </div>
  );
}
