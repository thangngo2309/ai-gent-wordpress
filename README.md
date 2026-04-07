# AI Coding Agent Orchestrator

Multi-agent pipeline tự động sinh website hoàn chỉnh từ một câu mô tả idea. Sử dụng Claude API (Anthropic) để phân tích, thiết kế, generate code, build, test và commit. Hỗ trợ **checkpoint/resume** — dừng giữa chừng và tiếp tục bất cứ lúc nào.

## Architecture

```
┌──────────┐     nhập prompt / --resume path
│   User   │──────────────────────────┐
└──────────┘                          │
                                      ▼
              ┌─────────────────────────────────┐
              │   Agent 1: Idea Analyzer        │  → IDEA.md
              │   (Claude Sonnet)               │
              └────────────┬────────────────────┘
                 review / change / regenerate / quit
                    ✅ approve → checkpoint saved
                           │
              ┌────────────▼────────────────────┐
              │   Agent 2: Spec Builder         │  → SPEC.md
              │   (Claude Sonnet)               │
              └────────────┬────────────────────┘
                 review / change / regenerate / quit
                    ✅ approve → checkpoint saved
                           │
              ┌────────────▼────────────────────┐
              │   Agent 3: Code Generator       │  → src/**
              │   Batched (4 files/call)        │
              │   + npm install                 │
              │   + Runtime check & auto-fix    │
              │   + Dev server (localhost:3456) │
              └────────────┬────────────────────┘
                 review / change / regenerate / quit
                    ✅ approve → checkpoint saved
                           │
              ┌────────────▼────────────────────┐
              │   Agent 4: Build & Auto-Fix     │  → production build
              │   Loop max 5 retries            │
              │   + Runtime check (3x auto-fix) │
              │   + Dev server (localhost:3456) │
              └────────────┬────────────────────┘
                 review / change / regenerate / quit
                    ✅ approve → checkpoint saved
                           │
              ┌────────────▼────────────────────┐
              │   Agent 5: Test Runner          │
              └────────────┬────────────────────┘
                 review / change / regenerate / quit
                    ✅ approve → checkpoint saved
                           │
              ┌────────────▼────────────────────┐
              │   Agent 6: Git Commit           │
              └────────────┬────────────────────┘
                    ✅ approve → checkpoint saved
                           │
                    ✅ Pipeline hoàn thành!
                    🔄 Resume lại = bắt đầu từ Agent 1
```

### Interactive Review Menu

Mỗi agent chạy xong → hiện **interactive review menu**:

| Action | Phím | Mô tả |
|--------|------|--------|
| Approve | `a` | Lưu checkpoint → chuyển sang agent tiếp theo |
| Change | `c` | Nhập yêu cầu chỉnh sửa → LLM auto-fix → review lại |
| Regenerate | `r` | Chạy lại agent từ đầu (gọi LLM mới hoàn toàn) |
| Quit | `q` | Lưu checkpoint → dừng pipeline (resume sau) |

### Checkpoint System

```
output/project-{timestamp}/
  └── .agent-checkpoint.json    ← auto-saved sau mỗi agent
```

| Sự kiện | Hành vi |
|---------|---------|
| Approve agent | Lưu checkpoint + đánh dấu agent hoàn thành |
| Quit giữa chừng | Lưu checkpoint → in ra command resume |
| Agent fail | Lưu checkpoint → in ra command resume |
| Resume project | Đọc checkpoint → skip agents đã xong → tiếp tục agent tiếp theo |
| Resume sau khi 6/6 xong | Chạy lại từ Agent 1 (iterate/refine) |

Checkpoint lưu đầy đủ: idea, analysis, spec, generated files, build logs, test logs.

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
├── agent.ts              # Single-file orchestrator (~2700 lines)
├── package.json
├── tsconfig.json
├── .env                  # API keys (git-ignored)
├── .env.example          # Template config
├── .gitignore
├── dist/                 # Compiled JS output
│   └── agent.js
└── output/               # Generated projects
    └── project-{timestamp}/
        ├── .agent-checkpoint.json  # ← Checkpoint (auto-saved)
        ├── IDEA.md                 # Feature analysis output
        ├── SPEC.md                 # Architecture spec output
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

### Tạo project mới

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

### Resume project đã tạo

Khi bạn quit giữa chừng (nhấn `q`) hoặc agent fail, pipeline sẽ in ra command resume:

```bash
# Resume bằng flag --resume
node dist/agent.js --resume ./output/project-1775238748739

# Hoặc truyền path trực tiếp (auto-detect checkpoint)
node dist/agent.js ./output/project-1775238748739

# Đường dẫn tuyệt đối cũng được
node dist/agent.js --resume /Users/nst/Workspace/FL/ai-agent-for-develop/output/project-1775238748739
```

