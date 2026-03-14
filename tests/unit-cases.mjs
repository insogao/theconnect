#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { extractFeishuText } from '../dist/feishu.js';
import { MockCodexRuntime } from '../dist/codex.js';
import { createRouter } from '../dist/router.js';
import { MemorySessionStore } from '../dist/session-store.js';
import { StaticTargetProvider, listTargetsFromDb } from '../dist/targets.js';
import { formatRelativeTime } from '../dist/time.js';

const targets = [
  {
    slot: '101',
    threadId: 'thread-101',
    title: 'Clarify user intent',
    workspaceName: '4test',
    workingDirectory: '/Users/demo/4test',
    createdAt: 1710000000,
    updatedAt: 1,
  },
  {
    slot: '102',
    threadId: 'thread-102',
    title: 'Build router layer',
    workspaceName: 'alpha',
    workingDirectory: '/Users/demo/alpha',
    createdAt: 1710003600,
    updatedAt: 2,
  },
];

const store = new MemorySessionStore();
const runtime = new MockCodexRuntime();
const router = createRouter({
  targetProvider: new StaticTargetProvider(targets),
  sessionStore: store,
  codexRuntime: runtime,
});

const chatId = 'chat-unit-1';
let passed = 0;

async function test(name, fn) {
  await fn();
  console.log(`✅ ${name}`);
  passed += 1;
}

await test('extractFeishuText: text', async () => {
  assert.equal(extractFeishuText('text', '{"text":"/help"}'), '/help');
});

await test('extractFeishuText: strip mention', async () => {
  assert.equal(extractFeishuText('text', '{"text":"@Bot /list"}'), '/list');
});

await test('extractFeishuText: post', async () => {
  assert.equal(
    extractFeishuText('post', JSON.stringify({ zh_cn: { content: [[{ tag: 'text', text: '/list' }]] } })),
    '/list',
  );
});

await test('/help 显示 slash 命令并推荐 4test', async () => {
  const result = await router.handleText(chatId, '/help');
  assert.match(result, /会话命令/);
  assert.match(result, /\/go 101/);
});

await test('/list 返回目标列表', async () => {
  const result = await router.handleText(chatId, '/list');
  assert.match(result, /101 - \[4test\]/);
  assert.match(result, /102 - \[alpha\]/);
  assert.match(result, /更新时间：/);
});

await test('/go 101 设置默认目标', async () => {
  const result = await router.handleText(chatId, '/go 101');
  assert.match(result, /已切换默认目标：101/);
});

await test('/where 显示当前目标', async () => {
  const result = await router.handleText(chatId, '/where');
  assert.match(result, /当前默认目标：101/);
  assert.match(result, /4test/);
});

