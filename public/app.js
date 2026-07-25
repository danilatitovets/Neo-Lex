const form = document.getElementById('analyze-form');
const analyzeBtn = document.getElementById('analyze-btn');
const pdfBtn = document.getElementById('pdf-btn');
const formError = document.getElementById('form-error');

let lastResult = null;

const MONTHS_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDisplayDate(iso) {
  if (!iso) return 'Выберите дату';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function parseISODate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function initSelects() {
  document.querySelectorAll('[data-select]').forEach((root) => {
    const hidden = root.querySelector('input[type="hidden"]');
    const trigger = root.querySelector('.select-trigger');
    const valueEl = root.querySelector('.select-value');
    const menu = root.querySelector('.select-menu');
    const options = [...menu.querySelectorAll('[role="option"]')];

    function close() {
      root.classList.remove('is-open');
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }

    function open() {
      document.querySelectorAll('[data-select].is-open, [data-datepicker].is-open').forEach((el) => {
        if (el !== root) el.querySelector('[aria-expanded="true"]')?.click();
      });
      root.classList.add('is-open');
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
    }

    function selectOption(option) {
      options.forEach((item) => item.setAttribute('aria-selected', 'false'));
      option.setAttribute('aria-selected', 'true');
      hidden.value = option.dataset.value;
      valueEl.textContent = option.textContent;
      close();
    }

    trigger.addEventListener('click', () => {
      if (menu.hidden) open();
      else close();
    });

    options.forEach((option) => {
      option.addEventListener('click', () => selectOption(option));
    });

    document.addEventListener('click', (event) => {
      if (!root.contains(event.target)) close();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
  });
}

function initDatepickers() {
  document.querySelectorAll('[data-datepicker]').forEach((root) => {
    const hidden = root.querySelector('input[type="hidden"]');
    const trigger = root.querySelector('.datepicker-trigger');
    const valueEl = root.querySelector('.datepicker-value');
    const panel = root.querySelector('.datepicker-panel');
    const titleEl = root.querySelector('[data-dp-title]');
    const grid = root.querySelector('[data-dp-grid]');
    const todayISO = toISODate(new Date());

    let view = new Date();
    view.setDate(1);

    function setValue(iso) {
      hidden.value = iso || '';
      valueEl.textContent = formatDisplayDate(iso);
      valueEl.classList.toggle('is-placeholder', !iso);
      render();
    }

    function close() {
      root.classList.remove('is-open');
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }

    function open() {
      document.querySelectorAll('[data-select].is-open').forEach((el) => {
        el.querySelector('.select-trigger')?.click();
      });
      root.classList.add('is-open');
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      const selected = parseISODate(hidden.value);
      if (selected) {
        view = new Date(selected.getFullYear(), selected.getMonth(), 1);
      }
      render();
    }

    function render() {
      const year = view.getFullYear();
      const month = view.getMonth();
      titleEl.textContent = `${MONTHS_RU[month]} ${year}`;

      const firstDay = new Date(year, month, 1);
      let startOffset = firstDay.getDay() - 1;
      if (startOffset < 0) startOffset = 6;

      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const daysInPrev = new Date(year, month, 0).getDate();
      const selected = hidden.value;
      const cells = [];

      for (let i = 0; i < 42; i++) {
        let dayNum;
        let cellDate;
        let outside = false;

        if (i < startOffset) {
          dayNum = daysInPrev - startOffset + i + 1;
          cellDate = new Date(year, month - 1, dayNum);
          outside = true;
        } else if (i >= startOffset + daysInMonth) {
          dayNum = i - startOffset - daysInMonth + 1;
          cellDate = new Date(year, month + 1, dayNum);
          outside = true;
        } else {
          dayNum = i - startOffset + 1;
          cellDate = new Date(year, month, dayNum);
        }

        const iso = toISODate(cellDate);
        const classes = ['datepicker-day'];
        if (outside) classes.push('is-outside');
        if (iso === todayISO) classes.push('is-today');
        if (iso === selected) classes.push('is-selected');

        cells.push(
          `<button type="button" class="${classes.join(' ')}" data-iso="${iso}">${dayNum}</button>`
        );
      }

      grid.innerHTML = cells.join('');
      grid.querySelectorAll('.datepicker-day').forEach((btn) => {
        btn.addEventListener('click', () => {
          setValue(btn.dataset.iso);
          close();
        });
      });
    }

    trigger.addEventListener('click', () => {
      if (panel.hidden) open();
      else close();
    });

    root.querySelector('[data-dp-prev]').addEventListener('click', () => {
      view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
      render();
    });

    root.querySelector('[data-dp-next]').addEventListener('click', () => {
      view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
      render();
    });

    root.querySelector('[data-dp-clear]').addEventListener('click', () => {
      setValue('');
    });

    root.querySelector('[data-dp-today]').addEventListener('click', () => {
      setValue(todayISO);
      close();
    });

    document.addEventListener('click', (event) => {
      if (!root.contains(event.target)) close();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });

    setValue(todayISO);
  });
}

initSelects();
initDatepickers();
initAutoGrowTextareas();

const STATE_KEY = 'neo-lex-ui-state-v1';

function readFormValues() {
  return {
    marketplace: document.getElementById('marketplace').value.trim(),
    clauseNumber: document.getElementById('clauseNumber').value,
    penaltyDescription: document.getElementById('penaltyDescription').value,
    date: document.getElementById('date').value.trim(),
  };
}

function setMarketplaceValue(value) {
  const root = document.querySelector('[data-select]');
  if (!root || !value) return;
  const hidden = root.querySelector('input[type="hidden"]');
  const valueEl = root.querySelector('.select-value');
  const options = [...root.querySelectorAll('[role="option"]')];
  const match = options.find((item) => item.dataset.value === value);
  if (!match) return;
  options.forEach((item) => item.setAttribute('aria-selected', 'false'));
  match.setAttribute('aria-selected', 'true');
  hidden.value = value;
  valueEl.textContent = match.textContent;
}

function setDateValue(iso) {
  const root = document.querySelector('[data-datepicker]');
  if (!root) return;
  const hidden = root.querySelector('input[type="hidden"]');
  const valueEl = root.querySelector('.datepicker-value');
  hidden.value = iso || '';
  valueEl.textContent = formatDisplayDate(iso);
  valueEl.classList.toggle('is-placeholder', !iso);
}

function growTextareas() {
  document.querySelectorAll('textarea').forEach((el) => {
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 120)}px`;
  });
}

function saveUiState() {
  try {
    sessionStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        form: readFormValues(),
        result: lastResult,
      })
    );
  } catch {
    /* ignore quota */
  }
}

function restoreUiState() {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    const formState = state?.form || {};
    if (formState.marketplace) setMarketplaceValue(formState.marketplace);
    if (formState.clauseNumber != null) {
      document.getElementById('clauseNumber').value = formState.clauseNumber;
    }
    if (formState.penaltyDescription != null) {
      document.getElementById('penaltyDescription').value =
        formState.penaltyDescription;
    }
    if (formState.date) setDateValue(formState.date);
    growTextareas();
    if (state?.result && typeof state.result === 'object') {
      renderResult(state.result);
    }
  } catch {
    /* ignore broken state */
  }
}

function initAutoGrowTextareas() {
  document.querySelectorAll('textarea').forEach((el) => {
    const grow = () => {
      el.style.height = 'auto';
      el.style.height = `${Math.max(el.scrollHeight, 120)}px`;
    };
    el.addEventListener('input', () => {
      grow();
      saveUiState();
    });
    grow();
  });
}

document.getElementById('clauseNumber')?.addEventListener('input', saveUiState);
document.querySelectorAll('[data-select] [role="option"]').forEach((option) => {
  option.addEventListener('click', () => setTimeout(saveUiState, 0));
});
document.querySelectorAll('[data-datepicker]').forEach((root) => {
  root.addEventListener('click', () => setTimeout(saveUiState, 0));
});

function showError(message) {
  formError.hidden = !message;
  formError.textContent = message || '';
}

function userFacingError(err, fallback) {
  const raw = String(err?.message || err || '');
  const lower = raw.toLowerCase();
  if (
    err?.name === 'TypeError' ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('network request failed')
  ) {
    return 'Не удалось подключиться к серверу. Проверьте соединение и повторите попытку';
  }
  if (/^[a-z][a-z0-9 _.-]*$/i.test(raw) && !/[а-яё]/i.test(raw)) {
    return fallback;
  }
  return raw || fallback;
}

const EMPTY = {
  block: 'Появится после анализа',
  finalBlock: 'Появится после финальной проверки',
  status: 'Ожидание',
  sources: 'Источники не найдены',
  sourcesWait: 'Источники появятся после поиска',
  warnings: 'Пока нет предупреждений',
  demands: 'Пока нет требований',
  clauseMissing:
    'Текст пункта не подтверждён источниками. Требуется дополнительная проверка.',
  summaryMissing:
    'Интерпретация недоступна: точный текст пункта оферты не найден.',
};

const LIMITS = {
  marketplace: 80,
  clauseNumber: 64,
  penaltyDescription: 4000,
  date: 32,
};

function statusHint(status) {
  if (status === 'VERIFIED') {
    return 'VERIFIED — данные подтверждены источниками.';
  }
  if (status === 'NEEDS_REVIEW') {
    return 'NEEDS_REVIEW — требуется дополнительная проверка.';
  }
  return '';
}

function pickFinalText(final) {
  const position = String(final?.finalPosition || '').trim();
  const argumentation = String(final?.legalArgumentation || '').trim();
  if (position && argumentation) {
    if (position === argumentation || argumentation.includes(position)) {
      return argumentation;
    }
    if (position.includes(argumentation)) return position;
    return `${position}\n\n${argumentation}`;
  }
  return position || argumentation;
}

function uniqueStrings(items, max = 30) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const text = String(item || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function setStatusHint(id, status) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = statusHint(status);
  el.hidden = !text;
  el.textContent = text;
}

function validateFormPayload(payload) {
  if (
    !payload.marketplace ||
    !payload.clauseNumber ||
    !payload.penaltyDescription ||
    !payload.date
  ) {
    return 'Заполните обязательные поля';
  }
  if (payload.penaltyDescription.length > LIMITS.penaltyDescription) {
    return 'Описание ситуации слишком длинное';
  }
  if (payload.clauseNumber.length > LIMITS.clauseNumber) {
    return 'Слишком длинное значение: номер пункта оферты';
  }
  return '';
}

function setText(id, value, emptyText = EMPTY.block) {
  const el = document.getElementById(id);
  const text = value && String(value).trim() ? String(value) : emptyText;
  el.textContent = text;
  el.classList.toggle('empty', text === emptyText);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stageBrand(label) {
  const text = String(label || '').toLowerCase();
  if (text.includes('gemini') || text.includes('polza') || text.includes('sonar') || text.includes('поиск')) {
    return '<img class="stage-brand" src="/icons/gemini.svg" alt="" />';
  }
  if (text.includes('claude')) {
    return '<img class="stage-brand" src="/icons/claude.svg" alt="" />';
  }
  return '';
}

function renderStages(stages) {
  const el = document.getElementById('stages');
  if (!stages?.length) {
    el.innerHTML = `
      <li class="is-waiting">
        <span class="stage-label-wrap">
          <span class="stage-label">Ожидание запуска</span>
        </span>
        <span class="stage-side">
          <span class="spinner" aria-hidden="true"></span>
          <span class="status-pill status-wait">Ожидание</span>
        </span>
      </li>`;
    return;
  }

  el.innerHTML = stages
    .map((s, index) => {
      let pillClass = 'status-run';
      let mark = 'Выполняется';
      let rowClass = 'is-running';
      let spinner = '<span class="spinner spinner-light" aria-hidden="true"></span>';

      if (s.status === 'done') {
        pillClass = 'status-done';
        mark = 'Готово';
        rowClass = 'is-done';
        spinner = '';
      } else if (s.status === 'error') {
        pillClass = 'status-error';
        mark = 'Ошибка';
        rowClass = 'is-error';
        spinner = '';
      }

      return `
        <li class="${rowClass}" style="animation-delay: ${index * 40}ms">
          <span class="stage-label-wrap">
            ${stageBrand(s.label)}
            <span class="stage-label">${escapeHtml(s.label)}</span>
          </span>
          <span class="stage-side">
            ${spinner}
            <span class="status-pill ${pillClass}">${mark}</span>
          </span>
        </li>`;
    })
    .join('');
}

function renderList(id, items, emptyText = EMPTY.warnings) {
  const el = document.getElementById(id);
  if (!items?.length) {
    el.innerHTML = `<li class="muted">${escapeHtml(emptyText)}</li>`;
    return;
  }
  el.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function renderSources(sources) {
  const el = document.getElementById('sources');
  if (!sources?.length) {
    el.innerHTML = `<p class="muted">${escapeHtml(EMPTY.sources)}</p>`;
    return;
  }
  el.innerHTML = sources
    .map((s) => {
      const title = escapeHtml(s.title || 'Источник');
      const url = escapeHtml(s.url || '');
      const quote = s.quote
        ? `<div class="quote">${escapeHtml(s.quote)}</div>`
        : '';
      const link = s.url
        ? `<div class="url"><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></div>`
        : '';
      return `<div class="item"><div class="title">${title}</div>${link}${quote}</div>`;
    })
    .join('');
}

function statusClass(status) {
  const base = 'status-pill';
  if (!status || status === EMPTY.status) return `${base} status-wait`;
  if (status === 'VERIFIED') return `${base} status-verified`;
  if (status === 'NEEDS_REVIEW') return `${base} status-review`;
  return `${base} status-wait`;
}

function confidenceClass(confidence) {
  if (typeof confidence !== 'number') return 'status-pill status-wait';
  if (confidence >= 0.7) return 'status-pill status-conf-high';
  if (confidence >= 0.4) return 'status-pill status-conf-mid';
  return 'status-pill status-conf-low';
}

function renderResult(result) {
  lastResult = result;
  renderStages(result.stages);

  const preliminary = result.preliminary || {};
  const parts = [
    preliminary.preliminaryPosition || '',
    Array.isArray(preliminary.keyArguments) && preliminary.keyArguments.length
      ? '\nАргументы:\n' +
        preliminary.keyArguments.map((item) => `• ${item}`).join('\n')
      : '',
    Array.isArray(preliminary.factsToVerify) && preliminary.factsToVerify.length
      ? '\nТребуют проверки:\n' +
        preliminary.factsToVerify.map((item) => `• ${item}`).join('\n')
      : '',
  ];
  setText('preliminary', parts.filter(Boolean).join('\n').trim());
  setText('search-query', preliminary.searchQuery);

  const search = result.search || {};
  const providerText =
    search.providerLabel ||
    (search.provider === 'polza'
      ? 'Polza / Perplexity Sonar'
      : search.provider === 'google'
        ? 'Google Gemini Search Grounding'
        : search.provider || EMPTY.status);

  const providerEl = document.getElementById('search-provider');
  if (providerEl) {
    providerEl.textContent = providerText;
    providerEl.className = 'status-pill status-date';
  }
  const providerLabelEl = document.getElementById('search-provider-label');
  if (providerLabelEl) {
    providerLabelEl.textContent =
      search.providerLabel ||
      (search.provider === 'google'
        ? 'Google Gemini Search Grounding'
        : 'Polza / Perplexity Sonar');
  }

  const searchStatusEl = document.getElementById('search-status');
  searchStatusEl.textContent = search.status || EMPTY.status;
  searchStatusEl.className = statusClass(search.status);
  setStatusHint('search-status-hint', search.status);

  const confEl = document.getElementById('search-confidence');
  if (typeof search.confidence === 'number') {
    confEl.textContent = `${Math.round(search.confidence * 100)}%`;
    confEl.className = confidenceClass(search.confidence);
    confEl.classList.remove('empty');
  } else {
    confEl.textContent = EMPTY.status;
    confEl.className = 'status-pill status-wait';
  }

  const checkedEl = document.getElementById('search-checked-at');
  if (search.checkedAt) {
    checkedEl.textContent = search.checkedAt;
    checkedEl.className = 'status-pill status-date';
    checkedEl.classList.remove('empty');
  } else {
    checkedEl.textContent = EMPTY.status;
    checkedEl.className = 'status-pill status-wait';
  }

  const final = result.final || {};

  setText(
    'clause-text',
    search.clauseText || final.clauseText,
    EMPTY.clauseMissing
  );
  setText('search-summary', search.summary, EMPTY.summaryMissing);
  renderSources(search.sources);
  renderList(
    'search-warnings',
    search.warnings,
    search.status
      ? 'Источники не подтвердили точный текст указанного пункта.'
      : EMPTY.warnings
  );

  const finalStatusEl = document.getElementById('final-status');
  finalStatusEl.textContent = final.status || EMPTY.status;
  finalStatusEl.className = statusClass(final.status);
  setStatusHint('final-status-hint', final.status);
  setText(
    'final-position',
    pickFinalText(final),
    'Финальная позиция недоступна. Требуется дополнительная проверка.'
  );
  renderList(
    'demands',
    final.demands,
    final.status ? 'Требования не сформированы.' : EMPTY.demands
  );
  renderList(
    'final-warnings',
    final.warnings,
    final.status
      ? 'Источники не подтвердили точный текст указанного пункта.'
      : EMPTY.warnings
  );

  pdfBtn.disabled = false;
  saveUiState();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  pdfBtn.disabled = true;

  const payload = {
    marketplace: document.getElementById('marketplace').value.trim(),
    clauseNumber: document.getElementById('clauseNumber').value.trim(),
    penaltyDescription: document
      .getElementById('penaltyDescription')
      .value.trim(),
    date: document.getElementById('date').value.trim(),
  };

  const validationError = validateFormPayload(payload);
  if (validationError) {
    showError(validationError);
    if (lastResult) pdfBtn.disabled = false;
    return;
  }

  saveUiState();
  analyzeBtn.disabled = true;
  renderStages([
    {
      id: 'architect',
      label: 'Claude: предварительный анализ',
      status: 'running',
    },
  ]);

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        data.error || 'Сервис анализа временно недоступен. Попробуйте ещё раз позже'
      );
    }
    renderResult(data);
  } catch (err) {
    renderStages([{ id: 'failed', label: 'Анализ прерван', status: 'error' }]);
    showError(
      userFacingError(
        err,
        'Сервис анализа временно недоступен. Попробуйте ещё раз позже'
      )
    );
    if (lastResult) pdfBtn.disabled = false;
  } finally {
    analyzeBtn.disabled = false;
  }
});

pdfBtn.addEventListener('click', async () => {
  if (!lastResult) return;
  showError('');
  pdfBtn.disabled = true;

  const input = lastResult.input || {};
  const search = lastResult.search || {};
  const final = lastResult.final || {};

  const payload = {
    marketplace: input.marketplace,
    clauseNumber: final.clauseNumber || input.clauseNumber,
    situation: input.penaltyDescription,
    clauseText: final.clauseText || search.clauseText || '',
    preliminaryPosition: lastResult.preliminary?.preliminaryPosition || '',
    legalArgumentation: pickFinalText(final),
    demands: (final.demands || []).slice(0, 20),
    usedSources: (final.usedSources || search.sources || []).slice(0, 20),
    checkedAt: final.checkedAt || search.checkedAt || input.date,
    status: final.status || search.status || 'NEEDS_REVIEW',
    providerLabel: search.providerLabel || search.provider || '',
    warnings: uniqueStrings(
      [...(search.warnings || []), ...(final.warnings || [])],
      25
    ),
  };

  try {
    const response = await fetch('/api/generate-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
        const text = new TextDecoder('utf-8').decode(bytes);
        const data = JSON.parse(text);
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
    a.download = 'neo-lex-claim.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showError(userFacingError(err, 'Не удалось сформировать PDF'));
  } finally {
    pdfBtn.disabled = false;
  }
});

restoreUiState();
