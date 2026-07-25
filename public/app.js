const shellEl = document.getElementById('shell');
const heroEl = document.getElementById('hero');
const chatEl = document.getElementById('chat');
const form = document.getElementById('chat-form');
const input = document.getElementById('message');
const sendBtn = document.getElementById('send-btn');
const pdfBtn = document.getElementById('pdf-btn');
const pdfCta = document.getElementById('pdf-cta');
const pdfBar = document.getElementById('pdf-bar');
const clearBtn = document.getElementById('clear-btn');
const typingEl = document.getElementById('typing');
const typingLabel = document.getElementById('typing-label');
const errorEl = document.getElementById('form-error');

const SESSION_KEY = 'neo-lex-session-id';
let sessionId = localStorage.getItem(SESSION_KEY) || '';
let busy = false;
let hasAssistant = false;
let started = false;

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || '';
}

function setPdfEnabled(enabled) {
  const on = Boolean(enabled);
  pdfBtn.disabled = !on;
  pdfCta.disabled = !on;
  pdfBar.hidden = !hasAssistant;
  pdfBtn.classList.toggle('is-ready', hasAssistant && on);
  pdfCta.classList.toggle('is-busy', busy);
}

function setBusy(state) {
  busy = state;
  sendBtn.disabled = state;
  input.disabled = state;
  typingEl.hidden = !state;
  setPdfEnabled(!state && hasAssistant);
}

function scrollToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function growInput() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(Math.max(input.scrollHeight, 24), 160)}px`;
}

function setEmptyState(empty) {
  started = !empty;
  shellEl.classList.toggle('is-chatting', !empty);
  heroEl.hidden = !empty;
  chatEl.hidden = empty;
  if (empty) {
    chatEl.innerHTML = '';
  }
}

function addMessage(role, content) {
  const row = document.createElement('div');
  row.className = 'row';

  const avatar = document.createElement('div');
  avatar.className = `avatar ${role}`;
  avatar.textContent = role === 'user' ? 'Вы' : 'N';

  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.textContent = content;

  row.appendChild(avatar);
  row.appendChild(message);
  chatEl.appendChild(row);
  scrollToBottom();
  return message;
}

function addMeta({ sources, warnings }) {
  if ((!sources || !sources.length) && (!warnings || !warnings.length)) return;
  const wrap = document.createElement('div');
  wrap.className = 'meta-block';

  if (sources?.length) {
    const list = document.createElement('ul');
    list.className = 'sources';
    for (const source of sources) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = source.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = source.title || source.url;
      li.appendChild(a);
      list.appendChild(li);
    }
    wrap.appendChild(list);
  }

  if (warnings?.length) {
    const list = document.createElement('ul');
    list.className = 'warnings';
    for (const warning of warnings) {
      const li = document.createElement('li');
      li.textContent = warning;
      list.appendChild(li);
    }
    wrap.appendChild(list);
  }

  chatEl.appendChild(wrap);
  scrollToBottom();
}

function updatePdfVisibility() {
  setPdfEnabled(!busy && hasAssistant);
}

function resetChatView() {
  setEmptyState(true);
  hasAssistant = false;
  updatePdfVisibility();
  showError('');
}

function userFacingError(err, fallback) {
  const raw = String(err?.message || err || '');
  const lower = raw.toLowerCase();
  if (
    err?.name === 'TypeError' ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed')
  ) {
    return 'Не удалось подключиться к серверу';
  }
  if (/^[a-z][a-z0-9 _.-]*$/i.test(raw) && !/[а-яё]/i.test(raw)) {
    return fallback;
  }
  return raw || fallback;
}

async function clearSession() {
  if (sessionId) {
    try {
      await fetch(`/api/chat/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    } catch {
      /* ignore */
    }
  }
  sessionId = '';
  localStorage.removeItem(SESSION_KEY);
  resetChatView();
  input.focus();
}

