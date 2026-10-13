import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[100dvh] flex-1">{children}</div>;
}
