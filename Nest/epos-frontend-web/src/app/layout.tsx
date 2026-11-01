import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

// Catatan: sengaja TIDAK pakai next/font/google (Geist) — itu butuh koneksi
// ke fonts.googleapis.com PAS BUILD (gagal kalau environment build-nya
// offline/dibatasi jaringan, mis. sandbox ini). Font sistem juga lebih
// cepat render (nol request tambahan) buat aplikasi internal toko kayak
// ini yang gak butuh branding font custom.
export const metadata: Metadata = {
  title: "E-POS AC",
  description: "Sistem kasir & servis AC",
  // Aplikasi internal (termasuk tautan struk pelanggan): jangan diindeks.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased">
      <head>
        {/* Font di atas lipatan dimuat lebih awal supaya penggantian dari font
            cadangan terjadi sebelum cat pertama (sumber layout shift di login). */}
        {['inter-latin-400-normal', 'inter-latin-500-normal', 'plus-jakarta-sans-latin-600-normal'].map((f) => (
          <link key={f} rel="preload" href={`/fonts/${f}.woff2`} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
