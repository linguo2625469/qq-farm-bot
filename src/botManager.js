/**
 * Bot 生命周期管理 - 供 GUI 使用
 */

const { CONFIG, configEvents } = require('./config');
const { loadProto } = require('./proto');
const { connect, cleanup, closeWs, getUserState } = require('./network');
const { startFarmCheckLoop, stopFarmCheckLoop } = require('./farm');
const { startFriendCheckLoop, stopFriendCheckLoop } = require('./friend');
const { initTaskSystem, cleanupTaskSystem } = require('./task');
const { startSellLoop, stopSellLoop, debugSellFruits } = require('./warehouse');
const { processInviteCodes } = require('./invite');
const { initFileLogger } = require('./logger');

let botState = 'stopped'; // stopped | starting | running | stopping
let protoLoaded = false;

/**
 * 启动 bot
 * @param {string} code - 登录凭证
 * @param {string} [platform] - 'qq' 或 'wx'
 */
async function startBot(code, platform) {
    if (botState === 'running' || botState === 'starting') {
        throw new Error('Bot 已在运行中');
    }

    botState = 'starting';

    if (platform) CONFIG.platform = platform;

    // 确保 proto 已加载
    if (!protoLoaded) {
        await loadProto();
        protoLoaded = true;
    }

    // 确保日志系统已初始化
    initFileLogger();

    const platformName = CONFIG.platform === 'wx' ? '微信' : 'QQ';
    console.log(`[GUI] ${platformName} 启动中... code=${code.substring(0, 8)}...`);

    return new Promise((resolve, reject) => {
        try {
            connect(code, async () => {
                botState = 'running';
                console.log('[GUI] 登录成功，启动功能模块...');

                await processInviteCodes();

                if (CONFIG.enableFarmLoop) startFarmCheckLoop();
                if (CONFIG.enableFriendLoop) startFriendCheckLoop();
                if (CONFIG.enableTaskSystem) initTaskSystem();
                if (CONFIG.enableSellLoop) {
                    setTimeout(() => debugSellFruits(), 5000);
                    startSellLoop(60000);
                }

                resolve();
            });
        } catch (e) {
            botState = 'stopped';
            reject(e);
        }
    });
}

/**
 * 停止 bot
 */
function stopBot() {
    if (botState === 'stopped') return;
    botState = 'stopping';

    stopFarmCheckLoop();
    stopFriendCheckLoop();
    cleanupTaskSystem();
    stopSellLoop();
    cleanup();
    closeWs();

    botState = 'stopped';
    console.log('[GUI] Bot 已停止');
}

/**
 * 获取 bot 状态信息
 */
function getStatus() {
    const state = getUserState();
    return {
        botState,
        platform: CONFIG.platform,
        gid: state.gid,
        name: state.name,
        level: state.level,
        gold: state.gold,
        exp: state.exp,
    };
}

/**
 * 获取所有可切换的配置项
 */
function getAllConfig() {
    return {
        // 主功能
        enableFarmLoop: CONFIG.enableFarmLoop,
        enableFriendLoop: CONFIG.enableFriendLoop,
        enableSellLoop: CONFIG.enableSellLoop,
        enableTaskSystem: CONFIG.enableTaskSystem,
        enableAutoAcceptFriends: CONFIG.enableAutoAcceptFriends,
        // 农场
        enableAutoHarvest: CONFIG.enableAutoHarvest,
        enableAutoWater: CONFIG.enableAutoWater,
        enableAutoWeed: CONFIG.enableAutoWeed,
        enableAutoBug: CONFIG.enableAutoBug,
        enableAutoFertilize: CONFIG.enableAutoFertilize,
        enableAutoPlant: CONFIG.enableAutoPlant,
        enableAutoRemoveDead: CONFIG.enableAutoRemoveDead,
        // 好友
        enableHelpWater: CONFIG.enableHelpWater,
        enableHelpWeed: CONFIG.enableHelpWeed,
        enableHelpBug: CONFIG.enableHelpBug,
        enableSteal: CONFIG.enableSteal,
        helpOnlyWithExp: CONFIG.helpOnlyWithExp,
        enablePutInsects: CONFIG.enablePutInsects,
        enablePutWeeds: CONFIG.enablePutWeeds,
        // 其他
        forceLowestLevelCrop: CONFIG.forceLowestLevelCrop,
        farmCheckInterval: CONFIG.farmCheckInterval,
        friendCheckInterval: CONFIG.friendCheckInterval,
    };
}

// 监听配置变更，自动启停对应循环
configEvents.on('change', ({ key, value }) => {
    if (botState !== 'running') return;

    switch (key) {
        case 'enableFarmLoop':
            value ? startFarmCheckLoop() : stopFarmCheckLoop();
            break;
        case 'enableFriendLoop':
            value ? startFriendCheckLoop() : stopFriendCheckLoop();
            break;
        case 'enableSellLoop':
            value ? startSellLoop(60000) : stopSellLoop();
            break;
        case 'enableTaskSystem':
            value ? initTaskSystem() : cleanupTaskSystem();
            break;
    }
});

module.exports = {
    startBot,
    stopBot,
    getStatus,
    getAllConfig,
};
