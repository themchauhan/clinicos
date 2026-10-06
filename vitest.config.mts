import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// tests/rls/*.test.ts need NEXT_PUBLIC_SUPABASE_URL etc. to reach the
// local Supabase instance. CI provides these via $GITHUB_ENV; locally
// they come from .env.local, which plain `vitest run` doesn't load on
// its own the way Next.js does.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local yet (e.g. fresh clone before `supabase start`) —
  // tests/rls/* will report a clear "not configured" failure instead.
}

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // RLS tests sign in and round-trip to a real database; on a cold one
    // (a fresh CI run, or right after heavy DB work) the 5s default is tight.
    testTimeout: 20_000,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
});
