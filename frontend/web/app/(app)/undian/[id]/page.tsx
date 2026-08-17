import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { undianStatusLabel, type Undian, type UndianParticipant } from "@/lib/types";
import { UndianActions } from "./_components/undian-actions";

export const dynamic = "force-dynamic";

export default async function UndianDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: undian } = await supabase
    .from("undian")
    .select(
      "id,title,description,winner_count,discount_type,discount_value,voucher_valid_days,status",
    )
    .eq("id", id)
    .maybeSingle();
  if (!undian) notFound();

  const { data: participantRows } = await supabase
    .from("undian_participants")
    .select("id,undian_id,member_id,source,members(name)")
    .eq("undian_id", id);
  const participants = (participantRows ?? []) as unknown as (UndianParticipant & {
    members: { name: string } | null;
  })[];

  const berjalan = (undian as Undian).status === "berjalan";
  const discountLabel =
    undian.discount_type === "persen"
      ? `${undian.discount_value}%`
      : `Rp ${undian.discount_value.toLocaleString("id-ID")}`;

  return (
    <div className="mx-auto max-w-2xl p-6 md:p-8">
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-900">{undian.title}</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
            {undianStatusLabel[undian.status as Undian["status"]]}
          </span>
        </div>
        {undian.description ? (
          <p className="mt-2 text-sm text-slate-600">{undian.description}</p>
        ) : null}
        <p className="mt-2 text-sm text-slate-500">
          Hadiah {discountLabel} · {undian.winner_count} pemenang · voucher
          berlaku {undian.voucher_valid_days} hari
        </p>
      </div>

      <h2 className="mb-2 font-semibold text-slate-900">
        Peserta ({participants.length})
      </h2>
      <ul className="mb-6 flex flex-col gap-2">
        {participants.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada peserta.</p>
        ) : (
          participants.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <span>{p.members?.name ?? "Pelanggan"}</span>
              <span className="text-xs text-slate-400">
                {p.source === "manual" ? "Manual" : "Otomatis"}
              </span>
            </li>
          ))
        )}
      </ul>

      {berjalan ? <UndianActions undianId={id} /> : null}
    </div>
  );
}
