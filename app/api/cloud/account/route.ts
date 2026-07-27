import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { accountNameError, normalizeAccountName } from "../../../cloud";
import {
  clearSessionCookie,
  createAccountSession,
  deleteAccountSession,
  routeError,
  sessionCookie,
} from "../../../cloud-server";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { account?: unknown };
    const account = typeof payload.account === "string" ? payload.account.normalize("NFKC").trim() : "";
    const validationError = accountNameError(account);
    if (validationError) return Response.json({ error: validationError }, { status: 400 });

    const db = getDb();
    const normalizedAccount = normalizeAccountName(account);
    const [existing] = await db
      .select({ id: users.id, account: users.account, role: users.role })
      .from(users)
      .where(eq(users.normalizedAccount, normalizedAccount))
      .limit(1);
    let resolved = existing;
    let created = false;

    if (!resolved) {
      const [firstUser] = await db.select({ id: users.id }).from(users).limit(1);
      const id = crypto.randomUUID();
      const role = firstUser ? "user" : "admin";

      try {
        await db.insert(users).values({
          id,
          authSubject: `account:${normalizedAccount}`,
          account,
          normalizedAccount,
          role,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/unique|constraint/i.test(message)) {
          return Response.json({ error: "该账号刚刚被占用，请重新输入" }, { status: 409 });
        }
        throw error;
      }
      resolved = { id, account, role };
      created = true;
    }

    const session = await createAccountSession(resolved.id);
    const response = Response.json({ account: resolved, created }, { status: created ? 201 : 200 });
    response.headers.append("Set-Cookie", sessionCookie(session.token));
    return response;
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await deleteAccountSession(request);
    const response = Response.json({ ok: true });
    response.headers.append("Set-Cookie", clearSessionCookie());
    return response;
  } catch (error) {
    return routeError(error);
  }
}
