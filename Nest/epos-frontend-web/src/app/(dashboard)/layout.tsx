import type { ReactNode } from 'react';
import { currentUser } from '@/lib/server-api';
import { DashboardShell } from './_components/dashboard-shell';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell user={await currentUser()}>{children}</DashboardShell>;
}
