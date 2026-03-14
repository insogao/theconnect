import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BridgeConfig } from './types.js';

export const BRIDGE_HOME = join(homedir(), '.codex-feishu-bridge');
const CONFIG_PATH = join(BRIDGE_HOME, 'config.json');

function ensureHome(): void {
  if (!existsSync(BRIDGE_HOME)) {
    mkdirSync(BRIDGE_HOME, { recursive: true });
  }
}

export function loadConfig(): BridgeConfig | null {
  ensureHome();
  if (!existsSync(CONFIG_PATH)) return null;
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as BridgeConfig;
}

export function saveConfig(config: BridgeConfig): void {
  ensureHome();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

export function requireConfig(): BridgeConfig {
  const config = loadConfig();
  if (config) return config;
  throw new Error('未找到配置文件。请先在 ~/.codex-feishu-bridge/config.json 写入 feishuAppId 和 feishuAppSecret。');
}
