/**
 * WebSocket 广播服务 - 实时广播游戏数据
 * 
 * 功能:
 * - 启动 WebSocket 服务器 (端口 3001)
 * - 收集各模块的游戏状态
 * - 每秒向所有连接的客户端广播完整状态
 */

const WebSocket = require('ws');
const { getUserState, networkEvents, getWs, getConnectionState } = require('./src/network');
const { getFarmState } = require('./src/farm');
const { getFriendState } = require('./src/friend');
const { getTaskState } = require('./src/task');
const { getWarehouseState } = require('./src/warehouse');
const { statusData } = require('./src/status');

const WS_PORT = 3001;
const BROADCAST_INTERVAL = 1000;

let wss = null;
let broadcastTimer = null;
let connectedClients = new Set();

function startWebSocketServer() {
    wss = new WebSocket.Server({ port: WS_PORT });

    wss.on('connection', (ws, req) => {
        const clientIp = req.socket.remoteAddress;
        console.log(`[WS广播] 新客户端连接: ${clientIp}`);
        connectedClients.add(ws);

        ws.on('close', () => {
            console.log(`[WS广播] 客户端断开: ${clientIp}`);
            connectedClients.delete(ws);
        });

        ws.on('error', (err) => {
            console.error(`[WS广播] 客户端错误: ${err.message}`);
            connectedClients.delete(ws);
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                }
            } catch (e) {}
        });
    });

    console.log(`[WS广播] 服务器启动在端口 ${WS_PORT}`);

    startBroadcastLoop();
}

function stopWebSocketServer() {
    if (broadcastTimer) {
        clearInterval(broadcastTimer);
        broadcastTimer = null;
    }

    if (wss) {
        wss.close();
        wss = null;
    }

    connectedClients.clear();
    console.log('[WS广播] 服务器已停止');
}

function startBroadcastLoop() {
    broadcastTimer = setInterval(() => {
        const gameState = collectGameState();
        broadcast(gameState);
    }, BROADCAST_INTERVAL);
}

function collectGameState() {
    const userState = getUserState();
    const connectionState = getConnectionState();

    return {
        timestamp: Date.now(),
        user: {
            gid: userState.gid,
            name: userState.name,
            level: userState.level,
            gold: userState.gold,
            exp: userState.exp,
            platform: statusData.platform,
        },
        connection: connectionState,
        farm: getFarmState(),
        friend: getFriendState(),
        task: getTaskState(),
        warehouse: getWarehouseState(),
    };
}

function broadcast(data) {
    if (connectedClients.size === 0) return;

    const message = JSON.stringify(data);
    const deadClients = new Set();

    for (const ws of connectedClients) {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            } else {
                deadClients.add(ws);
            }
        } catch (err) {
            deadClients.add(ws);
        }
    }

    for (const ws of deadClients) {
        connectedClients.delete(ws);
    }
}

if (require.main === module) {
    process.on('SIGINT', () => {
        console.log('\n[WS广播] 正在停止...');
        stopWebSocketServer();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        stopWebSocketServer();
        process.exit(0);
    });

    startWebSocketServer();
}

module.exports = {
    startWebSocketServer,
    stopWebSocketServer,
    collectGameState,
    broadcast,
};
