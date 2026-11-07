import * as Cloudflare from "@alchemy.run/cloudflare";

/** Absolute, so the path does not depend on the directory Alchemy is started from. */
const migrations = new URL("../d1-migrations", import.meta.url).pathname;

/** The global index (SPEC §6.2): sign-in lookups, the session deny list, and email routing. No survey content. */
export const Database = Cloudflare.D1.Database("Database", { migrations });
