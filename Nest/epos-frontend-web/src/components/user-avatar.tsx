'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { SessionUser } from '@/lib/session';

/** Foto profil (lewat proxy same-origin yang menyisipkan token) atau inisial nama bila belum ada / gagal dimuat. */
export function UserAvatar({ user, className }: { user: SessionUser; className?: string }) {
  // Simpan path yang gagal (bukan boolean) supaya foto baru otomatis dicoba lagi.
  const [failedPath, setFailedPath] = React.useState<string | null>(null);
  const initial = (user.displayName.trim() || user.email || '?').charAt(0).toUpperCase();

  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full', className)}>
      {user.avatarPath && user.avatarPath !== failedPath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/proxy${user.avatarPath}`}
          alt={`Foto ${user.displayName}`}
          className="size-full object-cover"
          onError={() => setFailedPath(user.avatarPath ?? null)}
        />
      ) : (
        initial
      )}
    </span>
  );
}
