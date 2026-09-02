import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatTanggalPanjang } from "@/lib/format";
import { waKindLabel, type WaMessage } from "@/lib/types";

// Riwayat tidak berubah setelah pesan diproses, tapi tetap force-dynamic supaya
// data terbaru muncul tiap kunjungan (konsisten dengan halaman antrean).
export const dynamic = "force-dynamic";

type Row = WaMessage & {
  sent_at: string | null;
  error: string | null;
  members: { name: string } | null;
};

const kindClass: Record<string, string> = {
  selesai_servis: "bg-emerald-50 text-emerald-700",
  reminder_h3: "bg-amber-50 text-amber-700",
  reminder_h7: "bg-red-50 text-red-600",
  menang_undian: "bg-emerald-50 text-emerald-700",
  voucher_baru: "bg-emerald-50 text-emerald-700",
};

const statusClass: Record<string, string> = {
  terkirim: "bg-emerald-50 text-emerald-700",
  gagal: "bg-red-50 text-red-600",
  dibatalkan: "bg-slate-100 text-slate-600",
};

const statusLabel: Record<string, string> = {
  terkirim: "Terkirim",
  gagal: "Gagal",
  dibatalkan: "Dibatalkan",
};

export default async function RiwayatPengingatPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wa_outbox")
    .select(
      "id,member_id,phone,kind,unit_ids,due_date,body,status,created_at,sent_at,error,members(name)",
    )
    .neq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="p-6 md:p-8">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Riwayat Pengingat</h1>
        <Link
          href="/pengingat"
          className="shrink-0 text-sm font-semibold text-brand hover:underline"
        >
          &larr; Antrean
        </Link>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Pesan yang sudah dikirim, gagal, atau dibatalkan. Menampilkan 100
        terbaru.
      </p>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Gagal memuat: {error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500">
          Belum ada riwayat. Pesan pindah ke sini setelah dikirim, gagal, atau
          dibatalkan.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((row) => {
            const nama = row.members?.name ?? "Pelanggan";
            const when = row.sent_at ?? row.created_at;
            return (
              <li
                key={row.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold text-slate-900">{nama}</p>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      kindClass[row.kind] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {waKindLabel[row.kind] ?? row.kind}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      statusClass[row.status] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {statusLabel[row.status] ?? row.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {when ? formatTanggalPanjang(when) : ""}
                </p>
                <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  {row.body}
                </p>
                {row.status === "dibatalkan" && row.error ? (
                  <p className="text-xs text-slate-500">Alasan: {row.error}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
