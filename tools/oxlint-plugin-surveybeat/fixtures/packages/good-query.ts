const sql = (strings: TemplateStringsArray) => strings[0];
export const goodOrder = sql`SELECT * FROM submission ORDER BY id ASC`;
export const goodCount = sql`SELECT COUNT(*) FROM submission`;
export const goodInsert = sql`INSERT INTO submission (id, round_id, edit_key_hash) VALUES (1, 2, 3)`;
