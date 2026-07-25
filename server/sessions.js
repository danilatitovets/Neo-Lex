import { randomUUID } from 'node:crypto';
import { config } from './config.js';

const sessions = new Map();

function nowIso() {
  return new Date().toISOString();
}

export function cleanupSessions() {
  const ttl = config.sessions.ttlMs;
  const now = Date.now();
  for (const [id, session] of sessions) {
    const last = Date.parse(session.updatedAt || session.createdAt || 0);
    if (!Number.isFinite(last) || now - last > ttl) {
      sessions.delete(id);
    }
  }
  while (sessions.size > config.sessions.maxSessions) {
    let oldestId = null;
    let oldestTs = Infinity;
    for (const [id, session] of sessions) {
      const ts = Date.parse(session.updatedAt || session.createdAt || 0);
      if (ts < oldestTs) {
        oldestTs = ts;
        oldestId = id;
      }
    }
    if (!oldestId) break;
    sessions.delete(oldestId);
  }
}

export function createSession() {
  cleanupSessions();
  const id = randomUUID();
  const stamp = nowIso();
  const session = {
    id,
    createdAt: stamp,
    updatedAt: stamp,
    messages: [],
  };
  sessions.set(id, session);
  return session;
}

export function getSession(sessionId) {
  cleanupSessions();
  if (!sessionId) return null;
  return sessions.get(String(sessionId)) || null;
}

export function touchSession(session) {
  session.updatedAt = nowIso();
  sessions.set(session.id, session);
}

export function deleteSession(sessionId) {
  return sessions.delete(String(sessionId || ''));
}

export function historyCharCount(messages) {
  return (messages || []).reduce(
    (sum, msg) => sum + String(msg.content || '').length,
    0
  );
}

export function appendMessage(session, message) {
  session.messages.push(message);
  while (session.messages.length > config.sessions.maxMessages) {
    session.messages.shift();
  }
  while (
    historyCharCount(session.messages) > config.sessions.maxHistoryChars &&
    session.messages.length > 2
  ) {
    session.messages.shift();
  }
  touchSession(session);
  return message;
}

export function sessionSources(session) {
  const seen = new Set();
  const out = [];
  for (const msg of session.messages || []) {
    for (const source of msg.sources || []) {
      const url = String(source?.url || '').trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      out.push({
        title: String(source?.title || ''),
        url,
      });
    }
  }
  return out;
}

export function hasAssistantReply(session) {
  return (session?.messages || []).some(
    (msg) => msg.role === 'assistant' && String(msg.content || '').trim()
  );
}

export function hasUserMessage(session) {
  return (session?.messages || []).some(
    (msg) => msg.role === 'user' && String(msg.content || '').trim()
  );
}
