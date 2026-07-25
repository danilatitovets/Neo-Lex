import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(__dirname, 'templates', 'claim.html');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function listHtml(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p class="muted">Нет данных</p>';
  }
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function sourcesHtml(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return '<p class="muted">Источники не указаны.</p>';
  }
  return `<ol>${sources
    .map((s) => {
      const title = escapeHtml(s.title || s.url || 'Источник');
      const url = escapeHtml(s.url || '');
      const quote = s.quote
        ? `<div class="quote">${escapeHtml(s.quote)}</div>`
        : '';
      return `<li><div class="src-title">${title}</div><div class="src-url">${url}</div>${quote}</li>`;
    })
    .join('')}</ol>`;
}

export async function buildClaimHtml(data) {
  const template = await fs.readFile(templatePath, 'utf8');
  const status = data.status === 'VERIFIED' ? 'VERIFIED' : 'NEEDS_REVIEW';
  const statusLabel =
    status === 'VERIFIED'
      ? 'VERIFIED — данные подтверждены источниками'
      : 'NEEDS_REVIEW — требуется дополнительная проверка';
  const reviewBanner =
    status === 'NEEDS_REVIEW'
      ? '<div class="banner">Документ требует дополнительной юридической проверки. Не используйте как финальную претензию без проверки юристом.</div>'
      : '';
  const warningsHtml = listHtml(
    Array.isArray(data.warnings) && data.warnings.length
      ? data.warnings
      : status === 'NEEDS_REVIEW'
        ? [
            'Источники не подтвердили точный текст указанного пункта. Требуется дополнительная проверка.',
          ]
        : []
  );

  return template
    .replaceAll('{{MARKETPLACE}}', escapeHtml(data.marketplace))
    .replaceAll('{{SITUATION}}', escapeHtml(data.situation))
    .replaceAll('{{CLAUSE_NUMBER}}', escapeHtml(data.clauseNumber))
    .replaceAll(
      '{{CLAUSE_TEXT}}',
      escapeHtml(
        data.clauseText ||
          'Текст пункта не подтверждён источниками. Требуется дополнительная проверка.'
      )
    )
    .replaceAll(
      '{{PRELIMINARY}}',
      escapeHtml(data.preliminaryPosition || 'Нет данных')
    )
    .replaceAll(
      '{{ARGUMENTATION}}',
      escapeHtml(data.legalArgumentation || data.finalPosition || '')
    )
    .replaceAll('{{DEMANDS}}', listHtml(data.demands))
    .replaceAll('{{SOURCES}}', sourcesHtml(data.usedSources || data.sources))
    .replaceAll('{{WARNINGS}}', warningsHtml)
    .replaceAll('{{CHECKED_AT}}', escapeHtml(data.checkedAt || ''))
    .replaceAll('{{STATUS}}', escapeHtml(statusLabel))
    .replaceAll(
      '{{PROVIDER}}',
      escapeHtml(data.providerLabel || data.provider || 'не указан')
    )
    .replaceAll('{{REVIEW_BANNER}}', reviewBanner);
}

export async function generatePdfBuffer(data) {
  const html = await buildClaimHtml(data);
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(90000);
    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' },
    });
    await page.close().catch(() => {});
    return Buffer.from(pdf);
  } catch (err) {
    const error = new Error('Не удалось сформировать PDF');
    error.code = 'PDF';
    error.cause = err;
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
