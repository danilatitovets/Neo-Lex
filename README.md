# Neo-Lex

Тестовый прототип LegalTech-пайплайна: Claude Architect, поиск, Claude Final QA, HTML и PDF.

По умолчанию поиск выполняется через Polza с моделью Perplexity Sonar и возвратом источников. Позже можно переключить `SEARCH_PROVIDER=google` для использования Google Gemini Search Grounding.

## Запуск

1. Скопируйте `.env.example` в `.env` и заполните необходимые переменные.
2. Выполните `npm install`.
3. Запустите приложение командой `npm start`.
4. Откройте `http://localhost:3000`.

## Переменные окружения

Список переменных находится в `.env.example`.

Для поиска через Polza достаточно указать `CLAUDE_API_KEY`, если `SEARCH_API_KEY` оставлен пустым.

## Render

PDF формируется через `pdfkit` без Chrome — отдельная установка браузера не нужна.