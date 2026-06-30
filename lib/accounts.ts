import { redis } from "./redis";
import { SEKI_ID, SEKI_NAME } from "./accountIds";

export { SEKI_ID, SEKI_NAME } from "./accountIds";

const ACCOUNTS_KEY = "accounts";

export interface Account {
  id: string;
  name: string;
  ownerEmail?: string; // reserved for future auth
  createdAt: string;
}

const SEKI_DEFAULT: Account = {
  id: SEKI_ID,
  name: SEKI_NAME,
  createdAt: "2024-01-01T00:00:00.000Z",
};

export async function listAccounts(): Promise<Account[]> {
  try {
    const stored = await redis.get<Account[]>(ACCOUNTS_KEY);
    if (stored && stored.length > 0) return stored;
    await redis.set(ACCOUNTS_KEY, [SEKI_DEFAULT]);
    return [SEKI_DEFAULT];
  } catch {
    return [SEKI_DEFAULT];
  }
}

export async function getAccount(id: string): Promise<Account | null> {
  const accounts = await listAccounts();
  return accounts.find((a) => a.id === id) ?? null;
}

export async function createAccount(name: string): Promise<Account> {
  const id = `account-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const account: Account = { id, name, createdAt: new Date().toISOString() };
  const accounts = await listAccounts();
  await redis.set(ACCOUNTS_KEY, [...accounts, account]);
  return account;
}

export async function updateAccountName(id: string, name: string): Promise<boolean> {
  if (id === SEKI_ID) return false; // official account name is fixed
  const accounts = await listAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  accounts[idx] = { ...accounts[idx], name };
  await redis.set(ACCOUNTS_KEY, accounts);
  return true;
}

export async function validateAccountId(id: string): Promise<boolean> {
  const account = await getAccount(id);
  return account !== null;
}
