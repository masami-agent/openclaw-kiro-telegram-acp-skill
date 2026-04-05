# Kiro Agent Knowledge Base

> 這是一個範例 KB（Knowledge Base）檔案。Kiro agent 會在回答問題時參考此檔案的內容。
> 請根據你的需求自訂以下內容，或新增更多 KB 檔案並在 `kiro-agent.json` 的 `resources` 陣列中加入路徑。

## 關於此 Agent

- 名稱：Kiro
- 用途：透過 Telegram `/kiro` 指令回答使用者問題
- 語言偏好：繁體中文（可依需求調整）

## 常見問答

### Q: 這個 bot 能做什麼？

Kiro 是一個透過 OpenClaw 平台運作的 AI 助手。你可以在 Telegram 中使用 `/kiro` 指令向它提問，例如：

- `/kiro 今天天氣如何？`
- `/kiro 幫我解釋什麼是 ACP`
- `/kiro 用 Python 寫一個 hello world`

### Q: 如何新增自訂知識？

1. 建立一個新的 markdown 檔案（例如 `templates/my-knowledge.md`）
2. 在 `kiro-agent.json` 的 `resources` 陣列中加入該檔案的相對路徑
3. 重新載入 agent 設定

## 自訂規則

<!-- 在此新增你希望 agent 遵守的規則，例如： -->

- 回答時保持簡潔，避免過長的回覆
- 遇到不確定的問題時，誠實告知使用者
- 不回答涉及個人隱私或敏感資訊的問題

## 領域知識

<!-- 在此新增你的專業領域知識，例如： -->

### 專案資訊

- 專案名稱：（填入你的專案名稱）
- 技術棧：（填入你使用的技術）
- 文件位置：（填入相關文件的路徑或連結）

### 團隊慣例

- 程式碼風格：（填入你的團隊慣例）
- 部署流程：（填入部署相關資訊）
