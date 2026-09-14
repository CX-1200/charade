import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { CATEGORY_COLORS, clean, getBank, HttpError, id, updateBank } from '@/lib/game';

export const dynamic = 'force-dynamic';

export async function GET() {
  const bank = await getBank();
  return NextResponse.json({ bank });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    // The question bank is shared by every room, so only admins may edit it.
    requireAdmin(body.adminToken);
    const action = String(body.action ?? '');

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
        default:
          throw new HttpError(400, `Unknown action: ${action}`);
      }
    });

    return NextResponse.json({ bank });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status });
  }
}
