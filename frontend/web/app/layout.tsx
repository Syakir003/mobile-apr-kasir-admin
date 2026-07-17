import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "E-POS AC — Web",
  description: "Web E-POS AC Realtime (Next.js) di atas backend Supabase.",
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
