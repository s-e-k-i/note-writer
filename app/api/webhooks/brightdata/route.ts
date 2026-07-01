import { processBrightDataPosts } from "@/lib/brightdata-process";

export async function POST(req: Request) {
  const secret = process.env.BRIGHTDATA_WEBHOOK_SECRET ?? "";
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const querySecret = new URL(req.url).searchParams.get("secret") ?? "";

  if (secret && authHeader !== secret && querySecret !== secret) {
    console.warn(
      "[brightdata/webhook] unauthorized, header:",
      authHeader.slice(0, 20),
      "query_secret:",
      querySecret.slice(0, 10),
    );
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawPosts: unknown[] = Array.isArray(body) ? body : ((body as { items?: unknown[] })?.items ?? []);
  const result = await processBrightDataPosts(rawPosts);

  return Response.json({ ok: true, ...result });
}
