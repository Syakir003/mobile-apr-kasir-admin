import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,

  // Header keamanan. CSP sengaja HANYA direktif yang tidak merusak inline script
  // Next (frame-ancestors/base-uri/form-action/object-src); script-src ketat
  // butuh nonce per-request — tambahkan bila perlu.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },

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
  allowedDevOrigins: ['192.168.18.52', '192.168.18.99','192.168.1.26', '*.trycloudflare.com'],
};

export default nextConfig;
