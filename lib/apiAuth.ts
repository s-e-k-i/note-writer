import { validateAccountId } from "./accounts";

const AUTH_HEADER = "x-site-password";

// Reuses the existing single shared-password site gate (see PasswordGate.tsx /
// app/api/auth/route.ts). This is intentionally NOT per-user auth — note-writer
// has one operator today. Callers must send the site password on every request
// to a DB-backed article endpoint; unlike the browser UI, these endpoints are
// checked on every request, not just once per session.
export function requireSitePassword(request: Request): Response | null {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) {
    return Response.json({ error: "SITE_PASSWORD is not configured" }, { status: 500 });
  }
  const provided = request.headers.get(AUTH_HEADER);
  if (provided !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
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
