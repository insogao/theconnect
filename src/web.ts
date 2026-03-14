import http from 'node:http';
import { URL } from 'node:url';
import { loadConfig, saveConfig } from './config.js';
import { formatAbsoluteTime, formatRelativeTime } from './time.js';
import type { BridgeConfig, TargetProvider } from './types.js';

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer | string) => {
      data += String(chunk);
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function htmlPage(body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Codex Feishu Bridge</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; background: #f6f7fb; color: #1f2328; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 24px; }
  .card { background: #fff; border-radius: 16px; padding: 18px 20px; margin-bottom: 16px; box-shadow: 0 6px 24px rgba(15,23,42,.06); }
  h1 { margin: 0 0 16px; font-size: 28px; }
  h2 { margin: 0 0 12px; font-size: 18px; }
  ul { padding-left: 20px; }
  .muted { color: #667085; }
  .target { border: 1px solid #eaecf0; border-radius: 12px; padding: 12px; margin-bottom: 10px; }
  .slot { font-weight: 700; color: #6941c6; }
  .title { font-size: 18px; font-weight: 700; margin: 6px 0; }
  .meta { color: #667085; font-size: 13px; line-height: 1.6; }
  label { display: block; font-size: 14px; margin: 12px 0 6px; }
  input { width: 100%; padding: 10px 12px; border: 1px solid #d0d5dd; border-radius: 10px; box-sizing: border-box; }
  button { margin-top: 14px; background: #7c3aed; color: white; border: 0; border-radius: 10px; padding: 10px 14px; cursor: pointer; }
  code { background: #f2f4f7; padding: 2px 6px; border-radius: 6px; }
</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

export function startWebUi(targetProvider: TargetProvider, port = 7547): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `127.0.0.1:${port}`}`);

    if (req.method === 'GET' && url.pathname === '/api/targets') {
      const payload = targetProvider.listTargets().map((target) => ({
        ...target,
        updatedAtText: formatRelativeTime(target.updatedAt),
        updatedAtFull: formatAbsoluteTime(target.updatedAt),
      }));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload, null, 2));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/config') {
      const body = await readBody(req);
      const form = new URLSearchParams(body);
      const current = loadConfig() ?? { feishuAppId: '', feishuAppSecret: '' };
      const next: BridgeConfig = {
        ...current,
        feishuAppId: form.get('feishuAppId') ?? '',
        feishuAppSecret: form.get('feishuAppSecret') ?? '',
        openaiApiKey: form.get('openaiApiKey') ?? '',
        defaultWorkingDirectory: form.get('defaultWorkingDirectory') ?? '',
      };
      saveConfig(next);
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const config = loadConfig();
      const targets = targetProvider.listTargets();
      const targetHtml = targets.map((target) => `
        <div class="target">
          <div><span class="slot">${esc(target.slot)}</span> · <span class="muted">${esc(target.workspaceName)}</span></div>
          <div class="title">${esc(target.title)}</div>
          <div class="meta">
            路径：${esc(target.workingDirectory)}<br/>
            更新时间：${esc(formatRelativeTime(target.updatedAt))}（${esc(formatAbsoluteTime(target.updatedAt))}）<br/>
            线程 ID：${esc(target.threadId)}
          </div>
        </div>`).join('');

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(htmlPage(`
        <div class="card">
          <h1>Codex Feishu Bridge</h1>
          <div class="muted">当前目标列表已过滤：只展示未归档、工作目录仍存在、rollout 文件仍存在的线程。</div>
        </div>
        <div class="card">
          <h2>配置</h2>
          <form method="post" action="/config">
            <label>Feishu App ID</label>
            <input name="feishuAppId" value="${esc(config?.feishuAppId ?? '')}" />
            <label>Feishu App Secret</label>
            <input name="feishuAppSecret" value="${esc(config?.feishuAppSecret ?? '')}" />
            <label>OpenAI API Key</label>
            <input name="openaiApiKey" value="${esc(config?.openaiApiKey ?? '')}" />
            <label>默认工作目录</label>
            <input name="defaultWorkingDirectory" value="${esc(config?.defaultWorkingDirectory ?? '')}" />
            <button type="submit">保存配置</button>
          </form>
        </div>
        <div class="card">
          <h2>目标列表</h2>
          <div class="muted">接口：<code>/api/targets</code></div>
          ${targetHtml || '<div class="muted">当前没有可见目标。</div>'}
        </div>
      `));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });

  server.listen(port, () => {
    console.log(`[web] UI: http://127.0.0.1:${port}`);
  });

  return server;
}
