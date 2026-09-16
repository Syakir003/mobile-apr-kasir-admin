import { redirect } from 'next/navigation';
import { getSession } from '@/lib/server-api';
import { ROLE_HOME } from '@/lib/session';

// '/' cuma nentuin kemana redirect — belum login -> middleware sebenernya
// udah nangkep ini duluan (lihat middleware.ts), tapi tetep dijaga di sini
// buat kasus session ada tapi mendarat di '/' (redirect ke "rumah" role-nya).
export default async function RootPage() {
  const session = await getSession();
  redirect(session ? ROLE_HOME[session.user.role] : '/login');
}
