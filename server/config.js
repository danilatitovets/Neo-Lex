import 'dotenv/config';

function requiredHint(name) {
  return process.env[name]?.trim() || '';
}

const searchProvider = (process.env.SEARCH_PROVIDER || 'polza').trim().toLowerCase();

function resolveSearchApiKey() {
  const explicit = requiredHint('SEARCH_API_KEY');
  if (explicit) return explicit;
  if (searchProvider === 'polza') return requiredHint('CLAUDE_API_KEY');
  if (searchProvider === 'google') return requiredHint('GOOGLE_API_KEY');
  return '';
}

function resolveSearchBaseUrl() {
  const explicit = requiredHint('SEARCH_BASE_URL');
  if (explicit) return explicit;
  if (searchProvider === 'polza') {
    return requiredHint('CLAUDE_BASE_URL') || 'https://polza.ai/api/v1';
  }
  return '';
}

function resolveSearchModel() {
  const explicit = requiredHint('SEARCH_MODEL');
  if (explicit) return explicit;
  if (searchProvider === 'polza') return 'perplexity/sonar';
  if (searchProvider === 'google') return requiredHint('GEMINI_MODEL');
  return '';
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  claude: {
    provider: (process.env.CLAUDE_PROVIDER || 'anthropic').trim().toLowerCase(),
    apiKey: requiredHint('CLAUDE_API_KEY'),
    baseUrl: requiredHint('CLAUDE_BASE_URL'),
    model: requiredHint('CLAUDE_MODEL'),
  },
  search: {
    provider: searchProvider,
    apiKey: resolveSearchApiKey(),
    baseUrl: resolveSearchBaseUrl(),
    model: resolveSearchModel(),
  },
  google: {
    apiKey: requiredHint('GOOGLE_API_KEY'),
    model: requiredHint('GEMINI_MODEL'),
  },
  limits: {
    marketplace: 80,
    clauseNumber: 64,
    penaltyDescription: 4000,
    date: 32,
  },
};

export function missingConfig() {
  const missing = [];

  if (!config.claude.apiKey) missing.push('CLAUDE_API_KEY');
  if (!config.claude.model) missing.push('CLAUDE_MODEL');
  if (config.claude.provider !== 'anthropic' && !config.claude.baseUrl) {
    missing.push('CLAUDE_BASE_URL');
  }

  if (!config.search.apiKey) {
    if (config.search.provider === 'polza') {
      missing.push('SEARCH_API_KEY или CLAUDE_API_KEY');
    } else if (config.search.provider === 'google') {
      missing.push('GOOGLE_API_KEY или SEARCH_API_KEY');
    } else {
      missing.push('SEARCH_API_KEY');
    }
  }
  if (!config.search.model) missing.push('SEARCH_MODEL');
  if (config.search.provider === 'polza' && !config.search.baseUrl) {
    missing.push('SEARCH_BASE_URL');
  }

  return missing;
}

export function providerLabel(provider = config.search.provider) {
  if (provider === 'polza') return 'Polza / Perplexity Sonar';
  if (provider === 'google') return 'Google Gemini Search Grounding';
  return String(provider || 'unknown');
}
