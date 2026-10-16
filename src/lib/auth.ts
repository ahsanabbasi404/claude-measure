import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "ccm_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Cookie value derived from the password, so changing DASHBOARD_PASSWORD or AUTH_SECRET invalidates sessions. */
export function sessionToken(): string | null {
  const password = process.env.DASHBOARD_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!password || !secret) return null;
  return createHmac("sha256", secret).update(`dashboard:v1:${password}`).digest("hex");
}

export function isValidSession(cookieValue: string | undefined): boolean {
  const expected = sessionToken();
  return !!expected && !!cookieValue && safeEqual(cookieValue, expected);
}

export function isValidPassword(password: unknown): boolean {
  const expected = process.env.DASHBOARD_PASSWORD;
  return !!expected && typeof password === "string" && safeEqual(password, expected);
}

/** Validates "Authorization: Bearer <INGEST_TOKEN>" sent by developer machines. */
export function isValidIngestRequest(req: Request): boolean {
  const token = process.env.INGEST_TOKEN;
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return !!token && !!match && safeEqual(match[1].trim(), token);
}
