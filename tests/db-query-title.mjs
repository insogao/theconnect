import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';

const logsDb = new DatabaseSync(join(homedir(), '.codex', 'logs_1.sqlite'), { readOnly: true });
const rows = logsDb.prepare(`
  SELECT ts, level, thread_id, message
  FROM logs
  WHERE thread_id LIKE ? OR LOWER(message) LIKE ?
  ORDER BY ts DESC
  LIMIT 50
`).all('019cea2a%', '%clarify user intent%');
for (const row of rows) {
  console.log('---');
  console.log(new Date(row.ts).toISOString(), row.level, row.thread_id ?? '');
  console.log(String(row.message).slice(0, 2000));
}
logsDb.close();
