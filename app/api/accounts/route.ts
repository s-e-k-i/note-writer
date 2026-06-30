import { NextResponse } from "next/server";
import { listAccounts, createAccount, updateAccountName, SEKI_ID } from "@/lib/accounts";

export async function GET() {
  try {
    const accounts = await listAccounts();
    return NextResponse.json({ accounts });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name } = (await req.json()) as { name?: string };
    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const account = await createAccount(name.trim());
    return NextResponse.json({ account });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { id, name } = (await req.json()) as { id?: string; name?: string };
    if (!id || !name?.trim()) {
      return NextResponse.json({ error: "id and name are required" }, { status: 400 });
    }
    if (id === SEKI_ID) {
      return NextResponse.json({ error: "Official account name cannot be changed" }, { status: 403 });
    }
    const ok = await updateAccountName(id, name.trim());
    if (!ok) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
