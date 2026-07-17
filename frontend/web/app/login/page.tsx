import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_8px_24px_rgba(15,23,42,.06)]">
        <div className="flex flex-col items-center text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand text-white text-3xl">
            ❄
          </div>
          <h1 className="mt-5 text-2xl font-bold text-slate-900">
            E-POS AC Realtime
          </h1>
          <p className="mt-1 text-slate-500">Masuk untuk melanjutkan</p>
        </div>

        {error ? (
          <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <form action={login} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-slate-500">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="rounded-lg border border-slate-200 px-3.5 py-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-slate-500">Password</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="rounded-lg border border-slate-200 px-3.5 py-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
          </label>
          <button
            type="submit"
            className="mt-2 rounded-lg bg-brand py-3 font-semibold text-white transition hover:bg-brand-dark"
          >
            Masuk
          </button>
        </form>
      </div>
    </main>
  );
}