async function sendMessage(text) {
  showError('');
  setBusy(true);
  typingLabel.textContent = 'Юрист печатает…';

  if (!started) {
    setEmptyState(false);
  }

  addMessage('user', text);
  input.value = '';
  growInput();

  const assistantEl = addMessage('assistant', '');
  let sources = [];
  let warnings = [];

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionId || undefined,
        message: text,
      }),
    });

    if (!response.ok || !response.body) {
      let message = 'Сервис консультации временно недоступен';
      try {
        const data = await response.json();
        if (data?.error) message = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = 'message';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n');
      buffer = chunks.pop() || '';

      for (const line of chunks) {
        const trimmed = line.trimEnd();
        if (!trimmed) continue;
        if (trimmed.startsWith('event:')) {
          eventName = trimmed.slice(6).trim();
          continue;
        }
        if (!trimmed.startsWith('data:')) continue;
        const dataRaw = trimmed.slice(5).trim();
        let data = {};
        try {
          data = JSON.parse(dataRaw);
        } catch {
          continue;
        }

        if (eventName === 'session' && data.sessionId) {
          sessionId = data.sessionId;
          localStorage.setItem(SESSION_KEY, sessionId);
        } else if (eventName === 'status' && data.message) {
          typingLabel.textContent = data.message;
          typingEl.hidden = false;
        } else if (eventName === 'delta' && data.content) {
          typingLabel.textContent = 'Юрист печатает…';
          assistantEl.textContent += data.content;
          scrollToBottom();
        } else if (eventName === 'sources') {
          sources = data.sources || [];
        } else if (eventName === 'warning') {
          warnings = data.warnings || [];
        } else if (eventName === 'error') {
          throw new Error(data.message || 'Сервис консультации временно недоступен');
        } else if (eventName === 'done') {
          hasAssistant = true;
          updatePdfVisibility();
        }
      }
    }

    if (!assistantEl.textContent.trim()) {
      throw new Error('Ответ модели не удалось обработать');
    }

    addMeta({ sources, warnings });
  } catch (err) {
    if (!assistantEl.textContent.trim()) {
      assistantEl.closest('.row')?.remove();
    }
    if (!chatEl.querySelector('.row')) {
      setEmptyState(true);
    }
    if (/сессия завершилась/i.test(String(err.message || ''))) {
      sessionId = '';
      localStorage.removeItem(SESSION_KEY);
    }
    showError(userFacingError(err, 'Сервис консультации временно недоступен'));
  } finally {
    typingLabel.textContent = 'Юрист печатает…';
    setBusy(false);
    input.focus();
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const text = input.value.trim();
  if (!text) {
    showError('Введите сообщение');
    return;
  }
  if (text.length > 4000) {
    showError('Сообщение слишком длинное');
    return;
  }
  await sendMessage(text);
});

input.addEventListener('input', growInput);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

clearBtn.addEventListener('click', async () => {
  if (busy) return;
  await clearSession();
});

async function downloadPdf() {
  if (!sessionId || busy || !hasAssistant) return;
  showError('');
  setBusy(true);
  const ctaLabel = pdfCta.querySelector('span');
  const prevLabel = ctaLabel?.textContent || 'Сформировать PDF-документ на проверку';
  if (ctaLabel) ctaLabel.textContent = 'Формируем документ…';

  try {
    const response = await fetch('/api/chat/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const isPdf =
      bytes.length > 4 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46;

    if (!response.ok || !isPdf) {
      let message = 'Не удалось сформировать PDF';
      try {
        const data = JSON.parse(new TextDecoder().decode(bytes));
        if (data?.error) message = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'neo-lex-consultation.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showError(userFacingError(err, 'Не удалось сформировать PDF'));
  } finally {
    if (ctaLabel) ctaLabel.textContent = prevLabel;
    setBusy(false);
    input.focus();
  }
}

pdfBtn.addEventListener('click', downloadPdf);
pdfCta.addEventListener('click', downloadPdf);

resetChatView();
growInput();
input.focus();
