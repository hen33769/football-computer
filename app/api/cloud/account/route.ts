import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { accountNameError, normalizeAccountName } from "../../../cloud";
import { routeError } from "../../../cloud-server";

export async function POST(request: Request) {
  try {
    const identity = await getChatGPTUser();
    if (!identity) return Response.json({ error: "请先登录" }, { status: 401 });

    const payload = await request.json() as { account?: unknown };
    const account = typeof payload.account === "string" ? payload.account.normalize("NFKC").trim() : "";
    const validationError = accountNameError(account);
    if (validationError) return Response.json({ error: validationError }, { status: 400 });

    const db = getDb();
    const authSubject = identity.email.trim().toLocaleLowerCase("en-US");
    const [existing] = await db
      .select({ id: users.id, account: users.account, role: users.role })
      .from(users)
      .where(eq(users.authSubject, authSubject))
      .limit(1);
    if (existing) return Response.json({ account: existing });

    const [firstUser] = await db.select({ id: users.id }).from(users).limit(1);
    const id = crypto.randomUUID();
    const role = firstUser ? "user" : "admin";

    try {
      await db.insert(users).values({
        id,
        authSubject,
        account,
        normalizedAccount: normalizeAccountName(account),
        role,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/unique|constraint/i.test(message)) {
        return Response.json({ error: "该账号已经被使用，请换一个账号" }, { status: 409 });
      }
      throw error;
    }

    return Response.json({ account: { id, account, role } }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
