"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ModuleType, StaffRole } from "@/types/database";

const PRIMARY_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/patients", label: "Patients" },
  { href: "/dashboard/visits", label: "Visits" },
  { href: "/dashboard/usg", label: "USG", requiresModule: "USG" as ModuleType },
  { href: "/dashboard/documents", label: "Documents" },
] as const;

// Less-frequently-used links, grouped under a single "More" dropdown
// on desktop rather than crowding the primary nav row.
const MORE_LINKS = [
  {
    href: "/dashboard/devices",
    label: "Connect a device",
    requiresRole: ["HOSPITAL_ADMIN", "RECEPTIONIST"] as readonly StaffRole[],
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    requiresRole: ["HOSPITAL_ADMIN"] as readonly StaffRole[],
  },
  {
    href: "/account/security",
    label: "Security",
    requiresRole: ["SUPER_ADMIN", "HOSPITAL_ADMIN"] as readonly StaffRole[],
  },
] as const;

type NavLink = (typeof PRIMARY_LINKS)[number] | (typeof MORE_LINKS)[number];

/**
 * A link with `requiresRole`/`requiresModule` only shows once we know
 * the signed-in user's role/enabled modules — shown unconditionally
 * when signed out (there's nothing role-specific to hide yet). This
 * mirrors the pages themselves, which redirect away rather than crash
 * for a role/module that shouldn't be there in the first place.
 */
function visibleLinks(session: NavShellSession | null | undefined, links: readonly NavLink[]) {
  return links.filter((link) => {
    if (!session) return true;
    if ("requiresRole" in link && !link.requiresRole.includes(session.role)) return false;
    if ("requiresModule" in link && !session.enabledModules.includes(link.requiresModule)) {
      return false;
    }
    return true;
  });
}

/** The Dashboard link should only read as active on the dashboard root
 * itself -- every other primary link already owns its own subtree
 * (e.g. /dashboard/patients/123 shouldn't also highlight Dashboard). */
function isLinkActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const ROLE_LABELS: Record<StaffRole, string> = {
  SUPER_ADMIN: "Platform admin",
  HOSPITAL_ADMIN: "Admin",
  RECEPTIONIST: "Receptionist",
};

/** First + last initial (or the first two letters of a single name) --
 * a stand-in avatar with no image upload/storage to build. Words that
 * don't start with a letter (e.g. a parenthetical like "(Clarity)" in
 * some seeded names) are skipped rather than contributing a stray
 * initial. */
function initialsFor(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => /^[A-Za-z]/.test(part));
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface NavShellSession {
  name: string;
  email: string;
  role: StaffRole;
  hospitalName: string | null;
  enabledModules: ModuleType[];
}

/**
 * Phase 1b added the real sign-in/sign-out control on the right.
 *
 * `onSignOut` is passed in (rather than importing the `signOut`
 * server action directly here) so this component stays a plain,
 * dependency-free presentational component that unit tests can render
 * without pulling in server-only/Next-request-context code.
 */
