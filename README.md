# AI Coding Agent Orchestrator

Multi-agent pipeline tự động sinh website hoàn chỉnh từ một câu mô tả idea. Sử dụng Claude API (Anthropic) để phân tích, thiết kế, generate code, build, test và commit.

## Architecture

```
┌──────────┐     nhập prompt
│   User   │────────────────┐
└──────────┘                │
                            ▼
              ┌─────────────────────────┐
              │   Agent 1: Idea Analyzer│  → IDEA.md
              │   (Claude Sonnet)       │
              └────────────┬────────────┘
                    review & approve
                           │
              ┌────────────▼────────────┐
              │   Agent 2: Spec Builder │  → SPEC.md
              │   (Claude Sonnet)       │
              └────────────┬────────────┘
                    review & approve
                           │
              ┌────────────▼────────────┐
              │   Agent 3: Code Generator│ → src/**
              │   Batched (4 files/call) │
              └────────────┬────────────┘
                  runtime check + fix
                    review & approve
                           │
              ┌────────────▼────────────┐
              │   Agent 4: Build & Fix  │  → production build
              │   Loop max 5 retries    │
              │   + Runtime check (3x)  │
              └────────────┬────────────┘
                    review & approve
                           │
              ┌────────────▼────────────┐
              │   Agent 5: Test Runner  │
              └────────────┬────────────┘
                    review & approve
                           │
              ┌────────────▼────────────┐
              │   Agent 6: Git Commit   │
              └──────────────────────────┘
```

Mỗi agent chạy xong → hiện **interactive review menu**:

| Action | Mô tả |
|--------|--------|
| `[a]` Approve | Chuyển sang agent tiếp theo |
| `[c]` Change | Nhập yêu cầu chỉnh sửa → LLM auto-fix → review lại |
| `[r]` Regenerate | Chạy lại agent từ đầu |
| `[q]` Quit | Dừng pipeline |

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript (Node.js ≥ 18) |
| LLM | Claude Sonnet via Anthropic API |
| Generated apps | Next.js 14 + Tailwind CSS + TypeScript |
| Package manager | npm (auto-fallback từ pnpm) |
| Config | dotenv (`.env`) |

## Project Structure

```
ai-agent-for-develop/
├── agent.ts              # Single-file orchestrator (~2600 lines)
├── package.json
├── tsconfig.json
├── .env                  # API keys (git-ignored)
├── .env.example          # Template config
├── .gitignore
├── sample/
│   └── index.html        # (Optional) Reference layout template
├── dist/                 # Compiled JS output
│   └── agent.js
└── output/               # Generated projects
    └── project-{timestamp}/
        ├── IDEA.md       # Feature analysis output
        ├── SPEC.md       # Architecture spec output
        ├── package.json
        ├── next.config.mjs
        ├── tailwind.config.ts
        ├── postcss.config.js
        ├── tsconfig.json
        └── src/
            ├── app/
            │   ├── layout.tsx
            │   ├── page.tsx
            │   └── globals.css
            ├── components/
            │   ├── Header.tsx
            │   ├── Hero.tsx
            │   ├── FeaturedProducts.tsx
            │   ├── Categories.tsx
            │   ├── Editorial.tsx
            │   ├── Archives.tsx
            │   ├── About.tsx
            │   ├── Footer.tsx
            │   └── BackToTop.tsx
            ├── data/
            │   ├── site.ts
            │   ├── products.ts
            │   ├── articles.ts
            │   └── archives.ts
            └── types/
                └── index.ts
```

## Cài đặt

```bash
# Clone & install
cd ai-agent-for-develop
npm install

# Config
cp .env.example .env
# Mở .env → điền ANTHROPIC_API_KEY
```

## Sử dụng

```bash
# Build TypeScript
npm run build

# Chạy agent
node dist/agent.js "build a landing page for selling bikes"

# Chạy với tiếng Việt
node dist/agent.js "xây dựng trang giới thiệu và buôn bán pin lithium"

# Auto-approve tất cả steps (skip interactive menu)
AUTO_APPROVE=true node dist/agent.js "create a portfolio website"

# Mock mode (không cần API key, dùng dữ liệu giả)
# Chỉ cần để ANTHROPIC_API_KEY trống trong .env
node dist/agent.js "test idea"
```

## Environment Variables

