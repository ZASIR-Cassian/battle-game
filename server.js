/**
 * 双人格斗对战 - 服务器
 * 
 * 功能:
 * 1. 托管静态文件 (游戏网页)
 * 2. WebSocket 匹配系统 (排队 → 配对 → 开战)
 * 3. 房间管理 (每对玩家一个房间，消息隔离)
 * 4. 服务器权威校验 (防作弊)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 3000;

// ============ HTTP 服务器（托管游戏页面） ============
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ============ WebSocket 匹配系统 ============
const wss = new WebSocketServer({ server });

// 等待队列
const waitingQueue = [];

// 活跃房间: roomId → { player1: ws, player2: ws, state: {...} }
const rooms = new Map();
let roomIdCounter = 1;

// ws → 玩家信息映射
const players = new Map();

wss.on('connection', (ws) => {
  console.log('🔗 新玩家连接');

  // 初始化玩家状态
  const playerId = 'P' + Date.now() + Math.floor(Math.random() * 1000);
  players.set(ws, {
    id: playerId,
    ws: ws,
    inQueue: false,
    roomId: null,
    playerNum: null, // 1 or 2
  });

  // 发送连接确认
  send(ws, { type: 'connected', playerId });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join_queue':
        handleJoinQueue(ws);
        break;
      case 'leave_queue':
        handleLeaveQueue(ws);
        break;
      case 'game_input':
        handleGameInput(ws, msg);
        break;
      case 'rematch':
        handleRematch(ws);
        break;
    }
  });

  ws.on('close', () => {
    console.log('🔌 玩家断开:', playerId);
    handleLeaveQueue(ws);
    handleDisconnect(ws);
    players.delete(ws);
  });
});

// ============ 匹配逻辑 ============

function handleJoinQueue(ws) {
  const player = players.get(ws);
  if (!player || player.inQueue || player.roomId) return;

  // 清理可能已经在队列中的旧记录
  const idx = waitingQueue.indexOf(ws);
  if (idx !== -1) waitingQueue.splice(idx, 1);

  waitingQueue.push(ws);
  player.inQueue = true;

  console.log(`🟢 ${player.id} 加入匹配队列 (当前等待: ${waitingQueue.length})`);
  send(ws, { type: 'queue_status', status: 'searching', waiting: waitingQueue.length });

  // 尝试配对
  tryMatch();
}

function handleLeaveQueue(ws) {
  const player = players.get(ws);
  if (!player) return;

  const idx = waitingQueue.indexOf(ws);
  if (idx !== -1) {
    waitingQueue.splice(idx, 1);
    player.inQueue = false;
    send(ws, { type: 'queue_status', status: 'cancelled' });
  }
}

function tryMatch() {
  while (waitingQueue.length >= 2) {
    const player1ws = waitingQueue.shift();
    const player2ws = waitingQueue.shift();

    const p1 = players.get(player1ws);
    const p2 = players.get(player2ws);

    if (!p1 || !p2) continue;

    p1.inQueue = false;
    p2.inQueue = false;

    const roomId = 'room_' + roomIdCounter++;
    p1.roomId = roomId;
    p2.roomId = roomId;
    p1.playerNum = 1;
    p2.playerNum = 2;

    // 创建房间
    const room = {
      id: roomId,
      player1: player1ws,
      player2: player2ws,
      state: createGameState(),
    };
    rooms.set(roomId, room);

    console.log(`🎮 匹配成功! ${p1.id} vs ${p2.id} → ${roomId}`);

    // 通知双方
    send(player1ws, {
      type: 'match_found',
      roomId,
      playerNum: 1,
      opponentId: p2.id,
      gameState: room.state,
    });

    send(player2ws, {
      type: 'match_found',
      roomId,
      playerNum: 2,
      opponentId: p1.id,
      gameState: flipState(room.state),
    });
  }
}

// ============ 游戏逻辑 ============

const GAME_WIDTH = 800;
const GAME_HEIGHT = 400;
const GROUND_Y = 350;
const PLAYER_W = 30;
const PLAYER_H = 50;
const MOVE_SPEED = 5;
const JUMP_FORCE = -12;
const GRAVITY = 0.7;
const ATTACK_RANGE = 60;
const ATTACK_DAMAGE = 10;
const ATTACK_COOLDOWN = 400; // ms
const MAX_HEALTH = 100;

function createGameState() {
  return {
    players: {
      p1: { x: 150, y: GROUND_Y - PLAYER_H, vx: 0, vy: 0, health: MAX_HEALTH, attacking: false, facingRight: true },
      p2: { x: GAME_WIDTH - 150 - PLAYER_W, y: GROUND_Y - PLAYER_H, vx: 0, vy: 0, health: MAX_HEALTH, attacking: false, facingRight: false },
    },
    round: 1,
    scores: { p1: 0, p2: 0 },
    gameOver: false,
    winner: null,
  };
}

function flipState(state) {
  return JSON.parse(JSON.stringify(state));
}

function handleGameInput(ws, msg) {
  const player = players.get(ws);
  if (!player || !player.roomId) return;

  const room = rooms.get(player.roomId);
  if (!room) return;

  const now = Date.now();
  const stateP = player.playerNum === 1 ? room.state.players.p1 : room.state.players.p2;
  const opponentP = player.playerNum === 1 ? room.state.players.p2 : room.state.players.p1;

  if (!stateP || !opponentP || room.state.gameOver) return;

  const { keys, action } = msg;

  // --- 移动 ---
  if (keys) {
    stateP.vx = 0;
    if (keys.left)  { stateP.vx = -MOVE_SPEED; stateP.facingRight = false; }
    if (keys.right) { stateP.vx = MOVE_SPEED; stateP.facingRight = true; }

    if (keys.jump && stateP.y >= GROUND_Y - PLAYER_H) {
      stateP.vy = JUMP_FORCE;
    }
  }

  // --- 攻击 ---
  if (action === 'attack' && !stateP.attacking) {
    const lastAttack = stateP._lastAttack || 0;
    if (now - lastAttack < ATTACK_COOLDOWN) return;
    stateP._lastAttack = now;
    stateP.attacking = true;

    // 检测是否命中对手
    const myCenter = stateP.x + PLAYER_W / 2;
    const oppCenter = opponentP.x + PLAYER_W / 2;
    const distance = Math.abs(myCenter - oppCenter);
    const correctDirection = stateP.facingRight
      ? (stateP.x < opponentP.x)
      : (stateP.x > opponentP.x);

    if (distance < ATTACK_RANGE && correctDirection) {
      opponentP.health = Math.max(0, opponentP.health - ATTACK_DAMAGE);
      
      // 胜负判定
      if (opponentP.health <= 0) {
        room.state.scores['p' + player.playerNum]++;
        room.state.gameOver = true;
        room.state.winner = player.playerNum;
      }
    }

    // 攻击动画持续150ms后自动取消
    setTimeout(() => {
      if (stateP) stateP.attacking = false;
    }, 150);
  }

  // --- 物理更新 ---
  stateP.x += stateP.vx;
  stateP.vy += GRAVITY;
  stateP.y += stateP.vy;

  // 边界
  stateP.x = Math.max(0, Math.min(GAME_WIDTH - PLAYER_W, stateP.x));
  if (stateP.y >= GROUND_Y - PLAYER_H) {
    stateP.y = GROUND_Y - PLAYER_H;
    stateP.vy = 0;
  }

  // --- 推给对手 ---
  const opponentWs = player.playerNum === 1 ? room.player2 : room.player1;
  send(opponentWs, {
    type: 'game_update',
    gameState: room.state,
  });

  // --- 推回给自己 ---
  send(ws, {
    type: 'game_update',
    gameState: room.state,
  });

  // --- 游戏结束通知 ---
  if (room.state.gameOver) {
    send(ws, {
      type: 'game_over',
      winner: room.state.winner === player.playerNum ? '你' : '对手',
      scores: room.state.scores,
    });
    send(opponentWs, {
      type: 'game_over',
      winner: room.state.winner !== player.playerNum ? '你' : '对手',
      scores: room.state.scores,
    });
  }
}

// ============ 重新匹配 ============

function handleRematch(ws) {
  const player = players.get(ws);
  if (!player) return;

  const roomId = player.roomId;
  if (roomId) {
    const room = rooms.get(roomId);
    if (room) {
      // 通知对手
      const opponentWs = player.playerNum === 1 ? room.player2 : room.player1;
      send(opponentWs, { type: 'opponent_left' });
      rooms.delete(roomId);
    }
    player.roomId = null;
    player.playerNum = null;
  }

  // 重新加入队列
  handleJoinQueue(ws);
}

// ============ 断线处理 ============

function handleDisconnect(ws) {
  const player = players.get(ws);
  if (!player) return;

  // 从等待队列移除
  const idx = waitingQueue.indexOf(ws);
  if (idx !== -1) waitingQueue.splice(idx, 1);

  // 从房间移除
  if (player.roomId) {
    const room = rooms.get(player.roomId);
    if (room) {
      const opponentWs = player.playerNum === 1 ? room.player2 : room.player1;
      send(opponentWs, { type: 'opponent_disconnected' });
      rooms.delete(player.roomId);
    }
  }
}

// ============ 工具函数 ============

function send(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

// ============ 启动 ============

server.listen(PORT, () => {
  console.log('⚔️  双人格斗对战服务器已启动!');
  console.log(`   打开浏览器访问: http://localhost:${PORT}`);
  console.log(`   开两个窗口即可测试匹配对战`);
  console.log(`   按 Ctrl+C 停止服务器`);
});
