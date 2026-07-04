import { createHash } from "crypto";
import { validateAccountId } from "./accounts";

export const SESSION_COOKIE_NAME = "nw_session";

// Derived from SITE_PASSWORD, never the raw password itself. Lets the
// browser prove "the /api/auth password check already passed this session"
// on every subsequent request via an HttpOnly cookie, without the client
// ever holding or resending the plaintext password.
export function siteSessionToken(): string | null {
  const secret = process.env.SITE_PASSWORD;
  if (!secret) return null;
  return createHash("sha256").update(secret).digest("hex");
}

// Reuses the existing single shared-password site gate (see PasswordGate.tsx /
// app/api/auth/route.ts). This is intentionally NOT per-user auth — note-writer
// has one operator today. Unlike the browser UI (which only checks once per
// tab session via sessionStorage), these endpoints are checked on every request.
export function requireSitePassword(request: Request): Response | null {
  const expected = siteSessionToken();
  if (!expected) {
    return Response.json({ error: "SITE_PASSWORD is not configured" }, { status: 500 });
  }
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}=([^;]+)`));
  if (match?.[1] !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

// Fail-closed CRON_SECRET check shared by every cron-triggered route
// (app/api/cron/bd-collect, cron/raindrop-sync, and collect-substack-news's
// cron-only GET). Unlike the earlier version of this helper (and unlike
// bd-collect's original inline check, now replaced to use this same
// function), a missing CRON_SECRET is treated as a misconfiguration and
// blocks the request — it is never treated as "no check needed".
export function requireCronSecret(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// Confirms the caller-supplied noteAccountId is a real, registered account
// (backed by the existing Redis account list) before any article data for it
// is read or written. Never trust noteAccountId from the client on its own.
export async function requireValidAccountId(noteAccountId: unknown): Promise<Response | null> {
  if (typeof noteAccountId !== "string" || !noteAccountId.trim()) {
    return Response.json({ error: "noteAccountId is required" }, { status: 400 });
  }
  const ok = await validateAccountId(noteAccountId);
  if (!ok) {
    return Response.json({ error: "unknown or unauthorized noteAccountId" }, { status: 403 });
  }
  return null;
}
