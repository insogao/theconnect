import { requireConfig } from './config.js';
import { OpenAICodexRuntime } from './codex.js';
import { startFeishuBridge } from './feishu.js';
import { createRouter } from './router.js';
import { JsonSessionStore } from './session-store.js';
import { CodexTargetProvider } from './targets.js';
import { startWebUi } from './web.js';

async function main(): Promise<void> {
  const config = requireConfig();
  const targetProvider = new CodexTargetProvider();
  const router = createRouter({
    targetProvider,
    sessionStore: new JsonSessionStore(),
    codexRuntime: new OpenAICodexRuntime(),
  });

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Codex Feishu Bridge v2 — Slash Workflow   ║');
  console.log('╚══════════════════════════════════════════════╝');

  startWebUi(targetProvider);
  await startFeishuBridge(config, (chatId, text) => router.handleText(chatId, text));
}

main().catch((error) => {
  console.error('[fatal]', error instanceof Error ? error.message : error);
  process.exit(1);
});
