import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

/** Requires the dashboard session cookie for every page and API route not listed as public below. */
export function proxy(req: NextRequest) {
  if (isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // Public: login, installers, client and ingest endpoints (own bearer token), cron (own secret),
    // health, static assets.
    "/((?!login|install\\.sh|install\\.ps1|api/login|api/limits|api/client/|api/health|api/cron|v1/|_next/static|_next/image|favicon.ico).*)",
  ],
};
