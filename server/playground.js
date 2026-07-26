import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, missingChatConfig, missingSearchConfig } from './config.js';
import { runSearch } from './search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PLAYGROUND_MODELS = [
  {
    id: 'openai/gpt-4o-mini',
    label: 'GPT-4o mini',
    provider: 'OpenAI',
  },
  {
    id: 'openai/gpt-4o',
    label: 'GPT-4o',
    provider: 'OpenAI',
  },
  {
    id: 'anthropic/claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    provider: 'Anthropic',
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
  },
];

export const PLAYGROUND_DEFAULTS = {
  model: 'openai/gpt-4o-mini',
  temperature: 0,
  maxTokens: 350,
  webSearch: false,
  presencePenalty: 0,
  frequencyPenalty: 0,
  maxSystemChars: 20000,
  maxMessageChars: 4000,
  maxMessages: 20,
  maxHistoryChars: 40000,
  minTokens: 50,
  maxTokensLimit: 4000,
};

const ALLOWED_MODEL_IDS = new Set(PLAYGROUND_MODELS.map((m) => m.id));

let searchCallCount = 0;

export function getPlaygroundSearchCallCount() {
  return searchCallCount;
}

export function resetPlaygroundSearchCallCount() {
  searchCallCount = 0;
}

export function getDefaultSystemPrompt() {
  return fs
    .readFileSync(path.join(__dirname, 'prompts', 'chat-system-prompt.txt'), 'utf8')
    .trim();
}

export function listPlaygroundModels() {
  return {
    models: PLAYGROUND_MODELS.map((m) => ({ ...m })),
    defaultModel: PLAYGROUND_DEFAULTS.model,
    defaults: {
      temperature: PLAYGROUND_DEFAULTS.temperature,
      maxTokens: PLAYGROUND_DEFAULTS.maxTokens,
      webSearch: PLAYGROUND_DEFAULTS.webSearch,
      maxSystemChars: PLAYGROUND_DEFAULTS.maxSystemChars,
      maxMessageChars: PLAYGROUND_DEFAULTS.maxMessageChars,
    },
  };
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function validatePlaygroundBody(body) {
  const missing = missingChatConfig();
  if (missing.length) {
    const err = new Error('Для продолжения требуется настройка серверного API');
    err.code = 'CONFIG';
    throw err;
  }

  const systemPrompt = String(body?.systemPrompt ?? '');
  if (systemPrompt.length > PLAYGROUND_DEFAULTS.maxSystemChars) {
    const err = new Error('Системный промпт слишком длинный');
    err.code = 'VALIDATION';
    throw err;
  }

  const model = String(body?.model || '').trim();
  if (!model) {
    const err = new Error('Выберите модель');
    err.code = 'VALIDATION';
    throw err;
  }
  if (!ALLOWED_MODEL_IDS.has(model)) {
    const err = new Error('Выбранная модель недоступна');
    err.code = 'VALIDATION';
    throw err;
  }

  const temperature = Number(body?.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    const err = new Error('Некорректное значение температуры');
    err.code = 'VALIDATION';
    throw err;
  }

  const maxTokens = Number(body?.maxTokens);
  if (
    !Number.isInteger(maxTokens) ||
    maxTokens < PLAYGROUND_DEFAULTS.minTokens ||
    maxTokens > PLAYGROUND_DEFAULTS.maxTokensLimit
  ) {
    const err = new Error('Некорректное значение макс. токенов');
    err.code = 'VALIDATION';
    throw err;
  }

  if (typeof body?.webSearch !== 'boolean') {
    const err = new Error('Некорректный параметр веб-поиска');
    err.code = 'VALIDATION';
    throw err;
  }

  const rawMessages = Array.isArray(body?.messages) ? body.messages : null;
  if (!rawMessages) {
    const err = new Error('Некорректный формат сообщений');
    err.code = 'VALIDATION';
    throw err;
  }

  const messages = [];
  for (const item of rawMessages.slice(-PLAYGROUND_DEFAULTS.maxMessages)) {
    const role = String(item?.role || '');
    const content = String(item?.content || '').trim();
    if (role === 'system') {
      const err = new Error('Роль system в messages не принимается');
      err.code = 'VALIDATION';
      throw err;
    }
    if (role !== 'user' && role !== 'assistant') {
      const err = new Error('Некорректная роль сообщения');
      err.code = 'VALIDATION';
      throw err;
    }
    if (!content) continue;
    if (content.length > PLAYGROUND_DEFAULTS.maxMessageChars) {
      const err = new Error('Сообщение слишком длинное');
      err.code = 'VALIDATION';
      throw err;
    }
    messages.push({ role, content });
  }

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    const err = new Error('Введите сообщение');
    err.code = 'VALIDATION';
    throw err;
  }

  const historyChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (historyChars > PLAYGROUND_DEFAULTS.maxHistoryChars) {
    const err = new Error('История диалога слишком длинная');
    err.code = 'VALIDATION';
    throw err;
  }

  return {
    systemPrompt,
    model,
    temperature,
    maxTokens,
    webSearch: body.webSearch,
    messages,
  };
}

