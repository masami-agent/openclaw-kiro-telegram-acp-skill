# Masami Agent Steering — Git 與開發流程規範

## 身份

你是 Masami 的開發助手。你協助她維護 OpenClaw skill 相關的 repo。
你必須遵守以下所有規範，不可跳過。

## Git 流程

### 永遠不要直接 push 到 main

- 所有改動必須開 branch，透過 PR merge
- branch 命名格式：`feat/描述`、`fix/描述`、`docs/描述`
- PR 必須有標題和 body 說明改了什麼、為什麼改

```bash
# 正確流程
git checkout -b feat/add-error-handler
# ... 改動 ...
git push origin feat/add-error-handler
gh pr create --title "feat: add error handler" --body "..."
```

### Commit 規範

使用 Conventional Commits 格式：

```
feat: 新功能
fix: 修 bug
docs: 文件更新
refactor: 重構（不改行為）
test: 加測試
chore: 雜務（CI、build config）
```

- 一個 commit 做一件事
- commit message 要能讓人從 git log 看出改了什麼
- 禁止用模糊的 message 如「改善體驗」、「更新」、「修改」

### PR 大小控制

- 單一 PR 不超過 300 行改動（特殊情況除外）
- 如果改動超過 300 行，必須拆成多個 PR
- 拆分建議：
  - 基礎模組 / lib 先進
  - 依賴基礎模組的功能再進
  - 文件和設定最後進

## 檔案同步規則

### examples/ 與 skill-src/references/

這兩個資料夾的共用檔案必須保持一致：

- `hook-template.ts`
- `kiro-acp-ask.js`
- `kiro-agent-template.json`

改了其中一邊，必須同步另一邊。每次 commit 前執行：

```bash
diff examples/hook-template.ts skill-src/kiro-telegram-acp/references/hook-template.ts
diff examples/kiro-acp-ask.js skill-src/kiro-telegram-acp/references/kiro-acp-ask.js
diff examples/kiro-agent-template.json skill-src/kiro-telegram-acp/references/kiro-agent-template.json
```

如果有差異，必須先同步再 commit。

### .skill ZIP 打包

每次修改 `skill-src/` 底下的檔案後，必須重新打包：

```bash
cd skill-src/kiro-telegram-acp
zip -r ../../kiro-telegram-acp.skill SKILL.md references/
```

打包後驗證：

```bash
rm -rf /tmp/skill-verify && mkdir /tmp/skill-verify
unzip -o kiro-telegram-acp.skill -d /tmp/skill-verify
diff -r /tmp/skill-verify/ skill-src/kiro-telegram-acp/
```

## 程式碼規範

### TypeScript

- 使用 `node:` prefix import（如 `import { readFileSync } from "node:fs"`）
- 所有函數必須有型別標註
- 禁止使用 `any`，除非有明確理由並加註解說明
- 禁止使用 `execSync`，一律用 `execFile`（非同步）

### 可執行腳本

- CLI wrapper（如 `kiro-acp-ask.js`）必須有 executable 權限：`chmod +x`
- 必須有 shebang：`#!/usr/bin/env node`

### 安全

- 禁止在程式碼或 commit 中出現 bot token、API key、個人 chat ID
- 使用環境變數或 `.env`（已加入 `.gitignore`）
- 範例檔案中的敏感值必須用 placeholder 替代

## 測試

- 新增功能必須附帶對應的測試
- 測試放在同模組的 `__tests__/` 資料夾
- commit 前確認 `npm test` 全部通過
- 不可提交有 failing test 的程式碼

## PR 提交前 Checklist

每次開 PR 前，逐項確認：

- [ ] branch 從最新的 main 建立
- [ ] commit message 符合 Conventional Commits
- [ ] `npm run build` 無錯誤
- [ ] `npm test` 全部通過
- [ ] examples/ 與 references/ 同步
- [ ] .skill ZIP 已重新打包（如有改動 skill-src/）
- [ ] 可執行腳本有 +x 權限
- [ ] 無敏感資訊（token、key、個人 ID）
- [ ] PR 描述清楚說明改了什麼、為什麼改
