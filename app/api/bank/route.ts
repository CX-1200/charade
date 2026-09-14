import { NextResponse } from 'next/server';
import { CATEGORY_COLORS, clean, getBank, HttpError, id, updateBank } from '@/lib/game';

export const dynamic = 'force-dynamic';

export async function GET() {
  const bank = await getBank();
  return NextResponse.json({ bank });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? '');

    const bank = await updateBank((draft) => {
      switch (action) {
        case 'addCategory': {
          const name = clean(body.name, 30);
          if (!name) throw new HttpError(400, '请输入分类名称');
          if (draft.categories.some((c) => c.name === name)) {
            throw new HttpError(409, '这个分类已经存在了');
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
          if (!category) throw new HttpError(404, '分类不存在');
          const name = clean(body.name, 30);
          if (!name) throw new HttpError(400, '请输入分类名称');
          category.name = name;
          break;
        }
        case 'deleteCategory': {
          draft.categories = draft.categories.filter((c) => c.id !== body.categoryId);
          break;
        }
        case 'addItems': {
          const category = draft.categories.find((c) => c.id === body.categoryId);
          if (!category) throw new HttpError(404, '分类不存在');
          const raw = Array.isArray(body.texts) ? body.texts : [body.text];
          const texts = raw
            .flatMap((value) => String(value ?? '').split(/[\n,，、]/))
            .map((value) => clean(value, 60))
            .filter(Boolean);
          if (!texts.length) throw new HttpError(400, '请输入至少一道题目');
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
          if (!item) throw new HttpError(404, '题目不存在');
          const text = clean(body.text, 60);
          if (!text) throw new HttpError(400, '题目不能为空');
          item.text = text;
          break;
        }
        case 'deleteItem': {
          const category = draft.categories.find((c) => c.id === body.categoryId);
          if (!category) throw new HttpError(404, '分类不存在');
          category.items = category.items.filter((i) => i.id !== body.itemId);
          break;
        }
        default:
          throw new HttpError(400, `未知操作：${action}`);
      }
    });

    return NextResponse.json({ bank });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : '服务器错误';
    return NextResponse.json({ error: message }, { status });
  }
}
