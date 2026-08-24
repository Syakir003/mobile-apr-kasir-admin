# Web (Next.js) → NestJS Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Next.js web app's two implemented data pages (`/transaksi`, `/jobs`) and the four already-defined-but-unused `lib/rpc.ts` write wrappers off direct Supabase table/RPC access and onto the new NestJS REST API, while leaving Supabase Auth completely untouched.

**Architecture:** Keep `@supabase/ssr` for Auth/session/cookies exactly as-is — login, logout, middleware session refresh, and role-from-JWT (`lib/roles.ts`) are not part of this migration. Add one small server-side helper, `lib/api.ts`'s `apiFetch`, that reads the current Supabase session's `access_token` (via the existing `lib/supabase/server.ts` `createClient()`) and calls the NestJS API with it as a Bearer token. Replace the two pages' `.from(table).select()` calls and the four `lib/rpc.ts` functions' `supabase.rpc(...)` calls with `apiFetch` calls against the exact paths in the backend plan's endpoint contract table.

**Tech Stack:** native `fetch` (no new HTTP library needed — Next.js Server Components already have `fetch` global; YAGNI on axios/ky for one helper function), existing `@supabase/ssr` (kept, Auth only), `vitest` (new devDependency — lightest-weight test runner for a few server-side TS utils, no jsdom/component testing needed).

## Global Constraints