await test('/rename 设置别名', async () => {
  const result = await router.handleText(chatId, '/rename 小高');
  assert.match(result, /#小高/);
});

await test('#小高 临时消息不改变默认目标', async () => {
  const result = await router.handleText(chatId, '#小高 你好');
  assert.match(result, /临时发送到 101/);
  const where = await router.handleText(chatId, '/where');
  assert.match(where, /当前默认目标：101/);
});

await test('普通消息走默认目标', async () => {
  const result = await router.handleText(chatId, '继续处理');
  assert.equal(result, 'MOCK_REPLY:101:继续处理');
});

await test('未绑定时普通消息提示 /list', async () => {
  const freshRouter = createRouter({
    targetProvider: new StaticTargetProvider(targets),
    sessionStore: new MemorySessionStore(),
    codexRuntime: new MockCodexRuntime(),
  });
  const result = await freshRouter.handleText('chat-unit-2', 'hello');
  assert.match(result, /当前还没有默认目标/);
  assert.match(result, /\/list/);
});

await test('未知编号提示错误', async () => {
  const result = await router.handleText(chatId, '/go 999');
  assert.match(result, /找不到目标/);
});

await test('别名冲突提示错误', async () => {
  await router.handleText(chatId, '/go 102');
  const result = await router.handleText(chatId, '/rename 小高');
  assert.match(result, /别名 小高 已被/);
});

await test('/new 调用 runtime.createThread', async () => {
  const result = await router.handleText(chatId, '/new /tmp/demo');
  assert.match(result, /已新建会话/);
  assert.equal(runtime.calls.at(-1)?.kind, 'new');
});

await test('formatRelativeTime 输出中文相对时间', async () => {
  assert.equal(formatRelativeTime(1000, 1000 * 1000 + 3 * 86400 * 1000), '3 天前');
});

await test('listTargetsFromDb 会过滤掉工作目录不存在的线程', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-db-'));
  const dbPath = path.join(tmpRoot, 'state.sqlite');
  const sessionIndexPath = path.join(tmpRoot, 'session_index.jsonl');
  const liveCwd = path.join(tmpRoot, 'live-workspace');
  const deadCwd = path.join(tmpRoot, 'missing-workspace');
  fs.mkdirSync(liveCwd, { recursive: true });
  const liveRollout = path.join(tmpRoot, 'live.jsonl');
  const deadRollout = path.join(tmpRoot, 'dead.jsonl');
  fs.writeFileSync(liveRollout, 'live');
  fs.writeFileSync(deadRollout, 'dead');

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      model_provider TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      sandbox_policy TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      has_user_event INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      archived_at INTEGER,
      git_sha TEXT,
      git_branch TEXT,
      git_origin_url TEXT,
      cli_version TEXT NOT NULL DEFAULT '',
      first_user_message TEXT NOT NULL DEFAULT '',
      agent_nickname TEXT,
      agent_role TEXT,
      memory_mode TEXT NOT NULL DEFAULT 'enabled'
    );
    CREATE TABLE stage1_outputs (
      thread_id TEXT PRIMARY KEY,
      source_updated_at INTEGER NOT NULL,
      raw_memory TEXT NOT NULL,
      rollout_summary TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      rollout_slug TEXT
    );
  `);
  const insert = db.prepare(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      sandbox_policy, approval_mode, tokens_used, has_user_event, archived, cli_version, first_user_message, memory_mode
    ) VALUES (?, ?, ?, ?, 'vscode', 'openai', ?, ?, '{}', 'never', 0, 0, 0, '0.0.0', ?, 'enabled')
  `);
  insert.run('thread-live', liveRollout, 1, 2, liveCwd, 'Live title', 'Live first');
  insert.run('thread-dead', deadRollout, 1, 2, deadCwd, 'Dead title', 'Dead first');
  db.close();

  fs.writeFileSync(sessionIndexPath, `${JSON.stringify({ id: 'thread-live', thread_name: 'Desktop Live Title', updated_at: '2026-03-14T10:26:20.000Z' })}\n`);

  const targetsFromDb = listTargetsFromDb(dbPath, sessionIndexPath);
  assert.equal(targetsFromDb.length, 1);
  assert.equal(targetsFromDb[0].workspaceName, 'live-workspace');
  assert.equal(targetsFromDb[0].title, 'Desktop Live Title');
  assert.equal(targetsFromDb[0].updatedAt, Math.floor(Date.parse('2026-03-14T10:26:20.000Z') / 1000));
});

await test('旧版 {} sessions.json 不会导致 /list 崩溃', async () => {
  const home = path.join(os.tmpdir(), `bridge-home-${Date.now()}`);
  const bridgeHome = path.join(home, '.codex-feishu-bridge');
  fs.mkdirSync(bridgeHome, { recursive: true });
  fs.writeFileSync(path.join(bridgeHome, 'sessions.json'), '{}');

  const output = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import { JsonSessionStore } from './dist/session-store.js'; const store = new JsonSessionStore(); console.log(JSON.stringify(store.getChatState('chat-old-format')));",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  }).trim();

  assert.equal(output, '{"aliases":{}}');
});

console.log(`\n单元测试完成：${passed} 项通过`);
