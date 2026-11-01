import type { MetadataRoute } from 'next';

// Aplikasi internal toko: tidak perlu muncul di mesin pencari. SEO yang
// penting ada di situs company profile (domain utama), bukan di sini.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
