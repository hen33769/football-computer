import { getD1 } from "../../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../../cloud-server";
import { commitFullDataImport } from "../../../../../server/data-backup-service";
import type { BackupImportStrategy, BackupInitialBalanceStrategy } from "../../../../../data-backup";

export async function POST(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const payload = await request.json() as Record<string, unknown>;
    return Response.json(await commitFullDataImport(
      getD1(),
      authenticated.value.account.id,
      {
        backup: payload.backup,
        strategy: payload.strategy as BackupImportStrategy,
        initialBalanceStrategy: payload.initialBalanceStrategy as BackupInitialBalanceStrategy,
        requestId: String(payload.requestId ?? ""),
        expectedDataRevision: Number(payload.expectedDataRevision),
        backupDigest: String(payload.backupDigest ?? ""),
      },
    ));
  } catch (error) {
    return routeError(error);
  }
}
