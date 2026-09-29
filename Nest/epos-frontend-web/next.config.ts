import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */

  // Biar bisa dites dari HP/device lain di WiFi yang sama lewat IP LAN
  // (mis. http://192.168.x.x:3001) — tanpa ini, Next.js/Turbopack nolak
  // request cross-origin ke asset dev (_next/static, HMR), JS-nya gagal
  // ke-load, React gak ke-hydrate, dan form fallback ke submit native
  // browser (keliatan dari URL yang kebawa query string email/password).
  // IP LAN laptop ini bisa ganti-ganti (DHCP) — kalau abis restart
  // dev server IP-nya beda dari yang ada di daftar ini, tambahin lagi.
  //
  // '*.trycloudflare.com' — buat testing lewat tunnel `cloudflared tunnel
  // --url http://localhost:3001` (quick tunnel). Domainnya acak tiap kali
  // tunnel dibuka ulang, makanya dipakai wildcard sekali taruh, bukan
  // ditambahin manual satu-satu tiap buka tunnel baru.
  allowedDevOrigins: ['192.168.18.52', '192.168.18.99', '*.trycloudflare.com'],
};

export default nextConfig;
