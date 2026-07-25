import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, missingPdfConfig } from './config.js';
import {
  getSession,
  hasAssistantReply,
  hasUserMessage,
  sessionSources,
} from './sessions.js';
import { generateConsultationPdf } from './pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfPrompt = fs
  .readFileSync(path.join(__dirname, 'prompts', 'pdf-system-prompt.txt'), 'utf8')
  .trim();

function extractJson(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || '').trim());
}

function asStringArray(value, max = 30) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function validatePdfPayload(raw, allowedSources) {
  const allowed = new Map(
    (allowedSources || [])
      .filter((s) => isHttpUrl(s.url))
      .map((s) => [String(s.url).trim(), { title: String(s.title || ''), url: String(s.url).trim() }])
  );

  const status = raw?.status === 'READY' ? 'READY' : 'NEEDS_REVIEW';
  const sources = [];
  for (const item of Array.isArray(raw?.sources) ? raw.sources : []) {
    const url = String(item?.url || '').trim();
    if (!allowed.has(url)) continue;
    sources.push(allowed.get(url));
  }
  if (!sources.length) {
    for (const source of allowed.values()) sources.push(source);
  }

  const legalReferences = [];
  for (const item of Array.isArray(raw?.legalReferences) ? raw.legalReferences : []) {
    const name = String(item?.name || '').trim();
    const article = String(item?.article || '').trim();
    const url = String(item?.url || '').trim();
    if (!name && !article) continue;
    if (url && !allowed.has(url) && !isHttpUrl(url)) continue;
    if (url && !allowed.has(url)) {
      legalReferences.push({ name, article, url: '' });
    } else {
      legalReferences.push({ name, article, url: allowed.has(url) ? url : '' });
    }
  }

  let warning = String(raw?.warning || '').trim();
  const missingInformation = asStringArray(raw?.missingInformation);
  if (!sources.length || missingInformation.length) {
    if (status === 'READY') {
      warning =
        warning ||
        'Для итогового документа требуется дополнительная проверка: подтверждённых данных недостаточно.';
    }
  }

  return {
    title: String(raw?.title || 'Итог консультации').trim() || 'Итог консультации',
    marketplace: String(raw?.marketplace || '').trim(),
    situation: String(raw?.situation || '').trim(),
    facts: asStringArray(raw?.facts),
    legalAssessment: String(raw?.legalAssessment || '').trim(),
    legalReferences,
    recommendations: asStringArray(raw?.recommendations),
    demands: asStringArray(raw?.demands),
    missingInformation,
    sources,
    status:
      !sources.length || missingInformation.length || status !== 'READY'
        ? 'NEEDS_REVIEW'
        : 'READY',
    warning,
    checkedAt: new Date().toISOString(),
  };
}

function isEnoughForPdf(session) {
  const userText = (session.messages || [])
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ');
  const assistantText = (session.messages || [])
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content)
    .join(' ');
  return (
    hasUserMessage(session) &&
    hasAssistantReply(session) &&
    userText.length >= 20 &&
    assistantText.length >= 80
  );
}

async function structureSession(session) {
  const missing = missingPdfConfig();
  if (missing.length) {
    const err = new Error('Для продолжения требуется настройка серверного API');
    err.code = 'CONFIG';
    throw err;
  }

  const allowedSources = sessionSources(session);
  const payload = {
    dialog: session.messages.map((m) => ({
      role: m.role,
      content: m.content,
      sources: m.sources || [],
      warnings: m.warnings || [],
    })),
    citations: allowedSources,
  };

  const base = config.pdfModel.baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  let response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.pdfModel.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.pdfModel.model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: pdfPrompt },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error('Не удалось сформировать PDF');
    err.code = 'PDF';
    throw err;
  }

  const parsed = extractJson(body?.choices?.[0]?.message?.content || '');
  if (!parsed) {
    const err = new Error('Ответ модели не удалось обработать');
    err.code = 'PDF';
    throw err;
  }

  return validatePdfPayload(parsed, allowedSources);
}

export async function handleChatPdf(sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    const err = new Error('Сессия завершилась. Начните новый диалог');
    err.code = 'SESSION';
    throw err;
  }
  if (!isEnoughForPdf(session)) {
    const err = new Error(
      'Для формирования документа пока недостаточно данных. Уточните обстоятельства ситуации'
    );
    err.code = 'VALIDATION';
    throw err;
  }

  const structured = await structureSession(session);
  const pdf = await generateConsultationPdf(structured);
  return { pdf, structured };
}
