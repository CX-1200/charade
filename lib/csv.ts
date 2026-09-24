/**
 * The question bank as a spreadsheet: one row per question, two columns.
 *
 *   category,question
 *   Animals,Giraffe
 *   Movies,"Crouching Tiger, Hidden Dragon"
 *
 * Written to survive whatever Excel, Numbers or Google Sheets hand back: a
 * UTF-8 byte-order mark, CRLF line endings, quoted cells with commas or line
 * breaks inside, `;` or tab separators (Excel uses `;` in many locales), blank
 * rows, and headers in English or Chinese — or no header at all.
 *
 * Pure functions with no dependencies, shared by the browser (import/export)
 * and the server (restoring from the copy kept in the repository).
 */

export type CsvCategory = { name: string; items: string[] };

export type CsvParseResult = {
  categories: CsvCategory[];
  /** Rows that became questions. */
  rows: number;
  /** Rows dropped because the category or the question was empty. */
  skipped: number;
};

const BOM = '﻿';

const CATEGORY_HEADERS = ['category', 'categories', 'cat', 'group', '分类', '类别', '类型', '組別', '组别'];
const QUESTION_HEADERS = ['question', 'questions', 'prompt', 'word', 'answer', 'text', '题目', '題目', '问题', '答案', '词语'];

const norm = (value: string) => value.trim().toLowerCase();

/** Picks the separator the header row (or first row) actually uses. */
function sniffDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r\n|\n|\r|$/));
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  const [best] = counts.sort((a, b) => b[1] - a[1]);
  return best[1] > 0 ? best[0] : ',';
}

/** RFC 4180 tokenizer: quoted cells, doubled quotes, line breaks inside quotes. */
function tokenize(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const clean = (value: string | undefined, max: number) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export function parseQuestionsCsv(input: string): CsvParseResult {
  const text = input.startsWith(BOM) ? input.slice(BOM.length) : input;
  const rows = tokenize(text, sniffDelimiter(text)).filter((r) => r.some((c) => c.trim() !== ''));
  if (!rows.length) return { categories: [], rows: 0, skipped: 0 };

  // Find the two columns by header name; without a recognised header the
  // first row is data and the columns are simply category, question.
  let catCol = 0;
  let qCol = 1;
  let start = 0;
  const header = rows[0].map(norm);
  const c = header.findIndex((h) => CATEGORY_HEADERS.includes(h));
  const q = header.findIndex((h) => QUESTION_HEADERS.includes(h));
  if (c !== -1 || q !== -1) {
    catCol = c !== -1 ? c : q === 0 ? 1 : 0;
    qCol = q !== -1 ? q : catCol === 0 ? 1 : 0;
    start = 1;
  }

  const byName = new Map<string, CsvCategory>();
  const seen = new Map<string, Set<string>>();
  let kept = 0;
  let skipped = 0;

  for (const row of rows.slice(start)) {
    const name = clean(row[catCol], 30);
    const question = clean(row[qCol], 60);
    if (!name || !question) {
      skipped += 1;
      continue;
    }
    const key = name.toLowerCase();
    let category = byName.get(key);
    if (!category) {
      category = { name, items: [] };
      byName.set(key, category);
      seen.set(key, new Set());
    }
    const questions = seen.get(key)!;
    if (questions.has(question.toLowerCase())) continue; // duplicate row, not an error
    questions.add(question.toLowerCase());
    category.items.push(question);
    kept += 1;
  }

  return { categories: [...byName.values()], rows: kept, skipped };
}

/**
 * Quote only when a cell needs it. Cells are written as-is otherwise: only
 * admins author questions, so spreadsheet formula escaping would just leave
 * stray apostrophes in their own text after a round trip.
 */
function cell(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * CRLF and a byte-order mark: without the mark Excel opens UTF-8 as the local
 * code page and every non-ASCII question turns into mojibake.
 */
export function toQuestionsCsv(categories: Array<{ name: string; items: string[] }>): string {
  const lines = ['category,question'];
  for (const category of categories) {
    for (const item of category.items) lines.push(`${cell(category.name)},${cell(item)}`);
  }
  return BOM + lines.join('\r\n') + '\r\n';
}
