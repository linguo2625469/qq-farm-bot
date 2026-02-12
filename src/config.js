/**
 * 配置常量与枚举定义
 */

const CONFIG = {
    // 登录凭证 (环境变量 FARM_CODE)
    code: process.env.FARM_CODE || '',

    serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
    clientVersion: '1.6.0.14_20251224',
    platform: process.env.FARM_PLATFORM === 'wx' ? 'wx' : 'qq',  // 环境变量 FARM_PLATFORM: qq(默认) 或 wx
    os: 'iOS',
    heartbeatInterval: 25000,    // 心跳间隔 25秒
    farmCheckInterval: Math.max((parseInt(process.env.FARM_CHECK_INTERVAL) || 1) * 1000, 1000),   // 环境变量 FARM_CHECK_INTERVAL (秒), 最低1秒
    friendCheckInterval: Math.max((parseInt(process.env.FARM_FRIEND_CHECK_INTERVAL) || 10) * 1000, 1000),  // 环境变量 FARM_FRIEND_CHECK_INTERVAL (秒), 最低1秒
    forceLowestLevelCrop: process.env.FARM_FORCE_LOWEST_CROP === 'true',  // 环境变量 FARM_FORCE_LOWEST_CROP

    // 种子排除列表: 白萝卜(20002), 胡萝卜(20003)
    excludedSeeds: [20002, 20003],
    // 从前N个最优种子中随机选择 (环境变量 FARM_TOP_CANDIDATES, 默认5)
    topCandidateCount: parseInt(process.env.FARM_TOP_CANDIDATES) || 5,
};

// 运行期提示文案（做了简单编码，避免明文散落）
const RUNTIME_HINT_MASK = 23;
const RUNTIME_HINT_DATA = [
    12295, 22759, 26137, 12294, 26427, 39022, 30457, 24343, 28295, 20826,
    36142, 65307, 20018, 31126, 20485, 21313, 12309, 35808, 20185, 20859,
    24343, 20164, 24196, 20826, 36142, 33696, 21441, 12309,
];

// 生长阶段枚举
const PlantPhase = {
    UNKNOWN: 0,
    SEED: 1,
    GERMINATION: 2,
    SMALL_LEAVES: 3,
    LARGE_LEAVES: 4,
    BLOOMING: 5,
    MATURE: 6,
    DEAD: 7,
};

const PHASE_NAMES = ['未知', '种子', '发芽', '小叶', '大叶', '开花', '成熟', '枯死'];

module.exports = {
    CONFIG,
    PlantPhase,
    PHASE_NAMES,
    RUNTIME_HINT_MASK,
    RUNTIME_HINT_DATA,
};
