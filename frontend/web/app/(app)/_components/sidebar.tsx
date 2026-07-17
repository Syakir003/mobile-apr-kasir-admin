"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MenuItem } from "@/lib/roles";

export function Sidebar({
  menu,
  name,
  roleLabel,
}: {
  menu: MenuItem[];
  name: string;
  roleLabel: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex items-center gap-3 border-b border-slate-200 p-4">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white">
          ❄
        </div>
        <b className="text-slate-900">E-POS AC</b>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <p className="mb-3 ml-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Menu {roleLabel}
        </p>
        <ul className="flex flex-col gap-1">
          {menu.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href ||
                  pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    active
                      ? "bg-brand-soft text-brand-dark"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-slate-200 p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-soft font-bold text-brand-dark">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {name}
            </p>
            <p className="text-xs text-slate-500">{roleLabel}</p>
          </div>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50"
          >
            Logout
          </button>
        </form>
      </div>
    </aside>
  );
}
