export async function POST(request: Request) {
  const { password } = await request.json();
  const correct = process.env.SITE_PASSWORD;

  if (!correct) {
    return Response.json({ error: "SITE_PASSWORD is not configured" }, { status: 500 });
  }

  if (password === correct) {
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false }, { status: 401 });
}
