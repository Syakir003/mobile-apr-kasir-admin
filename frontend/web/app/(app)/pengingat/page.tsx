import { createClient } from "@/lib/supabase/server";
import { formatTanggalPanjang } from "@/lib/format";
import { waKindLabel, type WaMessage } from "@/lib/types";
import { WaActions } from "./_components/wa-actions";

// Antrean muncul lewat select biasa (bukan realtime seperti di app Flutter):
// halaman ini di-render ulang setelah setiap aksi lewat `router.refresh()`.
export const dynamic = "force-dynamic";

type Row = WaMessage & { members: { name: string } | null };

const kindClass: Record<string, string> = {
  selesai_servis: "bg-emerald-50 text-emerald-700",
  reminder_h3: "bg-amber-50 text-amber-700",
  reminder_h7: "bg-red-50 text-red-600",
  menang_undian: "bg-emerald-50 text-emerald-700",
  voucher_baru: "bg-emerald-50 text-emerald-700",
};

export default async function PengingatPage() {
  const supabase = await createClient();
  // Nama pelanggan ikut lewat relasi `member_id` — di server ini select biasa,
  // jadi embed PostgREST bisa dipakai (berbeda dari Realtime di app Flutter,
  // yang hanya mengirim baris tabelnya sendiri).
  const { data, error } = await supabase
    .from("wa_outbox")
    .select(
      "id,member_id,phone,kind,unit_ids,due_date,body,status,created_at,members(name)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="p-6 md:p-8">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Pengingat</h1>
      <p className="mb-6 text-sm text-slate-500">
        Pesan menunggu dikirim. Tombol Kirim membuka WhatsApp dengan teks sudah
        terisi — tinggal tekan Send di sana.
      </p>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Gagal memuat: {error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500">
          Tidak ada pesan menunggu. Pengingat baru muncul sendiri saat pekerjaan
          selesai atau saat jadwal servis pelanggan mendekat.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((row) => {
            const nama = row.members?.name ?? "Pelanggan";
            const unitCount = row.unit_ids?.length ?? 0;
            return (
              <li
                key={row.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 md:flex-row md:items-start"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-slate-900">
                      {nama}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        kindClass[row.kind] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {waKindLabel[row.kind] ?? row.kind}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {[
                      unitCount > 0 ? `${unitCount} unit AC` : null,
                      row.due_date
                        ? `jatuh tempo ${formatTanggalPanjang(row.due_date)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mt-2 line-clamp-4 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                    {row.body}
                  </p>
                </div>
                <WaActions
                  id={row.id}
                  memberName={nama}
                  waUrl={`https://wa.me/${row.phone}?text=${encodeURIComponent(row.body)}`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
