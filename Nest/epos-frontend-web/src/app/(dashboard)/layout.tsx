import type { ReactNode } from 'react';
import { requireSession } from '@/lib/server-api';
import { DashboardShell } from './_components/dashboard-shell';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  return <DashboardShell user={session.user}>{children}</DashboardShell>;
}
