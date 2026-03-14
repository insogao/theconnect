import * as lark from '@larksuiteoapi/node-sdk';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
      type PostBlock = { tag: string; text?: string; user_name?: string };
      type PostLang = { content?: PostBlock[][] };
      const content = JSON.parse(contentJson) as Record<string, PostLang>;
      const lang = content.zh_cn ?? content.en_us ?? Object.values(content)[0];
      const pieces: string[] = [];
      for (const line of lang?.content ?? []) {
        for (const block of line) {
          if (block.tag === 'text' && block.text) pieces.push(block.text);
          // 'a' = link element — grab link text too
          else if (block.tag === 'a' && block.text) pieces.push(block.text);
        }
      }
      raw = pieces.join(' ').trim();
    } catch {
      raw = '';
    }
  } else if (messageType === 'sticker') {
    raw = '(表情包)';
  } else if (messageType === 'image' || messageType === 'file') {
    // Handled via downloadMessageMedia in the event handler; return empty here.
    raw = '';
  }

  return raw.replace(/^(@\S+\s*)+/, '').trim();
}

/**
 * Download an image or file from Feishu and save to a temp file.
 * Returns the list of temp file paths (empty on failure).
 */
async function downloadMessageMedia(
  client: lark.Client,
  messageType: string,
  contentJson: string,
): Promise<Array<{ tmpPath: string; displayName: string }>> {
  const results: Array<{ tmpPath: string; displayName: string }> = [];
  try {
    const content = JSON.parse(contentJson || '{}') as Record<string, unknown>;

    if (messageType === 'image') {
      const imageKey = content.image_key as string | undefined;
      if (imageKey) {
        const tmpPath = path.join(os.tmpdir(), `feishu_img_${Date.now()}.jpg`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resp = await (client.im.image as any).get({ path: { image_key: imageKey } });
        const stream: unknown = (resp as Record<string, unknown>).data ?? resp;
        if (stream instanceof Readable || (stream && typeof (stream as { pipe?: unknown }).pipe === 'function')) {
          await pipeline(stream as Readable, fs.createWriteStream(tmpPath));
          results.push({ tmpPath, displayName: path.basename(tmpPath) });
        }
      }
    } else if (messageType === 'file') {
      const fileKey = content.file_key as string | undefined;
      const fileName = (content.file_name as string | undefined) ?? 'file';
      if (fileKey) {
        const ext = path.extname(fileName) || '';
        const tmpPath = path.join(os.tmpdir(), `feishu_file_${Date.now()}${ext}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resp = await (client.im.file as any).get({ path: { file_key: fileKey } });
        const stream: unknown = (resp as Record<string, unknown>).data ?? resp;
        if (stream instanceof Readable || (stream && typeof (stream as { pipe?: unknown }).pipe === 'function')) {
          await pipeline(stream as Readable, fs.createWriteStream(tmpPath));
          results.push({ tmpPath, displayName: fileName });
        }
      }
    }
  } catch {
    // Ignore download errors; caller will fall back to placeholder text
  }
  return results;
}

export async function startFeishuBridge(
  config: BridgeConfig,
  handleText: (chatId: string, text: string, onProgress?: (chars: number, actualTokens?: number) => void) => Promise<string>,
): Promise<{ sendToChat: (chatId: string, text: string) => Promise<void> }> {
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

        // Send reaction immediately so user always gets feedback that message was received
        await client.im.messageReaction.create({
          path: { message_id: message.message_id },
          data: { reaction_type: { emoji_type: 'Typing' } },
        }).catch(() => undefined);

        // Download media files for image/file messages; build descriptor text
        let mediaPaths: Array<{ tmpPath: string; displayName: string }> = [];
        let text: string;
        if (message.message_type === 'image' || message.message_type === 'file') {
          mediaPaths = await downloadMessageMedia(client, message.message_type, message.content ?? '').catch(() => []);
          if (mediaPaths.length > 0) {
            const list = mediaPaths.map(m => `  - ${m.displayName}: ${m.tmpPath}`).join('\n');
            text = `[收到${message.message_type === 'file' ? '文件' : '图片'}，已下载到本地供 Codex 使用：\n${list}\n]`;
          } else {
            text = message.message_type === 'file' ? '(文件)' : '(图片)';
          }
        } else {
          text = extractFeishuText(message.message_type, message.content ?? '');
        }
        if (!text) return;

        const chatId = message.chat_type === 'p2p'
          ? (data.sender?.sender_id?.open_id ?? message.chat_id)
          : message.chat_id;

        const startTime = Date.now();
        let outputChars = 0;
        let finalTokens = 0;  // actual tokens from turn.completed (set at end of run)
        // Re-read interval from disk on each message so web UI changes take effect immediately
        const intervalMs = ((loadConfig()?.statusIntervalSecs) ?? config.statusIntervalSecs ?? 180) * 1000;
        // Send a "still running" status reply at configured interval
        // Note: chars come in per-item (not streaming), shown as rough proxy until run ends
        const statusTimer = setInterval(() => {
          const elapsedSec = Math.round((Date.now() - startTime) / 1000);
          const mins = Math.floor(elapsedSec / 60);
          const secs = elapsedSec % 60;
          const elapsed = mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
          const tokenInfo = outputChars > 0 ? `已收到 ${outputChars} 字` : 'Codex 思考中...';
          sendReply(message.message_id, `⏳ 正在运行中... ${tokenInfo}，已用 ${elapsed}`).catch(() => undefined);
        }, intervalMs);

        try {
          const reply = await handleText(chatId, text, (chars, actualTokens) => {
            outputChars = chars;
            if (actualTokens) finalTokens = actualTokens;
          });
          clearInterval(statusTimer);
          // Append real token count if we got it from the SDK
          const tokenSuffix = finalTokens > 0 ? `\n\n📊 本轮消耗：${finalTokens} tokens（输出+思考）` : '';
          await sendReply(message.message_id, reply + tokenSuffix);
        } catch (err) {
          clearInterval(statusTimer);
          const msg = err instanceof Error ? err.message : String(err);
          await sendReply(message.message_id, `❌ 出错了：${msg}`);
        } finally {
          // Clean up any downloaded temp files
          for (const { tmpPath } of mediaPaths) {
            fs.unlink(tmpPath, () => undefined);
          }
        }
      },
    }),
  });

  /**
   * Send a proactive message to any Feishu chat (used by RemoteMonitor notifications).
   * Detects receive_id_type from the chatId prefix:
   *   ou_ → open_id (DM)   oc_ → chat_id (group)
   */
  const sendToChat = async (chatId: string, text: string): Promise<void> => {
    const receiveIdType = chatId.startsWith('oc_') ? 'chat_id' : 'open_id';
    await client.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
  };

  console.log('[feishu] Bot connected. Waiting for messages...');
  return { sendToChat };
}
