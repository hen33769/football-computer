import { getD1 } from "../../../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../../../cloud-server";
import { previewFullDataImport } from "../../../../../../server/data-backup-service";
import type { BackupImportStrategy } from "../../../../../../data-backup";

export async function POST(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const payload = await request.json() as { backup?: unknown; strategy?: unknown };
    return Response.json(await previewFullDataImport(
      getD1(),
      authenticated.value.account.id,
      payload.backup,
      payload.strategy as BackupImportStrategy,
    ));
  } catch (error) {
    return routeError(error);
  }
}
