"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { saveWaReminderTemplates } from "@/lib/rpc";
import { waKindLabel, type WaTemplate } from "@/lib/types";

const EDITABLE_KINDS = [
  "selesai_servis",
  "reminder_h3",
  "reminder_h7",
] as const;
type EditableKind = (typeof EDITABLE_KINDS)[number];

const KNOWN_PLACEHOLDER = /\{(nama|unit|tanggal)\}/g;
const ANY_PLACEHOLDER = /\{[^{}]*\}/;

function validate(body: string): string | null {
  const s = body.trim();
  if (!s) return "Teks pesan wajib diisi";
  if (s.length > 1000) return "Maksimal 1000 karakter";
  if (ANY_PLACEHOLDER.test(s.replace(KNOWN_PLACEHOLDER, ""))) {
    return "Kata kunci tak dikenal. Hanya {nama}, {unit}, {tanggal}.";
  }
  return null;
}

/** Pratinjau dengan data contoh — tidak dikirim ke mana pun. */
function preview(body: string): string {
  return body
    .replaceAll("{nama}", "Budi Santoso")
    .replaceAll(
      "{unit}",
      "- Panasonic 1/2 PK (Kamar Tamu)\n- Daikin 1 PK (Kamar Utama)",
    )
    .replaceAll("{tanggal}", "15 September 2026");
}

/**
 * Form 3 kartu (satu per jenis pesan). Diisi sekali dari `initial` — tidak
 * disinkron ulang setelah itu (mirror `_hydrate` di app Flutter), supaya
 * `router.refresh()` sehabis simpan tidak menimpa teks yang sedang diedit.
 */
export function TemplateEditor({
  initial,
  readOnly,
}: {
  initial: WaTemplate[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState<Record<EditableKind, string>>(() => {
    const map = {} as Record<EditableKind, string>;
    for (const kind of EDITABLE_KINDS) {
      map[kind] = initial.find((t) => t.kind === kind)?.body ?? "";
    }
    return map;
  });
  const defaults = useMemo(() => {
    const map = {} as Record<EditableKind, string>;
    for (const kind of EDITABLE_KINDS) {
      map[kind] = initial.find((t) => t.kind === kind)?.defaultBody ?? "";
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const errors = useMemo(
    () =>
      Object.fromEntries(
        EDITABLE_KINDS.map((k) => [k, validate(body[k])]),
      ) as Record<EditableKind, string | null>,
    [body],
  );
  const hasErrors = Object.values(errors).some(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (hasErrors) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const supabase = createClient();
      await saveWaReminderTemplates(supabase, { templates: { ...body } });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {readOnly ? (
        <p className="text-sm text-slate-500">
          Hanya Admin yang bisa mengubah teks pesan. Ini teks yang berlaku
          sekarang.
        </p>
      ) : null}

      {EDITABLE_KINDS.map((kind) => (
        <div
          key={kind}
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <p className="mb-2 font-semibold text-slate-900">
            {waKindLabel[kind]}
          </p>
          <textarea
            value={body[kind]}
            onChange={(e) =>
              setBody((b) => ({ ...b, [kind]: e.target.value }))
            }
            disabled={readOnly || busy}
            rows={5}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              Kata kunci: {"{nama}"}, {"{unit}"}, {"{tanggal}"}
            </p>
            {!readOnly ? (
              <button
                type="button"
                onClick={() =>
                  setBody((b) => ({ ...b, [kind]: defaults[kind] }))
                }
                disabled={busy}
                className="shrink-0 text-xs font-semibold text-brand hover:underline disabled:opacity-50"
              >
                Reset ke bawaan
              </button>
            ) : null}
          </div>
          {errors[kind] ? (
            <p className="mt-1 text-xs text-red-600">{errors[kind]}</p>
          ) : null}

          <p className="mb-1 mt-3 text-xs font-medium text-slate-500">
            Pratinjau
          </p>
          <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            {preview(body[kind]).trim() || "(kosong)"}
          </p>
        </div>
      ))}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {saved ? (
        <p className="text-sm text-emerald-600">Teks pesan tersimpan.</p>
      ) : null}

      {!readOnly ? (
        <button
          type="submit"
          disabled={busy || hasErrors}
          className="self-start rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Menyimpan..." : "Simpan"}
        </button>
      ) : null}
    </form>
  );
}
