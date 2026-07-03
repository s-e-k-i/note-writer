import { siteSessionToken, SESSION_COOKIE_NAME } from "@/lib/apiAuth";

export async function POST(request: Request) {
  const { password } = await request.json();
  const correct = process.env.SITE_PASSWORD;

  if (!correct) {
    return Response.json({ error: "SITE_PASSWORD is not configured" }, { status: 500 });
  }

  if (password === correct) {
    const token = siteSessionToken();
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const res = Response.json({ ok: true });
    // Session cookie (no Max-Age) to match the existing sessionStorage-based
    // "logged out when the tab closes" behavior. HttpOnly so client-side JS
    // (and any XSS) can never read it back out.
    res.headers.set("Set-Cookie", `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/${secure}`);
    return res;
  }

  return Response.json({ ok: false }, { status: 401 });
}
