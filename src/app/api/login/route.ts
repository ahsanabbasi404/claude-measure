import { NextResponse } from "next/server";
import { isValidPassword, sessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";
import {
  checkLoginLimit, clientIp, FAILURE_DELAY_MS, MIN_PASSWORD_LENGTH, recordLoginAttempt,
} from "@/lib/login-limit";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  const token = sessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "DASHBOARD_PASSWORD and AUTH_SECRET must be set on the server" },
      { status: 500 },
    );
  }
  if ((process.env.DASHBOARD_PASSWORD ?? "").length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Login is disabled: DASHBOARD_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters. Update it in the server environment.` },
      { status: 503 },
    );
  }

  const ip = clientIp(req);
  let limit;
  try {
    limit = await checkLoginLimit(ip);
  } catch (err) {
    // Without the attempt log the limit cannot be enforced, so login stays closed.
    console.error("[login] rate limit check failed", err);
    return NextResponse.json({ error: "Login is temporarily unavailable" }, { status: 503 });
  }
  if (limit.blocked) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return NextResponse.json(
      {
        error: limit.scope === "ip"
          ? `Too many failed attempts. Try again in ${minutes} minute${minutes > 1 ? "s" : ""}.`
          : `Login is temporarily locked after many failed attempts. Try again in ${minutes} minute${minutes > 1 ? "s" : ""}.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { password?: unknown };
  if (!isValidPassword(body.password)) {
    await recordLoginAttempt(ip, false);
    await sleep(FAILURE_DELAY_MS);
    const left = limit.remaining - 1;
    return NextResponse.json(
      { error: left > 0 ? `Wrong password. ${left} attempt${left > 1 ? "s" : ""} left.` : "Wrong password. Login is now locked for 15 minutes." },
      { status: 401 },
    );
  }

  await recordLoginAttempt(ip, true);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
