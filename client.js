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

// ============ 帮助信息 ============
function showHelp() {
    console.log(`
QQ经典农场 挂机脚本
====================

用法:
  FARM_CODE=<登录code> node client.js
  node client.js --verify
  node client.js --decode <数据> [--hex] [--gate] [--type <消息类型>]

环境变量:
  FARM_CODE                    小程序 login() 返回的临时凭证 (必需)
  FARM_PLATFORM                平台: qq (默认) 或 wx (微信)
  FARM_CHECK_INTERVAL          自己农场巡查完成后等待秒数, 默认1, 最低1
  FARM_FRIEND_CHECK_INTERVAL   好友巡查完成后等待秒数, 默认10, 最低1
  FARM_FORCE_LOWEST_CROP       固定种最低等级作物 (true/false, 默认false)
  FARM_TOP_CANDIDATES          从前N个最优种子中随机选择 (默认5)

开发工具:
  --verify            验证proto定义
  --decode            解码PB数据 (运行 --decode 无参数查看详细帮助)

PM2 示例:
  ecosystem.config.js:
  module.exports = {
    apps: [{
      name: 'farm',
      script: 'client.js',
      env: {
        FARM_CODE: 'your-code-here',
        FARM_PLATFORM: 'qq',
      }
    }]
  }

功能:
  - 自动收获成熟作物 → 购买种子 → 种植 → 施肥
  - 自动除草、除虫、浇水
  - 自动铲除枯死作物
  - 自动巡查好友农场: 帮忙浇水/除草/除虫 + 偷菜
  - 自动领取任务奖励 (支持分享翻倍)
  - 每分钟自动出售仓库果实
  - 启动时读取 share.txt 处理邀请码 (仅微信)
  - 心跳保活
  - 从经验最优种子中随机选择，排除白萝卜/胡萝卜
  - 操作延迟随机化，好友访问顺序随机化

邀请码文件 (share.txt):
  每行一个邀请链接，格式: ?uid=xxx&openid=xxx&share_source=xxx&doc_id=xxx
  启动时会尝试通过 SyncAll API 同步这些好友
`);
}

// ============ 主函数 ============
async function main() {
    const args = process.argv.slice(2);

    // 加载 proto 定义
    await loadProto();

    // 验证模式 (开发工具，保留CLI参数)
    if (args.includes('--verify')) {
        await verifyMode();
        return;
    }

    // 解码模式 (开发工具，保留CLI参数)
    if (args.includes('--decode')) {
        await decodeMode(args);
        return;
    }

    // 正常挂机模式 - 从环境变量读取配置
    if (!CONFIG.code) {
        console.error('[错误] 未设置 FARM_CODE 环境变量');
        showHelp();
        process.exit(1);
    }

    // 初始化状态栏
    initStatusBar();
    setStatusPlatform(CONFIG.platform);
    emitRuntimeHint(true);

    const platformName = CONFIG.platform === 'wx' ? '微信' : 'QQ';
    console.log(`[启动] ${platformName} code=${CONFIG.code.substring(0, 8)}... 农场${CONFIG.farmCheckInterval / 1000}s 好友${CONFIG.friendCheckInterval / 1000}s`);

    // 连接并登录，登录成功后启动各功能模块
    connect(async () => {
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
