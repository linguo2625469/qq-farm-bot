/**
 * QQ经典农场 挂机脚本 - 入口文件
 *
 * 模块结构:
 *   src/config.js   - 配置常量与枚举
 *   src/utils.js    - 通用工具函数
 *   src/proto.js    - Protobuf 加载与类型管理
 *   src/network.js  - WebSocket 连接/消息编解码/登录/心跳
 *   src/farm.js     - 自己农场操作与巡田循环
 *   src/friend.js   - 好友农场操作与巡查循环
 *   src/decode.js   - PB解码/验证工具模式
 */

const { CONFIG } = require('./src/config');
const { loadProto } = require('./src/proto');
const { connect, cleanup, getWs } = require('./src/network');
const { startFarmCheckLoop, stopFarmCheckLoop } = require('./src/farm');
const { startFriendCheckLoop, stopFriendCheckLoop } = require('./src/friend');
const { initTaskSystem, cleanupTaskSystem } = require('./src/task');
const { initStatusBar, cleanupStatusBar, setStatusPlatform } = require('./src/status');
const { startSellLoop, stopSellLoop, debugSellFruits } = require('./src/warehouse');
const { processInviteCodes } = require('./src/invite');
const { verifyMode, decodeMode } = require('./src/decode');
const { emitRuntimeHint, sleep } = require('./src/utils');
const { getQQFarmCodeByScan } = require('./src/qqQrLogin');
const { initFileLogger } = require('./src/logger');

initFileLogger();

// ============ 帮助信息 ============
function showHelp() {
    console.log(`
QQ经典农场 挂机脚本
====================

用法:
  node client.js --code <登录code> [--wx] [--interval <秒>] [--friend-interval <秒>]
  node client.js --qr [--interval <秒>] [--friend-interval <秒>]
  node client.js --verify
  node client.js --decode <数据> [--hex] [--gate] [--type <消息类型>]

参数:
  --code              小程序 login() 返回的临时凭证 (必需)
  --qr                启动后使用QQ扫码获取登录code（仅QQ平台）
  --wx                使用微信登录 (默认为QQ小程序)
  --interval          自己农场巡查完成后等待秒数, 默认10秒, 最低10秒
  --friend-interval   好友巡查完成后等待秒数, 默认1秒, 最低1秒
  --no-fertilize      不自动施肥 (默认自动施肥)
  --verify            验证proto定义
  --decode            解码PB数据 (运行 --decode 无参数查看详细帮助)

功能:
  - 自动收获成熟作物 → 购买种子 → 种植 → 施肥
  - 自动除草、除虫、浇水
  - 自动铲除枯死作物
  - 自动巡查好友农场: 帮忙浇水/除草/除虫 + 偷菜
  - 自动领取任务奖励 (支持分享翻倍)
  - 每分钟自动出售仓库果实
  - 启动时读取 share.txt 处理邀请码 (仅微信)
  - 心跳保活

邀请码文件 (share.txt):
  每行一个邀请链接，格式: ?uid=xxx&openid=xxx&share_source=xxx&doc_id=xxx
  启动时会尝试通过 SyncAll API 同步这些好友
`);
}

function getArgsMap(args) {
    const map = new Map();

    for (let i = 0; i < args.length; i++) {
        const key = args[i];
        if (!key.startsWith('--')) {
            map.set(key, true);
            continue;
        }

        // 检查是否有下一个参数，且下一个参数不是另一个配置项
        const nextValue = args[i + 1];
        if (nextValue !== undefined && !nextValue.startsWith('--')) {
            map.set(key, nextValue);
            i++; // 跳过下一个参数
        } else {
            // 这是一个布尔开关
            map.set(key, true);
        }
    }

    return map;
}

function parseArgs(argsMap) {
    const options = {
        code: process.env.CODE || '',
        qrLogin: false
    };

    let interval = parseInt(process.env.INTERVAL) || 0;
    let friend_interval = parseInt(process.env.FRIEND_INTERVAL) || 0;

    for (const [key, value] of argsMap) {
        switch (key) {
            case '--code':
                options.code = value;
                break;
            case '--qr':
                options.qrLogin = value;
                break;
            case '--wx':
                CONFIG.platform = 'wx';
                break;
            case '--interval':
                interval = parseInt(value);
                break;
            case '--friend-interval':
                friend_interval = parseInt(value);
                break;
            case '--no-fertilize':
                CONFIG.enableFertilize = false;
                break;
        }
    }

    if (interval) {
        CONFIG.farmCheckInterval = Math.max(interval, 1) * 1000;
    }

    if (friend_interval) {
        CONFIG.friendCheckInterval = Math.max(friend_interval, 1) * 1000;
    }

    return options;
}

// ============ 主函数 ============
async function main() {
    const args = process.argv.slice(2);
    let usedQrLogin = false;

    // 加载 proto 定义
    await loadProto();

    // 验证模式
    if (args.includes('--verify')) {
        await verifyMode();
        return;
    }

    // 解码模式
    if (args.includes('--decode')) {
        await decodeMode(args);
        return;
    }

    // 正常挂机模式
    const argsMap = getArgsMap(args);
    const options = parseArgs(argsMap);

    // QQ 平台支持扫码登录: 显式 --qr，或未传 --code 时自动触发
    if (!options.code && CONFIG.platform === 'qq' && (options.qrLogin || !args.includes('--code'))) {
        console.log('[扫码登录] 正在获取二维码...');
        options.code = await getQQFarmCodeByScan();
        usedQrLogin = true;
        console.log(`[扫码登录] 获取成功，code=${options.code.substring(0, 8)}...`);
    }

    if (!options.code) {
        if (CONFIG.platform === 'wx') {
            console.log('[参数] 微信模式仍需通过 --code 传入登录凭证');
        }
        showHelp();
        process.exit(1);
    }
    if (options.deleteAccountMode && (!options.name || !options.certId)) {
        console.log('[参数] 注销账号模式必须提供 --name 和 --cert-id');
        showHelp();
        process.exit(1);
    }

    // 扫码阶段结束后清屏，避免状态栏覆盖二维码区域导致界面混乱
    if (usedQrLogin && process.stdout.isTTY) {
        process.stdout.write('\x1b[2J\x1b[H');
    }

    // 初始化状态栏
    initStatusBar();
    setStatusPlatform(CONFIG.platform);
    emitRuntimeHint(true);

    const platformName = CONFIG.platform === 'wx' ? '微信' : 'QQ';
    console.log(`[启动] ${platformName} code=${options.code.substring(0, 8)}... 农场${CONFIG.farmCheckInterval / 1000}s 好友${CONFIG.friendCheckInterval / 1000}s`);

    // 连接并登录，登录成功后启动各功能模块
    connect(options.code, async () => {
        // 处理邀请码 (仅微信环境)
        await processInviteCodes();
        
        startFarmCheckLoop();
        startFriendCheckLoop();
        initTaskSystem();
        
        // 启动时立即检查一次背包
        setTimeout(() => debugSellFruits(), 5000);
        startSellLoop(60000);  // 每分钟自动出售仓库果实
    });

    // 退出处理
    process.on('SIGINT', () => {
        cleanupStatusBar();
        console.log('\n[退出] 正在断开...');
        stopFarmCheckLoop();
        stopFriendCheckLoop();
        cleanupTaskSystem();
        stopSellLoop();
        cleanup();
        const ws = getWs();
        if (ws) ws.close();
        process.exit(0);
    });
}

main().catch(err => {
    console.error('启动失败:', err);
    process.exit(1);
});
