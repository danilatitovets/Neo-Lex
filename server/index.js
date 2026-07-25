import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { runAnalysis } from './orchestrator.js';
import { generatePdfBuffer } from './pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(publicDir));

function clip(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function rawLength(value) {
  return String(value ?? '').length;
}

const FIELD_NAMES = {
  marketplace: 'маркетплейс',
  clauseNumber: 'номер пункта оферты',
  penaltyDescription: 'описание ситуации',
  date: 'дата проверки',
};

function parseAnalyzeBody(body) {
  const errors = [];
  const tooLong = [];

  if (rawLength(body?.marketplace) > config.limits.marketplace) {
    tooLong.push(FIELD_NAMES.marketplace);
  }
  if (rawLength(body?.clauseNumber) > config.limits.clauseNumber) {
    tooLong.push(FIELD_NAMES.clauseNumber);
  }
  if (rawLength(body?.penaltyDescription) > config.limits.penaltyDescription) {
    tooLong.push(FIELD_NAMES.penaltyDescription);
  }
  if (rawLength(body?.date) > config.limits.date) {
    tooLong.push(FIELD_NAMES.date);
  }

  const marketplace = clip(body?.marketplace, config.limits.marketplace);
  const clauseNumber = clip(body?.clauseNumber, config.limits.clauseNumber);
  const penaltyDescription = clip(
    body?.penaltyDescription,
    config.limits.penaltyDescription
  );
  const date = clip(body?.date, config.limits.date);

  if (!marketplace) errors.push(FIELD_NAMES.marketplace);
  if (!clauseNumber) errors.push(FIELD_NAMES.clauseNumber);
  if (!penaltyDescription) errors.push(FIELD_NAMES.penaltyDescription);
  if (!date) errors.push(FIELD_NAMES.date);

  return {
    marketplace,
    clauseNumber,
    penaltyDescription,
    date,
    errors,
    tooLong,
  };
}

function logServerError(err) {
  const safe = String(err?.message || err || '')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/pza_[A-Za-z0-9_-]+/gi, '[redacted]')
    .replace(/sk-[A-Za-z0-9_-]+/gi, '[redacted]')
    .replace(/AIza[A-Za-z0-9_-]+/gi, '[redacted]')
    .slice(0, 240);
  console.error(`[neo-lex] ${err?.code || 'ERROR'}: ${safe}`);
}

function publicError(err) {
  logServerError(err);

  const byCode = {
    CONFIG: {
      status: 503,
      error: 'Для продолжения требуется настройка серверного API',
    },
    SEARCH_AUTH: {
      status: 502,
      error: 'Поисковый сервис отклонил доступ. Проверьте настройки ключа',
    },
    SEARCH_PROVIDER: {
      status: 502,
      error: 'Не удалось получить данные от поискового сервиса',
    },
    SEARCH_TIMEOUT: {
      status: 504,
      error: 'Время ожидания ответа истекло. Повторите запрос',
    },
    SEARCH_JSON: {
      status: 502,
      error: 'Ответ модели не удалось обработать',
    },
    ARCHITECT: {
      status: 502,
      error: 'Сервис анализа временно недоступен. Попробуйте ещё раз позже',
    },
    FINAL_QA: {
      status: 502,
      error: 'Сервис анализа временно недоступен. Попробуйте ещё раз позже',
    },
    CLAUDE_TIMEOUT: {
      status: 504,
      error: 'Время ожидания ответа истекло. Повторите запрос',
    },
    PDF: {
      status: 500,
      error: 'Не удалось сформировать PDF',
    },
  };

  if (err?.code && byCode[err.code]) return byCode[err.code];
  if (/puppeteer|pdf/i.test(String(err?.message || ''))) return byCode.PDF;

  return {
    status: 500,
    error: 'Сервис анализа временно недоступен. Попробуйте ещё раз позже',
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/analyze', async (req, res) => {
  const input = parseAnalyzeBody(req.body);
  if (input.tooLong.length) {
    const longDesc = input.tooLong.includes(FIELD_NAMES.penaltyDescription);
    return res.status(400).json({
      error: longDesc
        ? 'Описание ситуации слишком длинное'
        : `Слишком длинное значение: ${input.tooLong.join(', ')}`,
    });
  }
  if (input.errors.length) {
    return res.status(400).json({
      error:
        input.errors.length === 1
          ? 'Заполните обязательные поля'
          : `Заполните обязательные поля: ${input.errors.join(', ')}`,
    });
  }

  try {
    const result = await runAnalysis({
      marketplace: input.marketplace,
      clauseNumber: input.clauseNumber,
      penaltyDescription: input.penaltyDescription,
      date: input.date,
    });
    res.json(result);
  } catch (err) {
    const { status, error } = publicError(err);
    res.status(status).json({ error });
  }
});

app.post('/api/generate-pdf', async (req, res) => {
  const body = req.body || {};
  if (body.html || body.filePath || body.path || body.url) {
    return res.status(400).json({
      error: 'Произвольный HTML, URL и пути к файлам не принимаются',
    });
  }

  const marketplace = clip(body.marketplace, config.limits.marketplace);
  const clauseNumber = clip(body.clauseNumber, config.limits.clauseNumber);
  const situation = clip(
    body.situation || body.penaltyDescription,
    Math.max(config.limits.penaltyDescription, 20000)
  );
  const clauseText = clip(body.clauseText, 100000);
  const legalArgumentation = clip(
    body.legalArgumentation || body.finalPosition,
    100000
  );
  const checkedAt = clip(body.checkedAt, 64);
  const status = body.status === 'VERIFIED' ? 'VERIFIED' : 'NEEDS_REVIEW';
  const providerLabel = clip(body.providerLabel || body.searchProviderLabel, 200);
  const preliminaryPosition = clip(body.preliminaryPosition, 100000);
  const warnings = Array.isArray(body.warnings)
    ? body.warnings.slice(0, 50).map((w) => clip(w, 4000))
    : [];

  if (!marketplace || !clauseNumber || !situation) {
    return res.status(400).json({
      error: 'Заполните обязательные поля',
    });
  }

  const demands = Array.isArray(body.demands)
    ? body.demands.slice(0, 40).map((d) => clip(d, 4000))
    : [];
  const usedSources = Array.isArray(body.usedSources || body.sources)
    ? (body.usedSources || body.sources).slice(0, 40).map((s) => ({
        title: clip(s?.title, 500),
        url: clip(s?.url, 2000),
        quote: clip(s?.quote, 4000),
      }))
    : [];

  try {
    const pdf = await generatePdfBuffer({
      marketplace,
      clauseNumber,
      situation,
      clauseText,
      legalArgumentation,
      finalPosition: legalArgumentation,
      preliminaryPosition,
      demands,
      usedSources,
      checkedAt,
      status,
      providerLabel,
      warnings,
    });

    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="neo-lex-claim.pdf"'
    );
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  } catch (err) {
    err.code = err.code || 'PDF';
    const { status: code, error } = publicError(err);
    res.status(code).json({ error });
  }
});

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      error: 'Некорректный формат JSON в запросе',
    });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Тело запроса слишком большое. Сократите текст и повторите.',
    });
  }
  if (res.headersSent) return next(err);
  const { status, error } = publicError(err);
  res.status(status).json({ error });
});

app.listen(config.port, () => {
  console.log(`Neo-Lex listening on http://localhost:${config.port}`);
});
