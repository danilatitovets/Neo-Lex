const shellEl = document.getElementById('shell');
const heroEl = document.getElementById('hero');
const chatEl = document.getElementById('chat');
const form = document.getElementById('chat-form');
const input = document.getElementById('message');
const sendBtn = document.getElementById('send-btn');
const typingEl = document.getElementById('typing');
const typingLabel = document.getElementById('typing-label');
const errorEl = document.getElementById('form-error');

const systemPromptEl = document.getElementById('system-prompt');
const systemPromptEdit = document.getElementById('system-prompt-edit');
const promptCountEl = document.getElementById('prompt-count');
const modelEl = document.getElementById('model');
const temperatureEl = document.getElementById('temperature');
const tempValueEl = document.getElementById('temp-value');
const tempChipValue = document.getElementById('temp-chip-value');
const maxTokensEl = document.getElementById('max-tokens');
const webSearchEl = document.getElementById('web-search');
const searchCheck = document.getElementById('search-check');
const searchChipState = document.getElementById('search-chip-state');
const searchChip = document.getElementById('search-chip');
const modelChip = document.getElementById('model-chip');
const modelChipLabel = document.getElementById('model-chip-label');
const tempChip = document.getElementById('temp-chip');
const plusBtn = document.getElementById('plus-btn');
const mainMenu = document.getElementById('main-menu');
const modelsMenu = document.getElementById('models-menu');
const modelsList = document.getElementById('models-list');
const tempMenu = document.getElementById('temp-menu');
const tokensMenu = document.getElementById('tokens-menu');
const promptModal = document.getElementById('prompt-modal');
const closePromptBtn = document.getElementById('close-prompt');
const savePromptBtn = document.getElementById('save-prompt');
const resetPromptBtn = document.getElementById('reset-prompt');
const clearChatBtn = document.getElementById('clear-chat');
const resetSettingsBtn = document.getElementById('reset-settings');

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
  maxSystemChars: 2500,
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
  if (/^[a-z][a-z0-9 _.-]*$/i.test(raw) && !/[а-яё]/i.test(raw)) return fallback;
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
  input.style.height = `${Math.min(Math.max(input.scrollHeight, 24), 160)}px`;
}

function syncTemp() {
  const v = Number(temperatureEl.value).toFixed(1);
  tempValueEl.textContent = v;
  tempChipValue.textContent = v;
}

function syncSearch() {
  const on = webSearchEl.checked;
  searchCheck.hidden = !on;
  searchChipState.textContent = on ? 'вкл' : 'выкл';
  searchChip.classList.toggle('active', on);
}

function syncModelChip() {
  const found = models.find((m) => m.id === modelEl.value);
  modelChipLabel.textContent = found ? found.label : 'Модель';
  renderModelsList();
}

function clampPrompt(text) {
  const limit = defaults.maxSystemChars || 2500;
  return String(text || '').slice(0, limit);
}

function updatePromptCount() {
  const limit = defaults.maxSystemChars || 2500;
  const len = systemPromptEdit.value.length;
  promptCountEl.textContent = `${len} / ${limit}`;
  promptCountEl.classList.toggle('is-limit', len >= limit);
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

function closeMenus() {
  mainMenu.hidden = true;
  modelsMenu.hidden = true;
  tempMenu.hidden = true;
  tokensMenu.hidden = true;
  plusBtn.setAttribute('aria-expanded', 'false');
}

function openMenu(which) {
  closeMenus();
  if (which === 'main') {
    mainMenu.hidden = false;
    plusBtn.setAttribute('aria-expanded', 'true');
  } else if (which === 'models') {
    modelsMenu.hidden = false;
  } else if (which === 'temperature') {
    tempMenu.hidden = false;
  } else if (which === 'tokens') {
    tokensMenu.hidden = false;
  }
}

function setChatting(on) {
  shellEl.classList.toggle('is-chatting', on);
  heroEl.hidden = on;
  chatEl.hidden = !on;
}

function iconCopy() {
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke-linecap="round"/></svg>`;
}

function iconPdf() {
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6" stroke-linejoin="round"/><path d="M8 13h8M8 17h5" stroke-linecap="round"/></svg>`;
}

async function copyAssistantText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const prev = button.innerHTML;
    button.innerHTML = `${iconCopy()}<span>Скопировано</span>`;
    setTimeout(() => {
      button.innerHTML = prev;
    }, 1200);
  } catch {
    showError('Не удалось скопировать текст');
  }
}

function findPreviousUserContent(index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return messages[i].content || '';
  }
  return '';
}

