import type { CodexRuntime, ProgressCallback, Target } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCodex = any;

/**
 * Uses @openai/codex-sdk directly. No API key required —
 * the SDK automatically picks up ~/.codex/auth.json (ChatGPT login).
 *
 * skipGitRepoCheck: true is required when calling from outside the
 * target workspace (which is always the case here).
 *
 * Event flow:
 *   thread.started    → confirms thread ID
 *   item.completed    → item.type === 'agent_message' → item.text  ← AI reply
 *   turn.completed    → all done
 *   turn.failed/error → throw
 */
export class LocalCodexRuntime implements CodexRuntime {
  private codex: AnyCodex | null = null;

  private async getCodex(): Promise<AnyCodex> {
    if (this.codex) return this.codex;
    const mod = await import('@openai/codex-sdk') as AnyCodex;
    const CodexClass = mod.Codex ?? mod.default?.Codex ?? mod.default;
    // No apiKey → SDK reads ~/.codex/auth.json automatically
    this.codex = new CodexClass({});
    return this.codex;
  }

  async sendToThread(target: Target, message: string, onProgress?: ProgressCallback, images?: string[]): Promise<string> {
    const codex = await this.getCodex();
    const thread = codex.resumeThread(target.threadId, {
      workingDirectory: target.workingDirectory,
      approvalPolicy: 'on-request',
      skipGitRepoCheck: true,
    });

    // Build multimodal input when local image paths are provided
    type UserInput = { type: 'text'; text: string } | { type: 'local_image'; path: string };
    const input: string | UserInput[] = images?.length
      ? [
          { type: 'text' as const, text: message },
          ...images.map((p) => ({ type: 'local_image' as const, path: p })),
        ]
      : message;

    const textParts: string[] = [];
    let accChars = 0;
    const { events } = await thread.runStreamed(input);

    for await (const event of events) {
      if (event.type === 'item.completed') {
        const item = event.item as Record<string, unknown>;
        if (item.type === 'agent_message' && typeof item.text === 'string' && item.text) {
          textParts.push(item.text);
          accChars += item.text.length;
          onProgress?.(accChars);
        }
      } else if (event.type === 'turn.completed') {
        // Capture actual token usage from the SDK — this is authoritative
        const usage = (event as Record<string, unknown>).usage as Record<string, unknown> | undefined;
        if (usage && onProgress) {
          const actual = Number(usage.output_tokens ?? 0) + Number(usage.reasoning_output_tokens ?? 0);
          if (actual > 0) onProgress(accChars, actual);
        }
      } else if (event.type === 'turn.failed') {
        const msg = (event as Record<string, unknown>).message;
        throw new Error(`Codex turn failed: ${typeof msg === 'string' ? msg : 'unknown'}`);
      } else if (event.type === 'error') {
        const msg = (event as Record<string, unknown>).message;
        throw new Error(`Codex error: ${typeof msg === 'string' ? msg : 'unknown'}`);
      }
    }

    const reply = textParts.join('').trim();
    return reply || '(Codex 没有返回文字回复)';
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

  async sendToThread(target: Target, message: string, _onProgress?: ProgressCallback, _images?: string[]): Promise<string> {
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
