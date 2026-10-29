"use client";

import type {
  BackupImportPreview,
  BackupImportStrategy,
  BackupInitialBalanceStrategy,
  FullDataBackupV6,
} from "../data-backup";
import type { MatchItem } from "../types";
import { requestJson } from "./http";

export function exportCloudFullDataBackup() {
  return requestJson<FullDataBackupV6>("/api/users/me/backup");
}

export function previewCloudFullDataImport(backup: unknown, strategy: BackupImportStrategy) {
  return requestJson<BackupImportPreview>("/api/users/me/backup/import/preview", {
    method: "POST",
    body: JSON.stringify({ backup, strategy }),
  });
}

export function commitCloudFullDataImport(input: {
  backup: unknown;
  strategy: BackupImportStrategy;
  initialBalanceStrategy: BackupInitialBalanceStrategy;
  requestId: string;
  expectedDataRevision: number;
  backupDigest: string;
}) {
  return requestJson<{
    ok: true;
    strategy: BackupImportStrategy;
    orders: number;
    correctionsAdded: number;
    matches: MatchItem[];
    backupDigest: string;
  }>("/api/users/me/backup/import", { method: "POST", body: JSON.stringify(input) });
}
