import * as Cloudflare from "@alchemy.run/cloudflare";

/** Absolute, so the path does not depend on the directory Alchemy is started from. */
const migrations = new URL("../d1-migrations", import.meta.url).pathname;

/** The global index (see the SPEC). Its first migration is empty. */
export const Database = Cloudflare.D1.Database("Database", { migrations });
