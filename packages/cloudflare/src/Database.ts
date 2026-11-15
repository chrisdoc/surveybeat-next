import * as Cloudflare from "@alchemy.run/cloudflare";

const migrations = new URL("../d1-migrations", import.meta.url).pathname;

export const Database = Cloudflare.D1.Database("Database", { migrations });
