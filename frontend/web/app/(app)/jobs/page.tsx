import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import { jobStatusLabel, type TechnicianJob } from "@/lib/types";

// Contoh BACA dengan filter per-peran: teknisi hanya job miliknya.
// (service_orders/technician_jobs dibaca via select — bukan realtime.)
export default async function JobsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = await getUserRole(supabase);

  let query = supabase
    .from("technician_jobs")
    .select("id,order_id,member_id,unit_id,technician_id,type,status,notes,created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (role === "teknisi" && user) {
    query = query.eq("technician_id", user.id);
  }
  const { data, error } = await query;
  const jobs = (data ?? []) as TechnicianJob[];

  return (
    <div className="p-6 md:p-8">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">
        {role === "teknisi" ? "Job Saya" : "Job Teknisi"}
      </h1>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Gagal memuat: {error.message}
        </p>
      ) : jobs.length === 0 ? (
        <p className="text-slate-500">Belum ada job.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900 capitalize">
                  {job.type}
                </p>
                <p className="text-sm text-slate-500">
                  {formatDate(job.created_at)}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {jobStatusLabel[job.status] ?? job.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
