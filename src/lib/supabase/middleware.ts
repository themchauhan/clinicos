import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/scan",
  "/device",
  "/auth/confirm",
];

function isPublicPath(pathname: string) {
  if (pathname === "/") return true;
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Refreshes the Supabase session cookie on every request and redirects
 * unauthenticated requests away from non-public paths. This is coarse
 * routing only — it never makes an authorization (role/tenant) decision.
 * Every protected route/action still calls getSessionProfile() +
 * requireRole() itself; this just avoids flashing protected UI at a
 * signed-out visitor before that check runs.
 */
export async function updateSession(request: NextRequest) {
  // Exposed to Server Components via headers() so a layout that needs
  // to redirect through an intermediate step (e.g. the MFA gate in
  // dashboard/layout.tsx) can send the user back to the page they
  // actually asked for, not a hardcoded fallback.
  request.headers.set("x-pathname", request.nextUrl.pathname);
  // Never trust a client-sent value: this header is only ever set below,
  // from the user the Auth server just validated for THIS request.
  request.headers.delete("x-user-id");

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Validated once here (the Auth server round trip), then handed to
    // getSessionProfile() so it doesn't repeat that same round trip on
    // every request -- and on every link prefetch, of which a page has
    // many. Recreate the response so the forwarded request carries the
    // header, keeping any session cookies the refresh above just set.
    request.headers.set("x-user-id", user.id);
    const refreshed = response.cookies.getAll();
    response = NextResponse.next({ request });
    refreshed.forEach((cookie) => response.cookies.set(cookie));
  }

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
