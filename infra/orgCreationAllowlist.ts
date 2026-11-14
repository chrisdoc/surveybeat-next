// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import { readFileSync } from "node:fs";
import { EmailAddress } from "@surveybeat/domain";
import * as Schema from "effect/Schema";
import { parse } from "yaml";

export const allowlistFile = new URL("org-creation-allowlist.yaml", import.meta.url);

const AllowlistFile = Schema.Record(Schema.String, Schema.NonEmptyArray(EmailAddress));

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
