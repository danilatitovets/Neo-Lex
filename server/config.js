import 'dotenv/config';

function env(name) {
  return process.env[name]?.trim() || '';
}

const searchProvider = (env('SEARCH_PROVIDER') || 'polza').toLowerCase();
const chatProvider = (env('CHAT_PROVIDER') || 'polza').toLowerCase();
const pdfProvider = (env('PDF_MODEL_PROVIDER') || 'polza').toLowerCase();

function resolvePolzaKey(explicit) {
  return explicit || env('CLAUDE_API_KEY');
}

function resolvePolzaBase(explicit) {
  return explicit || env('CLAUDE_BASE_URL') || 'https://polza.ai/api/v1';
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: env('HOST') || '0.0.0.0',
  claude: {
    provider: (env('CLAUDE_PROVIDER') || 'anthropic').toLowerCase(),
    apiKey: env('CLAUDE_API_KEY'),
    baseUrl: env('CLAUDE_BASE_URL'),
    model: env('CLAUDE_MODEL'),
  },
  chat: {
    provider: chatProvider,
    apiKey: resolvePolzaKey(env('CHAT_API_KEY')),
    baseUrl: resolvePolzaBase(env('CHAT_BASE_URL')),
    model: env('CHAT_MODEL') || 'openai/gpt-4o-mini',
    fallbackModel: env('CHAT_FALLBACK_MODEL') || 'anthropic/claude-sonnet-4.6',
  },
  pdfModel: {
    provider: pdfProvider,
    apiKey: resolvePolzaKey(env('PDF_MODEL_API_KEY')),
    baseUrl: resolvePolzaBase(env('PDF_MODEL_BASE_URL')),
    model: env('PDF_MODEL') || 'openai/gpt-4o-mini',
  },
  search: {
    provider: searchProvider,
    apiKey: (() => {
      const explicit = env('SEARCH_API_KEY');
      if (explicit) return explicit;
      if (searchProvider === 'polza') return env('CLAUDE_API_KEY');
      if (searchProvider === 'google') return env('GOOGLE_API_KEY');
      return '';
    })(),
    baseUrl: (() => {
      const explicit = env('SEARCH_BASE_URL');
      if (explicit) return explicit;
      if (searchProvider === 'polza') {
        return env('CLAUDE_BASE_URL') || 'https://polza.ai/api/v1';
      }
      return '';
    })(),
    model: env('SEARCH_MODEL') || (searchProvider === 'polza' ? 'perplexity/sonar' : env('GEMINI_MODEL')),
  },
  google: {
    apiKey: env('GOOGLE_API_KEY'),
    model: env('GEMINI_MODEL'),
  },
  sessions: {
    ttlMs: 1000 * 60 * 60 * 6,
    maxSessions: 200,
    maxMessages: 20,
    maxMessageChars: 4000,
    maxHistoryChars: 40000,
  },
  limits: {
    marketplace: 80,
    clauseNumber: 64,
    penaltyDescription: 4000,
    date: 32,
  },
};

export function missingChatConfig() {
  const missing = [];
  if (!config.chat.apiKey) missing.push('CHAT_API_KEY или CLAUDE_API_KEY');
  if (!config.chat.baseUrl) missing.push('CHAT_BASE_URL');
  if (!config.chat.model) missing.push('CHAT_MODEL');
  return missing;
}

export function missingPdfConfig() {
  const missing = [];
  if (!config.pdfModel.apiKey) missing.push('PDF_MODEL_API_KEY или CLAUDE_API_KEY');
  if (!config.pdfModel.baseUrl) missing.push('PDF_MODEL_BASE_URL');
  if (!config.pdfModel.model) missing.push('PDF_MODEL');
  return missing;
}

export function missingSearchConfig() {
  const missing = [];
  if (!config.search.apiKey) {
    if (config.search.provider === 'polza') missing.push('SEARCH_API_KEY или CLAUDE_API_KEY');
    else if (config.search.provider === 'google') missing.push('GOOGLE_API_KEY или SEARCH_API_KEY');
    else missing.push('SEARCH_API_KEY');
  }
  if (!config.search.model) missing.push('SEARCH_MODEL');
  if (config.search.provider === 'polza' && !config.search.baseUrl) {
    missing.push('SEARCH_BASE_URL');
  }
  return missing;
}

export function missingConfig() {
  return [...new Set([...missingChatConfig(), ...missingSearchConfig()])];
}

export function providerLabel(provider = config.search.provider) {
  if (provider === 'polza') return 'Polza / Perplexity Sonar';
  if (provider === 'google') return 'Google Gemini Search Grounding';
  return String(provider || 'unknown');
}
