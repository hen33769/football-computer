export type PersonalDataRevision = {
  revision: number;
  originId: string;
  updatedAt: string;
};

type RevisionRow = {
  revision: number;
  origin_id: string;
  updated_at: string;
};

export async function ensurePersonalDataRevision(
  d1: D1Database,
  userId: string,
  now = new Date().toISOString(),
) {
  await d1.prepare(`
    INSERT INTO user_personal_data_revisions (user_id, revision, origin_id, updated_at)
    VALUES (?1, 0, ?2, ?3)
    ON CONFLICT(user_id) DO NOTHING
  `).bind(userId, crypto.randomUUID(), now).run();
}

export async function getPersonalDataRevision(d1: D1Database, userId: string): Promise<PersonalDataRevision> {
  await ensurePersonalDataRevision(d1, userId);
  const row = await d1.prepare(`
    SELECT revision, origin_id, updated_at
    FROM user_personal_data_revisions
    WHERE user_id = ?1
  `).bind(userId).first<RevisionRow>();
  return {
    revision: Number(row?.revision ?? 0),
    originId: row?.origin_id ?? "",
    updatedAt: row?.updated_at ?? "",
  };
}

export function guardPersonalDataRevisionStatement(d1: D1Database, userId: string, expectedRevision: number) {
  return d1.prepare(`
    SELECT CASE
      WHEN EXISTS (
        SELECT 1 FROM user_personal_data_revisions
        WHERE user_id = ?1 AND revision = ?2
      ) THEN json('null')
      ELSE json('')
    END
  `).bind(userId, expectedRevision);
}

export function incrementPersonalDataRevisionStatement(d1: D1Database, userId: string, now: string) {
  return d1.prepare(`
    UPDATE user_personal_data_revisions
    SET revision = revision + 1, updated_at = ?1
    WHERE user_id = ?2
  `).bind(now, userId);
}
