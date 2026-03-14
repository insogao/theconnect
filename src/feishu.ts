import * as lark from '@larksuiteoapi/node-sdk';
import { loadConfig } from './config.js';
import type { BridgeConfig } from './types.js';

export interface FeishuMessageEvent {
  sender: {
    sender_id?: { open_id?: string };
  };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
  };
}

export function extractFeishuText(messageType: string, contentJson: string): string {
  let raw = '';

  if (messageType === 'text') {
    try {
      const content = JSON.parse(contentJson) as { text?: string };
      raw = content.text ?? '';
    } catch {
      raw = contentJson;
    }
  } else if (messageType === 'post') {
    try {
      type PostBlock = { tag: string; text?: string };
      type PostLang = { content?: PostBlock[][] };
      const content = JSON.parse(contentJson) as Record<string, PostLang>;
      const lang = content.zh_cn ?? content.en_us ?? Object.values(content)[0];
      const pieces: string[] = [];
      for (const line of lang?.content ?? []) {
        for (const block of line) {
          if (block.tag === 'text' && block.text) pieces.push(block.text);
        }
      }
      raw = pieces.join(' ').trim();
    } catch {
      raw = '';
    }
  }

  return raw.replace(/^(@\S+\s*)+/, '').trim();
}

export async function startFeishuBridge(
  config: BridgeConfig,
  handleText: (chatId: string, text: string, onProgress?: (chars: number) => void) => Promise<string>,
): Promise<void> {
  const client = new lark.Client({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    loggerLevel: lark.LoggerLevel.warn,
  });

  const wsClient = new lark.WSClient({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    loggerLevel: lark.LoggerLevel.warn,
  });

  // Dedup: track recently processed message IDs (last 5 minutes)
  const processedIds = new Map<string, number>();
  const DEDUP_TTL_MS = 5 * 60 * 1000;
  const cleanupDedup = (): void => {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    for (const [id, ts] of processedIds) {
      if (ts < cutoff) processedIds.delete(id);
    }
  };

  const sendReply = async (messageId: string, text: string): Promise<void> => {
    await client.im.message.reply({
      path: { message_id: messageId },
      data: { msg_type: 'text', content: JSON.stringify({ text }) },
    });
  };

  wsClient.start({
    eventDispatcher: new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: FeishuMessageEvent) => {
        const message = data.message;
        if (!message) return;

        // Dedup: skip if already processed
        cleanupDedup();
        if (processedIds.has(message.message_id)) return;
        processedIds.set(message.message_id, Date.now());

        const text = extractFeishuText(message.message_type, message.content ?? '');
        if (!text) return;

        const chatId = message.chat_type === 'p2p'
          ? (data.sender?.sender_id?.open_id ?? message.chat_id)
          : message.chat_id;

        // Immediate typing indicator as an emoji reaction (Typing is a valid Feishu emoji code)
        await client.im.messageReaction.create({
          path: { message_id: message.message_id },
          data: { reaction_type: { emoji_type: 'Typing' } },
        }).catch(() => undefined);

        const startTime = Date.now();
        let outputChars = 0;
        // Re-read interval from disk on each message so web UI changes take effect immediately
        const intervalMs = ((loadConfig()?.statusIntervalSecs) ?? config.statusIntervalSecs ?? 180) * 1000;
        // Send a "still running" status reply at configured interval — shows live token estimate
        const statusTimer = setInterval(() => {
          const tokenEst = Math.ceil(outputChars / 3.5);
          const elapsedSec = Math.round((Date.now() - startTime) / 1000);
          const mins = Math.floor(elapsedSec / 60);
          const secs = elapsedSec % 60;
          const elapsed = mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
          const tokenInfo = outputChars > 0 ? `已收到约 ${tokenEst} tokens` : '等待回复中';
          sendReply(message.message_id, `⏳ 正在运行中... ${tokenInfo}，已用 ${elapsed}`).catch(() => undefined);
        }, intervalMs);

        try {
          const reply = await handleText(chatId, text, (chars) => { outputChars = chars; });
          clearInterval(statusTimer);
          await sendReply(message.message_id, reply);
        } catch (err) {
          clearInterval(statusTimer);
          const msg = err instanceof Error ? err.message : String(err);
          await sendReply(message.message_id, `❌ 出错了：${msg}`);
        }
      },
    }),
  });

  console.log('[feishu] Bot connected. Waiting for messages...');
}
