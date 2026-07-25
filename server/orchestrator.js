import { missingConfig, providerLabel, config } from './config.js';
import { runArchitect, runFinalQa } from './claude.js';
import { runSearch } from './search.js';

const SEARCH_TOOLS = new Set([
  'google_grounding_search',
  'web_search',
  'external_search',
]);

export async function runAnalysis(input) {
  const missing = missingConfig();
  if (missing.length) {
    const error = new Error(
      'Для продолжения требуется настройка серверного API'
    );
    error.code = 'CONFIG';
    throw error;
  }

  const stages = [];
  const searchLabel =
    config.search.provider === 'google'
      ? 'Google: Search Grounding'
      : 'Polza / Perplexity Sonar: поиск';

  stages.push({
    id: 'architect',
    label: 'Claude: предварительный анализ',
    status: 'running',
  });

  try {
    const preliminary = await runArchitect(input);
    stages[stages.length - 1].status = 'done';

    const toolName = preliminary?.toolRequest?.tool || 'web_search';
    if (toolName && !SEARCH_TOOLS.has(toolName)) {
      // Accept unknown tool names; real provider comes from SEARCH_PROVIDER.
    }

    stages.push({ id: 'search', label: searchLabel, status: 'running' });
    const search = await runSearch({
      ...input,
      searchQuery:
        preliminary.searchQuery ||
        preliminary.toolRequest?.query ||
        `${input.marketplace} ${input.clauseNumber}`,
    });
    stages[stages.length - 1].status = 'done';

    stages.push({
      id: 'final_qa',
      label: 'Claude: финальная проверка',
      status: 'running',
    });

    let final;
    try {
      final = await runFinalQa({
        input,
        preliminary,
        searchQuery: preliminary.searchQuery,
        searchProvider: search.provider,
        searchProviderLabel:
          search.providerLabel || providerLabel(search.provider),
        search,
      });
    } catch (err) {
      if (!err.code) err.code = 'FINAL_QA';
      throw err;
    }
    stages[stages.length - 1].status = 'done';

    if (search.status === 'NEEDS_REVIEW') {
      final.status = 'NEEDS_REVIEW';
      final.needsLegalReview = true;
      if (
        !(final.warnings || []).some((w) =>
          /NEEDS_REVIEW|дополнительн/i.test(w)
        )
      ) {
        final.warnings = [
          ...(final.warnings || []),
          'Источники не подтвердили точный текст указанного пункта. Требуется дополнительная проверка.',
        ];
      }
    }

    if (!search.clauseText) {
      final.clauseText = '';
    }

    return {
      stages,
      input,
      preliminary,
      search,
      final,
    };
  } catch (err) {
    if (stages.length) stages[stages.length - 1].status = 'error';
    throw err;
  }
}