async function streamCompletion(res, { model, temperature, maxTokens, messages }) {
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
        model,
        temperature,
        max_tokens: maxTokens,
        stream: true,
        presence_penalty: PLAYGROUND_DEFAULTS.presencePenalty,
        frequency_penalty: PLAYGROUND_DEFAULTS.frequencyPenalty,
        messages,
      }),
    });

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
          /* ignore partial */
        }
      }
    }

    return full;
  } finally {
    clearTimeout(timer);
  }
}

export async function handlePlaygroundChat(req, res) {
  const input = validatePlaygroundBody(req.body || {});

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let usedSearch = false;
  let sources = [];
  const warnings = [];

  try {
    if (input.webSearch) {
      const searchMissing = missingSearchConfig();
      if (searchMissing.length) {
        warnings.push('Не удалось выполнить веб-поиск');
      } else {
        usedSearch = true;
        searchCallCount += 1;
        sseWrite(res, 'status', { message: 'Проверяю источники…' });
        try {
          const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
          const searchResult = await runSearch({
            marketplace: '',
            clauseNumber: '',
            penaltyDescription: lastUser?.content || '',
            date: new Date().toISOString().slice(0, 10),
            searchQuery: lastUser?.content || '',
          });
          sources = (searchResult?.sources || [])
            .filter((s) => /^https?:\/\//i.test(String(s.url || '')))
            .map((s) => ({
              title: String(s.title || ''),
              url: String(s.url).trim(),
            }));
          if (!sources.length) {
            warnings.push(
              'Не удалось подтвердить источники по результатам веб-поиска'
            );
          }
          if (searchResult?.warnings?.length) {
            warnings.push(...searchResult.warnings.slice(0, 5));
          }
        } catch {
          warnings.push('Не удалось выполнить веб-поиск');
        }
      }
    }

    const modelMessages = [];
    if (input.systemPrompt.trim()) {
      modelMessages.push({ role: 'system', content: input.systemPrompt });
    }
    modelMessages.push(...input.messages);
    if (usedSearch) {
      modelMessages.push({
        role: 'system',
        content: `Результаты веб-поиска (Polza / Perplexity Sonar). Используй только эти citations и не добавляй новые URL.\n\n${JSON.stringify(
          { sources, warnings },
          null,
          2
        )}`,
      });
    }

    const content = await streamCompletion(res, {
      model: input.model,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      messages: modelMessages,
    });

    if (!String(content || '').trim()) {
      const err = new Error('Ответ модели не удалось обработать');
      err.code = 'CHAT';
      throw err;
    }

    if (sources.length) sseWrite(res, 'sources', { sources });
    if (warnings.length) sseWrite(res, 'warning', { warnings: [...new Set(warnings)] });

    sseWrite(res, 'done', {
      model: input.model,
      usedSearch,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      presencePenalty: PLAYGROUND_DEFAULTS.presencePenalty,
      frequencyPenalty: PLAYGROUND_DEFAULTS.frequencyPenalty,
    });
    res.end();
  } catch (err) {
    const code = err?.code || 'CHAT';
    const message =
      code === 'CONFIG'
        ? 'Для продолжения требуется настройка серверного API'
        : code === 'VALIDATION'
          ? err.message
          : err?.name === 'AbortError'
            ? 'Время ожидания ответа истекло'
            : 'Сервис модели временно недоступен';
    try {
      sseWrite(res, 'error', { message });
      res.end();
    } catch {
      /* ignore */
    }
  }
}
