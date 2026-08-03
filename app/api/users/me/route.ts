import { findAuthenticatedCloudAccount, routeError } from "../../../cloud-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authenticated = await findAuthenticatedCloudAccount(request);
    if (authenticated.kind === "anonymous") {
      return Response.json({ authenticated: false, account: null });
    }
    return Response.json({ authenticated: true, account: authenticated.value.account });
  } catch (error) {
    return routeError(error);
  }
}
