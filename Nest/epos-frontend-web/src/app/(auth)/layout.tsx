import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-muted/40 p-4">
      {children}
    </div>
  );
}
