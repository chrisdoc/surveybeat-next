// @effect-diagnostics nodeBuiltinImport:off -- the harness reads migration files from disk outside a Worker; the Effect FileSystem service does not exist there.

import { createHash } from "node:crypto";
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

const sqlFiles = (directory: URL): string[] =>
  readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();

const sha256 = (directory: URL, file: string): string =>
  createHash("sha256")
    .update(readFileSync(new URL(file, directory)))
    .digest("hex");

export const migrationHistoryDrift = (directory: URL, lockFile: URL): string[] => {
  const lock: unknown = JSON.parse(readFileSync(lockFile, "utf8"));

  const locked = new Map(
    typeof lock === "object" && lock !== null
      ? Object.entries(lock).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      : [],
  );

  const onDisk = sqlFiles(directory);
  const drift: string[] = [];

  for (const file of onDisk) {
    const hash = sha256(directory, file);
    const expected = locked.get(file);

    if (expected === undefined) {
      drift.push(`${file} is new: add "${file}": "${hash}" to the lock file`);
    } else if (expected !== hash) {
      drift.push(`${file} changed after it was locked: restore it and put the change in a new migration`);
    }
  }

  for (const file of locked.keys()) {
    if (!onDisk.includes(file)) {
      drift.push(`${file} is locked but missing: applied migrations are never deleted`);
    }
  }

  return drift;
};
