/**
 * The public origin of this deployment, used to build links that leave
 * the app (password-reset emails, phone scan / device pairing QR codes).
 *
 * Deliberately NOT derived from the incoming request's Host header: a
 * forged Host would let someone get a reset link pointing at their own
 * domain emailed to a victim. In production a missing value is a
 * misconfiguration to fail loudly on, not to paper over with localhost.
 */
export function getAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  // Vercel injects the production domain automatically.
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelHost) return `https://${vercelHost}`;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set. Set it to this deployment's public URL (e.g. https://app.example.com) so emailed and QR links point at the right host.",
    );
  }
  return "http://localhost:3000";
}
