import { GoogleGenAI } from '@google/genai';
import { config, providerLabel } from './config.js';

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

function uniqueSources(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = (item.url || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || '').trim());
}

function looksOfficial(url, marketplace) {
  const host = String(url || '').toLowerCase();
  const m = String(marketplace || '').toLowerCase();
  if (m.includes('ozon')) return /ozon\.ru|docs\.ozon/.test(host);
  if (m.includes('wildberries') || m.includes('wb')) {
    return /wildberries\.ru|wb\.ru|seller\.wildberries/.test(host);
  }
  if (m.includes('яндекс') || m.includes('yandex')) {
    return /yandex\.ru|market\.yandex/.test(host);
  }
  if (m.includes('avito')) return /avito\.ru/.test(host);
  return false;
}

function collectPolzaCitations(payload) {
  const sources = [];
  const msg = payload?.choices?.[0]?.message || {};
  const bags = [
    msg.annotations,
    payload?.annotations,
    msg.citations,
    payload?.citations,
  ].filter(Boolean);

  for (const bag of bags) {
    if (!Array.isArray(bag)) continue;
    for (const item of bag) {
      const citation = item?.url_citation || item;
      const url = citation?.url || item?.url || '';
      const title = citation?.title || item?.title || '';
      const quote = citation?.content || citation?.quote || item?.content || '';
      if (!isHttpUrl(url)) continue;
      sources.push({
        title: String(title || ''),
        url: String(url).trim(),
        quote: String(quote || ''),
      });
    }
  }

  return uniqueSources(sources);
}

function collectGoogleSources(groundingMetadata) {
  const sources = [];
  const chunks = groundingMetadata?.groundingChunks || [];
  for (const chunk of chunks) {
    const web = chunk.web || chunk.Web;
    if (!web?.uri && !web?.url) continue;
    const url = web.uri || web.url;
    if (!isHttpUrl(url)) continue;
    sources.push({
      title: web.title || '',
      url,
      quote: '',
    });
  }

  const supports = groundingMetadata?.groundingSupports || [];
  for (const support of supports) {
    const indices = support.groundingChunkIndices || [];
    const quote = support.segment?.text || '';
    for (const index of indices) {
      if (sources[index] && quote && !sources[index].quote) {
        sources[index].quote = quote;
      }
    }
  }

  return uniqueSources(sources);
}

function mergeQuotesFromModel(apiSources, parsedSources) {
  const byUrl = new Map(apiSources.map((s) => [s.url, { ...s }]));
  if (!Array.isArray(parsedSources)) return [...byUrl.values()];

  for (const s of parsedSources) {
    if (!s?.url || !byUrl.has(s.url)) continue;
    const cur = byUrl.get(s.url);
    byUrl.set(s.url, {
      title: cur.title || String(s.title || ''),
      url: s.url,
      quote: cur.quote || String(s.quote || ''),
    });
  }
  return [...byUrl.values()];
}

function normalizeResult({
  provider,
  input,
  parsed,
  apiSources,
  checkedAt,
  extraWarnings = [],
}) {
  const sources = mergeQuotesFromModel(apiSources, parsed?.sources);
  const warnings = [
    ...(Array.isArray(parsed?.warnings) ? parsed.warnings.map(String) : []),
    ...extraWarnings,
  ];

  const clauseText = String(parsed?.clauseText || '').trim();
  const summary = String(parsed?.summary || '').trim();
  const officialCount = sources.filter((s) =>
    looksOfficial(s.url, input.marketplace)
  ).length;

  if (!apiSources.length) {
    warnings.push('Нет подтверждённых citations от поискового провайдера.');
  }
  if (!clauseText) {
    warnings.push('Конкретный текст пункта оферты не подтверждён источниками.');
  }
  if (sources.length && officialCount === 0) {
    warnings.push(
      'Найдены только сторонние источники, официальная страница маркетплейса не подтверждена citations.'
    );
  }
  warnings.push(
    'Сниппет или краткая выдержка не считаются полным текстом оферты.'
  );
  if (provider === 'polza') {
    warnings.push(
      'Поиск выполнен через Polza / Perplexity Sonar Web Search with citations, не через Google Search Grounding.'
    );
  }

  const confidenceRaw = Number(parsed?.confidence);
  let confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0;

  const modelVerified = Boolean(parsed?.verified);
  const modelStatus = String(parsed?.status || '').toUpperCase();
  const canVerify =
    modelVerified &&
    modelStatus === 'VERIFIED' &&
    clauseText &&
    apiSources.length > 0 &&
    officialCount > 0;

  if (modelStatus === 'VERIFIED' && !canVerify) {
    warnings.push(
      'Модель заявила VERIFIED, но citations недостаточны для подтверждения.'
    );
  }

  if (!confidence && canVerify) confidence = 0.65;
  if (!confidence && apiSources.length) confidence = officialCount ? 0.45 : 0.25;
  if (!canVerify) {
    confidence = Math.min(confidence || 0, officialCount ? 0.55 : 0.35);
  }

  const quotesMissing = sources.some((s) => !s.quote);
  if (quotesMissing) {
    warnings.push(
      'Для части источников нет связанной выдержки quote из citations.'
    );
  }

  return {
    provider,
    providerLabel: providerLabel(provider),
    marketplace: String(parsed?.marketplace || input.marketplace || ''),
    clauseNumber: String(parsed?.clauseNumber || input.clauseNumber || ''),
    clauseText,
    summary,
    sources,
    checkedAt,
    confidence,
    verified: Boolean(canVerify),
    status: canVerify ? 'VERIFIED' : 'NEEDS_REVIEW',
    warnings: [...new Set(warnings.filter(Boolean))],
  };
}

