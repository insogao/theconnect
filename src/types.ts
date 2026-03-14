export interface BridgeConfig {
  feishuAppId: string;
  feishuAppSecret: string;
  defaultWorkingDirectory?: string;
  /** Seconds between "still running" status replies. Default: 180 */
  statusIntervalSecs?: number;
}

export interface Target {
  slot: string;
  threadId: string;
  title: string;
  workspaceName: string;
  workingDirectory: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatState {
  currentTargetSlot?: string;
  aliases: Record<string, string>;
}

export interface SessionStore {
  getChatState(chatId: string): ChatState;
  setCurrentTarget(chatId: string, slot: string): void;
  setAlias(chatId: string, alias: string, slot: string): void;
  removeAlias(chatId: string, alias: string): void;
  clearChat(chatId: string): void;
}

export interface TargetProvider {
  listTargets(): Target[];
  findBySlot(slot: string): Target | undefined;
}

/**
 * Called with progress info as AI generates:
 * - chars: cumulative output characters received so far
 * - actualTokens: set only once at turn end with real SDK usage (output + reasoning tokens)
 */
export type ProgressCallback = (chars: number, actualTokens?: number) => void;

export interface CodexRuntime {
  sendToThread(target: Target, message: string, onProgress?: ProgressCallback, images?: string[]): Promise<string>;
  createThread(workingDirectory?: string): Promise<Target>;
}

export interface RouterDependencies {
  targetProvider: TargetProvider;
  sessionStore: SessionStore;
  codexRuntime: CodexRuntime;
  remoteMonitor?: import('./remote-monitor.js').RemoteMonitor;
}

export interface ParsedTemporaryRoute {
  targetToken: string;
  message: string;
}