export function NavShell({
  session,
  onSignOut,
}: {
  session?: NavShellSession | null;
  onSignOut?: () => void | Promise<void>;
}) {
  const pathname = usePathname() ?? "";
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const visibleMoreLinks = visibleLinks(session, MORE_LINKS);

  function toggleMoreMenu() {
    setUserMenuOpen(false);
    setMoreOpen((open) => !open);
  }

  function toggleUserMenu() {
    setMoreOpen(false);
    setUserMenuOpen((open) => !open);
  }

  return (
    <header className="relative border-b border-slate-200 bg-white print:hidden">
      <div className="relative z-50 mx-auto flex max-w-5xl items-center justify-between bg-white px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight"
            onClick={() => setMenuOpen(false)}
          >
            <svg viewBox="0 0 100 100" className="h-7 w-7 shrink-0" aria-hidden="true">
              <rect x="6" y="6" width="88" height="88" rx="22" fill="#0d9488" />
              <rect x="28" y="42" width="44" height="16" rx="8" fill="#ffffff" />
              <rect x="42" y="28" width="16" height="44" rx="8" fill="#ffffff" />
            </svg>
            <span className="whitespace-nowrap">ClinicOS</span>
          </Link>
          {session?.hospitalName ? (
            <>
              <span className="hidden h-4 w-px shrink-0 bg-slate-300 md:block" aria-hidden="true" />
              <span className="hidden truncate text-sm text-slate-500 md:block">
                {session.hospitalName}
              </span>
            </>
          ) : null}
        </div>

        <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
          {visibleLinks(session, PRIMARY_LINKS).map((link) => {
            const active = isLinkActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-md bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-800"
                    : "rounded-md px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-teal-50 hover:text-teal-800"
                }
              >
                {link.label}
              </Link>
            );
          })}

          {visibleMoreLinks.length > 0 ? (
            <div className="relative">
              <button
                type="button"
                onClick={toggleMoreMenu}
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-teal-50 hover:text-teal-800"
              >
                More
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                  <path d="M7 10l5 5 5-5z" />
                </svg>
              </button>
              {moreOpen ? (
                <>
                  <button
                    type="button"
                    aria-label="Close menu"
                    onClick={() => setMoreOpen(false)}
                    className="fixed inset-0 z-40"
                  />
                  <div className="absolute top-full right-0 z-50 mt-1 w-52 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                    {visibleMoreLinks.map((link) => {
                      const active = isLinkActive(pathname, link.href);
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setMoreOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={
                            active
                              ? "block bg-teal-50 px-3 py-2 text-sm font-medium text-teal-800"
                              : "block px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-teal-50 hover:text-teal-800"
                          }
                        >
                          {link.label}
                        </Link>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </nav>

        <div className="hidden items-center sm:flex">
          {session ? (
            <div className="relative">
              <button
                type="button"
                onClick={toggleUserMenu}
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                aria-label="Account menu"
                className="flex items-center gap-2 rounded-md py-1.5 pr-1 pl-1.5 text-sm transition-colors hover:bg-slate-50"
              >
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-semibold text-white"
                >
                  {initialsFor(session.name)}
                </span>
                <span className="max-w-[8rem] truncate font-medium text-slate-700">
                  {session.name.split(" ")[0]}
                </span>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="currentColor">
                  <path d="M7 10l5 5 5-5z" />
                </svg>
              </button>
              {userMenuOpen ? (
                <>
                  <button
                    type="button"
                    aria-label="Close menu"
                    onClick={() => setUserMenuOpen(false)}
                    className="fixed inset-0 z-40"
                  />
                  <div className="absolute top-full right-0 z-50 mt-1 w-64 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                    <div className="border-b border-slate-100 px-3 py-2">
                      <p className="truncate text-sm font-medium text-slate-900">{session.name}</p>
                      <p className="truncate text-xs text-slate-500">{session.email}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {ROLE_LABELS[session.role]}
                        {session.hospitalName ? ` · ${session.hospitalName}` : ""}
                      </p>
                    </div>
                    <form action={onSignOut ?? (() => {})}>
                      <button
                        type="submit"
                        className="block w-full px-3 py-2 text-left text-sm text-slate-600 transition-colors hover:bg-teal-50 hover:text-teal-800"
                      >
                        Sign out
                      </button>
                    </form>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              Sign in
            </Link>
          )}
        </div>

        <button
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-600 sm:hidden"
        >
          {menuOpen ? (
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </div>

      {menuOpen ? (
        <>
          {/* Backdrop: closes the menu on tap, and visually confirms
              this is a floating overlay rather than reflowed content. */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 bg-slate-900/30 sm:hidden"
          />
          <div className="animate-slide-down absolute inset-x-0 top-full z-50 border-t border-slate-200 bg-white px-4 pb-4 shadow-lg sm:hidden">
            <nav aria-label="Primary" className="flex flex-col">
              {[...visibleLinks(session, PRIMARY_LINKS), ...visibleMoreLinks].map((link) => {
                const active = isLinkActive(pathname, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "rounded-md bg-teal-50 px-3 py-2.5 text-sm font-medium text-teal-800"
                        : "rounded-md px-3 py-2.5 text-sm text-slate-600 transition-colors hover:bg-teal-50 hover:text-teal-800"
                    }
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-2 border-t border-slate-200 pt-3">
              {session ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-semibold text-white"
                    >
                      {initialsFor(session.name)}
                    </span>
                    <div className="min-w-0 text-xs leading-tight text-slate-500">
                      <p className="truncate font-medium text-slate-900">{session.name}</p>
                      <p className="truncate">{session.email}</p>
                      <p>
                        {ROLE_LABELS[session.role]}
                        {session.hospitalName ? ` · ${session.hospitalName}` : ""}
                      </p>
                    </div>
                  </div>
                  <form action={onSignOut ?? (() => {})}>
                    <button
                      type="submit"
                      className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      Sign out
                    </button>
                  </form>
                </div>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-md border border-slate-300 px-3 py-1.5 text-center text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </>
      ) : null}
    </header>
  );
}
