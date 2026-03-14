import { spawn } from 'node:child_process';
import type { CodexRuntime, Target } from './types.js';

/** Strip ANSI escape sequences from CLI output */
function stripAnsi(str: string): string {
  return str
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1B\][^\x07]*\x07/g, '')
    .replace(/\x1B[()][AB012]/g, '');
}

/**
 * Invokes the local Codex CLI (`npx codex exec resume`) which uses the
 * already-authenticated ~/.codex/auth.json — no API key required.
 */
export class LocalCodexRuntime implements CodexRuntime {
  async sendToThread(target: Target, message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        'npx',
        ['codex', 'exec', 'resume', target.threadId, message, '--full-auto'],
        {
          cwd: target.workingDirectory,
          env: { ...process.env },
        },
      );

      const outChunks: string[] = [];
      const errChunks: string[] = [];

      proc.stdout.on('data', (data: Buffer) => outChunks.push(data.toString()));
      proc.stderr.on('data', (data: Buffer) => errChunks.push(data.toString()));

      proc.on('close', (code: number | null) => {
        const reply = stripAnsi(outChunks.join('')).trim();
        if (reply) {
          resolve(reply);
        } else if (code !== 0) {
          const errText = stripAnsi(errChunks.join('')).slice(0, 300);
          reject(new Error(`codex 退出码 ${code}${errText ? ': ' + errText : ''}`));
        } else {
          resolve('Codex 已处理，但没有返回可显示文本。');
        }
      });

      proc.on('error', (err: Error) => {
        reject(new Error(`无法启动 codex CLI: ${err.message}`));
      });
    });
  }

  async createThread(workingDirectory?: string): Promise<Target> {
    const cwd = workingDirectory ?? process.cwd();
    const now = Math.floor(Date.now() / 1000);
    return {
      slot: 'NEW',
      threadId: 'pending-thread-id',
      title: '(新会话)',
      workspaceName: cwd.split('/').filter(Boolean).at(-1) ?? cwd,
      workingDirectory: cwd,
      createdAt: now,
      updatedAt: now,
    };
  }
}

/** Backward-compat alias */
export const OpenAICodexRuntime = LocalCodexRuntime;

export class MockCodexRuntime implements CodexRuntime {
  public readonly calls: Array<{ kind: 'send' | 'new'; target?: Target; message?: string; cwd?: string }> = [];

  constructor(private readonly replyPrefix = 'MOCK_REPLY') {}

  async sendToThread(target: Target, message: string): Promise<string> {
    this.calls.push({ kind: 'send', target, message });
    return `${this.replyPrefix}:${target.slot}:${message}`;
  }

  async createThread(workingDirectory?: string): Promise<Target> {
    this.calls.push({ kind: 'new', cwd: workingDirectory });
    const cwd = workingDirectory || '/tmp/mock-workspace';
    const now = Math.floor(Date.now() / 1000);

    return {
      slot: '999',
      threadId: 'mock-thread-id',
      title: '(新会话)',
      workspaceName: cwd.split('/').filter(Boolean).at(-1) ?? cwd,
      workingDirectory: cwd,
      createdAt: now,
      updatedAt: now,
    };
  }
}
