import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { accountSessions, users } from "../db/schema";
import type { CloudAccount } from "./cloud";

const SESSION_COOKIE = "smgr_account_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type AuthenticatedCloudAccount = { account: CloudAccount };

function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return "";
}

async function hashSessionToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createAccountSession(userId: string) {
  const token = `${crypto.randomUUID()}.${crypto.randomUUID()}`;
  const tokenHash = await hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await getDb().insert(accountSessions).values({ tokenHash, userId, expiresAt });
  return { token, expiresAt };
}

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function deleteAccountSession(request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  await getDb().delete(accountSessions).where(eq(accountSessions.tokenHash, await hashSessionToken(token)));
}

export async function findAuthenticatedCloudAccount(request: Request): Promise<
  | { kind: "anonymous" }
  | { kind: "ready"; value: AuthenticatedCloudAccount }
> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return { kind: "anonymous" };

  const [row] = await getDb()
    .select({
      id: users.id,
      account: users.account,
      role: users.role,
    })
    .from(accountSessions)
    .innerJoin(users, eq(accountSessions.userId, users.id))
    .where(and(
      eq(accountSessions.tokenHash, await hashSessionToken(token)),
      gt(accountSessions.expiresAt, new Date().toISOString()),
    ))
    .limit(1);

  if (!row) return { kind: "anonymous" };

  return {
    kind: "ready",
    value: {
      account: {
        id: row.id,
        account: row.account,
        role: row.role,
      },
    },
  };
}

export async function requireAuthenticatedCloudAccount(request: Request) {
  const result = await findAuthenticatedCloudAccount(request);
  if (result.kind === "anonymous") {
    return {
      response: Response.json({ error: "请先输入账号登录" }, { status: 401 }),
      value: null,
    };
  }
  return { response: null, value: result.value };
}

export function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "服务器暂时无法处理请求";
  const unavailable = /no such table|D1 binding|database/i.test(message);
  const status = Number((error as { status?: unknown }).status);
  const code = (error as { code?: unknown }).code;
  const conflictOrderIds = (error as { conflictOrderIds?: unknown }).conflictOrderIds;
  const revision = (error as { revision?: unknown }).revision;
  return Response.json(
    {
      ...(typeof code === "string" ? { code } : {}),
      error: unavailable ? "云数据库正在初始化，请稍后重试" : message,
      ...(Array.isArray(conflictOrderIds) ? { conflictOrderIds } : {}),
      ...(typeof revision === "number" ? { revision } : {}),
    },
    { status: unavailable ? 500 : Number.isInteger(status) ? status : 500 },
  );
}

export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
