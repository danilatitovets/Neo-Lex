const chatEl = document.getElementById('chat');
const form = document.getElementById('chat-form');
const input = document.getElementById('message');
const sendBtn = document.getElementById('send-btn');
const typingEl = document.getElementById('typing');
const typingLabel = document.getElementById('typing-label');
const errorEl = document.getElementById('form-error');
const systemPromptEl = document.getElementById('system-prompt');
const promptCountEl = document.getElementById('prompt-count');
const modelEl = document.getElementById('model');
const temperatureEl = document.getElementById('temperature');
const tempValueEl = document.getElementById('temp-value');
const maxTokensEl = document.getElementById('max-tokens');
const webSearchEl = document.getElementById('web-search');
const clearChatBtn = document.getElementById('clear-chat');
const resetSettingsBtn = document.getElementById('reset-settings');
const resetPromptBtn = document.getElementById('reset-prompt');
const settingsEl = document.getElementById('settings');
const settingsToggle = document.getElementById('settings-toggle');

const LS = {
  prompt: 'neo-lex-pg-system-prompt',
  model: 'neo-lex-pg-model',
  temperature: 'neo-lex-pg-temperature',
  maxTokens: 'neo-lex-pg-max-tokens',
  webSearch: 'neo-lex-pg-web-search',
  messages: 'neo-lex-pg-messages',
};

let defaults = {
  systemPrompt: '',
  defaultModel: 'openai/gpt-4o-mini',
  temperature: 0,
  maxTokens: 350,
  webSearch: false,
  maxSystemChars: 20000,
  maxMessageChars: 4000,
};

let messages = [];
let busy = false;
let models = [];

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || '';
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
    return 'Соединение было прервано';
  }
  if (/^[a-z][a-z0-9 _.-]*$/i.test(raw) && !/[а-яё]/i.test(raw)) {
    return fallback;
  }
  return raw || fallback;
}

function setBusy(state) {
  busy = state;
  sendBtn.disabled = state;
  input.disabled = state;
  typingEl.hidden = !state;
  if (!state) typingLabel.textContent = 'Генерирую ответ…';
}

