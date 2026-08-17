import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { undianStatusLabel, type Undian } from "@/lib/types";

export const dynamic = "force-dynamic";

const statusClass: Record<string, string> = {
  berjalan: "bg-amber-50 text-amber-700",
  selesai: "bg-emerald-50 text-emerald-700",
  dibatalkan: "bg-red-50 text-red-600",
};

function discountLabel(row: Undian) {
  return row.discount_type === "persen"
    ? `${row.discount_value}%`
    : `Rp ${row.discount_value.toLocaleString("id-ID")}`;
}

export default async function UndianPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("undian")
    .select(
      "id,title,description,winner_count,discount_type,discount_value,voucher_valid_days,status,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as Undian[];

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Undian</h1>
        <Link
          href="/undian/baru"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Buat Undian
        </Link>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Gagal memuat: {error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500">Belum ada undian.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/undian/${row.id}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">{row.title}</p>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        statusClass[row.status] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {undianStatusLabel[row.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    Hadiah {discountLabel(row)} · {row.winner_count} pemenang
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
