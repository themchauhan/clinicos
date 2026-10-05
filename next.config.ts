import type { NextConfig } from "next";

// Baseline hardening for an app that handles patient data. No CSP here
// on purpose: the PDF viewer's worker and Next's inline bootstrap make a
// correct policy something to design and test separately.
const securityHeaders = [
  // SAMEORIGIN, not DENY: the print-slip dialog frames the slip page.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // The phone scan page needs its own camera; nothing else needs any of these.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    serverActions: {
      // Default is 1MB, too small for document uploads (Phase 4). The
      // real enforcement is validateFile()'s MAX_FILE_SIZE_BYTES —
      // this just needs to be large enough not to reject a valid
      // upload before that check ever runs.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
