export interface BridgeConfig {
  feishuAppId: string;
  feishuAppSecret: string;
  openaiApiKey?: string;
  defaultWorkingDirectory?: string;
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

export interface CodexRuntime {
  sendToThread(target: Target, message: string): Promise<string>;
  createThread(workingDirectory?: string): Promise<Target>;
}

export interface RouterDependencies {
  targetProvider: TargetProvider;
  sessionStore: SessionStore;
  codexRuntime: CodexRuntime;
}

export interface ParsedTemporaryRoute {
  targetToken: string;
  message: string;
}