async function downloadAssistantPdf(index, turnEl, button) {
  const msg = messages[index];
  if (!msg || msg.role !== 'assistant' || !msg.content.trim()) return;

  const label = button.querySelector('span');
  const prevLabel = label?.textContent || 'PDF';
  turnEl.classList.add('is-busy');
  button.disabled = true;
  if (label) label.textContent = 'Формирую…';
  showError('');

  try {
    const response = await fetch('/api/playground/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userContent: findPreviousUserContent(index),
        assistantContent: msg.content,
        sources: msg.sources || [],
      }),
    });

    const type = response.headers.get('content-type') || '';
    if (!response.ok || !type.includes('application/pdf')) {
      let message = 'Не удалось сформировать PDF';
      try {
        const data = await response.json();
        if (data?.error) message = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    const blob = await response.blob();
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
    turnEl.classList.remove('is-busy');
    button.disabled = false;
    if (label) label.textContent = prevLabel;
  }
}

function renderChat() {
  chatEl.innerHTML = '';
  if (!messages.length) {
    setChatting(false);
    return;
  }
  setChatting(true);
  messages.forEach((msg, index) => {
    const turn = document.createElement('article');
    turn.className = `turn ${msg.role}`;

    const role = document.createElement('p');
    role.className = 'turn-role';
    role.textContent = msg.role === 'user' ? 'Вы' : 'Neo-Lex';

    const bubble = document.createElement('div');
    bubble.className = 'turn-bubble';

    const body = document.createElement('div');
    body.className = 'message';
    body.textContent = msg.content;
    bubble.appendChild(body);

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
      bubble.appendChild(meta);
    }

    turn.appendChild(role);
    turn.appendChild(bubble);

    if (msg.role === 'assistant' && msg.content.trim()) {
      const actions = document.createElement('div');
      actions.className = 'turn-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'action-btn';
      copyBtn.innerHTML = `${iconCopy()}<span>Копировать</span>`;
      copyBtn.addEventListener('click', () => copyAssistantText(msg.content, copyBtn));

      const pdfBtn = document.createElement('button');
      pdfBtn.type = 'button';
      pdfBtn.className = 'action-btn';
      pdfBtn.innerHTML = `${iconPdf()}<span>Сформировать PDF</span>`;
      pdfBtn.addEventListener('click', () => downloadAssistantPdf(index, turn, pdfBtn));

      actions.appendChild(copyBtn);
      actions.appendChild(pdfBtn);
      turn.appendChild(actions);
    }

    chatEl.appendChild(turn);
  });
  chatEl.scrollTop = chatEl.scrollHeight;
}

function renderModelsList() {
  modelsList.innerHTML = '';
  for (const item of models) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-item';
    btn.dataset.model = item.id;
    btn.innerHTML = `<span>${item.label}</span>${
      item.id === modelEl.value ? '<span class="check">✓</span>' : ''
    }`;
    btn.addEventListener('click', () => {
      modelEl.value = item.id;
      syncModelChip();
      saveSettings();
      closeMenus();
    });
    modelsList.appendChild(btn);
  }
}

function fillModels(list, selected) {
  modelEl.innerHTML = '';
  for (const item of list) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.label;
    modelEl.appendChild(opt);
  }
  if (selected && list.some((m) => m.id === selected)) modelEl.value = selected;
  else if (list.length) modelEl.value = defaults.defaultModel || list[0].id;
  syncModelChip();
}

function applyDefaultsToForm() {
  systemPromptEl.value = clampPrompt(defaults.systemPrompt || '');
  systemPromptEdit.value = systemPromptEl.value;
  temperatureEl.value = String(defaults.temperature ?? 0);
  maxTokensEl.value = String(defaults.maxTokens ?? 350);
  webSearchEl.checked = Boolean(defaults.webSearch);
  fillModels(models, defaults.defaultModel);
  syncTemp();
  syncSearch();
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

  systemPromptEl.value = clampPrompt(
    prompt != null ? prompt : defaults.systemPrompt || ''
  );
  systemPromptEdit.value = systemPromptEl.value;
  fillModels(models, model || defaults.defaultModel);
  temperatureEl.value = temperature != null ? temperature : String(defaults.temperature ?? 0);
  maxTokensEl.value = maxTokens != null ? maxTokens : String(defaults.maxTokens ?? 350);
  webSearchEl.checked = webSearch === '1';
  syncTemp();
  syncSearch();
  updatePromptCount();

  try {
    messages = storedMessages ? JSON.parse(storedMessages) : [];
    if (!Array.isArray(messages)) messages = [];
  } catch {
    messages = [];
  }
  renderChat();
}

