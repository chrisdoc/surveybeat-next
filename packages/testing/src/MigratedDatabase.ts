// @effect-diagnostics nodeBuiltinImport:off -- the harness reads migration files from disk outside a Worker; the Effect FileSystem service does not exist there.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const migratedDatabase = (migrationsDirectory: URL): DatabaseSync => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");

  for (const file of readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(new URL(file, migrationsDirectory), "utf8"));
  }

  return db;
};
