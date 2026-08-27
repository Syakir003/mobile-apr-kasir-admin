import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "APR-POS — Web",
  description: "Web APR-POS (Next.js) di atas backend Supabase.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
