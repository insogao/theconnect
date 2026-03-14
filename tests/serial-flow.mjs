#!/usr/bin/env node
import assert from 'node:assert/strict';
import { MockCodexRuntime } from '../dist/codex.js';
import { createRouter } from '../dist/router.js';
import { MemorySessionStore } from '../dist/session-store.js';
import { StaticTargetProvider } from '../dist/targets.js';

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
const runtime = new MockCodexRuntime('SERIAL');
const router = createRouter({
  targetProvider: new StaticTargetProvider(targets),
  sessionStore: store,
  codexRuntime: runtime,
});

const chatId = 'chat-serial-1';
const transcript = [];

async function step(input, expected) {
  const output = await router.handleText(chatId, input);
  transcript.push({ input, output });
  if (expected instanceof RegExp) {
    assert.match(output, expected);
  } else {
    assert.equal(output, expected);
  }
  console.log(`✅ ${input}`);
}

await step('/help', /会话命令/);
await step('/list', /101 - \[4test\]/);
await step('/where', /当前还没有默认目标/);
await step('/go 101', /已切换默认目标：101/);
await step('/where', /当前默认目标：101/);
await step('/rename 小高', /#小高/);
await step('#102 临时测试', /临时发送到 102/);
await step('/where', /当前默认目标：101/);
await step('#小高 再发一次', /临时发送到 101/);
await step('默认消息', 'SERIAL:101:默认消息');
await step('/当前', /当前默认目标：101/);

console.log('\n串行测试流程记录');
for (const item of transcript) {
  console.log(`- 输入: ${item.input}`);
  console.log(`  输出: ${item.output.split('\n')[0]}`);
}

console.log('\n串行测试完成：11 步通过');
