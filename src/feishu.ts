import * as lark from '@larksuiteoapi/node-sdk';
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
  handleText: (chatId: string, text: string) => Promise<string>,
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

        const text = extractFeishuText(message.message_type, message.content ?? '');
        if (!text) return;

        const chatId = message.chat_type === 'p2p'
          ? (data.sender?.sender_id?.open_id ?? message.chat_id)
          : message.chat_id;

        // Immediate typing indicator
        await sendReply(message.message_id, '⌨️').catch(() => undefined);

        const startTime = Date.now();
        // Send a "still running" status every 3 minutes
        const statusTimer = setInterval(() => {
          const elapsedSec = Math.round((Date.now() - startTime) / 1000);
          const mins = Math.floor(elapsedSec / 60);
          const secs = elapsedSec % 60;
          const elapsed = mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
          sendReply(message.message_id, `⏳ 正在运行中... 已用 ${elapsed}`).catch(() => undefined);
        }, 3 * 60 * 1000);

        try {
          const reply = await handleText(chatId, text);
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
