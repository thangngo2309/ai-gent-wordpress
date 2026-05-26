# AI Coding Agent Orchestrator

Multi-agent pipeline tự động sinh **WordPress theme hoặc WordPress plugin** production-ready từ một câu mô tả idea. Agent hiện phân loại yêu cầu thành theme/plugin, dựng spec đúng kiến trúc WordPress, generate code upload-ready, validate PHP, auto-fix lỗi cơ bản, và tạo ZIP sạch để upload trực tiếp lên WordPress. Hỗ trợ **checkpoint/resume** để dừng giữa chừng và tiếp tục bất cứ lúc nào.

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
              │   Agent 3: Code Generator       │  → theme/plugin files
              │   Batched (4 files/call)        │
              │   + PHP lint validation         │
              │   + Theme runtime check & auto-fix
              │   + Theme preview (localhost:3456)
              └────────────┬────────────────────┘
                 review / change / regenerate / quit
                    ✅ approve → checkpoint saved
                           │
              ┌────────────▼────────────────────┐
              │   Agent 4: Build & Auto-Fix     │  → PHP lint all files
              │   Loop max 5 retries            │
              │   + Theme runtime check (3x auto-fix)
              │   + Theme dev server (localhost:3456)
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
| Generated output | WordPress Theme hoặc WordPress Plugin |
| Validation | `php -l`, theme runtime preview, upload ZIP packaging |
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
      ├── style.css / plugin-slug.php   # Theme header or plugin bootstrap
      ├── functions.php / includes/     # Theme setup or plugin services
      ├── template-parts/ / admin/      # Theme sections or plugin admin layer
      ├── assets/                       # CSS/JS assets
      ├── uninstall.php                 # Plugin cleanup when applicable
      └── package-slug.zip              # Upload-ready ZIP artifact
```

## Cài đặt

### Yêu cầu môi trường

- Node.js `>= 18` để build và chạy agent
- PHP CLI để chạy `php -l` và local preview trong pipeline
- Anthropic API key nếu muốn chạy live generation
- Khuyến nghị: Node.js `>= 20.18` nếu muốn chạy thử output bằng WordPress Playground CLI

Kiểm tra nhanh:

```bash
node -v
php -v
```

### Cài agent

```bash
# Clone & install
cd ai-agent-for-develop
npm install

# Config
cp .env.example .env
# Mở .env → điền ANTHROPIC_API_KEY

# Lưu ý: agent ưu tiên các biến app config trong .env hơn các giá trị ANTHROPIC_API_KEY,
# CLAUDE_MODEL, LOG_LEVEL, AUTO_APPROVE, OUTPUT_DIR đã export sẵn trong shell.
```

Nếu chưa có file `.env.example`, bạn có thể tự tạo `.env` tối thiểu như sau:

```bash
ANTHROPIC_API_KEY=your_key_here
CLAUDE_MODEL=claude-sonnet-4-20250514
LOG_LEVEL=INFO
AUTO_APPROVE=false
OUTPUT_DIR=./output
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
# Ép mock mode ngay cả khi .env đang có key
FORCE_MOCK_MODE=true node dist/agent.js "test idea"
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

## Chạy output trong WordPress

Có 3 cách thực tế để chạy thử output sau khi agent generate xong.

### Cách 1: Upload vào WordPress thật

Sau khi pipeline hoàn tất, trong thư mục output sẽ có file ZIP sạch để upload.

Ví dụ:

```bash
output/project-1779727925602/
```

Tìm file ZIP trong đó rồi upload tại WordPress Admin:

```text
Appearance -> Themes -> Add New Theme -> Upload Theme
```

Nếu là plugin thì upload tại:

```text
Plugins -> Add New Plugin -> Upload Plugin
```

Sau đó:

1. Activate theme/plugin
2. Vào frontend để kiểm tra UI
3. Nếu cần, quay lại agent và resume project để refine tiếp

### Cách 2: Chạy local bằng WordPress Playground CLI

Cách này phù hợp để test nhanh mà không cần cài full MySQL/Apache/Nginx.

```bash
# Từ thư mục theme đã generate
cd output/project-1779727925602

# Chạy local Playground và auto-mount theme/plugin hiện tại
npx @wp-playground/cli@latest server --auto-mount --port=9401
```

Sau khi boot xong, mở:

```text
http://127.0.0.1:9401
```

Nếu auto-mount không activate đúng theme, dùng blueprint hoặc mount explicit vào `wp-content/themes/<theme-slug>`.

Ví dụ cho theme:

```bash
npx @wp-playground/cli@latest server \
   --mount=/absolute/path/to/output/project-1779727925602:/wordpress/wp-content/themes/hoang-long-lithium \
   --blueprint=/absolute/path/to/output/project-1779727925602/playground-blueprint.json \
   --port=9401
```

Blueprint tối thiểu để activate theme:

```json
{
   "$schema": "https://playground.wordpress.net/blueprint-schema.json",
   "landingPage": "/",
   "preferredVersions": {
      "php": "8.3",
      "wp": "latest"
   },
   "steps": [
      {
         "step": "activateTheme",
         "themeFolderName": "hoang-long-lithium"
      },
      {
         "step": "login"
      }
   ]
}
```

Lưu ý:

- Playground CLI khuyến nghị Node.js `>= 20.18`
- Playground là môi trường ephemeral, phù hợp để smoke test nhanh
- Nếu thấy admin bar khi đang login, frontend có thể nhìn khác một chút so với trạng thái người dùng thường

### Cách 3: Local preview nhẹ do agent tự dùng

Trong quá trình pipeline, theme flow còn tự preview bằng PHP built-in server tại:

```text
http://localhost:3456
```

Đây không phải WordPress thật, mà là preview router để bắt lỗi PHP/runtime sớm. Dùng nó để debug nhanh, còn test gần production hơn thì dùng WordPress thật hoặc Playground.

## Test và kiểm tra

```bash
# Build agent
npm run build

# Chạy fixture hard checks
npm run test:hard-checks
```

Hard-check suite hiện verify các case:

- theme include bị thiếu file
- plugin include bị thiếu file
- plugin bootstrap thiếu header

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
- LLM prompt: Thiết kế WordPress theme structure với vanilla CSS + BEM
- **Review**: Xem SPEC.md trên console → approve / change / regenerate
- Ví dụ change: `"add a FAQ component"`, `"add testimonials data file"`, `"remove contact form"`

### Agent 3: Code Generator
- Input: Spec từ Agent 2
- Output: Toàn bộ source code ghi vào disk
- Batched: 4 files/LLM call (tránh token overflow)
- Smart ordering: style.css → functions.php → inc/ → header/footer → page templates → template-parts → assets
- Post-gen: **PHP lint** → **runtime check** (PHP built-in server, bắt Fatal/Parse error, auto-fix max 3x) → start dev server
- **Review**: Mở `http://localhost:3456` xem theme → approve / change / regenerate
- Ví dụ change: `"change hero background to dark blue"`, `"make header sticky with blur"`, `"change text to English"`

### Agent 4: Build & Auto-Fix
- Chạy `php -l` cho mỗi file PHP
- Nếu lỗi → parse error output → đọc broken files → gửi LLM fix → retry (max 5 lần)
- Smart detection: PHP syntax errors, missing includes, undefined functions
- Rate limit handling: auto retry 429 với exponential backoff
- Post-build: **Runtime check** — start PHP dev server, fetch pages, bắt Fatal/Parse errors (max 3 retries auto-fix)
- **Review**: Mở `http://localhost:3456` xem website → approve / change / regenerate
- Ví dụ change: `"fix product cards - images too small"`, `"add spacing between sections"`, `"change font size"`

### Agent 5: Test Runner
- Chạy `php -l` validation cho tất cả PHP files
- Output: lint results
- **Review**: Xem validation output → approve / change / regenerate
- Ví dụ change: `"fix PHP syntax errors"`, `"add missing function"`

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
- **Command allow-list**: Chỉ cho phép `php`, `wp`, `zip`, `git`, `node`, `tsc`
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
| PHP syntax error | Thiếu `;` hoặc sai cú pháp | Build-fix agent sẽ auto-detect và fix |
| `Cannot find module 'agent.js'` | Chưa compile TypeScript | Chạy `npm run build` trước |
| Undefined function | Thiếu `require_once` hoặc hàm chưa định nghĩa | Build-fix agent sẽ auto-detect file cần include |
| Runtime Fatal error | PHP template lỗi runtime | Runtime check sẽ auto-fix (thêm `isset()`, `??`) |
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
