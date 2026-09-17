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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
