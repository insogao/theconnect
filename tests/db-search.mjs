import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';

const files = [
  join(homedir(), '.codex', 'state_5.sqlite'),
  join(homedir(), '.codex', 'sqlite', 'codex-dev.db'),
  join(homedir(), '.codex', 'logs_1.sqlite'),
];

for (const file of files) {
  const db = new DatabaseSync(file, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  console.log('DB', file);
  for (const table of tables) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    const textCols = cols.filter((c) => /TEXT/i.test(String(c.type))).map((c) => c.name);
    for (const col of textCols) {
      try {
        const rowsByThread = db.prepare(`SELECT ${col} AS value FROM ${table} WHERE CAST(${col} AS TEXT) LIKE ? LIMIT 5`).all('%019cea2a%');
        if (rowsByThread.length) {
          console.log('MATCH thread', table, col, rowsByThread.map((r) => String(r.value).slice(0, 160)));
        }
        const rowsByTitle = db.prepare(`SELECT ${col} AS value FROM ${table} WHERE LOWER(CAST(${col} AS TEXT)) LIKE ? LIMIT 5`).all('%clarify user intent%');
        if (rowsByTitle.length) {
          console.log('MATCH title', table, col, rowsByTitle.map((r) => String(r.value).slice(0, 160)));
        }
      } catch {
        // ignore bad casts or virtual tables
      }
    }
  }
  console.log('---');
  db.close();
}
