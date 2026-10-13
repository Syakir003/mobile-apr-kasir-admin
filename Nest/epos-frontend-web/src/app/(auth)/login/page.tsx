import { Suspense } from 'react';
import Image from 'next/image';
import { BarChart3, ReceiptText, Wrench } from 'lucide-react';
import { BrandPanel } from './brand-panel';
import { LoginForm } from './login-form';

const FEATURES = [
  { icon: ReceiptText, text: 'Kasir dan stok unit' },
  { icon: Wrench, text: 'Antrian servis teknisi' },
  { icon: BarChart3, text: 'Laporan per minggu' },
];

export default function LoginPage() {
  return (
    <main className="grid w-full lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel>
        <div className="relative flex flex-1 flex-col justify-center gap-10 [perspective:1000px]">
          <div className="w-fit rounded-3xl bg-white p-8 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.45)] transition-transform duration-200 ease-out [transform:rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-700">
            <Image
              src="/logo-apr-hd.png"
              alt="AYUB AC"
              width={1052}
              height={544}
              priority
              className="h-auto w-64 xl:w-72"
            />
          </div>
          <div className="max-w-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:delay-150 motion-safe:fill-mode-both">
            <h1 className="font-display text-[clamp(2.25rem,3.6vw,3.5rem)] leading-[1.08] font-semibold tracking-tight">
              Kasir, stok, dan servis AC <span className="text-[#6df5e1]">dalam satu layar.</span>
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-white/70">
              Dari penjualan unit sampai teknisi pulang dari lokasi, semuanya tercatat rapi di sini.
            </p>
          </div>
        </div>
        <ul className="relative grid grid-cols-3 gap-3">
          {FEATURES.map((f, i) => (
            <li
              key={f.text}
              style={{ animationDelay: `${300 + i * 120}ms` }}
              className="rounded-2xl border border-white/15 bg-white/[0.07] p-4 text-sm text-white/90 backdrop-blur-md transition duration-500 hover:-translate-y-1 hover:bg-white/[0.12] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-both"
            >
              <f.icon className="mb-3 size-5 text-[#6df5e1]" />
              {f.text}
            </li>
          ))}
        </ul>
      </BrandPanel>

      <section className="relative flex flex-col overflow-hidden bg-[#f3f7f7] px-5 py-8 sm:px-12">
        <div aria-hidden className="pointer-events-none absolute -top-40 -right-32 size-[26rem] rounded-full bg-[#0d7a70]/15 blur-[100px]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 size-[22rem] rounded-full bg-[#6df5e1]/25 blur-[100px]" />
        <div className="relative flex flex-1 items-center justify-center">
          <div className="w-full max-w-md rounded-3xl border border-white/80 bg-white/85 p-8 shadow-[0_30px_60px_-24px_rgba(11,107,98,0.35)] ring-1 ring-[#0b6b62]/10 backdrop-blur-xl sm:p-10 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-700">
            <Image
              src="/logo-apr-hd.png"
              alt="AYUB AC"
              width={1052}
              height={544}
              className="mb-8 h-auto w-36 lg:hidden"
            />
            <h2 className="font-display text-2xl font-semibold sm:text-[1.75rem]">Masuk ke E-POS AC</h2>
            <p className="mt-2 mb-8 text-sm text-muted-foreground">
              Gunakan akun yang didaftarkan oleh admin toko.
            </p>
            {/* useSearchParams butuh Suspense boundary di App Router */}
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>
        <p className="relative mt-6 text-center text-xs text-muted-foreground">Ayub Podo Rukun</p>
      </section>
    </main>
  );
}
