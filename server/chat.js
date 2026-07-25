import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { config, missingChatConfig, missingSearchConfig } from './config.js';
import { runSearch } from './search.js';
import {
  appendMessage,
  createSession,
  getSession,
  hasAssistantReply,
  sessionSources,
} from './sessions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chatPrompt = fs
  .readFileSync(path.join(__dirname, 'prompts', 'chat-system-prompt.txt'), 'utf8')
  .trim();

const SEARCH_HINTS = [
  /оферт/i,
  /пункт\s*\d/i,
  /\d+\.\d+(\.\d+)?/,
  /актуальн/i,
  /официальн/i,
  /источник/i,
  /ссылк/i,
  /что\s+действует\s+сейчас/i,
  /проверь/i,
  /перепроверь/i,
  /найди\s+(текст|пункт|правил)/i,
  /правил[ао]/i,
  /формулировк/i,
  /подтверд/i,
];

const NO_SEARCH_HINTS = [
  /^(привет|здравствуйте|добрый\s+день|добрый\s+вечер)[\s!.]*$/i,
  /^(да|нет|ок|понял|поняла|хорошо|ясно|спасибо)[\s!.]*$/i,
  /что\s+сначала/i,
  /какие\s+шаги/i,
  /последовательн/i,
];

export function shouldUseSearch(message, session) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (NO_SEARCH_HINTS.some((re) => re.test(text)) && !SEARCH_HINTS.some((re) => re.test(text))) {
    return false;
  }
  if (SEARCH_HINTS.some((re) => re.test(text))) return true;
  const recent = (session?.messages || []).slice(-4).map((m) => m.content).join(' ');
  if (/оферт|пункт|правил|источник/i.test(recent) && /проверь|актуаль|официал|ссылк/i.test(text)) {
    return true;
  }
  return false;
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function callChatCompletion({ messages, stream, model }) {
  const base = config.chat.baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.chat.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: model || config.chat.model,
        temperature: 0.3,
        stream: Boolean(stream),
        messages,
      }),
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function streamModelToClient(res, messages, model) {
  const response = await callChatCompletion({ messages, stream: true, model });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const err = new Error(body?.error?.message || 'chat failed');
    err.code = response.status === 401 ? 'CONFIG' : 'CHAT';
    throw err;
  }

  if (!response.body) {
    const body = await response.json().catch(() => ({}));
    const content = body?.choices?.[0]?.message?.content || '';
    if (content) sseWrite(res, 'delta', { content });
    return content;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const piece = json?.choices?.[0]?.delta?.content || '';
        if (piece) {
          full += piece;
          sseWrite(res, 'delta', { content: piece });
        }
      } catch {
        /* ignore partial json */
      }
    }
  }

  if (!full) {
    const fallback = await callChatCompletion({ messages, stream: false, model });
    const body = await fallback.json().catch(() => ({}));
    if (!fallback.ok) {
      const err = new Error(body?.error?.message || 'chat failed');
      err.code = 'CHAT';
      throw err;
    }
    full = body?.choices?.[0]?.message?.content || '';
    if (full) sseWrite(res, 'delta', { content: full });
  }

  return full;
}

