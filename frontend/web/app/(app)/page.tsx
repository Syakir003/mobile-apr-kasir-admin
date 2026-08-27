import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserRole, menuForRole } from "@/lib/roles";
import { roleLabel } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = await getUserRole(supabase);
  const name =
    (user?.user_metadata?.display_name as string | undefined) ||
    user?.email ||
    "Pengguna";
  const shortcuts = menuForRole(role).filter((m) => m.href !== "/");

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <span className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand-dark">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          Terhubung Supabase
        </span>
      </header>

      <div className="rounded-2xl bg-gradient-to-br from-brand-dark to-brand p-6 text-white">
        <h2 className="text-2xl font-bold">Halo, {name} 👋</h2>
        <p className="mt-1 text-teal-50">
          Selamat datang di APR-POS{role ? ` · ${roleLabel[role]}` : ""}.
        </p>
      </div>

      <h3 className="mb-3 mt-8 font-semibold text-slate-900">Akses Cepat</h3>
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
        {shortcuts.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand hover:shadow-sm"
          >
            <div className="mb-8 grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand-dark">
              •
            </div>
            <p className="font-semibold text-slate-900">{s.label}</p>
          </Link>
        ))}
      </div>

      <p className="mt-8 max-w-2xl text-sm text-slate-500">
        Pondasi web ini memakai backend Supabase yang sama dengan app Flutter.
        Halaman <b>Transaksi</b> dan <b>Job</b> sudah membaca data nyata; halaman
        lain siap kamu isi memakai pola yang sama (baca <code>select</code>,
        tulis lewat <code>lib/rpc.ts</code>).
      </p>
    </div>
  );
}
