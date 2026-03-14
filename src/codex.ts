import type { CodexRuntime, Target } from './types.js';

export class OpenAICodexRuntime implements CodexRuntime {
  constructor(private readonly apiKey?: string) {}

  async sendToThread(target: Target, message: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('未配置 openaiApiKey，无法向 Codex 线程发送消息。');
    }

    const { Codex } = await import('@openai/codex-sdk');
    const codex = new Codex({ apiKey: this.apiKey });
    const thread = codex.resumeThread(target.threadId, {
      workingDirectory: target.workingDirectory,
      approvalPolicy: 'on-request',
    });

    const chunks: string[] = [];
    const stream = await thread.runStreamed(message) as unknown as AsyncIterable<Record<string, unknown>>;
    for await (const event of stream) {
      if (event.type === 'thread.message.delta' && typeof event.delta === 'string') {
        chunks.push(event.delta);
      }
      if (event.type === 'thread.message.completed' && typeof event.text === 'string') {
        chunks.push(event.text);
      }
    }

    const reply = chunks.join('').trim();
    return reply || 'Codex 已处理，但没有返回可显示文本。';
  }

  async createThread(workingDirectory?: string): Promise<Target> {
    if (!this.apiKey) {
      throw new Error('未配置 openaiApiKey，无法创建新会话。');
    }

    const { Codex } = await import('@openai/codex-sdk');
    const codex = new Codex({ apiKey: this.apiKey });
    const cwd = workingDirectory || process.cwd();
    const thread = codex.startThread({
      workingDirectory: cwd,
      approvalPolicy: 'on-request',
    });
    const threadId = thread.id ?? 'pending-thread-id';

    const now = Math.floor(Date.now() / 1000);

    return {
      slot: 'NEW',
      threadId,
      title: '(新会话)',
      workspaceName: cwd.split('/').filter(Boolean).at(-1) ?? cwd,
      workingDirectory: cwd,
      createdAt: now,
      updatedAt: now,
    };
  }
}

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
