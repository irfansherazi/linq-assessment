/**
 * Next.js 16 Proxy (formerly middleware.ts).
 *
 * - Protects all dashboard routes: requires authenticated session
 * - Redirects unauthenticated requests to /login
 * - Passes x-request-id to API routes for correlation logging
 * - Does NOT protect /api/webhooks/linq (Linq calls that endpoint without auth)
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { nanoid } from "nanoid";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Attach a request ID to every request for correlation logging
  const requestId =
    request.headers.get("x-request-id") ?? nanoid(12);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("x-request-id", requestId);

  // ── Protect dashboard routes ──────────────────────────────────────
  if (isDashboardRoute(pathname)) {
    const session = await auth();

    if (!session?.user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── Redirect authenticated users away from auth pages ────────────
  if (isAuthRoute(pathname)) {
    const session = await auth();
    if (session?.user) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return response;
}

function isDashboardRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/candidates") ||
    pathname.startsWith("/messages") ||
    pathname.startsWith("/logs") ||
    pathname.startsWith("/settings")
  );
}

function isAuthRoute(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password"
  );
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - public assets
     * - api/webhooks (Linq webhooks — unauthenticated)
     * - api/auth (Auth.js endpoints)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
