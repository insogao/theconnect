import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRIDGE_HOME } from './config.js';
import type { ChatState, SessionStore } from './types.js';

interface SessionFile {
  chats: Record<string, ChatState>;
}

const SESSION_PATH = join(BRIDGE_HOME, 'sessions.json');

function normalizeState(state?: ChatState): ChatState {
  return {
    currentTargetSlot: state?.currentTargetSlot,
    aliases: { ...(state?.aliases ?? {}) },
  };
}

export class JsonSessionStore implements SessionStore {
  private load(): SessionFile {
    if (!existsSync(BRIDGE_HOME)) {
      mkdirSync(BRIDGE_HOME, { recursive: true });
    }
    if (!existsSync(SESSION_PATH)) {
      return { chats: {} };
    }
    return JSON.parse(readFileSync(SESSION_PATH, 'utf8')) as SessionFile;
  }

  private save(file: SessionFile): void {
    if (!existsSync(BRIDGE_HOME)) {
      mkdirSync(BRIDGE_HOME, { recursive: true });
    }
    writeFileSync(SESSION_PATH, JSON.stringify(file, null, 2), 'utf8');
  }

  getChatState(chatId: string): ChatState {
    const file = this.load();
    return normalizeState(file.chats[chatId]);
  }

  setCurrentTarget(chatId: string, slot: string): void {
    const file = this.load();
    const current = normalizeState(file.chats[chatId]);
    current.currentTargetSlot = slot;
    file.chats[chatId] = current;
    this.save(file);
  }

  setAlias(chatId: string, alias: string, slot: string): void {
    const file = this.load();
    const current = normalizeState(file.chats[chatId]);

    for (const [name, mappedSlot] of Object.entries(current.aliases)) {
      if (mappedSlot === slot && name !== alias) {
        delete current.aliases[name];
      }
    }

    current.aliases[alias] = slot;
    file.chats[chatId] = current;
    this.save(file);
  }

  removeAlias(chatId: string, alias: string): void {
    const file = this.load();
    const current = normalizeState(file.chats[chatId]);
    delete current.aliases[alias];
    file.chats[chatId] = current;
    this.save(file);
  }

  clearChat(chatId: string): void {
    const file = this.load();
    delete file.chats[chatId];
    this.save(file);
  }
}

export class MemorySessionStore implements SessionStore {
  private readonly chats = new Map<string, ChatState>();

  getChatState(chatId: string): ChatState {
    return normalizeState(this.chats.get(chatId));
  }

  setCurrentTarget(chatId: string, slot: string): void {
    const current = this.getChatState(chatId);
    current.currentTargetSlot = slot;
    this.chats.set(chatId, current);
  }

  setAlias(chatId: string, alias: string, slot: string): void {
    const current = this.getChatState(chatId);
    for (const [name, mappedSlot] of Object.entries(current.aliases)) {
      if (mappedSlot === slot && name !== alias) {
        delete current.aliases[name];
      }
    }
    current.aliases[alias] = slot;
    this.chats.set(chatId, current);
  }

  removeAlias(chatId: string, alias: string): void {
    const current = this.getChatState(chatId);
    delete current.aliases[alias];
    this.chats.set(chatId, current);
  }

  clearChat(chatId: string): void {
    this.chats.delete(chatId);
  }
}
