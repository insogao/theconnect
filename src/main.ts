import { requireConfig } from './config.js';
import { OpenAICodexRuntime } from './codex.js';
import { startFeishuBridge } from './feishu.js';
import { RemoteMonitor } from './remote-monitor.js';
import { createRouter } from './router.js';
import { JsonSessionStore } from './session-store.js';
import { CodexTargetProvider } from './targets.js';
import { startWebUi } from './web.js';

async function main(): Promise<void> {
  const config = requireConfig();
  const targetProvider = new CodexTargetProvider();

  const remoteMonitor = new RemoteMonitor(() => targetProvider.listTargets());

  const router = createRouter({
    targetProvider,
    sessionStore: new JsonSessionStore(),
    codexRuntime: new OpenAICodexRuntime(),
    remoteMonitor,
  });

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Codex Feishu Bridge v2 — Slash Workflow   ║');
  console.log('╚══════════════════════════════════════════════╝');

  startWebUi(targetProvider);
  const { sendToChat } = await startFeishuBridge(
    config,
    (chatId, text, onProgress) => router.handleText(chatId, text, onProgress),
  );

  // Wire the Feishu send function into the monitor so it can push notifications
  remoteMonitor.setSendFn(sendToChat);
}

main().catch((error) => {
  console.error('[fatal]', error instanceof Error ? error.message : error);
  process.exit(1);
});
