# 🎭 你比划我猜 · Charade Party

一个多人在线的「你比划我猜」网页游戏，为 Vercel 部署而写。

- **出题** — 自建分类，往每个分类里放题目；开局时选中的分类会被**打乱混合成一副牌**。
- **看板** — 多人用名字登录进同一个房间，分组、倒计时、实时比分、结束后结算看板。
- **答题** — 大字题卡 + 「✓ 正确」/「⏭ 跳过」两个按钮，倒计时长度由房主自定义。

## 玩法流程

1. 任何人打开首页 → `📚 题库管理` → 新建分类（动物 / 电影 / 成语…）→ 批量粘贴题目（一行一题，也支持逗号、顿号分隔）。
2. 回首页输入名字 → `创建房间`，拿到 4 位房间号，把链接发给朋友。
3. 朋友打开同一个网址输入房间号（或直接点邀请链接）→ 输入名字 → 进入大厅 → 选自己的组别。
4. 房主在大厅里设定：**倒计时时长**（预设 30/60/90/120/180 秒，或自定义 15–600 秒）、**参与的分类**、**组别**、跳过是否扣分。
5. 房主点「🚀 开始游戏」——所有人同时开始答题。每个人从同一副混合牌里依次抽题，**不会拿到重复的题**。
6. 时间到自动结算，或房主「提前结束」。看板按组显示分数、答对/跳过数和答题明细，可以「🔁 再来一轮」累计多轮成绩。

计分：答对 +1 分，跳过 0 分（房主可开启「跳过扣 1 分」）。分数记在玩家所属的**组别**上。

## 本地运行

```bash
npm install
npm run dev      # http://localhost:3000
```

其他命令：`npm run build`、`npm run start`、`npm run typecheck`。

## 部署到 Vercel

```bash
npm i -g vercel
vercel            # 首次部署，一路回车即可
vercel --prod     # 正式发布
```

或者把仓库推到 GitHub，在 [vercel.com/new](https://vercel.com/new) 里 Import 这个仓库 —— Next.js 会被自动识别，不需要改任何构建设置。

### ⚠️ 生产环境请配置 Redis（重要）

游戏状态（题库、房间、分数）通过一个可切换的 KV 存储保存：

| 驱动 | 何时启用 | 说明 |
| --- | --- | --- |
| `memory` | 默认 | 零配置，适合本地开发和快速试玩。状态存在 Node 进程里，重启即丢，**Serverless 的多个实例之间也不共享**。 |
| `redis` | 检测到 REST 环境变量时 | 所有实例共享同一份状态，多设备真正一起玩需要它。 |

在 Vercel 上只用内存驱动时，不同请求可能落到不同实例，会出现「房间不存在」「分数对不上」。首页检测到这种情况会显示黄色提示。

配置方法（二选一，都是免费额度起步）：

- **Upstash Redis** — 在 [upstash.com](https://upstash.com) 建一个 Redis 数据库，把 REST URL / REST Token 填进 Vercel 的环境变量：
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- **Vercel KV / Vercel Redis** — 在 Vercel 项目的 Storage 标签里创建，它会自动注入 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN`，代码同样会读取。

填完环境变量后重新部署即可。可以访问 `/api/health` 确认当前用的是哪个驱动。

房间数据有 12 小时 TTL，过期自动清理。

## 项目结构

```
app/
  page.tsx                   首页：登录名字、创建 / 加入房间
  questions/page.tsx         题库管理：分类 + 题目增删
  room/[code]/page.tsx       房间页（大厅 / 答题 / 看板三态）
  room/[code]/RoomClient.tsx 房间的全部交互与轮询逻辑
  api/bank/route.ts          题库读写
  api/rooms/route.ts         创建房间
  api/rooms/[code]/route.ts  房间状态轮询 + 所有房间操作
  api/health/route.ts        当前存储驱动
lib/
  game.ts                    房间 / 题库 / 发牌 / 计分等核心逻辑
  store.ts                   KV 存储（memory / redis 双驱动 + 进程内写锁）
  serialize.ts               对外暴露的房间视图（牌堆不下发给客户端）
  types.ts, ui.ts, client.ts 类型、共享常量、前端请求封装
```

同步方式是 HTTP 轮询（答题中约 0.9s 一次，大厅约 1.6s 一次），不依赖 WebSocket，所以在 Vercel 的 Serverless 环境里可以直接跑。
