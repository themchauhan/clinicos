"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function MfaSetupForm({ next }: { next: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function start() {
      const { data: existing } = await supabase.auth.mfa.listFactors();

      // A verified factor already existing means MFA is already
      // satisfied for this account — this happens when the browser
      // lands back on /mfa/setup immediately after completing
      // enrollment: challengeAndVerify() promotes the client-side
      // session to aal2 right away, but the very next server-rendered
      // page reads the session from a cookie that can be a beat
      // behind, so getMfaStatus() briefly still sees "enroll
      // required" and redirects here again. Move on instead of
      // enrolling a duplicate, which Supabase would reject anyway (it
      // enforces one factor per friendly name — empty string, here —
      // per user).
      const verified = existing?.all.find(
        (f) => f.factor_type === "totp" && f.status === "verified",
      );
      if (verified) {
        if (!cancelled) {
          router.replace(next);
          router.refresh();
        }
        return;
      }

      // Clear out any abandoned unverified factor from a previous
      // attempt — enroll() can't re-display a secret once issued, so
      // a stale factor would leave the QR/secret shown here out of
      // sync with what's actually pending server-side.
      const staleFactors =
        existing?.all.filter((f) => f.factor_type === "totp" && f.status === "unverified") ?? [];
      for (const stale of staleFactors) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }
      if (cancelled) return;

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (cancelled) return;
      if (enrollError || !data) {
        setError(enrollError?.message ?? "Could not start MFA setup.");
        return;
      }
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
    }

    start();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount; `next`/`router` don't change in a way that should re-trigger enrollment.
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setVerifying(true);
    setError(null);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });

    if (verifyError) {
      setError("Incorrect code. Check your authenticator app and try again.");
      setVerifying(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  if (error && !factorId) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {error}
      </p>
    );
  }

  if (!qrCode || !secret) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Setting up…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- qrCode is
          a data: URI returned per-request from Supabase Auth, not a
          static asset next/image can optimize. */}
      <img
        src={qrCode}
        alt="QR code to scan with your authenticator app"
        width={200}
        height={200}
        className="w-fit rounded-md border border-slate-200 bg-white p-2"
      />
      <p className="text-xs text-slate-500">
        Scan with your authenticator app, or enter this code manually:{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono break-all">{secret}</code>
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="code" className="text-sm font-medium">
          6-digit code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={verifying || code.length !== 6}
        className="w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
      >
        {verifying ? "Verifying…" : "Confirm"}
      </button>
    </form>
  );
}
