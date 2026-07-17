import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole, menuForRole } from "@/lib/roles";
import { roleLabel } from "@/lib/types";
import { Sidebar } from "./_components/sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(supabase);
  const menu = menuForRole(role);
  const name =
    (user.user_metadata?.display_name as string | undefined) ||
    user.email ||
    "Pengguna";

  return (
    <div className="flex min-h-screen">
      <Sidebar
        menu={menu}
        name={name}
        roleLabel={role ? roleLabel[role] : "Pengguna"}
      />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