- `lib/supabase/{client,server,middleware}.ts`, `middleware.ts`, `app/login/**`, `app/auth/signout/route.ts`, `lib/roles.ts` are **NOT touched** by any task in this plan — Auth/session/role-from-JWT stays exactly as it is today.
- Base URL for the NestJS API is a new **server-only** env var `API_URL` (NOT `NEXT_PUBLIC_*` — this is a server-to-server call made only from Server Components/Server Actions, and must never be exposed to the browser bundle). Local dev default is documented in `frontend/web/.env.local.example` as `API_URL=http://127.0.0.1:3001`, matching the port the backend plan's `.env.example` (`PORT=3001`) starts NestJS on.
- Every HTTP error response from the NestJS API is `{"message": "<pesan>"}` (per the backend plan's global exception filter). The new `apiFetch` helper throws a plain `Error(body.message)` on any non-2xx response — this matches `lib/rpc.ts`'s existing `if (error) throw new Error(error.message)` pattern exactly, so no calling code needs a different error-handling shape than it has today.
- Role-based data scoping (e.g. a teknisi only seeing their own jobs) is now enforced **server-side by the NestJS endpoint itself**, reading the caller's role from the verified JWT. Page code no longer carries its own `if (role === 'teknisi') query = query.eq(...)` branch — it calls the endpoint and trusts the response.
- Building out the placeholder pages (`/pos`, `/orders`, `/produk`, `/sparepart`, `/jasa`, `/paket`, `/member`, `/profil`, `/scan` — all currently served by `app/(app)/[...slug]/page.tsx`) is **explicitly OUT OF SCOPE** for this plan. That is net-new feature work (a much bigger, separate product-scope decision), not implied by "migrate to NestJS." This plan only migrates what already exists — the 2 real pages plus the 4 unused `rpc.ts` wrappers — and the shared API-calling infrastructure they need. Building out the placeholder pages is a natural follow-up plan, not a task here.
- No test-runner existed in `frontend/web/` before this plan (`package.json` had no `test` script and no testing devDependency). Task 1 adds `vitest` — the only test tooling this plan introduces. No `@testing-library/react` or any component-testing setup is added, since nothing in this plan tests React components (Tasks 3 and 4 migrate Server Component pages, which are covered by manual smoke test instead — justified inline in each of those tasks).

---

## Task 1: `apiFetch` helper + test runner setup

**Files:**
- Create: `frontend/web/lib/api.ts`
- Create: `frontend/web/vitest.config.ts`
- Modify: `frontend/web/package.json`
- Test: `frontend/web/lib/api.test.ts`

**Interfaces:**
- Consumes: `createClient()` from `frontend/web/lib/supabase/server.ts` (existing, unchanged) — returns a Supabase server client whose `.auth.getSession()` resolves `{ data: { session: { access_token: string } | null } }`.
- Produces: `apiFetch<T>(path: string, opts?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }): Promise<T>` — every later task in this plan calls this exact function.

- [ ] **Step 1: Add `vitest` as the project's test runner (no test runner exists yet)**

```bash
cd "frontend/web"
npm install -D vitest
```

Add a `test` script and the new devDependency to `frontend/web/package.json` (full file after the edit):

```json
{
  "name": "epos-ac-web",
  "version": "0.1.0",
  "private": true,
  "description": "Web (Next.js) E-POS AC Realtime — konsumsi backend Supabase yang sama dengan app Flutter.",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/ssr": "^0.5.2",
    "@supabase/supabase-js": "^2.45.4",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@types/node": "^22.9.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

Create `frontend/web/vitest.config.ts` (aliases `@/*` the same way `tsconfig.json` does, so tests can `import "@/lib/..."` exactly like app code):

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 2: Write the failing test**

```ts
// lib/api.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();

// lib/supabase/server.ts calls next/headers' cookies(), which only works
// inside a real Next.js request — mock the whole module so the test never
// touches it.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession },
  })),
}));

import { apiFetch } from "./api";

describe("apiFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    getSession.mockReset();
    process.env.API_URL = "http://127.0.0.1:3001";
  });

  it("calls the API with a Bearer token and returns parsed JSON on 2xx", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ id: "1" }]),
    });

    const result = await apiFetch<{ id: string }[]>("/invoices");

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/invoices",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(result).toEqual([{ id: "1" }]);
  });

  it("throws Error(body.message) on a non-2xx response", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: "Nama pelanggan wajib diisi" }),
    });

    await expect(
      apiFetch("/pos/checkout", { method: "POST", body: { customer: {} } }),
    ).rejects.toThrow("Nama pelanggan wajib diisi");
  });

  it("sends no Authorization header when there is no session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "[]",
    });

    await apiFetch("/invoices");

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("Authorization");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/api.test.ts` (from `frontend/web/`)
Expected: FAIL — `Failed to resolve import "./api" from "lib/api.test.ts". Does the file exist?` (`lib/api.ts` does not exist yet)

- [ ] **Step 4: Implement**

```ts
// lib/api.ts
import { createClient } from "@/lib/supabase/server";

// Helper fetch untuk memanggil NestJS API dari Server Component / Server
// Action. TIDAK bisa dipakai dari Client Component — bergantung pada
// lib/supabase/server.ts yang butuh next/headers (hanya tersedia di server).

export type ApiFetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

export async function apiFetch<T>(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  const res = await fetch(`${process.env.API_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = (json as { message?: string } | null)?.message;
    throw new Error(message ?? `Request ke ${path} gagal (${res.status})`);
  }
  return json as T;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/api.test.ts` (from `frontend/web/`)
Expected: PASS (3/3)

- [ ] **Step 6: Commit**

```bash
git add frontend/web/package.json frontend/web/package-lock.json frontend/web/vitest.config.ts frontend/web/lib/api.ts frontend/web/lib/api.test.ts
git commit -m "feat(web): add apiFetch helper + vitest for calling the NestJS API"
```

---

## Task 2: Rewire `lib/rpc.ts` to call `apiFetch`

**Files:**
- Modify: `frontend/web/lib/rpc.ts`
- Test: `frontend/web/lib/rpc.test.ts`

**Interfaces:**
- Consumes: `apiFetch<T>(path, opts)` from Task 1 (`frontend/web/lib/api.ts`).
- Produces (signatures change — see rationale below):
  - `checkoutTransaction(payload: CheckoutPayload): Promise<CheckoutResult>`
  - `recordPayment(payload: RecordPaymentPayload): Promise<{ status: string; totalPaid: number }>`
  - `assignTechnicianJob(payload: { jobId: string; technicianId: string }): Promise<{ ok: boolean }>`
  - `updateTechnicianJobStatus(payload: { jobId: string; action: JobAction; scannedBarcode?: string; notes?: string }): Promise<{ ok: boolean; status: string }>`

**Rationale (state once, applies to all 4 functions):** every exported function drops its `supabase: SupabaseClient` parameter — `apiFetch` gets its own session internally via `lib/supabase/server.ts`, so callers no longer need to pass one in. This is a signature change, but a safe one: per `web_research.md`'s full-codebase check, none of these 4 functions has any call site yet anywhere in the app, so nothing breaks. For the 2 functions whose REST path embeds an id (`recordPayment` → `POST /invoices/:id/payments`, `assignTechnicianJob` → `POST /jobs/:id/assign`, `updateTechnicianJobStatus` → `POST /jobs/:id/status`), the exported function keeps accepting the same flat payload shape callers already expect (`{ invoiceId, ... }` / `{ jobId, ... }`) — the implementation destructures the id out of the payload to build the URL and sends the remaining fields as the JSON body. `checkoutTransaction`'s payload has no id to extract, so it is sent as the request body unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rpc.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiFetchMock = vi.fn();
vi.mock("./api", () => ({ apiFetch: apiFetchMock }));

import {
  checkoutTransaction,
  recordPayment,
  assignTechnicianJob,
  updateTechnicianJobStatus,
  type CheckoutPayload,
} from "./rpc";

describe("lib/rpc.ts", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({});
  });

  it("checkoutTransaction calls POST /pos/checkout with the payload as-is", async () => {
    const payload: CheckoutPayload = {
      customer: { name: "Budi", phone: "0812" },
      items: [{ kind: "product", refId: "p1", qty: 1 }],
      discount: 0,
      taxPercent: 0,
      transportFee: 0,
      notes: "",
    };

    await checkoutTransaction(payload);

    expect(apiFetchMock).toHaveBeenCalledWith("/pos/checkout", {
      method: "POST",
      body: payload,
    });
  });

  it("recordPayment calls POST /invoices/:id/payments, pulling invoiceId into the URL", async () => {
    await recordPayment({ invoiceId: "inv-1", method: "tunai", amount: 50000, note: "lunas" });

    expect(apiFetchMock).toHaveBeenCalledWith("/invoices/inv-1/payments", {
      method: "POST",
      body: { method: "tunai", amount: 50000, note: "lunas" },
    });
  });

  it("assignTechnicianJob calls POST /jobs/:id/assign, pulling jobId into the URL", async () => {
    await assignTechnicianJob({ jobId: "job-1", technicianId: "tech-1" });

    expect(apiFetchMock).toHaveBeenCalledWith("/jobs/job-1/assign", {
      method: "POST",
      body: { technicianId: "tech-1" },
    });
  });

  it("updateTechnicianJobStatus calls POST /jobs/:id/status, pulling jobId into the URL", async () => {
    await updateTechnicianJobStatus({ jobId: "job-1", action: "start", notes: "mulai" });

    expect(apiFetchMock).toHaveBeenCalledWith("/jobs/job-1/status", {
      method: "POST",
      body: { action: "start", notes: "mulai" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rpc.test.ts` (from `frontend/web/`)
Expected: FAIL — assertion mismatch, e.g. `expected "spy" to be called with arguments: [ '/pos/checkout', … ]` because `lib/rpc.ts` still calls `supabase.rpc("checkout_transaction", { payload })`, not `apiFetch`, and still requires a `supabase` first argument (a TypeScript error on the call-site arity would also surface: `checkoutTransaction(payload)` doesn't match the old `checkoutTransaction(supabase, payload)` signature).

- [ ] **Step 3: Implement**

```ts
// lib/rpc.ts
import { apiFetch } from "./api";
import type { ItemKind, PaymentMethod } from "./types";

// Wrapper typed untuk NestJS API. SEMUA penulisan data lewat sini — jangan
// panggil fetch/apiFetch langsung dari komponen/page.
//
// Setiap fungsi memanggil apiFetch(), yang melempar Error berpesan Indonesia
// bila backend membalas non-2xx (body `{ message }`).

// ---- POST /pos/checkout -----------------------------------------------------

export type CheckoutItem = { kind: ItemKind; refId: string; qty: number };
export type CheckoutInstallation = {
  itemIndex: number;
  roomLocation: string;
  technicianId?: string | null;
};
export type CheckoutPayload = {
  customer: { name: string; phone: string; address?: string };
  items: CheckoutItem[];
  discount: number;
  taxPercent: number;
  transportFee: number;
  notes: string;
  installations?: CheckoutInstallation[];
};
export type CheckoutResult = {
  invoiceId: string;
  invoiceNumber: string;
  memberId: string;
  transactionId: string;
};

export function checkoutTransaction(payload: CheckoutPayload) {
  return apiFetch<CheckoutResult>("/pos/checkout", { method: "POST", body: payload });
}

// ---- POST /invoices/:id/payments --------------------------------------------

export type RecordPaymentPayload = {
  invoiceId: string;
  method: PaymentMethod;
  amount: number;
  note?: string;
};

export function recordPayment(payload: RecordPaymentPayload) {
  const { invoiceId, ...body } = payload;
  return apiFetch<{ status: string; totalPaid: number }>(
    `/invoices/${invoiceId}/payments`,
    { method: "POST", body },
  );
}

// ---- POST /jobs/:id/assign ---------------------------------------------------

export function assignTechnicianJob(payload: { jobId: string; technicianId: string }) {
  const { jobId, ...body } = payload;
  return apiFetch<{ ok: boolean }>(`/jobs/${jobId}/assign`, { method: "POST", body });
}

// ---- POST /jobs/:id/status ----------------------------------------------------

export type JobAction = "start" | "complete" | "cancel";

export function updateTechnicianJobStatus(payload: {
  jobId: string;
  action: JobAction;
  scannedBarcode?: string;
  notes?: string;
}) {
  const { jobId, ...body } = payload;
  return apiFetch<{ ok: boolean; status: string }>(`/jobs/${jobId}/status`, {
    method: "POST",
    body,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rpc.test.ts` (from `frontend/web/`)
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add frontend/web/lib/rpc.ts frontend/web/lib/rpc.test.ts
git commit -m "feat(web): rewire lib/rpc.ts to call the NestJS API via apiFetch"
```

---

## Task 3: Migrate `/transaksi` page

**Files:**
- Modify: `frontend/web/app/(app)/transaksi/page.tsx`
- Test: Manual smoke test — a Server Component page has no unit under test here beyond what Task 1 already covers (`apiFetch` itself); this project's testing infrastructure (Task 1) is deliberately scoped to plain TS utils, not React rendering (see Global Constraints), so verifying the page is a manual step rather than a fabricated automated test.

**Interfaces:**
- Consumes: `apiFetch<T>(path, opts)` from Task 1; `Invoice` type from `frontend/web/lib/types.ts` (unchanged: `{ id, number, customer_name, grand_total, status, created_at }`); `formatRupiah`, `formatDate` from `frontend/web/lib/format.ts` (unchanged); `invoiceStatusLabel` from `frontend/web/lib/types.ts` (unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Manual verification steps (write these down, run them after Step 2's implementation)**

1. Ensure the local Supabase stack is running: `supabase start` (from repo root).
2. Ensure the NestJS API is running locally: `cd backend/nest-api && npm run start:dev` (listens on `http://127.0.0.1:3001` per the backend plan's `.env.example`).
3. `cd frontend/web && npm run dev`, open `http://localhost:3000/login`.
4. Log in as an admin user (role `admin` in `public.users`).
5. Navigate to `http://localhost:3000/transaksi`.
6. Confirm the invoice list renders with the same fields as before the migration (invoice number, customer name + date, formatted Rupiah total, status badge) and no red "Gagal memuat" banner appears.
7. Stop the NestJS API process (Ctrl+C) and refresh `/transaksi` — confirm the red "Gagal memuat: `<pesan>`" banner now appears, proving the page's error path (via `apiFetch`'s thrown `Error`) still works.

- [ ] **Step 2: Implement**

```tsx
// app/(app)/transaksi/page.tsx
import { apiFetch } from "@/lib/api";
import { formatRupiah, formatDate } from "@/lib/format";
import { invoiceStatusLabel, type Invoice } from "@/lib/types";

// Contoh BACA data: lewat NestJS API (server-side, pakai token sesi Supabase).
export default async function TransaksiPage() {
  let invoices: Invoice[] = [];
  let error: { message: string } | null = null;
  try {
    invoices = await apiFetch<Invoice[]>("/invoices");
  } catch (e) {
    error = { message: e instanceof Error ? e.message : "Gagal memuat data" };
  }

  return (
    <div className="p-6 md:p-8">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Riwayat Transaksi</h1>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Gagal memuat: {error.message}
        </p>
      ) : invoices.length === 0 ? (
        <p className="text-slate-500">Belum ada transaksi.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {invoices.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">
                  {inv.number}
                </p>
                <p className="truncate text-sm text-slate-500">
                  {inv.customer_name} · {formatDate(inv.created_at)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold text-slate-900">
                  {formatRupiah(inv.grand_total)}
                </p>
                <span className="mt-1 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                  {invoiceStatusLabel[inv.status] ?? inv.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Note on the diff from the original: the `{ data, error }` destructure from `supabase.from("invoices").select(...)` is replaced by a `try/catch` around `apiFetch`, because `apiFetch` throws instead of returning an `error` object — this is the smallest change that keeps the exact same JSX (`error.message`, `invoices.length === 0`, `invoices.map(...)`) untouched.

- [ ] **Step 3: Run the manual verification steps from Step 1**

Expected: list renders identically to the pre-migration page while the API is up; red error banner appears when the API is down.

- [ ] **Step 4: Commit**

```bash
git add "frontend/web/app/(app)/transaksi/page.tsx"
git commit -m "feat(web): migrate /transaksi to call GET /invoices on the NestJS API"
```

---

## Task 4: Migrate `/jobs` page

**Files:**
- Modify: `frontend/web/app/(app)/jobs/page.tsx`
- Test: Manual smoke test — same justification as Task 3 (no component-testing infrastructure in this plan's scope). This task additionally must be checked under **two** roles because it deletes the client-side scoping branch, so the smoke test explicitly covers both.

**Interfaces:**
- Consumes: `apiFetch<T>(path, opts)` from Task 1; `createClient()` and `getUserRole()` (unchanged, still needed for the page heading, not for filtering); `TechnicianJob` type from `frontend/web/lib/types.ts` (unchanged); `formatDate` from `frontend/web/lib/format.ts` (unchanged); `jobStatusLabel` from `frontend/web/lib/types.ts` (unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Manual verification steps (write these down, run them after Step 2's implementation)**

1. Ensure the local Supabase stack and NestJS API are running (same as Task 3, Step 1's points 1–2).
2. `cd frontend/web && npm run dev`.
3. Log in as an **admin** user, navigate to `http://localhost:3000/jobs`. Confirm the heading reads "Job Teknisi" and the full job list renders (all technicians' jobs), with no error banner.
4. Note the `technician_id` values visible in that admin list (or check `public.technician_jobs` directly) so you know which jobs belong to a specific teknisi.
5. Log out, then log in as a **teknisi** user whose `id` matches one of the `technician_id` values noted above.
6. Navigate to `http://localhost:3000/jobs`. Confirm the heading reads "Job Saya" and the list contains **only** that teknisi's jobs — this proves `GET /jobs`'s server-side role scoping (per Global Constraints) replaced the deleted client-side `.eq("technician_id", user.id)` filter correctly.

- [ ] **Step 2: Implement**

```tsx
// app/(app)/jobs/page.tsx
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/roles";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { jobStatusLabel, type TechnicianJob } from "@/lib/types";

// Contoh BACA data: lewat NestJS API. Pemfilteran "teknisi hanya job miliknya"
// sekarang dilakukan server-side oleh endpoint GET /jobs (baca role dari JWT
// terverifikasi) — halaman ini tidak lagi punya cabang filter sendiri.
export default async function JobsPage() {
  const supabase = await createClient();
  const role = await getUserRole(supabase);

  let jobs: TechnicianJob[] = [];
  let error: { message: string } | null = null;
  try {
    jobs = await apiFetch<TechnicianJob[]>("/jobs");
  } catch (e) {
    error = { message: e instanceof Error ? e.message : "Gagal memuat data" };
  }

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
```

Note on the diff from the original: `supabase.auth.getUser()` and the `let query = ...; if (role === "teknisi") query = query.eq(...)` branch are both deleted — `user` was only ever read to build that filter, and the filter itself moves server-side per Global Constraints. `getUserRole(supabase)` is kept because the page heading ("Job Saya" vs "Job Teknisi") still needs the role. Same `try/catch` pattern as Task 3 replaces the `{ data, error }` destructure.

- [ ] **Step 3: Run the manual verification steps from Step 1**

Expected: admin sees all jobs under "Job Teknisi"; teknisi sees only their own jobs under "Job Saya".

- [ ] **Step 4: Commit**

```bash
git add "frontend/web/app/(app)/jobs/page.tsx"
git commit -m "feat(web): migrate /jobs to call GET /jobs on the NestJS API, drop client-side role filter"
```

---

## Task 5: `.env.local.example` + README update

**Files:**
- Modify: `frontend/web/.env.local.example`
- Modify: `frontend/web/README.md`
- Test: none — pure env/doc changes, no executable logic. Verified by grepping both files in Step 2 (same class of exception as Tasks 3 and 4: nothing here is logic to unit-test).

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Add `API_URL` to `.env.local.example` and a running-instructions line to `README.md`**

Full new content of `frontend/web/.env.local.example`:

```bash
# Salin ke .env.local dan isi sesuai proyek Supabase.
#
# LOKAL (supabase start) — nilai default CLI:
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH

# CLOUD — ambil dari Supabase Dashboard > Project Settings > API:
# NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-key>

# NestJS API — server-only (JANGAN pakai prefix NEXT_PUBLIC_, nilai ini tidak
# boleh terekspos ke browser). Dipakai oleh lib/api.ts di Server Component/Action.
API_URL=http://127.0.0.1:3001
```

In `frontend/web/README.md`'s "Menjalankan" section, add one sentence after the existing "Pastikan backend Supabase jalan (...)" line. Full new content of that section:

```markdown
## Menjalankan

\`\`\`bash
cd web
cp .env.local.example .env.local     # isi URL + anon key Supabase
npm install
npm run dev                          # http://localhost:3000
\`\`\`

Pastikan backend Supabase jalan (lokal: `supabase start`, atau isi kredensial
cloud di `.env.local`). Buat/atur user + role di tabel `public.users`.

Jalankan juga NestJS API di lokal (`cd backend/nest-api && npm run start:dev`,
default `http://127.0.0.1:3001`) — halaman `/transaksi` dan `/jobs` memanggilnya
lewat env `API_URL`.
```

- [ ] **Step 2: Verify both files contain the new lines**

Run: `grep -n "API_URL" "frontend/web/.env.local.example" "frontend/web/README.md"`
Expected: one match per file — `.env.local.example:API_URL=http://127.0.0.1:3001` and a line in `README.md` mentioning `API_URL`.

- [ ] **Step 3: Commit**

```bash
git add frontend/web/.env.local.example frontend/web/README.md
git commit -m "docs(web): document API_URL env var and NestJS local run step"
```

---

## Follow-ups (explicitly not part of this plan)

- Building out the placeholder pages (`/pos`, `/orders`, `/produk`, `/sparepart`, `/jasa`, `/paket`, `/member`, `/profil`, `/scan`) against the NestJS API is net-new feature work and deserves its own plan with its own product-scope decisions (which endpoints, what UI, what validation) — not bundled into a migration plan.
- No component-testing setup (`@testing-library/react`, jsdom) was added, since nothing here tests a rendered component. If a future plan needs to unit-test page/component behavior, add it then.
