// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import { readFileSync } from "node:fs";
import { EmailAddress } from "@surveybeat/domain";
import * as Schema from "effect/Schema";
import { parse } from "yaml";

/** The checked-in allowlist file, keyed by stage, with `default` for every stage not listed. */
export const allowlistFile = new URL("org-creation-allowlist.yaml", import.meta.url);

const AllowlistFile = Schema.Record(Schema.String, Schema.NonEmptyArray(EmailAddress));

/**
 * The `ORG_CREATION_ALLOWLIST` value for one stage: its emails, comma-separated.
 * Throws when the file is malformed or names no list for the stage, so a deploy never binds an empty list.
 */
export const allowlistForStage = (yamlText: string, stage: string): string => {
  const lists = Schema.decodeUnknownSync(AllowlistFile)(parse(yamlText));
  const emails = lists[stage] ?? lists["default"];
  if (emails === undefined) {
    throw new Error(`org-creation-allowlist.yaml has no entry for stage "${stage}" and no "default" entry`);
  }
  return emails.join(",");
};

export const readAllowlistForStage = (stage: string): string =>
  allowlistForStage(readFileSync(allowlistFile, "utf8"), stage);
