import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** 使用真实 SQLite 执行服务端 SQL，模拟 D1 batch 的整批事务语义。 */
export class SqliteD1 {
  readonly database = new DatabaseSync(":memory:");
  beforeBatch?: () => void;
  private batchQueue: Promise<void> = Promise.resolve();

  constructor() {
    for (const migration of [
      "0000_white_iron_lad",
      "0001_colorful_franklin_richards",
      "0002_modular_cloud_data",
      "0003_order_payment_status",
      "0004_shared_team_names",
      "0005_team_group_icons",
      "0006_team_group_display_order",
      "0007_user_match_notes",
      "0008_user_team_tags",
      "0009_team_tag_import_rate_limits",
      "0010_team_tag_mutation_tokens",
      "0011_order_tax",
      "0012_order_confirmation",
      "0013_finance_correction_ledger",
      "0014_finance_correction_tax",
    ]) {
      this.database.exec(readFileSync(new URL(`../../drizzle/${migration}.sql`, import.meta.url), "utf8"));
    }
  }

  prepare(sql: string) {
    const query = this.database.prepare(sql);
    let parameters: SQLInputValue[] = [];
    const numbered = /\?\d/.test(sql);
    const bindings = () => Object.fromEntries(parameters.map((value, index) => [`?${index + 1}`, value]));
    const statement = {
      bind: (...args: SQLInputValue[]) => {
        parameters = args;
        return statement;
      },
      all: async () => {
        const results = numbered ? query.all(bindings()) : query.all(...parameters);
        const changes = Number(this.database.prepare("SELECT changes() AS changes").get()?.changes ?? 0);
        return { results, success: true, meta: { changes } };
      },
      first: async () => (numbered ? query.get(bindings()) : query.get(...parameters)) ?? null,
      run: async () => ({ success: true, meta: numbered ? query.run(bindings()) : query.run(...parameters) }),
    };
    return statement;
  }

  async batch(statements: ReturnType<SqliteD1["prepare"]>[]) {
    const execute = async () => {
      this.beforeBatch?.();
      this.database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        this.database.exec("COMMIT");
        return results;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    };
    const pending = this.batchQueue.then(execute, execute);
    this.batchQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  asD1() {
    return this as unknown as D1Database;
  }
}
