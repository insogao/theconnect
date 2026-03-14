import type {
  ChatState,
  ParsedTemporaryRoute,
  RouterDependencies,
  Target,
} from './types.js';
import { formatAbsoluteTime, formatRelativeTime } from './time.js';

function trimCodeTicks(value: string): string {
  return value.replace(/^`+|`+$/g, '').trim();
}

function findRecommended4testTarget(targets: Target[]): Target | undefined {
  return targets.find((item) => item.workspaceName.toLowerCase() === '4test');
}

function resolveSlotFromAlias(state: ChatState, aliasOrSlot: string): string | undefined {
  if (/^\d+$/.test(aliasOrSlot)) return aliasOrSlot;
  return state.aliases[aliasOrSlot];
}

function parseTemporaryRoute(text: string): ParsedTemporaryRoute | null {
  const match = text.trim().match(/^#([^\s]+)\s+([\s\S]+)$/);
  if (!match) return null;
  return {
    targetToken: trimCodeTicks(match[1]),
    message: match[2].trim(),
  };
}

function formatTargetLine(target: Target, state: ChatState): string {
  const aliases = Object.entries(state.aliases)
    .filter(([, slot]) => slot === target.slot)
    .map(([alias]) => alias);
  const aliasSuffix = aliases.length > 0 ? `，别名：${aliases.map((item) => `#${item}`).join(' / ')}` : '';
  const timeSuffix = `，更新时间：${formatRelativeTime(target.updatedAt)}`;
  return `${target.slot} - [${target.workspaceName}] ${target.title}${aliasSuffix}${timeSuffix}`;
}

export class BridgeRouter {
  constructor(private readonly deps: RouterDependencies) {}

  private listTargets(): Target[] {
    return this.deps.targetProvider.listTargets();
  }

  private findTarget(slot: string): Target | undefined {
    return this.deps.targetProvider.findBySlot(slot);
  }

  private getState(chatId: string): ChatState {
    return this.deps.sessionStore.getChatState(chatId);
  }

  private helpText(chatId: string): string {
    const targets = this.listTargets();
    const state = this.getState(chatId);
    const current = state.currentTargetSlot ? this.findTarget(state.currentTargetSlot) : undefined;
    const recommended4test = findRecommended4testTarget(targets);

    const lines = [
      '会话命令',
      '/list - 列出全部目标',
      '/列表 - 列出全部目标',
      '#101 你的问题 - 临时发给 101',
      '#小高 你的问题 - 临时发给别名',
      '/go 101 - 切换默认目标',
      '/切换 101 - 切换默认目标',
      '/where - 查看当前默认目标',
      '/当前 - 查看当前默认目标',
      '/rename 小高 - 给当前目标起别名',
      '/改名 小高 - 给当前目标起别名',
      '/new [path] - 在指定目录新建会话',
      '/remote - 开启/关闭远程监控（桌面端 Codex 回复自动推送）',
      '/remote stream - 流式模式，含过程消息',
      '/远程 - 开启/关闭远程监控',
      '/help - 显示帮助',
      '/帮助 - 显示帮助',
    ];

    if (!current) {
      lines.push('');
      lines.push('当前还没有默认目标。');
      if (recommended4test) {
        lines.push(`建议先实验：/go ${recommended4test.slot} （4test）`);
      } else {
        lines.push('建议先实验：/list，然后 /go 目标编号');
      }
    }

    return lines.join('\n');
  }

  private listText(chatId: string): string {
    const targets = this.listTargets();
    const state = this.getState(chatId);
    if (targets.length === 0) {
      return '当前没有发现任何目标。请先在本地使用 Codex 创建线程。';
    }

    // Group targets by workspaceName, preserving order of first appearance
    const workspaceOrder: string[] = [];
    const workspaceMap = new Map<string, Target[]>();
    for (const target of targets) {
      if (!workspaceMap.has(target.workspaceName)) {
        workspaceOrder.push(target.workspaceName);
        workspaceMap.set(target.workspaceName, []);
      }
      workspaceMap.get(target.workspaceName)!.push(target);
    }

    const lines = ['全部目标'];
    for (const wsName of workspaceOrder) {
      const group = workspaceMap.get(wsName)!;
      const wsPath = group[0].workingDirectory;
      lines.push('');
      lines.push(`[工作区] ${wsName}`);
      lines.push(`路径：${wsPath}`);
      for (const target of group) {
        const currentMark = state.currentTargetSlot === target.slot ? '【当前】' : '';
        lines.push(`${formatTargetLine(target, state)} ${currentMark}`.trim());
      }
    }
    lines.push('');
    lines.push('可执行：/go 编号，或者直接发送 #编号 你的问题');
    return lines.join('\n');
  }

  private goText(chatId: string, slotToken: string): string {
    const state = this.getState(chatId);
    const resolvedSlot = resolveSlotFromAlias(state, trimCodeTicks(slotToken));
    if (!resolvedSlot) {
      return `找不到目标：${slotToken}\n请先 /list 查看可用目标。`;
    }
    const target = this.findTarget(resolvedSlot);
    if (!target) {
      return `找不到目标：${slotToken}\n请先 /list 查看可用目标。`;
    }
    this.deps.sessionStore.setCurrentTarget(chatId, target.slot);
    return [
      `已切换默认目标：${target.slot}`,
      `标题：${target.title}`,
      `工作区：${target.workspaceName}`,
      `路径：${target.workingDirectory}`,
      `更新时间：${formatRelativeTime(target.updatedAt)}（${formatAbsoluteTime(target.updatedAt)}）`,
      '现在直接发送普通消息，就会发到这个目标。',
    ].join('\n');
  }

  private whereText(chatId: string): string {
    const state = this.getState(chatId);
    if (!state.currentTargetSlot) {
      const recommended4test = findRecommended4testTarget(this.listTargets());
      return [
        '当前还没有默认目标。',
        recommended4test
          ? `建议先执行：/go ${recommended4test.slot} （4test）`
          : '建议先执行：/list，然后 /go 目标编号',
      ].join('\n');
    }

    const target = this.findTarget(state.currentTargetSlot);
    if (!target) {
      return '当前默认目标已失效，请重新 /list 后再 /go。';
    }

    const alias = Object.entries(state.aliases).find(([, slot]) => slot === target.slot)?.[0];
    return [
      `当前默认目标：${target.slot}`,
      `标题：${target.title}`,
      `工作区：${target.workspaceName}`,
      `路径：${target.workingDirectory}`,
      `更新时间：${formatRelativeTime(target.updatedAt)}（${formatAbsoluteTime(target.updatedAt)}）`,
      `别名：${alias ? alias : '（未设置）'}`,
    ].join('\n');
  }

  private renameText(chatId: string, alias: string): string {
    const cleanAlias = trimCodeTicks(alias).replace(/^#+/, '').trim();
    if (!cleanAlias) {
      return '请提供别名，例如：/rename 小高';
    }

    const state = this.getState(chatId);
    if (!state.currentTargetSlot) {
      return '当前还没有默认目标，无法改名。请先 /go 目标编号。';
    }

    const target = this.findTarget(state.currentTargetSlot);
    if (!target) {
      return '当前默认目标已失效，请先 /list 后再 /go。';
    }

    const existingSlot = state.aliases[cleanAlias];
    if (existingSlot && existingSlot !== target.slot) {
      return `别名 ${cleanAlias} 已被 ${existingSlot} 占用，请换一个。`;
    }

    this.deps.sessionStore.setAlias(chatId, cleanAlias, target.slot);
    return `已将 ${target.slot} 设置别名为 #${cleanAlias}`;
  }

  private remoteText(chatId: string, raw: string): string {
    const monitor = this.deps.remoteMonitor;
    if (!monitor) return '远程监控功能未启用（remoteMonitor 未注入）。';
    const wantStream = /stream|流式|详细/i.test(raw);
    const mode = wantStream ? 'stream' : 'final';
    const enabled = monitor.toggle(chatId, mode);
    if (enabled) {
      const modeLabel = mode === 'stream' ? '流式（含过程）' : '默认（仅最终回复）';
      return [
        `✅ 远程监控已开启 — ${modeLabel}`,
        '',
        '当 Codex 桌面端的任意 session 有新 AI 回复时，会自动推送到此对话。',
        mode === 'stream'
          ? '💭 过程消息（phase=commentary）和 📩 最终回复都会发送。'
          : '📩 只发送最终回复（phase=final_answer），过滤掉中间思考步骤。',
        '',
        '再次发送 /remote 可关闭；发送 /remote stream 可切换到流式模式。',
      ].join('\n');
    } else {
      return '🔕 远程监控已关闭。';
    }
  }

  private async newText(chatId: string, rawPath: string): Promise<string> {
    const workingDirectory = trimCodeTicks(rawPath) || undefined;
    const target = await this.deps.codexRuntime.createThread(workingDirectory);
    this.deps.sessionStore.setCurrentTarget(chatId, target.slot);
    return [
      `已新建会话：${target.threadId}`,
      `工作区：${target.workspaceName}`,
      `路径：${target.workingDirectory}`,
      `更新时间：${formatRelativeTime(target.updatedAt)}（${formatAbsoluteTime(target.updatedAt)}）`,
      '提示：新会话写入本地数据库后，/list 会出现正式编号。',
    ].join('\n');
  }

  private async sendTemporary(chatId: string, route: ParsedTemporaryRoute, onProgress?: import('./types.js').ProgressCallback): Promise<string> {
    const state = this.getState(chatId);
    const resolvedSlot = resolveSlotFromAlias(state, route.targetToken);
    if (!resolvedSlot) {
      return `找不到目标：${route.targetToken}\n请先 /list 查看可用目标。`;
    }

    const target = this.findTarget(resolvedSlot);
    if (!target) {
      return `找不到目标：${route.targetToken}\n请先 /list 查看可用目标。`;
    }

    const monitor = this.deps.remoteMonitor;
    monitor?.suppress(target.threadId);
    try {
      const reply = await this.deps.codexRuntime.sendToThread(target, route.message, onProgress);
      return [`临时发送到 ${target.slot} (${target.workspaceName})`, '', reply].join('\n');
    } finally {
      monitor?.unsuppress(target.threadId);
    }
  }

  private async sendDefault(chatId: string, message: string, onProgress?: import('./types.js').ProgressCallback): Promise<string> {
    const state = this.getState(chatId);
    if (!state.currentTargetSlot) {
      const recommended4test = findRecommended4testTarget(this.listTargets());
      return [
        '当前还没有默认目标。',
        '请先：',
        '1. /list',
        recommended4test ? `2. /go ${recommended4test.slot} （4test）` : '2. /go 目标编号',
        '3. 再发送普通消息',
        '或者直接使用：#编号 你的问题',
      ].join('\n');
    }

    const target = this.findTarget(state.currentTargetSlot);
    if (!target) {
      return '当前默认目标已失效，请重新 /list 并 /go。';
    }

    const monitor = this.deps.remoteMonitor;
    monitor?.suppress(target.threadId);
    try {
      return await this.deps.codexRuntime.sendToThread(target, message, onProgress);
    } finally {
      monitor?.unsuppress(target.threadId);
    }
  }

  async handleText(chatId: string, text: string, onProgress?: import('./types.js').ProgressCallback): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed) return '收到空消息。';

    if (trimmed === '/help' || trimmed === '/帮助') {
      return this.helpText(chatId);
    }
    if (trimmed === '/list' || trimmed === '/列表') {
      return this.listText(chatId);
    }
    if (trimmed.startsWith('/go ') || trimmed.startsWith('/切换 ')) {
      const token = trimmed.split(/\s+/, 2)[1] ?? '';
      return this.goText(chatId, token);
    }
    if (trimmed === '/where' || trimmed === '/当前') {
      return this.whereText(chatId);
    }
    if (trimmed.startsWith('/rename ') || trimmed.startsWith('/改名 ')) {
      const alias = trimmed.split(/\s+/, 2)[1] ?? '';
      return this.renameText(chatId, alias);
    }
    if (trimmed === '/new' || trimmed.startsWith('/new ')) {
      return this.newText(chatId, trimmed.slice('/new'.length));
    }
    if (trimmed === '/remote' || trimmed === '/远程' || trimmed.startsWith('/remote ') || trimmed.startsWith('/远程 ')) {
      return this.remoteText(chatId, trimmed);
    }

    const tempRoute = parseTemporaryRoute(trimmed);
    if (tempRoute) {
      return this.sendTemporary(chatId, tempRoute, onProgress);
    }

    return this.sendDefault(chatId, trimmed, onProgress);
  }
}

export function createRouter(deps: RouterDependencies): BridgeRouter {
  return new BridgeRouter(deps);
}
