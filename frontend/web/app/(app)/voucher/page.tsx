import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatTanggalPanjang } from "@/lib/format";
import { voucherStatusLabel, type Voucher } from "@/lib/types";
import { VoucherActions } from "./_components/voucher-actions";

export const dynamic = "force-dynamic";

type Row = Voucher & { members: { name: string } | null };

const statusClass: Record<string, string> = {
  aktif: "bg-emerald-50 text-emerald-700",
  terpakai: "bg-slate-100 text-slate-600",
  kadaluarsa: "bg-red-50 text-red-600",
  dibatalkan: "bg-red-50 text-red-600",
};

function discountLabel(row: Voucher) {
  return row.discount_type === "persen"
    ? `${row.discount_value}%`
    : `Rp ${row.discount_value.toLocaleString("id-ID")}`;
}

export default async function VoucherPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vouchers")
    .select(
      "id,code,member_id,discount_type,discount_value,max_discount_cap,min_purchase,expires_at,status,source,note,created_at,members(name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold text-slate-900">Voucher</h1>
          <p className="text-sm text-slate-500">
            Kode dipakai dengan cara diinput admin/kasir saat checkout.
          </p>
        </div>
        <Link
          href="/voucher/baru"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Buat Voucher
        </Link>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Gagal memuat: {error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500">Belum ada voucher.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 md:flex-row md:items-start md:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-mono font-semibold text-slate-900">
                    {row.code}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      statusClass[row.status] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {voucherStatusLabel[row.status]}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {row.members?.name ?? "Pelanggan"}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {discountLabel(row)} · berlaku sampai{" "}
                  {formatTanggalPanjang(row.expires_at)}
                </p>
              </div>
              {row.status === "aktif" ? (
                <VoucherActions id={row.id} code={row.code} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
