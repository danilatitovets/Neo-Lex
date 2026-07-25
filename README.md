# Neo-Lex

Юридический чат-помощник по спорам с маркетплейсами.

## Архитектура

- Обычный диалог: один вызов модели чата через Polza, ответ потоком.
- Поиск: Polza / Perplexity Sonar только если нужны актуальные правила, оферта или официальные источники.
- PDF: формируется только по кнопке «Сформировать PDF-документ на проверку».
- Сессии: in-memory на сервере. После перезапуска Render история сбрасывается.

## Запуск

1. Скопируйте `.env.example` в `.env` и заполните ключи.
2. `npm install`
3. `npm start`
4. Откройте `http://localhost:3000`

## Переменные

См. `.env.example`.

Для Polza достаточно `CLAUDE_API_KEY`, если `CHAT_API_KEY`, `PDF_MODEL_API_KEY` и `SEARCH_API_KEY` пустые.

Позже можно добавить `SEARCH_PROVIDER=google` для Google Gemini Search Grounding.
