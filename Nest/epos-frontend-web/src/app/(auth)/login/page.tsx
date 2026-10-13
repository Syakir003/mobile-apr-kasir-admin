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
          <div className="max-w-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:delay-150 motion-safe:fill-mode-both">
            <h1 className="font-display text-[clamp(2rem,3.2vw,3rem)] leading-[1.12] font-semibold">
              Kasir, stok, dan servis AC dalam satu layar.
            </h1>
          </div>
        </div>
        <ul className="relative flex flex-wrap gap-x-8 gap-y-3 border-t border-white/15 pt-6 text-sm text-white/75">
          {FEATURES.map((f) => (
            <li key={f.text} className="flex items-center gap-2">
              <f.icon className="size-4 text-[#6df5e1]" />
              {f.text}
            </li>
          ))}
        </ul>
      </BrandPanel>

      <section className="relative flex flex-col bg-[#f3f7f7] px-5 py-8 sm:px-12">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-md rounded-3xl border border-border/70 bg-white p-8 shadow-[0_24px_48px_-24px_rgba(11,107,98,0.25)] sm:p-10 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-700">
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
        <p className="mt-6 text-center text-xs text-muted-foreground">Ayub Podo Rukun</p>
      </section>
    </main>
  );
}
