import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveFont(name) {
  const local = path.join(__dirname, 'fonts', name);
  if (fs.existsSync(local)) return local;
  return require.resolve(`dejavu-fonts-ttf/ttf/${name}`);
}

const FONT_REGULAR = resolveFont('DejaVuSans.ttf');
const FONT_BOLD = resolveFont('DejaVuSans-Bold.ttf');

function text(value, fallback = '') {
  const raw = String(value ?? '').trim();
  return raw || fallback;
}

function writeSection(doc, title, body) {
  doc.moveDown(0.8);
  doc.font(FONT_BOLD).fontSize(12).fillColor('#111111').text(title);
  doc.moveDown(0.25);
  doc.font(FONT_REGULAR).fontSize(11).fillColor('#222222').text(body || 'Нет данных', {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    lineGap: 2,
  });
}

function writeList(doc, title, items, emptyText) {
  doc.moveDown(0.8);
  doc.font(FONT_BOLD).fontSize(12).fillColor('#111111').text(title);
  doc.moveDown(0.25);
  doc.font(FONT_REGULAR).fontSize(11).fillColor('#222222');
  const list = Array.isArray(items) ? items.filter((item) => String(item || '').trim()) : [];
  if (!list.length) {
    doc.text(emptyText);
    return;
  }
  for (const item of list) {
    doc.text(`• ${String(item).trim()}`, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      lineGap: 2,
    });
    doc.moveDown(0.2);
  }
}

export async function buildClaimHtml() {
  return '';
}

export async function generatePdfBuffer(data) {
  const status = data.status === 'VERIFIED' ? 'VERIFIED' : 'NEEDS_REVIEW';
  const statusLabel =
    status === 'VERIFIED'
      ? 'VERIFIED — данные подтверждены источниками'
      : 'NEEDS_REVIEW — требуется дополнительная проверка';
  const clauseText = text(
    data.clauseText,
    'Текст пункта не подтверждён источниками. Требуется дополнительная проверка.'
  );
  const warnings =
    Array.isArray(data.warnings) && data.warnings.length
      ? data.warnings
      : status === 'NEEDS_REVIEW'
        ? [
            'Источники не подтвердили точный текст указанного пункта. Требуется дополнительная проверка.',
          ]
        : [];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'Тестовая претензия — Neo-Lex',
        Author: 'Neo-Lex',
      },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font(FONT_BOLD).fontSize(16).text('Тестовая претензия', { align: 'center' });
    doc.moveDown(0.8);

    if (status === 'NEEDS_REVIEW') {
      doc
        .font(FONT_REGULAR)
        .fontSize(10)
        .fillColor('#5c4b1f')
        .text(
          'Документ требует дополнительной юридической проверки. Не используйте как финальную претензию без проверки юристом.'
        );
      doc.moveDown(0.6);
      doc.fillColor('#111111');
    }

    doc.font(FONT_REGULAR).fontSize(11);
    doc.text(`Маркетплейс: ${text(data.marketplace, '—')}`);
    doc.text(`Пункт оферты: ${text(data.clauseNumber, '—')}`);
    doc.text(`Дата проверки: ${text(data.checkedAt, '—')}`);
    doc.text(`Статус проверки: ${statusLabel}`);
    doc.text(
      `Поисковый провайдер: ${text(data.providerLabel || data.provider, 'не указан')}`
    );

    writeSection(doc, 'Описание ситуации', text(data.situation, 'Нет данных'));
    writeSection(doc, 'Найденный текст пункта', clauseText);
    writeSection(
      doc,
      'Предварительная позиция',
      text(data.preliminaryPosition, 'Нет данных')
    );
    writeSection(
      doc,
      'Итоговая юридическая аргументация',
      text(data.legalArgumentation || data.finalPosition, 'Нет данных')
    );
    writeList(doc, 'Требования', data.demands, 'Нет данных');

    doc.moveDown(0.8);
    doc.font(FONT_BOLD).fontSize(12).text('Источники');
    doc.moveDown(0.25);
    doc.font(FONT_REGULAR).fontSize(11);
    const sources = Array.isArray(data.usedSources || data.sources)
      ? data.usedSources || data.sources
      : [];
    if (!sources.length) {
      doc.text('Источники не указаны.');
    } else {
      sources.forEach((source, index) => {
        const title = text(source?.title || source?.url, 'Источник');
        const url = text(source?.url, '');
        doc.text(`${index + 1}. ${title}`);
        if (url) {
          doc.fillColor('#333333').text(url, {
            link: url,
            underline: true,
          });
          doc.fillColor('#222222');
        }
        if (source?.quote) {
          doc.font(FONT_REGULAR).fillColor('#444444').text(String(source.quote), {
            italic: false,
          });
          doc.fillColor('#222222');
        }
        doc.moveDown(0.25);
      });
    }

    writeList(doc, 'Предупреждения', warnings, 'Нет данных');
    doc.end();
  });
}
