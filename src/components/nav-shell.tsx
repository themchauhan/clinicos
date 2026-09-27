"use client";

import { useState } from "react";
import Link from "next/link";
import type { StaffRole } from "@/types/database";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/patients", label: "Patients" },
  { href: "/visits", label: "Visits" },
  { href: "/dashboard/usg", label: "USG" },
  { href: "/dashboard/documents", label: "Documents" },
  { href: "/dashboard/settings", label: "Settings" },
] as const;

const ROLE_LABELS: Record<StaffRole, string> = {
  SUPER_ADMIN: "Platform admin",
  HOSPITAL_ADMIN: "Admin",
  RECEPTIONIST: "Receptionist",
};

export interface NavShellSession {
  email: string;
  role: StaffRole;
  hospitalName: string | null;
}

/**
 * The Visits link is still a placeholder — visits are per-patient
 * only (no top-level /visits list exists yet). Phase 1b added the
 * real sign-in/sign-out control on the right.
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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="relative border-b border-slate-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
          onClick={() => setMenuOpen(false)}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-teal-600 text-xs font-bold text-white">
            +
          </span>
          <span className="whitespace-nowrap">Hospital &amp; USG Records</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-teal-50 hover:text-teal-800"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 sm:flex">
          {session ? (
            <>
              <div className="text-right text-xs leading-tight text-slate-500">
                <p className="font-medium text-slate-900">{session.email}</p>
                <p>
                  {ROLE_LABELS[session.role]}
                  {session.hospitalName ? ` · ${session.hospitalName}` : ""}
                </p>
              </div>
              <form action={onSignOut ?? (() => {})}>
                <button
                  type="submit"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Sign out
                </button>
              </form>
            </>
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
          <div className="absolute inset-x-0 top-full z-50 border-t border-slate-200 bg-white px-4 pb-4 shadow-lg sm:hidden">
            <nav aria-label="Primary" className="flex flex-col">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-md px-3 py-2.5 text-sm text-slate-600 transition-colors hover:bg-teal-50 hover:text-teal-800"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="mt-2 border-t border-slate-200 pt-3">
              {session ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs leading-tight text-slate-500">
                    <p className="font-medium text-slate-900">{session.email}</p>
                    <p>
                      {ROLE_LABELS[session.role]}
                      {session.hospitalName ? ` · ${session.hospitalName}` : ""}
                    </p>
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
