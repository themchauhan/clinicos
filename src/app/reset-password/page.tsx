import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Set your password — ClinicOS" };

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-16 sm:px-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          {/* Shared by both the "forgot password" reset flow and first-time
              password setup after a staff invite (see supabase/templates/invite.html). */}
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Set your password
          </h1>
        </div>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