Resume sẽ:
- Đọc `.agent-checkpoint.json` trong project
- Khôi phục context (idea, analysis, spec, files, logs)
- Skip agents đã hoàn thành
- Tiếp tục từ agent tiếp theo
- Nếu tất cả 6 agents đã xong → chạy lại từ Agent 1 (iterate/refine)

### Workflow ví dụ

```bash
# Lần 1: tạo mới, approve Agent 1-3, quit ở Agent 4
node dist/agent.js "trang bán giày sneakers"
# → Checkpoint saved — resume later with: node dist/agent.js --resume ./output/project-xxx

# Lần 2: resume, tiếp tục từ Agent 4
node dist/agent.js --resume ./output/project-xxx
# → Agent 4 build + fix, approve → Agent 5 test → Agent 6 commit → Done!

# Lần 3: resume project đã hoàn thành → iterate
node dist/agent.js --resume ./output/project-xxx
# → Pipeline restart từ Agent 1, refine features/design/code
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
- **Review**: Xem IDEA.md trên console → approve / change / regenerate
- Ví dụ change: `"add a blog section"`, `"change stack to Vue"`, `"remove authentication feature"`

### Agent 2: Spec Builder
- Input: Feature analysis từ Agent 1
- Output: `SPEC.md` — file tree, component diagram, architecture overview
- LLM prompt: Thiết kế Next.js App Router structure với Tailwind CSS
- **Review**: Xem SPEC.md trên console → approve / change / regenerate
- Ví dụ change: `"add a FAQ component"`, `"add testimonials data file"`, `"remove contact form"`

### Agent 3: Code Generator
- Input: Spec từ Agent 2
- Output: Toàn bộ source code ghi vào disk
- Batched: 4 files/LLM call (tránh token overflow)
- Smart ordering: types → data → config → components → pages → tests
- Post-gen: auto `npm install` → **runtime check** (fetch pages, bắt 500/TypeError, auto-fix max 3x) → start dev server
- **Review**: Mở `http://localhost:3456` xem website → approve / change / regenerate
- Ví dụ change: `"change hero background to dark blue"`, `"make header sticky with blur"`, `"change text to English"`

### Agent 4: Build & Auto-Fix
- Chạy `npm run build` (`next build`)
- Nếu lỗi → parse error output → đọc broken files → gửi LLM fix → retry (max 5 lần)
- Smart import/export detection: khi lỗi "has no exported member" → đọc cả target module
- Rate limit handling: auto retry 429 với exponential backoff
- Post-build: **Runtime check** — start dev server, fetch tất cả pages, bắt HTTP 500 / TypeError (max 3 retries auto-fix)
- **Review**: Mở `http://localhost:3456` xem website → approve / change / regenerate
- Ví dụ change: `"fix product cards - images too small"`, `"add spacing between sections"`, `"change font size"`

### Agent 5: Test Runner
- Chạy `npm test`
- Output: test results
- **Review**: Xem test output → approve / change / regenerate
- Ví dụ change: `"add test for contact form validation"`, `"skip failing tests"`

### Agent 6: Git Commit
- `git init` + `git add .` + `git commit -m "..."`
- Commit message do LLM sinh dựa trên project summary
- **Review**: Xem commit message → approve / change / regenerate
- Ví dụ change: `"change commit message to feat: initial release"`

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
| `ENOENT: BUILD_ID` | Chưa build mà chạy `npm start` | Dùng `npm run dev` hoặc `npm run build && npm start` |
| Runtime TypeError 500 | Component dùng data undefined | Runtime check sẽ auto-fix (thêm `?.`, `?? []`) |
| Agent fail giữa chừng | API error / build error | Resume: `node dist/agent.js --resume ./output/project-xxx` |
| Resume không thấy checkpoint | Chưa approve agent nào | Chạy ít nhất 1 agent và approve trước khi quit |

## Chi phí ước tính

Với Claude Sonnet + $5 credit:

| Operation | Input tokens | Output tokens | Cost |
|-----------|-------------|---------------|------|
| 1 pipeline run (6 agents) | ~30K-50K | ~15K-25K | ~$0.10-0.20 |
| Build-fix retry (1 lần) | ~5K-10K | ~2K-5K | ~$0.02-0.04 |
| Runtime check fix (1 lần) | ~5K-10K | ~2K-5K | ~$0.02-0.04 |
| Change request (1 lần) | ~3K-8K | ~2K-4K | ~$0.01-0.03 |
| Resume (skip completed) | Chỉ tính agents chạy lại | | Tiết kiệm ~50-80% |
| **$5 credit ≈** | | | **25-50 full pipelines** |