function searchPrompt(input, checkedAt, providerNote) {
  return `Найди актуальную редакцию оферты/правил маркетплейса и текст указанного пункта.

Маркетплейс: ${input.marketplace}
Номер пункта: ${input.clauseNumber}
Описание ситуации: ${input.penaltyDescription}
Поисковый запрос от юриста: ${input.searchQuery}
Дата проверки: ${checkedAt}

Требования:
- ${providerNote}
- Приоритет — официальные страницы маркетплейса.
- Не придумывай URL и текст пункта.
- clauseText — только найденный/процитированный текст пункта (не интерпретация).
- summary — краткая интерпретация отдельно от clauseText.
- Если пункт не найден или источники слабые/противоречивые — verified=false, status="NEEDS_REVIEW".
- Сниппет не считать полным текстом оферты.
- В JSON-поле sources не добавляй URL, которых нет в реальных citations провайдера.

Верни ТОЛЬКО JSON:
{
  "marketplace": "",
  "clauseNumber": "",
  "clauseText": "",
  "summary": "",
  "sources": [{"title":"","url":"","quote":""}],
  "checkedAt": "${checkedAt}",
  "confidence": 0,
  "verified": false,
  "status": "NEEDS_REVIEW",
  "warnings": []
}`;
}

async function runPolzaSearch(input) {
  const checkedAt = new Date().toISOString();
  const base = config.search.baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);

  let response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.search.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.search.model,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: searchPrompt(
              input,
              checkedAt,
              'Используй веб-поиск Polza / Perplexity Sonar. Это не Google Search Grounding.'
            ),
          },
        ],
      }),
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const error = new Error('Поисковый запрос превысил таймаут');
      error.code = 'SEARCH_TIMEOUT';
      throw error;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    const error = new Error('Поисковый сервис отклонил доступ');
    error.code = 'SEARCH_AUTH';
    throw error;
  }
  if (!response.ok) {
    const error = new Error('Поисковая модель недоступна');
    error.code = 'SEARCH_PROVIDER';
    throw error;
  }

  const text = body?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(text);
  if (!parsed) {
    const error = new Error('Поисковая модель не вернула валидный JSON');
    error.code = 'SEARCH_JSON';
    throw error;
  }

  const apiSources = collectPolzaCitations(body);
  return normalizeResult({
    provider: 'polza',
    input,
    parsed,
    apiSources,
    checkedAt,
  });
}

async function runGoogleSearch(input) {
  const checkedAt = new Date().toISOString();
  if (!config.search.apiKey || !config.search.model) {
    const error = new Error('Не заданы GOOGLE_API_KEY / SEARCH_MODEL для Google search');
    error.code = 'CONFIG';
    throw error;
  }

  const ai = new GoogleGenAI({ apiKey: config.search.apiKey });
  const response = await ai.models.generateContent({
    model: config.search.model,
    contents: searchPrompt(
      input,
      checkedAt,
      'Используй Google Search Grounding.'
    ),
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0.1,
    },
  });

  const text = response.text || '';
  const parsed = extractJson(text);
  if (!parsed) {
    const error = new Error('Поисковая модель не вернула валидный JSON');
    error.code = 'SEARCH_JSON';
    throw error;
  }

  const candidate = response.candidates?.[0];
  const groundingMetadata =
    candidate?.groundingMetadata || candidate?.grounding_metadata || null;
  const apiSources = collectGoogleSources(groundingMetadata || {});

  const result = normalizeResult({
    provider: 'google',
    input,
    parsed,
    apiSources,
    checkedAt,
    extraWarnings: !groundingMetadata
      ? ['Метаданные Google Search Grounding отсутствуют или пусты.']
      : [],
  });
  return result;
}

export async function runSearch(input) {
  if (config.search.provider === 'google') {
    return runGoogleSearch(input);
  }
  if (config.search.provider === 'polza') {
    return runPolzaSearch(input);
  }
  const error = new Error(
    `Неизвестный SEARCH_PROVIDER: ${config.search.provider}`
  );
  error.code = 'CONFIG';
  throw error;
}
