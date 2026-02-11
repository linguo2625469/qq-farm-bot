/**
 * HTTP Restart 服务 - 提供 PM2 重启接口
 * 
 * 功能:
 * - 启动 HTTP 服务器 (端口 3002)
 * - 提供 POST /restart 接口
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

let server = null;
let pm2Connected = false;

function startHttpServer() {
    server = http.createServer(async (req, res) => {
        const startTime = Date.now();

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        if (req.method !== 'POST') {
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'Method not allowed', method: 'POST' }));
            return;
        }

        if (req.url !== '/restart') {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found', path: req.url }));
            return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { code } = data;

                if (!code || typeof code !== 'string') {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Invalid code parameter' }));
                    return;
                }

                console.log(`[Restart] 收到重启请求: code=${code.substring(0, 8)}...`);

                const result = await restartPM2Process(code);
                const elapsed = Date.now() - startTime;

                res.writeHead(200);
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
        });
    });

    server.listen(HTTP_PORT, () => {
        console.log(`[Restart] HTTP 服务器启动在端口 ${HTTP_PORT}`);
        console.log(`[Restart] 接口: POST http://localhost:${HTTP_PORT}/restart`);
        console.log(`[Restart] 参数: { "code": "xxx" }`);
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
