# 多 AI 代理協作工具整理

> 搜尋日期：2026-04-04
> 目標：找到可用於 Claude Code 的多代理協作 MCP / Skill，實現美編、工程師、使用者等多角色 AI 助理開會、開發、測試

---

## ⭐ 第一優先：官方內建功能

### 1. Claude Code Agent Teams（官方）
- **來源**: [官方文件](https://code.claude.com/docs/en/agent-teams)
- **說明**: Claude Code 內建的多代理團隊協作功能
- **運作方式**: 一個 session 作為 Team Lead，協調其他 Teammate session，各自有獨立 context window，可直接互相溝通
- **適合場景**: 研究與審查、新模組開發、除錯競爭假設、跨層協調
- **啟用方式**: 在 `settings.json` 加入 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`，需 Claude Code v2.1.32+
- **與 Subagent 差異**: Subagent 是快速回報的工人；Agent Teams 是能共享發現、互相挑戰、自主協調的隊友
- **推薦程度**: ⭐⭐⭐⭐⭐（官方原生，最穩定）

### 2. Claude Code Custom Subagents（官方）
- **來源**: [官方文件](https://code.claude.com/docs/en/sub-agents)
- **說明**: 可自訂專門角色的子代理（如 designer、tester）
- **推薦程度**: ⭐⭐⭐⭐⭐

---

## 🔥 第二優先：多代理協作 MCP Server

### 3. Agent-MCP（rinadelph）
- **GitHub**: [rinadelph/Agent-MCP](https://github.com/rinadelph/Agent-MCP)
- **說明**: 多代理系統框架，透過 MCP 實現協調的 AI 協作
- **特色**:
  - 多代理平行執行（前端/後端/UI 同時作業）
  - 共享記憶體系統（所有代理共用專案知識庫）
  - 智慧任務管理（自動處理依賴、防止衝突）
  - Main Context Document (MCD) 作為協作藍圖
- **適合你的需求**: ✅ 非常適合，支援角色分工平行開發
- **推薦程度**: ⭐⭐⭐⭐⭐

### 4. Agent Hub MCP（gilbarbara）
- **GitHub**: [gilbarbara/agent-hub-mcp](https://github.com/gilbarbara/agent-hub-mcp)
- **說明**: 通用協調層，讓任何 MCP 相容的 AI 代理互相溝通
- **特色**:
  - 跨平台協作（Claude Code + Cursor + Gemini 都能用）
  - 代理註冊身份、加入對話、交換訊息
  - 支援 ask、command、result 等訊息類型
  - 持久化協作歷史
- **適合你的需求**: ✅ 適合，特別是跨工具協作
- **推薦程度**: ⭐⭐⭐⭐

### 5. Agent Orchestration（madebyaris）
- **GitHub**: [madebyaris/agent-orchestration](https://github.com/madebyaris/agent-orchestration)
- **說明**: 多代理協作 MCP Server，含共享記憶、任務佇列、資源鎖
- **特色**:
  - 共享記憶體
  - 任務佇列管理
  - 資源鎖定（防止衝突編輯）
  - 支援 AGENTS.md 工作流
- **適合你的需求**: ✅ 適合，有完整的任務協調機制
- **推薦程度**: ⭐⭐⭐⭐

### 6. MCP Agent Mail（Dicklesworthstone）
- **GitHub**: [Dicklesworthstone/mcp_agent_mail](https://github.com/Dicklesworthstone/mcp_agent_mail)
- **說明**: AI 代理的非同步協調層：身份、收件匣、可搜尋對話串、檔案租約
- **特色**:
  - 代理身份系統
  - 收件匣/寄件匣
  - 對話串搜尋
  - 檔案租約（防止同時編輯衝突）
- **適合你的需求**: ✅ 適合作為代理間的通訊基礎設施
- **推薦程度**: ⭐⭐⭐⭐

---

## 🛠️ 第三優先：多代理編排框架

### 7. Claude MPM（bobmatnyc）
- **GitHub**: [bobmatnyc/claude-mpm](https://github.com/bobmatnyc/claude-mpm)
- **說明**: Claude Code 的多代理專案管理框架
- **特色**:
  - 多頻道編排
  - GitHub-first SDK 模式
  - 插件系統
  - Session 管理
  - 語意化程式碼搜尋
- **推薦程度**: ⭐⭐⭐⭐

### 8. Agents（wshobson）
- **GitHub**: [wshobson/agents](https://github.com/wshobson/agents)
- **說明**: 智慧自動化與多代理編排
- **特色**:
  - 72 個專注插件
  - 112 個專業代理（涵蓋架構、語言、基礎設施、品質、AI、文件等）
  - 146 個代理技能
- **推薦程度**: ⭐⭐⭐⭐

### 9. Multi-MCP（religa）
- **GitHub**: [religa/multi_mcp](https://github.com/religa/multi_mcp)
- **說明**: 多模型聊天、程式碼審查和分析 MCP Server
- **特色**:
  - 整合多個 AI 模型（GPT、Claude、Gemini）
  - 程式碼品質檢查
  - 安全分析（OWASP Top 10）
  - 多代理共識機制
- **推薦程度**: ⭐⭐⭐

### 10. Task Orchestrator（jpicklyk）
- **GitHub**: [jpicklyk/task-orchestrator](https://github.com/jpicklyk/task-orchestrator)
- **說明**: 輕量級 MCP 任務編排 Server
- **特色**:
  - 跨 session 持久化任務追蹤
  - 上下文儲存
  - 可組合的 notes 與門控轉換
  - 不規定代理如何工作，只協調執行
- **推薦程度**: ⭐⭐⭐

---

## 📚 技能 / 插件生態系

### 11. Claude Skills 集合（alirezarezvani）
- **GitHub**: [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills)
- **說明**: 220+ Claude Code skills & agent plugins
- **推薦程度**: ⭐⭐⭐

### 12. Awesome Agent Skills（VoltAgent）
- **GitHub**: [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)
- **說明**: 1000+ agent skills，來自官方與社群
- **推薦程度**: ⭐⭐⭐

### 13. Claude Code Agents（darcyegb）
- **GitHub**: [darcyegb/ClaudeCodeAgents](https://github.com/darcyegb/ClaudeCodeAgents)
- **說明**: 一組 QA 代理，專門用於 Claude Code
- **推薦程度**: ⭐⭐⭐

---

## 🎯 推薦組合方案

### 方案 A：官方原生（最簡單）
```
Claude Code Agent Teams + Custom Subagents
```
- 直接用官方功能，定義美編/工程師/測試者角色
- 零額外安裝，穩定度最高

### 方案 B：完整多代理系統（最強大）
```
Agent-MCP + Agent Hub MCP + Task Orchestrator
```
- Agent-MCP 做角色分工與共享記憶
- Agent Hub MCP 做代理間通訊
- Task Orchestrator 做任務追蹤

### 方案 C：輕量協作（折衷）
```
Agent Orchestration + MCP Agent Mail
```
- Agent Orchestration 做任務佇列與資源鎖
- MCP Agent Mail 做代理間訊息傳遞