function growInput() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(Math.max(input.scrollHeight, 44), 160)}px`;
}

function updatePromptCount() {
  promptCountEl.textContent = `${systemPromptEl.value.length} / ${defaults.maxSystemChars}`;
}

function syncTempLabel() {
  tempValueEl.textContent = Number(temperatureEl.value).toFixed(1);
}

function saveSettings() {
  localStorage.setItem(LS.prompt, systemPromptEl.value);
  localStorage.setItem(LS.model, modelEl.value);
  localStorage.setItem(LS.temperature, temperatureEl.value);
  localStorage.setItem(LS.maxTokens, maxTokensEl.value);
  localStorage.setItem(LS.webSearch, webSearchEl.checked ? '1' : '0');
}

function saveMessages() {
  localStorage.setItem(LS.messages, JSON.stringify(messages.slice(-40)));
}

function renderChat() {
  chatEl.innerHTML = '';
  if (!messages.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent =
      'Измените System Prompt и параметры слева, затем отправьте тестовое сообщение.';
    chatEl.appendChild(empty);
    return;
  }

  for (const msg of messages) {
    const turn = document.createElement('article');
    turn.className = `turn ${msg.role}`;
    const role = document.createElement('p');
    role.className = 'turn-role';
    role.textContent = msg.role === 'user' ? 'Вы' : 'Ассистент';
    const body = document.createElement('div');
    body.className = 'message';
    body.textContent = msg.content;
    turn.appendChild(role);
    turn.appendChild(body);

    if ((msg.sources && msg.sources.length) || (msg.warnings && msg.warnings.length)) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      for (const source of msg.sources || []) {
        const a = document.createElement('a');
        a.href = source.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = source.title || source.url;
        meta.appendChild(a);
      }
      for (const warning of msg.warnings || []) {
        const w = document.createElement('div');
        w.className = 'warn';
        w.textContent = warning;
        meta.appendChild(w);
      }
      turn.appendChild(meta);
    }

    chatEl.appendChild(turn);
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

function getSettingsPayload() {
  const temperature = Number(temperatureEl.value);
  const maxTokens = Number(maxTokensEl.value);
  return {
    systemPrompt: systemPromptEl.value,
    model: modelEl.value,
    temperature,
    maxTokens,
    webSearch: Boolean(webSearchEl.checked),
  };
}

function validateBeforeSend(text) {
  if (!modelEl.value) return 'Выберите модель';
  if (!text) return 'Введите сообщение';
  if (text.length > defaults.maxMessageChars) return 'Сообщение слишком длинное';
  if (systemPromptEl.value.length > defaults.maxSystemChars) {
    return 'System Prompt слишком длинный';
  }
  const temperature = Number(temperatureEl.value);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    return 'Некорректное значение Temperature';
  }
  const maxTokens = Number(maxTokensEl.value);
  if (!Number.isInteger(maxTokens) || maxTokens < 50 || maxTokens > 4000) {
    return 'Некорректное значение Max Tokens';
  }
  return '';
}

async function sendMessage(text) {
  showError('');
  const validationError = validateBeforeSend(text);
  if (validationError) {
    showError(validationError);
    return;
  }

  messages.push({ role: 'user', content: text });
  const assistant = { role: 'assistant', content: '', sources: [], warnings: [] };
  messages.push(assistant);
  saveMessages();
  renderChat();
  input.value = '';
  growInput();
  setBusy(true);

  const assistantEl = chatEl.querySelector('.turn.assistant:last-of-type .message');

  try {
    const response = await fetch('/api/playground/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getSettingsPayload(),
        messages: messages
          .slice(0, -1)
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok || !response.body) {
      let message = 'Сервис модели временно недоступен';
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
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed) continue;
        if (trimmed.startsWith('event:')) {
          eventName = trimmed.slice(6).trim();
          continue;
        }
        if (!trimmed.startsWith('data:')) continue;
        let data = {};
        try {
          data = JSON.parse(trimmed.slice(5).trim());
        } catch {
          continue;
        }

        if (eventName === 'status' && data.message) {
          typingLabel.textContent = data.message;
          typingEl.hidden = false;
        } else if (eventName === 'delta' && data.content) {
          typingLabel.textContent = 'Генерирую ответ…';
          assistant.content += data.content;
          if (assistantEl) assistantEl.textContent = assistant.content;
          chatEl.scrollTop = chatEl.scrollHeight;
        } else if (eventName === 'sources') {
          assistant.sources = data.sources || [];
        } else if (eventName === 'warning') {
          assistant.warnings = data.warnings || [];
        } else if (eventName === 'error') {
          throw new Error(data.message || 'Сервис модели временно недоступен');
        }
      }
    }

    if (!assistant.content.trim()) {
      throw new Error('Ответ модели не удалось обработать');
    }

    saveMessages();
    renderChat();
  } catch (err) {
    if (!assistant.content.trim()) {
      messages.pop();
      if (messages.length && messages[messages.length - 1].role === 'user') {
        messages.pop();
      }
      saveMessages();
      renderChat();
    }
    showError(userFacingError(err, 'Сервис модели временно недоступен'));
  } finally {
    setBusy(false);
    input.focus();
  }
}

function fillModels(list, selected) {
  modelEl.innerHTML = '';
  for (const item of list) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = `${item.label} (${item.id})`;
    modelEl.appendChild(opt);
  }
  if (selected && list.some((m) => m.id === selected)) {
    modelEl.value = selected;
  } else if (list.length) {
    modelEl.value = defaults.defaultModel || list[0].id;
  }
}

function applyDefaultsToForm() {
  systemPromptEl.value = defaults.systemPrompt || '';
  temperatureEl.value = String(defaults.temperature ?? 0);
  maxTokensEl.value = String(defaults.maxTokens ?? 350);
  webSearchEl.checked = Boolean(defaults.webSearch);
  fillModels(models, defaults.defaultModel);
  syncTempLabel();
  updatePromptCount();
  saveSettings();
}

function loadFromStorage() {
  const prompt = localStorage.getItem(LS.prompt);
  const model = localStorage.getItem(LS.model);
  const temperature = localStorage.getItem(LS.temperature);
  const maxTokens = localStorage.getItem(LS.maxTokens);
  const webSearch = localStorage.getItem(LS.webSearch);
  const storedMessages = localStorage.getItem(LS.messages);

  systemPromptEl.value = prompt != null ? prompt : defaults.systemPrompt || '';
  fillModels(models, model || defaults.defaultModel);
  temperatureEl.value = temperature != null ? temperature : String(defaults.temperature ?? 0);
  maxTokensEl.value = maxTokens != null ? maxTokens : String(defaults.maxTokens ?? 350);
  webSearchEl.checked = webSearch === '1';
  syncTempLabel();
  updatePromptCount();

  try {
    messages = storedMessages ? JSON.parse(storedMessages) : [];
    if (!Array.isArray(messages)) messages = [];
  } catch {
    messages = [];
  }
  renderChat();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  await sendMessage(input.value.trim());
});

input.addEventListener('input', growInput);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

systemPromptEl.addEventListener('input', () => {
  updatePromptCount();
  saveSettings();
});
modelEl.addEventListener('change', saveSettings);
temperatureEl.addEventListener('input', () => {
  syncTempLabel();
  saveSettings();
});
maxTokensEl.addEventListener('change', saveSettings);
webSearchEl.addEventListener('change', saveSettings);

clearChatBtn.addEventListener('click', () => {
  if (busy) return;
  messages = [];
  saveMessages();
  renderChat();
  showError('');
});

resetPromptBtn.addEventListener('click', () => {
  systemPromptEl.value = defaults.systemPrompt || '';
  updatePromptCount();
  saveSettings();
});

resetSettingsBtn.addEventListener('click', () => {
  if (busy) return;
  applyDefaultsToForm();
  showError('');
});

settingsToggle.addEventListener('click', () => {
  const collapsed = settingsEl.classList.toggle('collapsed');
  settingsToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
});

async function boot() {
  const [modelsRes, defaultsRes] = await Promise.all([
    fetch('/api/playground/models'),
    fetch('/api/playground/defaults'),
  ]);
  if (!modelsRes.ok || !defaultsRes.ok) {
    showError('Не удалось загрузить настройки Playground');
    return;
  }
  const modelsData = await modelsRes.json();
  const defaultsData = await defaultsRes.json();
  models = modelsData.models || [];
  defaults = {
    systemPrompt: defaultsData.systemPrompt || '',
    defaultModel: defaultsData.defaultModel || modelsData.defaultModel,
    temperature: defaultsData.temperature ?? 0,
    maxTokens: defaultsData.maxTokens ?? 350,
    webSearch: Boolean(defaultsData.webSearch),
    maxSystemChars: defaultsData.maxSystemChars || 20000,
    maxMessageChars: defaultsData.maxMessageChars || 4000,
  };
  systemPromptEl.maxLength = defaults.maxSystemChars;
  loadFromStorage();
  growInput();
  input.focus();
}

boot().catch(() => showError('Не удалось загрузить настройки Playground'));
