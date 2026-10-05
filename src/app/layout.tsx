import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NavShell } from "@/components/nav-shell";
import { Footer } from "@/components/footer";
import { getSessionProfile } from "@/lib/auth/session";
import { signOut } from "@/app/login/actions";
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

  const enabledModules = profile?.enabledModules ?? [];

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <NavShell
          session={
            profile
              ? {
                  name: profile.name,
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
        <Footer />
      </body>
    </html>
  );
}
