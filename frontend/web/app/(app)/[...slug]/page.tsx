// Placeholder untuk rute menu yang belum diimplementasi (mis. /pos, /produk).
// Hapus ketika halaman aslinya sudah dibuat.
export default async function StubPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const title = (slug?.[0] ?? "Halaman").replace(/-/g, " ");

  return (
    <div className="grid min-h-screen place-items-center p-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold capitalize text-slate-900">{title}</h1>
        <p className="mt-2 text-slate-500">
          Halaman ini belum dibuat. Ikuti pola di{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">
            app/(app)/transaksi
          </code>{" "}
          atau <code className="rounded bg-slate-100 px-1.5 py-0.5">/jobs</code>.
        </p>
      </div>
    </div>
  );
}
