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
  doc.moveDown(0.7);
  doc.font(FONT_BOLD).fontSize(12).fillColor('#111111').text(title);
  doc.moveDown(0.2);
  doc.font(FONT_REGULAR).fontSize(11).fillColor('#222222').text(body || 'Нет данных', {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    lineGap: 2,
  });
}

function writeList(doc, title, items, emptyText) {
  doc.moveDown(0.7);
  doc.font(FONT_BOLD).fontSize(12).fillColor('#111111').text(title);
  doc.moveDown(0.2);
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
    doc.moveDown(0.15);
  }
}

export async function generateConsultationPdf(data) {
  const status = data.status === 'READY' ? 'READY' : 'NEEDS_REVIEW';
  const statusLabel =
    status === 'READY'
      ? 'READY — документ можно использовать для проверки'
      : 'NEEDS_REVIEW — требуется дополнительная проверка';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: text(data.title, 'Итог консультации'),
        Author: 'Neo-Lex',
      },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font(FONT_BOLD).fontSize(16).text(text(data.title, 'Итог консультации'), {
      align: 'center',
    });
    doc.moveDown(0.6);

    if (status === 'NEEDS_REVIEW') {
      doc
        .font(FONT_REGULAR)
        .fontSize(10)
        .fillColor('#5c4b1f')
        .text(
          text(
            data.warning,
            'Документ требует дополнительной юридической проверки. Не используйте как финальную претензию без проверки юристом.'
          )
        );
      doc.moveDown(0.5);
      doc.fillColor('#111111');
    }

    doc.font(FONT_REGULAR).fontSize(11);
    doc.text(`Дата формирования: ${text(data.checkedAt, '—')}`);
    doc.text(`Маркетплейс: ${text(data.marketplace, 'не указан')}`);
    doc.text(`Статус: ${statusLabel}`);

    writeSection(doc, 'Описание ситуации', text(data.situation, 'Нет данных'));
    writeList(doc, 'Установленные факты', data.facts, 'Факты не выделены');
    writeSection(
      doc,
      'Юридическая оценка',
      text(data.legalAssessment, 'Оценка не сформирована')
    );

    doc.moveDown(0.7);
    doc.font(FONT_BOLD).fontSize(12).text('Юридические ориентиры');
    doc.moveDown(0.2);
    doc.font(FONT_REGULAR).fontSize(11);
    const refs = Array.isArray(data.legalReferences) ? data.legalReferences : [];
    if (!refs.length) {
      doc.text('Не указаны');
    } else {
      for (const ref of refs) {
        const line = [ref.name, ref.article].filter(Boolean).join(' — ');
        doc.text(`• ${line || 'ориентир'}`);
        if (ref.url) {
          doc.fillColor('#333333').text(ref.url, { link: ref.url, underline: true });
          doc.fillColor('#222222');
        }
      }
    }

    writeList(doc, 'Рекомендации', data.recommendations, 'Нет данных');
    writeList(doc, 'Возможные требования', data.demands, 'Нет данных');
    writeList(doc, 'Недостающие данные', data.missingInformation, 'Не указаны');

    doc.moveDown(0.7);
    doc.font(FONT_BOLD).fontSize(12).text('Подтверждённые источники');
    doc.moveDown(0.2);
    doc.font(FONT_REGULAR).fontSize(11);
    const sources = Array.isArray(data.sources) ? data.sources : [];
    if (!sources.length) {
      doc.text('Подтверждённые источники отсутствуют.');
    } else {
      sources.forEach((source, index) => {
        doc.text(`${index + 1}. ${text(source.title || source.url, 'Источник')}`);
        if (source.url) {
          doc.fillColor('#333333').text(source.url, { link: source.url, underline: true });
          doc.fillColor('#222222');
        }
        doc.moveDown(0.15);
      });
    }

    if (data.warning) {
      writeSection(doc, 'Предупреждение', data.warning);
    }

    doc.end();
  });
}

export async function generatePdfBuffer(data) {
  return generateConsultationPdf({
    title: 'Тестовая претензия',
    marketplace: data.marketplace,
    situation: data.situation,
    facts: [],
    legalAssessment: data.legalArgumentation || data.finalPosition || '',
    legalReferences: [],
    recommendations: [],
    demands: data.demands || [],
    missingInformation: [],
    sources: data.usedSources || data.sources || [],
    status: data.status === 'VERIFIED' ? 'READY' : 'NEEDS_REVIEW',
    warning: '',
    checkedAt: data.checkedAt,
  });
}
