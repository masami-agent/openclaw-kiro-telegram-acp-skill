# openclaw-kiro-telegram-acp

透過 Telegram `/kiro` 指令，將使用者的訊息經由 OpenClaw hook 轉發至 Kiro agent，並將回覆傳回 Telegram。

```text
Telegram → OpenClaw Hook → openclaw agent --message --json → Kiro Agent → Telegram
```

## 功能特色

- 🤖 **Telegram `/kiro` 指令** — 在 Telegram 中直接與 Kiro agent 對話
- 🔀 **雙重回覆抑制** — `message:received` 攔截指令，`message:sending` 以 `{ cancel: true }` 取消主 agent 回覆
- 🧠 **跨訊息記憶** — 同一 chat 的 `/kiro` 對話共享固定 session，Kiro 能記住先前的對話內容
- 🔒 **Chat ID 白名單** — 限制僅允許信任的 Telegram 使用者存取
- 🛡️ **錯誤訊息格式化** — JSON-RPC error、provider error、ACP 權限錯誤皆轉換為使用者友善的訊息
- ⚡ **非同步非阻塞** — 使用 `execFile` 避免凍結 gateway event loop
- 📦 **OpenClaw Skill 封裝** — 可透過 `skill-src/` 或 ClawHub 安裝
- 🔧 **環境變數設定** — agent 名稱、timeout、chat 白名單、回覆前綴皆可透過 `.env` 調整

## 快速開始

完整的安裝步驟請參閱 **[INSTALL.md](INSTALL.md)**。

若偏好自動化流程，可使用內建的互動式安裝腳本：

```bash
npm install
npm run build
npm run install-skill
```

安裝後執行驗證：

```bash
npm run validate
```

## 相容性說明

本專案針對 OpenClaw `2026.4.2` 開發，使用 `openclaw agent --message --json` 進行 one-shot agent 呼叫。

## 專案結構

```text
.
├── INSTALL.md                      # 統一安裝指南（唯一安裝參考來源）
├── .env.example                    # 環境變數範本
├── src/
│   ├── hook/handler.ts             # OpenClaw Hook handler
│   └── lib/                        # 核心模組（config、error-formatter 等）
├── scripts/                        # 自動化腳本（install、validate、build-skill）
├── templates/                      # Agent config 與 KB 範本
├── skill-src/                      # Skill 原始碼（打包用）
├── docs/                           # 架構、部署文件
└── examples/                       # 範例檔案
```

## 相關文件

| 文件 | 說明 |
|------|------|
| [INSTALL.md](INSTALL.md) | 統一安裝指南 — 前置需求、環境設定、hook 部署、ACP pairing、驗證測試 |
| [docs/architecture.md](docs/architecture.md) | 端對端訊息流程與系統架構 |
| [docs/deployment.md](docs/deployment.md) | 部署步驟與疑難排解 |
| [.env.example](.env.example) | 所有可設定的環境變數與說明 |
| [templates/kiro-agent.json](templates/kiro-agent.json) | Kiro agent JSON 設定範本 |

## License

MIT
