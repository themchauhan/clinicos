import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NavShell } from "@/components/nav-shell";
import { getSessionProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import type { ModuleType } from "@/types/database";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ClinicOS",
  description: "Digital patient records for small hospitals and USG centres.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const profile = await getSessionProfile();

  // Nav-only concern (which links to show), so fetched here rather
  // than widening the shared getSessionProfile() cache shape.
  let enabledModules: ModuleType[] = [];
  if (profile?.hospitalId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("hospital_modules")
      .select("module")
      .eq("hospital_id", profile.hospitalId);
    enabledModules = (data ?? []).map((m) => m.module);
  }

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <NavShell
          session={
            profile
              ? {
                  email: profile.email,
                  role: profile.role,
                  hospitalName: profile.hospital?.name ?? null,
                  enabledModules,
                }
              : null
          }
          onSignOut={signOut}
        />
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
