import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import {
  CATEGORY_COLORS,
  clean,
  exportBank,
  getBank,
  HttpError,
  id,
  importBank,
  readRepoBackup,
  REPO_BACKUP_PATH,
  updateBank,
} from '@/lib/game';
import { parseQuestionsCsv } from '@/lib/csv';
import { storeDriver, storeIsDurable, storeIsShared } from '@/lib/store';

/** A few thousand questions is well under this; it only stops runaway uploads. */
const MAX_CSV_BYTES = 1_000_000;

const storage = { driver: storeDriver, durable: storeIsDurable, shared: storeIsShared };

/** What the repository copy holds, so the page can offer to restore it. */
function backupSummary() {
  const backup = readRepoBackup();
  return backup
    ? {
        path: REPO_BACKUP_PATH,
        categories: backup.categories.length,
        questions: backup.categories.reduce((sum, c) => sum + c.items.length, 0),
      }
    : null;
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const bank = await getBank();
  // ?export=1 returns the portable snapshot an admin can save and re-import.
  if (new URL(request.url).searchParams.get('export')) {
    return NextResponse.json(exportBank(bank), {
      headers: {
        'Content-Disposition': `attachment; filename="charade-question-bank.json"`,
      },
    });
  }
  return NextResponse.json({ bank, storage, backup: backupSummary() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    // The question bank is shared by every room, so only admins may edit it.
    requireAdmin(body.adminToken);
    const action = String(body.action ?? '');

    // Filled in by the import actions so the page can say what happened.
    let report: { rows: number; skipped: number; categories: number } | null = null;

    const bank = await updateBank((draft) => {
      switch (action) {
        case 'addCategory': {
          const name = clean(body.name, 30);
          if (!name) throw new HttpError(400, 'Please enter a category name');
          if (draft.categories.some((c) => c.name === name)) {
            throw new HttpError(409, 'That category already exists');
          }
          draft.categories.push({
            id: id('cat'),
            name,
            color: CATEGORY_COLORS[draft.categories.length % CATEGORY_COLORS.length],
            items: [],
            createdAt: Date.now(),
          });
          break;
        }
        case 'renameCategory': {
          const category = draft.categories.find((c) => c.id === body.categoryId);
          if (!category) throw new HttpError(404, 'Category not found');
          const name = clean(body.name, 30);
          if (!name) throw new HttpError(400, 'Please enter a category name');
          category.name = name;
          break;
        }
        case 'deleteCategory': {
          draft.categories = draft.categories.filter((c) => c.id !== body.categoryId);
          break;
        }
        case 'addItems': {
          const category = draft.categories.find((c) => c.id === body.categoryId);
          if (!category) throw new HttpError(404, 'Category not found');
          const raw = Array.isArray(body.texts) ? body.texts : [body.text];
          const texts = raw
            .flatMap((value) => String(value ?? '').split(/[\n,，、]/))
            .map((value) => clean(value, 60))
            .filter(Boolean);
          if (!texts.length) throw new HttpError(400, 'Please enter at least one prompt');
          const existing = new Set(category.items.map((i) => i.text));
          for (const text of texts) {
            if (existing.has(text)) continue;
            existing.add(text);
            category.items.push({ id: id('q'), text, createdAt: Date.now() });
          }
          break;
        }
        case 'updateItem': {
          const category = draft.categories.find((c) => c.id === body.categoryId);
          const item = category?.items.find((i) => i.id === body.itemId);
          if (!item) throw new HttpError(404, 'Prompt not found');
          const text = clean(body.text, 60);
          if (!text) throw new HttpError(400, 'A prompt cannot be empty');
          item.text = text;
          break;
        }
        case 'deleteItem': {
          const category = draft.categories.find((c) => c.id === body.categoryId);
          if (!category) throw new HttpError(404, 'Category not found');
          category.items = category.items.filter((i) => i.id !== body.itemId);
          break;
        }
        case 'import': {
          importBank(draft, body.data, body.mode === 'replace' ? 'replace' : 'merge');
          break;
        }
        case 'importCsv': {
          const csv = typeof body.csv === 'string' ? body.csv : '';
          if (!csv.trim()) throw new HttpError(400, 'That file is empty');
          if (csv.length > MAX_CSV_BYTES) throw new HttpError(413, 'That file is too large');
          const parsed = parseQuestionsCsv(csv);
          if (!parsed.categories.length) {
            throw new HttpError(
              400,
              'No questions found — the file needs a category column and a question column',
            );
          }
          importBank(draft, parsed, body.mode === 'replace' ? 'replace' : 'merge');
          report = {
            rows: parsed.rows,
            skipped: parsed.skipped,
            categories: parsed.categories.length,
          };
          break;
        }
        case 'restoreFromRepo': {
          const backup = readRepoBackup();
          if (!backup) throw new HttpError(404, `No backup found at ${REPO_BACKUP_PATH}`);
          importBank(draft, backup, body.mode === 'merge' ? 'merge' : 'replace');
          report = { rows: backup.rows, skipped: backup.skipped, categories: backup.categories.length };
          break;
        }
        default:
          throw new HttpError(400, `Unknown action: ${action}`);
      }
    });

    return NextResponse.json({ bank, storage, backup: backupSummary(), report });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status });
  }
}
