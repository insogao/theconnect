import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Target, TargetProvider } from './types.js';

interface ThreadRow {
  id: string;
  rollout_path: string;
  created_at: number;
  cwd: string;
  title: string | null;
  first_user_message: string | null;
  updated_at: number;
  rollout_slug: string | null;
}

const CODEX_DB_PATH = join(homedir(), '.codex', 'state_5.sqlite');

function normalizeTitle(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > 72 ? `${oneLine.slice(0, 69)}…` : oneLine;
}

function pickTitle(row: ThreadRow): string {
  const slug = row.rollout_slug?.trim();
  if (slug) return normalizeTitle(slug);
  const title = row.title?.trim();
  if (title && title !== '?') return normalizeTitle(title);
  const firstLine = row.first_user_message?.trim().split('\n')[0]?.trim();
  if (firstLine && firstLine !== '?') return normalizeTitle(firstLine);
  return '(新线程)';
}

export function listTargetsFromDb(dbPath = CODEX_DB_PATH): Target[] {
  if (!existsSync(dbPath)) {
    throw new Error(`未找到 Codex 数据库：${dbPath}`);
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare(`
    SELECT
      t.id,
      t.rollout_path,
      t.created_at,
      t.cwd,
      t.title,
      t.first_user_message,
      t.updated_at,
      s.rollout_slug
    FROM threads t
    LEFT JOIN stage1_outputs s ON s.thread_id = t.id
    WHERE COALESCE(t.archived, 0) = 0
    ORDER BY t.cwd ASC, t.updated_at DESC, t.id ASC
  `).all() as unknown as ThreadRow[];
  db.close();

  const visibleRows = rows.filter((row) => existsSync(row.cwd) && existsSync(row.rollout_path));

  return visibleRows.map((row, index) => ({
    slot: String(101 + index),
    threadId: row.id,
    title: pickTitle(row),
    workspaceName: basename(row.cwd),
    workingDirectory: row.cwd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export class CodexTargetProvider implements TargetProvider {
  private readonly dbPath: string;

  constructor(dbPath = CODEX_DB_PATH) {
    this.dbPath = dbPath;
  }

  listTargets(): Target[] {
    return listTargetsFromDb(this.dbPath);
  }

  findBySlot(slot: string): Target | undefined {
    return this.listTargets().find((item) => item.slot === slot);
  }
}

export class StaticTargetProvider implements TargetProvider {
  constructor(private readonly targets: Target[]) {}

  listTargets(): Target[] {
    return [...this.targets];
  }

  findBySlot(slot: string): Target | undefined {
    return this.targets.find((item) => item.slot === slot);
  }
}
