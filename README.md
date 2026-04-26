# Hi Web Talk

一个基于 `React + Vite` 的 AI 聊天网页，当前已经拆成可扩展的组件结构，并接好了本地服务端转发 OpenAI / DeepSeek 的基础能力。

## 开始使用


```bash
npm install
copy .env.example .env
```

把 `.env` 里你要用的 Key 填上：

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`

然后运行：

```bash
npm run dev:full
```

## 当前结构

```text
src/
  components/
    ChatComposer.jsx
    ChatHero.jsx
    MessageList.jsx
    Sidebar.jsx
  lib/
    chatApi.js
  styles/
    app.css
    index.css
  App.jsx
  main.jsx
server/
  index.js
```

## 当前支持的模型选项

- OpenAI · `gpt-5-mini-2025-08-07`
- DeepSeek · `deepseek-chat`

## 下一步建议

- 增加多会话存储
- 增加用户配置项和更多模型切换

# 提升用户为Admin

```bash
node -e "const D=require('better-sqlite3'); const db=new D('data/hi-web-talk.sqlite'); db.prepare('UPDATE users SET role=? WHERE username=?').run('admin','目标用户名'); console.log('Done'); db.close();"
```