import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/roles";
import { listWaReminderTemplates } from "@/lib/rpc";
import type { WaTemplate } from "@/lib/types";
import { TemplateEditor } from "./_components/template-editor";

export const dynamic = "force-dynamic";

export default async function TeksPesanPengingatPage() {
  const supabase = await createClient();
  const role = await getUserRole(supabase);

  let templates: WaTemplate[] = [];
  let loadError: string | null = null;
  try {
    templates = await listWaReminderTemplates(supabase);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Gagal memuat teks pesan.";
  }

  return (
    <div className="mx-auto max-w-2xl p-6 md:p-8">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Teks Pesan Pengingat</h1>
        <Link
          href="/pengingat"
          className="shrink-0 text-sm font-semibold text-brand hover:underline"
        >
          &larr; Pengingat
        </Link>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Kata kunci {"{nama}"}, {"{unit}"}, dan {"{tanggal}"} otomatis diganti
        saat pesan dikirim. Perubahan berlaku untuk pengingat berikutnya —
        pesan yang sudah di antrean sudah dibekukan teksnya.
      </p>

      {loadError ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Gagal memuat: {loadError}
        </p>
      ) : (
        <TemplateEditor initial={templates} readOnly={role !== "admin"} />
      )}
    </div>
  );
}
