/**
 * HTTP Restart 服务 - 提供 PM2 重启接口
 * 
 * 功能:
 * - 启动 HTTP 服务器 (端口 3002)
 * - 提供 GET /restart 接口
 * - 接收 { code: string } 参数
 * - 使用 pm2 重启游戏脚本
 * 
 * 使用场景:
 * - Whistle 拦截游戏请求，提取 code
 * - 调用此服务重启游戏脚本
 */

const http = require('http');
const pm2 = require('pm2');

const HTTP_PORT = 3002;
const PM2_APP_NAME = 'farm-bot';
const DEBOUNCE_INTERVAL = 30000;

let server = null;
let pm2Connected = false;
let lastRequestTime = 0;
let lastRequestCode = '';
let pendingResponse = null;

function startHttpServer() {
    server = http.createServer(async (req, res) => {
        const startTime = Date.now();

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(500);
            res.end();
            return;
        }

        if (req.method !== 'GET') {
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Method not allowed', allowedMethods: ['GET'] }));
            return;
        }

        if (req.url !== '/restart') {
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Not found', path: req.url }));
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const params = Object.fromEntries(url.searchParams.entries());
        
        console.log(`[Restart] 收到请求，查询参数:`, params);

        const code = params.code || '';

        await handleRequest(code, res, startTime);
    });

    server.listen(HTTP_PORT, () => {
        console.log(`[Restart] HTTP 服务器启动在端口 ${HTTP_PORT}`);
        console.log(`[Restart] 接口: GET http://localhost:${HTTP_PORT}/restart?code=xxx`);
    });
}

function stopHttpServer() {
    if (server) {
        server.close();
        server = null;
        console.log('[Restart] HTTP 服务器已停止');
    }
    if (pm2Connected) {
        pm2.disconnect();
        pm2Connected = false;
    }
}

function connectPM2() {
    return new Promise((resolve, reject) => {
        if (pm2Connected) {
            resolve();
            return;
        }
        pm2.connect((err) => {
            if (err) {
                reject(err);
            } else {
                pm2Connected = true;
                resolve();
            }
        });
    });
}

async function restartPM2Process(code) {
    try {
        await connectPM2();

        return new Promise((resolve, reject) => {
            pm2.list((err, list) => {
                if (err) {
                    reject(err);
                    return;
                }

                const existingProcess = list.find(p => p.name === PM2_APP_NAME);

                if (existingProcess) {
                    console.log(`[Restart] 发现现有进程 ${PM2_APP_NAME}，正在重启...`);
                    
                    pm2.restart(PM2_APP_NAME, (restartErr) => {
                        if (restartErr) {
                            reject(restartErr);
                        } else {
                            resolve({
                                action: 'restart',
                                appName: PM2_APP_NAME,
                                pid: existingProcess.pid,
                            });
                        }
                    });
                } else {
                    console.log(`[Restart] 未发现进程 ${PM2_APP_NAME}，正在启动...`);
                    
                    pm2.start({
                        name: PM2_APP_NAME,
                        script: 'client.js',
                        args: `--code ${code}`,
                        cwd: process.cwd(),
                    }, (startErr) => {
                        if (startErr) {
                            reject(startErr);
                        } else {
                            resolve({
                                action: 'start',
                                appName: PM2_APP_NAME,
                                command: `client.js --code ${code.substring(0, 8)}...`,
                            });
                        }
                    });
                }
            });
        });
    } catch (err) {
        console.error(`[Restart] PM2 操作失败: ${err.message}`);
        throw err;
    }
}

async function handleRequest(code, res, startTime) {
    try {
        if (!code || typeof code !== 'string') {
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Invalid code parameter' }));
            return;
        }

        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        const isDuplicate = timeSinceLastRequest < DEBOUNCE_INTERVAL && code === lastRequestCode;

        if (isDuplicate) {
            console.log(`[Restart] 防抖: 忽略重复请求 (${Math.round(timeSinceLastRequest / 1000)}s 内) code=${code.substring(0, 8)}...`);
            res.writeHead(500);
            res.end(JSON.stringify({
                success: true,
                message: 'Request debounced (duplicate)',
                code: code.substring(0, 8) + '...',
                debounced: true,
            }));
            return;
        }

        console.log(`[Restart] 收到重启请求: code=${code.substring(0, 8)}...`);

        lastRequestTime = now;
        lastRequestCode = code;

        const result = await restartPM2Process(code);
        const elapsed = Date.now() - startTime;

        res.writeHead(500);
        res.end(JSON.stringify({
            success: true,
            message: 'Restart initiated',
            code: code.substring(0, 8) + '...',
            elapsed,
            ...result,
        }));

        console.log(`[Restart] 重启请求完成 (${elapsed}ms)`);
    } catch (err) {
        console.error(`[Restart] 错误: ${err.message}`);
        res.writeHead(500);
        res.end(JSON.stringify({
            success: false,
            error: err.message,
        }));
    }
}

if (require.main === module) {
    process.on('SIGINT', () => {
        console.log('\n[Restart] 正在停止...');
        stopHttpServer();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        stopHttpServer();
        process.exit(0);
    });

    startHttpServer();
}

module.exports = {
    startHttpServer,
    stopHttpServer,
    restartPM2Process,
};
