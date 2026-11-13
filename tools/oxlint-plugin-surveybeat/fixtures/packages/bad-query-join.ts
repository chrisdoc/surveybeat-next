const sql = (strings: TemplateStringsArray) => strings[0];
export const bad = sql`SELECT id FROM submission JOIN participation ON submission.round_id = participation.round_id`;
