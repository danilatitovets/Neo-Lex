import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { buildSystemPrompt } from './prompts/index.js';

const CLAUDE_TIMEOUT_MS = 120000;

function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    const error = new Error('Модель не вернула валидный JSON');
    error.code = 'SEARCH_JSON';
    throw error;
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    const error = new Error('Модель не вернула валидный JSON');
    error.code = 'SEARCH_JSON';
    throw error;
  }
}

async function callAnthropic(system, user) {
  const client = new Anthropic({
    apiKey: config.claude.apiKey,
    timeout: CLAUDE_TIMEOUT_MS,
  });
  const response = await client.messages.create({
    model: config.claude.model,
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  if (!text) {
    const error = new Error('Пустой ответ от Claude');
    error.code = 'ARCHITECT';
    throw error;
  }
  return text;
}

async function callOpenAICompatible(system, user) {
  const base = config.claude.baseUrl.replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.claude.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.claude.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const error = new Error('Таймаут Claude');
      error.code = 'CLAUDE_TIMEOUT';
      throw error;
    }
    const error = new Error('Ошибка сети Claude');
    error.code = 'ARCHITECT';
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Claude HTTP ${response.status}`);
    error.code = response.status === 401 ? 'CONFIG' : 'ARCHITECT';
    throw error;
  }

  const text = body?.choices?.[0]?.message?.content;
  if (!text) {
    const error = new Error('Пустой ответ от Claude');
    error.code = 'ARCHITECT';
    throw error;
  }
  return text;
}

export async function completeJson(system, user) {
  const text =
    config.claude.provider === 'anthropic'
      ? await callAnthropic(system, user)
      : await callOpenAICompatible(system, user);

  return extractJson(text);
}

const ARCHITECT_STAGE = `Текущий этап: Анализ зацепки (Claude Architect).

В этом прототипе инструменты вызывает серверный оркестратор. Ты НЕ вызываешь tools напрямую и НЕ имитируешь ответы tools.
Логический toolRequest запрашивает внешний поиск; фактический провайдер выбирается сервером (Polza / Google и т.д.).
Твоя задача на этом этапе:
- по входным данным построить первичный юридический скелет претензии;
- явно перечислить факты, требующие проверки через поиск;
- сформировать точный searchQuery для поиска актуальной оферты;
- не выдумывать текст оферты, реквизиты, даты и нормы, которых нет во входных данных;
- не обещать гарантированный исход спора.

Верни ТОЛЬКО валидный JSON без markdown:
{
  "preliminaryPosition": "string",
  "keyArguments": ["string"],
  "factsToVerify": ["string"],
  "searchQuery": "string",
  "assumptions": ["string"],
  "cautions": ["string"],
  "toolRequest": {
    "tool": "web_search",
    "marketplace": "string",
    "clause_number": "string",
    "date": "string",
    "query": "string"
  }
}`;

export async function runArchitect(input) {
  const system = buildSystemPrompt(ARCHITECT_STAGE);
  const user = JSON.stringify(
    {
      marketplace: input.marketplace,
      clauseNumber: input.clauseNumber,
      penaltyDescription: input.penaltyDescription,
      date: input.date,
    },
    null,
    2
  );

  try {
    return await completeJson(system, user);
  } catch (err) {
    if (!err.code) err.code = 'ARCHITECT';
    throw err;
  }
}

const FINAL_QA_STAGE = `Текущий этап: Feedback Loop / финальный QA-контроль (Claude Final QA).

Тебе передан результат внешнего поиска от серверного провайдера.
Важно:
- если provider = polza, это Polza / Perplexity Sonar Web Search with citations, НЕ Google Search Grounding;
- не утверждай, что данные получены через Google Grounding, если provider не google;
- используй только источники из citations/API (поле search.sources);
- не выдумывай новые ссылки.

Твоя задача:
- провести QA по результатам поиска;
- использовать только подтверждённые источниками факты;
- отделять цитату источника от интерпретации;
- если оферту изменили — перестроить логику претензии;
- если подтверждений недостаточно, пункт не найден, или источники слабые — status = "NEEDS_REVIEW";
- если данные достаточны и согласованы — status = "VERIFIED";
- подготовить структурированные данные строго под HTML-шаблон PDF;
- не обещать гарантированный результат спора;
- не выдумывать источники, реквизиты, даты и текст оферты.

Верни ТОЛЬКО валидный JSON без markdown:
{
  "status": "VERIFIED | NEEDS_REVIEW",
  "finalPosition": "string",
  "legalArgumentation": "string",
  "demands": ["string"],
  "clauseNumber": "string",
  "clauseText": "string",
  "usedSources": [{"title":"string","url":"string","quote":"string"}],
  "checkedAt": "string",
  "warnings": ["string"],
  "needsLegalReview": true
}`;

function filterUsedSources(usedSources, allowedSources) {
  const allowed = new Set(
    (allowedSources || [])
      .map((s) => String(s?.url || '').trim())
      .filter((url) => /^https?:\/\//i.test(url))
  );
  return (Array.isArray(usedSources) ? usedSources : [])
    .filter((s) => allowed.has(String(s?.url || '').trim()))
    .map((s) => ({
      title: String(s.title || ''),
      url: String(s.url || '').trim(),
      quote: String(s.quote || ''),
    }));
}

export async function runFinalQa(payload) {
  const system = buildSystemPrompt(FINAL_QA_STAGE);
  const user = JSON.stringify(payload, null, 2);

  let result;
  try {
    result = await completeJson(system, user);
  } catch (err) {
    if (!err.code || err.code === 'SEARCH_JSON') err.code = 'FINAL_QA';
    throw err;
  }

  if (result.status !== 'VERIFIED' && result.status !== 'NEEDS_REVIEW') {
    result.status = 'NEEDS_REVIEW';
  }
  if (typeof result.needsLegalReview !== 'boolean') {
    result.needsLegalReview = result.status === 'NEEDS_REVIEW';
  }
  if (!Array.isArray(result.demands)) result.demands = [];
  if (!Array.isArray(result.warnings)) result.warnings = [];

  result.usedSources = filterUsedSources(
    result.usedSources,
    payload.search?.sources
  );

  if (!payload.search?.clauseText) {
    result.clauseText = '';
  }

  if (payload.search?.status === 'NEEDS_REVIEW') {
    result.status = 'NEEDS_REVIEW';
    result.needsLegalReview = true;
  }

  if (!result.checkedAt) {
    result.checkedAt = payload.search?.checkedAt || '';
  }

  return result;
}
