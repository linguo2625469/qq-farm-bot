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
const { startWebSocketServer: startGameStateBroadcast, stopWebSocketServer: stopGameStateBroadcast } = require('./src/game-state-broadcast');

// ============ 帮助信息 ============
function showHelp() {
    console.log(`
QQ经典农场 挂机脚本
====================

用法:
  node client.js --code <登录code> [--wx] [--interval <秒>] [--friend-interval <秒>]
  node client.js --verify
  node client.js --decode <数据> [--hex] [--gate] [--type <消息类型>]

参数:
  --code              小程序 login() 返回的临时凭证 (必需)
  --wx                使用微信登录 (默认为QQ小程序)
  --interval          自己农场巡查完成后等待秒数, 默认10秒, 最低10秒
  --friend-interval   好友巡查完成后等待秒数, 默认1秒, 最低1秒
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

// ============ 参数解析 ============
function parseArgs(args) {
    let code = '';
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--code' && args[i + 1]) {
            code = args[++i];
        }
        if (args[i] === '--wx') {
            CONFIG.platform = 'wx';
        }
        if (args[i] === '--interval' && args[i + 1]) {
            const sec = parseInt(args[++i]);
            CONFIG.farmCheckInterval = Math.max(sec, 1) * 1000;
        }
        if (args[i] === '--friend-interval' && args[i + 1]) {
            const sec = parseInt(args[++i]);
            CONFIG.friendCheckInterval = Math.max(sec, 1) * 1000;  // 最低1秒
        }
    }
    return code;
}

// ============ 主函数 ============
async function main() {
    const args = process.argv.slice(2);

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
    const code = parseArgs(args);
    if (!code) {
        showHelp();
        process.exit(1);
    }

    // 初始化状态栏
    initStatusBar();
    setStatusPlatform(CONFIG.platform);

    // 启动游戏状态广播服务
    startGameStateBroadcast();

    const platformName = CONFIG.platform === 'wx' ? '微信' : 'QQ';
    console.log(`[启动] ${platformName} code=${code.substring(0, 8)}... 农场${CONFIG.farmCheckInterval / 1000}s 好友${CONFIG.friendCheckInterval / 1000}s`);

    // 连接并登录，登录成功后启动各功能模块
    connect(code, async () => {
        // 处理邀请码 (仅微信环境)
        await processInviteCodes();
        
        startFarmCheckLoop();
        startFriendCheckLoop();
        initTaskSystem();
        
        // 启动时立即检查一次背包（调试用 目前不可用）
        // setTimeout(() => debugSellFruits(), 5000);
        // startSellLoop(60000);  // 每分钟自动出售仓库果实
    });

    // 退出处理
    process.on('SIGINT', () => {
        cleanupStatusBar();
        console.log('\n[退出] 正在断开...');
        stopFarmCheckLoop();
        stopFriendCheckLoop();
        cleanupTaskSystem();
        stopSellLoop();
        stopGameStateBroadcast();
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
