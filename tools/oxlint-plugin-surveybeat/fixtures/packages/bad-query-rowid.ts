const sql = (strings: TemplateStringsArray) => strings[0];
export const bad = sql`SELECT rowid, id FROM submission`;
