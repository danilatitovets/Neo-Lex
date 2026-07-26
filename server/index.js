import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { handleChatRequest } from './chat.js';
import { handleChatPdf } from './chat-pdf.js';
import { deleteSession, getSession } from './sessions.js';
import {
  getDefaultSystemPrompt,
  handlePlaygroundChat,
  listPlaygroundModels,
} from './playground.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const app = express();

app.use(express.json({ limit: '512kb' }));
app.use(express.static(publicDir));

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
    VALIDATION: {
      status: 400,
      error: err?.message || 'Некорректный запрос',
    },
    SESSION: {
      status: 404,
      error: 'Сессия завершилась. Начните новый диалог',
    },
    SEARCH_AUTH: {
      status: 502,
      error: 'Не удалось выполнить веб-поиск',
    },
    SEARCH_PROVIDER: {
      status: 502,
      error: 'Не удалось выполнить веб-поиск',
    },
    SEARCH_TIMEOUT: {
      status: 504,
      error: 'Время ожидания ответа истекло',
    },
    CHAT: {
      status: 502,
      error: 'Сервис модели временно недоступен',
    },
    PDF: {
      status: 500,
      error: 'Не удалось сформировать PDF',
    },
  };
  if (err?.code && byCode[err.code]) {
    if (err.code === 'VALIDATION' && err.message) {
      return { status: 400, error: err.message };
    }
    return byCode[err.code];
  }
  if (err?.name === 'AbortError') {
    return { status: 504, error: 'Время ожидания ответа истекло' };
  }
  return {
    status: 500,
    error: 'Сервис модели временно недоступен',
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/playground/models', (_req, res) => {
  res.json(listPlaygroundModels());
});

app.get('/api/playground/defaults', (_req, res) => {
  const catalog = listPlaygroundModels();
  res.json({
    systemPrompt: getDefaultSystemPrompt(),
    ...catalog.defaults,
    defaultModel: catalog.defaultModel,
  });
});

app.post('/api/playground/chat', async (req, res) => {
  try {
    await handlePlaygroundChat(req, res);
  } catch (err) {
    if (res.headersSent) {
      try {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: publicError(err).error })}\n\n`
        );
        res.end();
      } catch {
        /* ignore */
      }
      return;
    }
    const { status, error } = publicError(err);
    res.status(status).json({ error });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    await handleChatRequest(req, res);
  } catch (err) {
    if (res.headersSent) {
      try {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: publicError(err).error })}\n\n`
        );
        res.end();
      } catch {
        /* ignore */
      }
      return;
    }
    const { status, error } = publicError(err);
    res.status(status).json({ error });
  }
});

app.delete('/api/chat/:sessionId', (req, res) => {
  const id = String(req.params.sessionId || '').trim();
  if (!id) {
    return res.status(400).json({ error: 'Сессия не указана' });
  }
  deleteSession(id);
  res.json({ ok: true });
});

app.get('/api/chat/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Сессия завершилась. Начните новый диалог' });
  }
  res.json({
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
  });
});

app.post('/api/chat/pdf', async (req, res) => {
  if (req.body?.html || req.body?.filePath || req.body?.path || req.body?.url || req.body?.messages) {
    return res.status(400).json({
      error: 'Произвольный HTML, URL, пути и сообщения не принимаются',
    });
  }

  const sessionId = String(req.body?.sessionId || '').trim();
  if (!sessionId) {
    return res.status(400).json({ error: 'Сессия не указана' });
  }

  try {
    const { pdf } = await handleChatPdf(sessionId);
    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="neo-lex-consultation.pdf"'
    );
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  } catch (err) {
    const { status, error } = publicError(err);
    res.status(status).json({ error });
  }
});

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Некорректный формат JSON в запросе' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Тело запроса слишком большое' });
  }
  if (res.headersSent) return next(err);
  const { status, error } = publicError(err);
  res.status(status).json({ error });
});

app.listen(config.port, config.host, () => {
  console.log(`Neo-Lex listening on http://${config.host}:${config.port}`);
});
