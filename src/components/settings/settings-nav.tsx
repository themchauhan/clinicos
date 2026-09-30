"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SETTINGS_LINKS = [
  { href: "/dashboard/settings", label: "Overview" },
  { href: "/dashboard/settings/visit-types", label: "Visit types" },
  { href: "/dashboard/settings/doctors", label: "Doctors" },
  { href: "/dashboard/settings/document-types", label: "Document types" },
  { href: "/dashboard/settings/forms", label: "Forms" },
] as const;

/** Overview only reads as active on the settings root itself -- every
 * other link already owns its own subtree (e.g. /forms/new or a
 * /forms/[id]/edit page should still highlight "Forms"). */
function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard/settings") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2 border-b border-zinc-200 pb-6 dark:border-zinc-800">
      {SETTINGS_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={
            isActive(pathname, link.href)
              ? "rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white"
              : "rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          }
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
