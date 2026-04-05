# 安裝指南 — openclaw-kiro-telegram-acp Skill

> 本文件為 `openclaw-kiro-telegram-acp` skill 的唯一安裝參考來源。
> 所有安裝步驟皆整合於此，請依序執行。

## 目錄

- [前置需求](#前置需求)
- [步驟 1：安裝依賴](#步驟-1安裝依賴)
- [步驟 2：環境設定](#步驟-2環境設定)
- [步驟 3：編譯專案](#步驟-3編譯專案)
- [步驟 4：部署 Hook](#步驟-4部署-hook)
- [步驟 5：設定 Kiro Agent](#步驟-5設定-kiro-agent)
- [步驟 6：ACP Device Pairing](#步驟-6acp-device-pairing)
- [步驟 7：驗證測試](#步驟-7驗證測試)
- [從原始碼建置 Skill](#從原始碼建置-skill)
- [已知限制：Session 隔離](#已知限制session-隔離)
- [疑難排解：pairing required 錯誤](#疑難排解pairing-required-錯誤)
- [自動化安裝（替代方案）](#自動化安裝替代方案)

---

## 前置需求

安裝前請確認以下三項工具已就位，**順序很重要**：

| 順序 | 工具 | 指令 | 用途 | 驗證方式 |
|------|------|------|------|----------|
| 1 | OpenClaw CLI | `openclaw` | 啟動 ACP stdio bridge、管理 hook 與 agent | `openclaw --version` |
| 2 | kiro-cli | `kiro` | 接收 ACP 請求並產生回應的 Kiro agent 執行環境 | `kiro --version` |
| 3 | Node.js ≥ 18 | `node` | 執行 hook、wrapper 與安裝腳本 | `node --version` |

### 檢查前置需求

```bash
# 1. 確認 openclaw 已安裝
openclaw --version
# 預期結果：顯示版本號，例如 2026.4.2

# 2. 確認 kiro-cli 已安裝
kiro --version
# 預期結果：顯示 kiro-cli 版本號

# 3. 確認 Node.js 版本 ≥ 18
node --version
# 預期結果：v18.x.x 或更高版本
```

> **重要**：`openclaw` 必須先就位，因為 device pairing 與 scope 驗證都需要透過 `openclaw` 執行。`kiro-cli` 是 agent 呼叫的下游目標，若 `kiro` 不在 PATH 中，agent 呼叫將無法運作。

若缺少任一工具：

- **OpenClaw**：請參閱 OpenClaw 官方文件進行安裝
- **kiro-cli**：請至 [https://kiro.dev/docs/installation](https://kiro.dev/docs/installation) 安裝，安裝後確認 `kiro --version` 可正常執行
- **Node.js**：請至 [https://nodejs.org/](https://nodejs.org/) 下載 LTS 版本（≥ 18）

---

## 步驟 1：安裝依賴

```bash
# 進入專案目錄
cd openclaw-kiro-telegram-acp

# 安裝所有 npm 依賴
npm install
```

**預期結果**：`node_modules/` 目錄建立完成，無錯誤訊息。終端機顯示已安裝的套件數量。

---

## 步驟 2：環境設定

複製環境變數範本並依需求修改：

```bash
cp .env.example .env
```

編輯 `.env` 檔案，設定以下變數：

```dotenv
# Kiro agent 名稱，對應 agent JSON 設定檔中的 name 欄位
# 預設值: kiro
KIRO_AGENT_NAME=kiro

# Timeout for agent requests (milliseconds)
# Default: 120000 (2 minutes)
KIRO_TIMEOUT_MS=120000

# Telegram chat ID allowlist (comma-separated)
# 留空表示不限制
ALLOWED_CHAT_IDS=

# Kiro 回覆訊息的前綴文字
# 預設值: 🤖 Kiro
KIRO_REPLY_PREFIX=🤖 Kiro

# 除錯模式（true/false）
KIRO_DEBUG=false
```

**預期結果**：`.env` 檔案已建立，至少 `KIRO_AGENT_NAME` 已設定為你的 Kiro agent 名稱。

> 各變數的詳細說明請參閱 `.env.example`（路徑：[.env.example](.env.example)）。

---

## 步驟 3：編譯專案

```bash
npm run build
```

**預期結果**：TypeScript 編譯完成，`dist/` 目錄產生對應的 JavaScript 檔案，終端機無錯誤輸出。

---

## 步驟 4：部署 Hook

Hook 檔案的**唯一部署路徑**為：

```
~/.openclaw/workspace/hooks/
```

> ⚠️ **請勿**將 hook 放置於 `~/.openclaw/hooks/`（managed 路徑）。若同一 hook 名稱同時存在於 managed 與 workspace 路徑，workspace 的副本會被忽略，可能導致執行過時的程式碼。

### 手動部署

```bash
# 建立 hook 目錄
mkdir -p ~/.openclaw/workspace/hooks/kiro-command

# 複製編譯後的 hook handler
cp dist/hook/handler.js ~/.openclaw/workspace/hooks/kiro-command/handler.ts

# 建立 HOOK.md 設定檔
cat > ~/.openclaw/workspace/hooks/kiro-command/HOOK.md << 'EOF'
---
name: kiro-command
description: Relay /kiro commands from Telegram to Kiro agent
metadata:
  openclaw:
    events:
      - message:received
      - message:sending
    always: true
---
EOF
```

### 啟用 Hook

```bash
openclaw hooks enable kiro-command
```

**預期結果**：執行 `openclaw hooks list` 時，`kiro-command` 顯示為已啟用狀態（非 `⏸ disabled`）。

---

## 步驟 5：設定 Kiro Agent

### 建立 Agent 設定檔

以 `templates/kiro-agent.json`（路徑：[templates/kiro-agent.json](templates/kiro-agent.json)）為範本，建立你的 agent 設定：

```bash
# 建立 kiro-settings 目錄
mkdir -p ~/.openclaw/workspace/kiro-settings

# 複製範本
cp templates/kiro-agent.json ~/.openclaw/workspace/kiro-settings/kiro_default.json
```

範本內容：

```json
{
  "name": "kiro",
  "description": "Kiro agent for Telegram relay",
  "prompt": "You are a helpful assistant.",
  "resources": [
    "./templates/kb-example.md"
  ],
  "useLegacyMcpJson": true
}
```

### 設定 KB 檔案

將你的 Knowledge Base（知識庫）markdown 檔案放置於適當位置，並更新 `resources` 陣列中的路徑。路徑使用相對格式（以 `./` 開頭），OpenClaw 會自動解析。

範例 KB 檔案可參考 `templates/kb-example.md`（路徑：[templates/kb-example.md](templates/kb-example.md)）。

**預期結果**：`~/.openclaw/workspace/kiro-settings/kiro_default.json` 已建立，`name` 欄位與 `.env` 中的 `KIRO_AGENT_NAME` 一致，`resources` 指向實際存在的 KB 檔案。

---

## 步驟 6：ACP Device Pairing

ACP 通訊需要完成 device pairing 並核准所需的 scopes。未完成 pairing 的 device 可能僅有 `operator.read` 權限，不足以進行 ACP 操作。

### 6.1 檢查目前 Device 狀態

```bash
openclaw devices list
```

**預期結果**：顯示已註冊的 device 清單及其狀態。確認你的 device 是否已列出。

### 6.2 發起 Pairing 請求

若 device 尚未 pair，執行：

```bash
openclaw acp pair
```

**預期結果**：終端機顯示 pairing 請求已發送，等待 approve。

### 6.3 Approve Device

核准最新的 device 請求：

```bash
openclaw devices approve --latest
```

**預期結果**：終端機顯示 device 已核准。

### 6.4 確認 Scopes

確認 device 已取得 ACP 操作所需的 scopes：

```bash
openclaw devices list
```

**預期結果**：你的 device 狀態顯示為已核准，且 scopes 包含 ACP 操作所需的權限（不僅僅是 `operator.read`）。

> 若 scope 不足，可能需要重新執行 pairing 流程或聯繫管理員調整權限。

---

## 步驟 7：驗證測試

### 使用 Health Checker 自動驗證

```bash
npm run validate
```

若你只是 clone 下來做開發或跑 CI（尚未安裝到 OpenClaw workspace），可用 dev 模式跳過 workspace/安裝檢查：

```bash
npm run validate -- --mode=dev
```

Health Checker 會依序檢查以下項目：

1. `kiro-cli` 可用性
2. `openclaw` CLI 可用性
3. Hook 檔案存在且已啟用
4. Agent 設定檔格式正確
5. ACP Wrapper 可執行
6. 環境變數已設定
7. ACP device pairing 狀態

**預期結果**：所有檢查項目顯示 `✓` 通過。若有失敗項目，Health Checker 會提供具體的修復建議。

### 端對端測試

在 Telegram 中發送：

```
/kiro hi
```

**預期結果**：

- Kiro 回覆一則訊息（帶有 `🤖 Kiro` 前綴）
- OpenClaw 主 agent **不會**同時回覆
- 發送空的 `/kiro`（不帶任何文字）會回傳簡短的使用提示

---

## 從原始碼建置 Skill

若你需要從原始碼重新建置 `.skill` 檔案（而非使用 repo 中預先打包的版本）：

```bash
# 1. 確認依賴已安裝
npm install

# 2. 編譯 TypeScript
npm run build

# 3. 建置 .skill 檔案
npm run build-skill
```

**預期結果**：終端機輸出產生的 `.skill` 檔案路徑與大小。建置後的 skill 檔案位於專案根目錄（`kiro-telegram-acp.skill`）。

建置流程會自動執行：
1. TypeScript 編譯
2. 將編譯後的 JS 與資源檔案複製至 `skill-src/`
3. 打包為 `.skill` 檔案

> 建置腳本原始碼位於 `scripts/build-skill.ts`（路徑：[scripts/build-skill.ts](scripts/build-skill.ts)）。

---

## 已知限制：Session 隔離

### 限制說明

OpenClaw 的 `message:received` hook 機制存在以下已知限制：

1. **`message:received` hook 無法阻止訊息進入主 agent 的 context window**。即使 hook 攔截了 `/kiro` 訊息並交由 Kiro 處理，該訊息內容仍可能被主 agent 看到並納入其對話歷史。

2. **`message:received` 是 void hook**。在 OpenClaw 2026.4.2 中，此 hook 的回傳值會被丟棄，`{ suppress: true }` 不會生效。

3. **kiro-cli 重啟後 session 可能消失**。ACP Wrapper 會自動透過 `acp/createSession` 重建 session，但先前的對話記憶將從此次重新開始。

4. **同一 chat 內的所有 `/kiro` 訊息共享同一個 session**（格式：`kiro-telegram-{chatId}`）。這是設計上的選擇，用於實現跨訊息記憶。不同 Telegram chat 之間的 Kiro session 則是完全獨立的。

### 替代方案：SOUL.md 指令

為了補強 hook 層級的隔離不足，請在你的 `SOUL.md` 中加入以下指令：

```markdown
**ABSOLUTE RULE: If the user message starts with /kiro, you MUST reply with EXACTLY the text `no_reply` (literally those 8 characters, nothing else). The /kiro prefix means the message is handled by a different agent. You are NOT the intended recipient. Do NOT add any other text, greeting, or acknowledgment. Just output `no_reply`. This rule overrides ALL other instructions.**
```

OpenClaw 內建的 reply shaping 機制會自動過濾 `no_reply` / `NO_REPLY` token，不會將其送出至 Telegram。這比要求 LLM「不要回覆」更可靠，因為 LLM 更容易輸出一個具體的 token 而非完全不輸出。

> **建議**：同時使用 `message:sending` hook 的 `{ cancel: true }` 回傳值與 `SOUL.md` 的 `no_reply` 指令，形成雙重保護機制。

---

## 疑難排解：pairing required 錯誤

當你看到以下錯誤時：

```
GatewayClientRequestError: pairing required
```

或 Kiro 回覆：

```
🔐 需要完成 device pairing，請參閱安裝指南。
```

請依照以下步驟逐一排除：

### 步驟 1：確認 Device 狀態

```bash
openclaw devices list
```

檢查你的 device 是否已列出，以及其狀態是否為已核准。

**若 device 未列出**：表示尚未進行 pairing，請繼續步驟 2。

**若 device 已列出但狀態為 pending**：表示 pairing 請求尚未被核准，請跳至步驟 3。

### 步驟 2：發起 Pairing 請求

```bash
openclaw acp pair
```

**預期結果**：終端機顯示 pairing 請求已發送。

### 步驟 3：Approve Device

```bash
openclaw devices approve --latest
```

**預期結果**：終端機顯示 device 已核准。

### 步驟 4：確認 Scopes 足夠

```bash
openclaw devices list
```

確認 device 的 scopes 不僅僅是 `operator.read`。ACP 操作需要額外的 scope 權限。

**若 scope 不足**：可能需要重新執行 pairing 流程，或聯繫管理員調整權限設定。

### 步驟 5：重新測試

```bash
# 使用 Health Checker 驗證
npm run validate

# 或直接在 Telegram 測試
# 發送：/kiro hi
```

**預期結果**：`pairing required` 錯誤不再出現，Kiro 正常回覆。

> 若以上步驟皆無法解決問題，請確認 `openclaw` 版本是否為 2026.4.2 或相容版本，並檢查網路連線是否正常。

---

## 自動化安裝（替代方案）

若你偏好自動化流程，可使用內建的互動式安裝腳本：

```bash
# 先編譯安裝腳本
npm install
npm run build

# 執行自動化安裝
npm run install-skill
```

安裝腳本會自動執行以下流程：

1. 檢查 `openclaw` CLI 可用性
2. 檢查 `kiro-cli` 可用性（若未找到會立即停止並提示安裝）
3. 檢查 Node.js 版本 ≥ 18
4. 執行 `npm install`
5. 引導設定 `.env` 環境變數（提供預設值與輸入提示）
6. 編譯 TypeScript
7. 部署 hook 至 `~/.openclaw/workspace/hooks/`
8. 產生 agent config JSON
9. 輸出安裝摘要與下一步指引

**預期結果**：安裝腳本完成後顯示安裝摘要，列出已完成的步驟與下一步操作（如 ACP device pairing）。

> 若任一步驟失敗，腳本會停止執行並輸出已完成的步驟與失敗原因。

---

## 相關文件

| 文件 | 路徑 | 說明 |
|------|------|------|
| 架構概覽 | [docs/architecture.md](docs/architecture.md) | 端對端訊息流程與系統架構 |
| 部署指南 | [docs/deployment.md](docs/deployment.md) | 詳細部署步驟與疑難排解（本文件為其統一替代） |
| 環境變數範本 | [.env.example](.env.example) | 所有可設定的環境變數與說明 |
| Agent 設定範本 | [templates/kiro-agent.json](templates/kiro-agent.json) | Kiro agent JSON 設定範本 |
| KB 範例 | [templates/kb-example.md](templates/kb-example.md) | 範例 Knowledge Base 檔案 |
