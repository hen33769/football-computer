import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** 使用真实 SQLite 执行服务端 SQL，模拟 D1 batch 的整批事务语义。 */
export class SqliteD1 {
  readonly database = new DatabaseSync(":memory:");
  beforeBatch?: () => void;

  constructor() {
    for (const migration of ["0000_white_iron_lad", "0002_modular_cloud_data", "0003_order_payment_status"]) {
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
      all: async () => ({ results: numbered ? query.all(bindings()) : query.all(...parameters), success: true }),
      first: async () => (numbered ? query.get(bindings()) : query.get(...parameters)) ?? null,
      run: async () => ({ success: true, meta: numbered ? query.run(bindings()) : query.run(...parameters) }),
    };
    return statement;
  }

  async batch(statements: ReturnType<SqliteD1["prepare"]>[]) {
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
  }

  asD1() {
    return this as unknown as D1Database;
  }
}
