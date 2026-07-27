import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
import { getChatGPTUser } from "./chatgpt-auth";
import type { CloudAccount } from "./cloud";

export type AuthenticatedCloudAccount = {
  identity: {
    email: string;
    displayName: string;
  };
  account: CloudAccount;
};

export async function findAuthenticatedCloudAccount(): Promise<
  | { kind: "anonymous" }
  | { kind: "unregistered"; identity: { email: string; displayName: string } }
  | { kind: "ready"; value: AuthenticatedCloudAccount }
> {
  const identity = await getChatGPTUser();
  if (!identity) return { kind: "anonymous" };

  const [row] = await getDb()
    .select({
      id: users.id,
      account: users.account,
      role: users.role,
    })
    .from(users)
    .where(eq(users.authSubject, identity.email.trim().toLocaleLowerCase("en-US")))
    .limit(1);

  const normalizedIdentity = {
    email: identity.email,
    displayName: identity.displayName,
  };
  if (!row) return { kind: "unregistered", identity: normalizedIdentity };

  return {
    kind: "ready",
    value: {
      identity: normalizedIdentity,
      account: {
        id: row.id,
        account: row.account,
        role: row.role,
      },
    },
  };
}

export async function requireAuthenticatedCloudAccount() {
  const result = await findAuthenticatedCloudAccount();
  if (result.kind === "anonymous") {
    return {
      response: Response.json({ error: "请先登录" }, { status: 401 }),
      value: null,
    };
  }
  if (result.kind === "unregistered") {
    return {
      response: Response.json({ error: "请先创建唯一账号" }, { status: 409 }),
      value: null,
    };
  }
  return { response: null, value: result.value };
}

export function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "服务器暂时无法处理请求";
  const unavailable = /no such table|D1 binding|database/i.test(message);
  return Response.json(
    { error: unavailable ? "云数据库正在初始化，请稍后重试" : message },
    { status: 500 },
  );
}

export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
