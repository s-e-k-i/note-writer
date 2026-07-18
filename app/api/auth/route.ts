import { siteSessionToken, SESSION_COOKIE_NAME, requireSitePassword } from "@/lib/apiAuth";

// Lets the client verify its session cookie is still actually valid, rather
// than trusting a sessionStorage flag that could predate this cookie
// existing at all (e.g. a tab left open across a deployment that
// introduced it) or outlive an expired/cleared cookie.
export async function GET(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const { password } = await request.json();
  const correct = process.env.SITE_PASSWORD;

  if (!correct) {
    return Response.json({ error: "SITE_PASSWORD is not configured" }, { status: 500 });
  }

  if (password === correct) {
    const token = siteSessionToken();
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const maxAge = 60 * 24 * 60 * 60; // 60 days — "ほぼログイン不要" レベルの長期保持
    const res = Response.json({ ok: true });
    // HttpOnly so client-side JS (and any XSS) can never read it back out.
    res.headers.set(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
    );
    return res;
  }

  return Response.json({ ok: false }, { status: 401 });
}