| Variable | Default | Mô tả |
|----------|---------|--------|
| `ANTHROPIC_API_KEY` | *(trống = mock mode)* | API key từ [console.anthropic.com](https://console.anthropic.com) |
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` | Model Claude sử dụng |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARN` / `ERROR` |
| `AUTO_APPROVE` | `false` | `true` = skip interactive review |
| `OUTPUT_DIR` | `./output` | Thư mục chứa project output |

## Agent Details

### Agent 1: Idea Analyzer
- Input: Câu mô tả idea từ user
- Output: `IDEA.md` — project name, features (priority high/medium/low), tech stack
- LLM prompt: Phân tích idea → trả JSON `{ projectName, summary, features[], techStack }`

### Agent 2: Spec Builder
- Input: Feature analysis từ Agent 1
- Output: `SPEC.md` — file tree, component diagram, architecture overview
- LLM prompt: Thiết kế Next.js App Router structure với Tailwind CSS

### Agent 3: Code Generator
- Input: Spec từ Agent 2
- Output: Toàn bộ source code ghi vào disk
- Batched: 4 files/LLM call (tránh token overflow)
- Smart ordering: types → data → config → components → pages → tests
- Post-gen: auto `npm install` + runtime check + start dev server

### Agent 4: Build & Auto-Fix
- Chạy `npm run build` (`next build`)
- Nếu lỗi → parse error output → đọc broken files → gửi LLM fix → retry (max 5 lần)
- Smart import/export detection: khi lỗi "has no exported member" → đọc cả target module
- Rate limit handling: auto retry 429 với exponential backoff
- Post-build: **Runtime check** — start dev server, fetch tất cả pages, bắt HTTP 500 / TypeError (max 3 retries)
- Preview server trên `http://localhost:3456`

### Agent 5: Test Runner
- Chạy `npm test`
- Output: test results

### Agent 6: Git Commit
- `git init` + `git add .` + `git commit -m "..."`
- Commit message do LLM sinh dựa trên project summary

## Design System

Code generator sử dụng design system sáng tạo:

| Token | Ý nghĩa |
|-------|---------|
| `--font-heading` | Inter (Google Fonts) |
| `primary` | Brand color (Claude tự chọn theo topic) |
| `secondary` | Accent color |
| `background` | Page background |
| `foreground` | Text color |
| `muted` | Subtle backgrounds |
| `card` | Card surfaces |
| `border` | Border color |
| `accent` | Interactive highlights |

Component animations: `fade-in`, `slide-up` keyframes cho entrance effects.

## Security & Sandboxing

- **Path traversal blocked**: Tất cả file I/O qua `resolveSafe()` — kiểm tra path không escape workspace
- **Command allow-list**: Chỉ cho phép `npm`, `pnpm`, `npx`, `git`, `node`, `tsc`
- **Rate limit retry**: Auto backoff khi bị Claude API 429
- **Timeout**: Command execution timeout 120s
- **API key isolation**: `.env` git-ignored, không bao giờ log key

## Troubleshooting

| Lỗi | Nguyên nhân | Fix |
|-----|-------------|-----|
| `credit balance is too low` | Chưa nạp tiền Anthropic | Vào console.anthropic.com → Billing → Add credits ($5+) |
| `rate_limit_error 429` | Vượt 30K input tokens/phút | Agent sẽ auto retry (30-90s backoff) |
| `Unterminated string in JSON` | Response bị truncated | Giảm batch size hoặc tăng `max_tokens` |
| `mgt.clearMarks is not a function` | VS Code terminal bug | Chạy ngoài Terminal.app, ignore warning |
| CSS không apply | `postcss.config` format sai | Dùng `.js` (CommonJS), không dùng `@apply` trong `@layer` |
| `Cannot find module 'agent.js'` | Chưa compile TypeScript | Chạy `npm run build` trước |
| Import/export mismatch | Claude gen batched không nhất quán | Build-fix agent sẽ auto-detect và fix |

## Chi phí ước tính

Với Claude Sonnet + $5 credit:

| Operation | Input tokens | Output tokens | Cost |
|-----------|-------------|---------------|------|
| 1 pipeline run (6 agents) | ~30K-50K | ~15K-25K | ~$0.10-0.20 |
| Build-fix retry (1 lần) | ~5K-10K | ~2K-5K | ~$0.02-0.04 |
| Change request (1 lần) | ~3K-8K | ~2K-4K | ~$0.01-0.03 |
| **$5 credit ≈** | | | **25-50 full pipelines** |
