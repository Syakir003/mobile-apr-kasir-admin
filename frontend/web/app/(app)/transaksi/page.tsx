import { createClient } from "@/lib/supabase/server";
import { formatRupiah, formatDate } from "@/lib/format";
import { invoiceStatusLabel, type Invoice } from "@/lib/types";

// Contoh BACA data: select langsung (RLS membatasi baris otomatis).
export default async function TransaksiPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id,number,customer_name,grand_total,status,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const invoices = (data ?? []) as Invoice[];

  return (
    <div className="p-6 md:p-8">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Riwayat Transaksi</h1>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Gagal memuat: {error.message}
        </p>
      ) : invoices.length === 0 ? (
        <p className="text-slate-500">Belum ada transaksi.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {invoices.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">
                  {inv.number}
                </p>
                <p className="truncate text-sm text-slate-500">
                  {inv.customer_name} · {formatDate(inv.created_at)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold text-slate-900">
                  {formatRupiah(inv.grand_total)}
                </p>
                <span className="mt-1 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                  {invoiceStatusLabel[inv.status] ?? inv.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