function buildChatMessages(session, searchContext) {
  const history = (session.messages || [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  const messages = [{ role: 'system', content: chatPrompt }, ...history];
  if (searchContext) {
    messages.push({
      role: 'system',
      content: `Результаты внешнего поиска (Polza / Perplexity Sonar). Используй только эти citations и не добавляй новые URL.\n\n${JSON.stringify(searchContext, null, 2)}`,
    });
  }
  return messages;
}

export async function handleChatRequest(req, res) {
  const missing = missingChatConfig();
  if (missing.length) {
    const err = new Error('Для продолжения требуется настройка серверного API');
    err.code = 'CONFIG';
    throw err;
  }

  const incoming = String(req.body?.message || '').trim();
  if (!incoming) {
    const err = new Error('Введите сообщение');
    err.code = 'VALIDATION';
    throw err;
  }
  if (incoming.length > config.sessions.maxMessageChars) {
    const err = new Error('Сообщение слишком длинное');
    err.code = 'VALIDATION';
    throw err;
  }

  let session = getSession(req.body?.sessionId);
  if (!session) {
    if (req.body?.sessionId) {
      const err = new Error('Сессия завершилась. Начните новый диалог');
      err.code = 'SESSION';
      throw err;
    }
    session = createSession();
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  sseWrite(res, 'session', { sessionId: session.id });

  appendMessage(session, {
    id: randomUUID(),
    role: 'user',
    content: incoming,
    createdAt: new Date().toISOString(),
    sources: [],
    warnings: [],
    usedSearch: false,
  });

  let searchResult = null;
  let usedSearch = false;
  const warnings = [];

  try {
    if (shouldUseSearch(incoming, session)) {
      const searchMissing = missingSearchConfig();
      if (searchMissing.length) {
        warnings.push('Поиск временно недоступен: не настроен поисковый API.');
      } else {
        usedSearch = true;
        sseWrite(res, 'status', { message: 'Проверяю актуальные источники…' });
        try {
          searchResult = await runSearch({
            marketplace: '',
            clauseNumber: '',
            penaltyDescription: incoming,
            date: new Date().toISOString().slice(0, 10),
            searchQuery: incoming,
          });
          if (!searchResult?.sources?.length) {
            warnings.push(
              'Мне не удалось подтвердить точный текст этого пункта по официальному источнику. Для итогового документа потребуется дополнительная проверка.'
            );
          }
          if (searchResult?.warnings?.length) {
            warnings.push(...searchResult.warnings.slice(0, 8));
          }
        } catch {
          warnings.push('Не удалось проверить актуальные источники.');
        }
      }
    }

    const searchContext = searchResult
      ? {
          provider: searchResult.provider,
          providerLabel: searchResult.providerLabel,
          status: searchResult.status,
          clauseText: searchResult.clauseText,
          summary: searchResult.summary,
          sources: (searchResult.sources || []).map((s) => ({
            title: s.title,
            url: s.url,
          })),
          warnings: searchResult.warnings || [],
        }
      : null;

    const modelMessages = buildChatMessages(session, searchContext);
    let content = '';
    try {
      content = await streamModelToClient(res, modelMessages, config.chat.model);
    } catch (err) {
      if (config.chat.fallbackModel && config.chat.fallbackModel !== config.chat.model) {
        content = await streamModelToClient(
          res,
          modelMessages,
          config.chat.fallbackModel
        );
      } else {
        throw err;
      }
    }

    if (!String(content || '').trim()) {
      const err = new Error('Ответ модели не удалось обработать');
      err.code = 'CHAT';
      throw err;
    }

    const sources = (searchResult?.sources || []).map((s) => ({
      title: String(s.title || ''),
      url: String(s.url || ''),
    }));

    if (
      usedSearch &&
      !sources.length &&
      !warnings.some((w) => /не удалось подтвердить точный текст/i.test(w))
    ) {
      warnings.push(
        'Мне не удалось подтвердить точный текст этого пункта по официальному источнику. Для итогового документа потребуется дополнительная проверка.'
      );
    }

    const messageId = randomUUID();
    appendMessage(session, {
      id: messageId,
      role: 'assistant',
      content: String(content).trim(),
      createdAt: new Date().toISOString(),
      sources,
      warnings: [...new Set(warnings.filter(Boolean))],
      usedSearch,
    });

    if (sources.length) sseWrite(res, 'sources', { sources });
    if (warnings.length) {
      sseWrite(res, 'warning', { warnings: [...new Set(warnings)] });
    }
    sseWrite(res, 'done', {
      messageId,
      usedSearch,
      canCreatePdf: hasAssistantReply(session),
    });
    res.end();
  } catch (err) {
    const code = err?.code || 'CHAT';
    const message =
      code === 'CONFIG'
        ? 'Для продолжения требуется настройка серверного API'
        : code === 'SESSION'
          ? 'Сессия завершилась. Начните новый диалог'
          : err?.name === 'AbortError'
            ? 'Время ожидания ответа истекло'
            : 'Сервис консультации временно недоступен';
    sseWrite(res, 'error', { message });
    res.end();
  }
}

export function getSessionPublicState(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;
  return {
    sessionId: session.id,
    messages: session.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      sources: m.sources || [],
      warnings: m.warnings || [],
      usedSearch: Boolean(m.usedSearch),
    })),
    sources: sessionSources(session),
    canCreatePdf: hasAssistantReply(session),
  };
}