function getSettingsPayload() {
  return {
    systemPrompt: systemPromptEl.value,
    model: modelEl.value,
    temperature: Number(temperatureEl.value),
    maxTokens: Number(maxTokensEl.value),
    webSearch: Boolean(webSearchEl.checked),
  };
}

function validateBeforeSend(text) {
  if (!modelEl.value) return 'Выберите модель';
  if (!text) return 'Введите сообщение';
  if (text.length > defaults.maxMessageChars) return 'Сообщение слишком длинное';
  if (systemPromptEl.value.length > defaults.maxSystemChars) return 'Системный промпт слишком длинный';
  const temperature = Number(temperatureEl.value);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    return 'Некорректное значение температуры';
  }
  const maxTokens = Number(maxTokensEl.value);
  if (!Number.isInteger(maxTokens) || maxTokens < 50 || maxTokens > 4000) {
    return 'Некорректное значение макс. токенов';
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

    if (!assistant.content.trim()) throw new Error('Ответ модели не удалось обработать');
    saveMessages();
    renderChat();
  } catch (err) {
    if (!assistant.content.trim()) {
      messages.pop();
      if (messages.length && messages[messages.length - 1].role === 'user') messages.pop();
      saveMessages();
      renderChat();
    }
    showError(userFacingError(err, 'Сервис модели временно недоступен'));
  } finally {
    setBusy(false);
    input.focus();
  }
}

plusBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!mainMenu.hidden) closeMenus();
  else openMenu('main');
});

mainMenu.addEventListener('click', (event) => {
  const item = event.target.closest('[data-action]');
  if (!item) return;
  const action = item.dataset.action;
  if (action === 'prompt') {
    closeMenus();
    systemPromptEdit.value = clampPrompt(systemPromptEl.value);
    systemPromptEdit.maxLength = defaults.maxSystemChars || 2500;
    updatePromptCount();
    promptModal.hidden = false;
    systemPromptEdit.focus();
  } else if (action === 'models') openMenu('models');
  else if (action === 'temperature') openMenu('temperature');
  else if (action === 'tokens') openMenu('tokens');
  else if (action === 'search') {
    webSearchEl.checked = !webSearchEl.checked;
    syncSearch();
    saveSettings();
  }
});

modelChip.addEventListener('click', (event) => {
  event.stopPropagation();
  openMenu('models');
});

tempChip.addEventListener('click', (event) => {
  event.stopPropagation();
  openMenu('temperature');
});

searchChip.addEventListener('click', () => {
  webSearchEl.checked = !webSearchEl.checked;
  syncSearch();
  saveSettings();
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.picker-root') && !event.target.closest('.pill')) {
    closeMenus();
  }
});

temperatureEl.addEventListener('input', () => {
  syncTemp();
  saveSettings();
});
maxTokensEl.addEventListener('change', saveSettings);

closePromptBtn.addEventListener('click', () => {
  promptModal.hidden = true;
});

savePromptBtn.addEventListener('click', () => {
  systemPromptEl.value = clampPrompt(systemPromptEdit.value);
  systemPromptEdit.value = systemPromptEl.value;
  updatePromptCount();
  saveSettings();
  promptModal.hidden = true;
});

resetPromptBtn.addEventListener('click', () => {
  systemPromptEdit.value = clampPrompt(defaults.systemPrompt || '');
  updatePromptCount();
});

systemPromptEdit.addEventListener('input', () => {
  if (systemPromptEdit.value.length > (defaults.maxSystemChars || 2500)) {
    systemPromptEdit.value = clampPrompt(systemPromptEdit.value);
  }
  updatePromptCount();
});

clearChatBtn.addEventListener('click', () => {
  if (busy) return;
  messages = [];
  saveMessages();
  renderChat();
  showError('');
  closeMenus();
});

resetSettingsBtn.addEventListener('click', () => {
  if (busy) return;
  applyDefaultsToForm();
  showError('');
  closeMenus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  closeMenus();
  await sendMessage(input.value.trim());
});

input.addEventListener('input', growInput);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

async function boot() {
  const [modelsRes, defaultsRes] = await Promise.all([
    fetch('/api/playground/models'),
    fetch('/api/playground/defaults'),
  ]);
  if (!modelsRes.ok || !defaultsRes.ok) {
    showError('Не удалось загрузить настройки песочницы');
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
    maxSystemChars: defaultsData.maxSystemChars || 2500,
    maxMessageChars: defaultsData.maxMessageChars || 4000,
  };
  systemPromptEl.maxLength = defaults.maxSystemChars;
  systemPromptEdit.maxLength = defaults.maxSystemChars;
  loadFromStorage();
  growInput();
  input.focus();
}

boot().catch(() => showError('Не удалось загрузить настройки песочницы'));
