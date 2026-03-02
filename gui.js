/**
 * QQ经典农场 Web GUI 控制面板
 * 启动: node gui.js [--port 3000]
 */

const express = require('express');
const path = require('path');
const { CONFIG, updateConfig } = require('./src/config');
const { startBot, stopBot, getStatus, getAllConfig } = require('./src/botManager');
const { addLogSubscriber, removeLogSubscriber } = require('./src/logger');
const { requestLoginCode, queryScanStatus, getAuthCode } = require('./src/qqQrLogin');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API: Bot 状态 ---
app.get('/api/status', (req, res) => {
    res.json(getStatus());
});

// --- API: 配置读取 ---
app.get('/api/config', (req, res) => {
    res.json(getAllConfig());
});

// --- API: 配置更新 ---
app.post('/api/config', (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: '缺少 key' });
    const ok = updateConfig(key, value);
    if (!ok) return res.status(400).json({ error: `无效的配置项: ${key}` });
    res.json({ ok: true, key, value: CONFIG[key] });
});

// --- API: 启动 bot ---
app.post('/api/bot/start', async (req, res) => {
    const { code, platform } = req.body;
    if (!code) return res.status(400).json({ error: '缺少 code' });
    try {
        await startBot(code, platform);
        res.json({ ok: true, status: getStatus() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- API: 停止 bot ---
app.post('/api/bot/stop', (req, res) => {
    stopBot();
    res.json({ ok: true, status: getStatus() });
});

// --- API: SSE 实时日志 ---
app.get('/api/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const subscriber = (entry) => {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
    };

    addLogSubscriber(subscriber);

    req.on('close', () => {
        removeLogSubscriber(subscriber);
    });
});

// --- API: QR 登录 - 开始 ---
app.get('/api/qr/start', async (req, res) => {
    try {
        const { loginCode, url } = await requestLoginCode();
        // 生成二维码图片 URL (使用公共 API)
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`;
        res.json({ loginCode, url, qrImageUrl });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- API: QR 登录 - 轮询 ---
app.get('/api/qr/poll', async (req, res) => {
    const { loginCode } = req.query;
    if (!loginCode) return res.status(400).json({ error: '缺少 loginCode' });
    try {
        const result = await queryScanStatus(loginCode);
        if (result.status === 'OK' && result.ticket) {
            const code = await getAuthCode(result.ticket);
            res.json({ status: 'OK', code });
        } else {
            res.json({ status: result.status });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- 启动服务器 ---
const args = process.argv.slice(2);
let port = 3000;
const portIdx = args.indexOf('--port');
if (portIdx >= 0 && args[portIdx + 1]) port = parseInt(args[portIdx + 1]) || 3000;

app.listen(port, () => {
    console.log(`[GUI] Web 控制面板已启动: http://localhost:${port}`);
});
