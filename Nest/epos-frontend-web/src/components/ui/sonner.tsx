'use client';

import * as React from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

// Catatan: shadcn/ui default pakai `next-themes` buat ganti tema toast
// otomatis. Project ini belum pakai dark-mode toggle, jadi di-hardcode
// 'light' dulu — gampang disambungkan ke ThemeProvider nanti kalau perlu.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
