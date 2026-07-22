# ⚔️ 双人格斗对战

在线匹配 · 实时对战 · 纯 JavaScript

## 🎮 玩法

- 点击"开始匹配"，系统自动配对对手
- P1 用 **方向键移动 + F 攻击**
- P2 用 **WASD 移动 + G 攻击**
- 先打掉对手 100 血就赢一局
- 结束后可以再来一局

## 🚀 运行

```bash
# 1. 安装依赖
npm install

# 2. 启动服务器
npm start

# 3. 打开浏览器
# 开两个窗口/标签页，访问 http://localhost:3000
# 两个窗口各自点"开始匹配"即可对战
```

## 📁 项目结构

```
battle-game/
├── server.js          # WebSocket 服务器 + 匹配系统
├── public/
│   └── index.html     # 游戏前端（HTML + Canvas + JS）
├── package.json
└── README.md
```

## 🛠 技术栈

- 后端：Node.js + ws (WebSocket)
- 前端：原生 Canvas + WebSocket
- 匹配：服务器维护等待队列，人齐自动配对
- 同步：服务器权威校验，60fps 实时渲染

## 🔧 自定义

在 `server.js` 开头可以调整：
- `MOVE_SPEED` — 移动速度
- `ATTACK_DAMAGE` — 攻击伤害
- `MAX_HEALTH` — 最大血量
- `ATTACK_RANGE` — 攻击范围
