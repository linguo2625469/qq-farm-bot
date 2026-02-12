/**
 * 通用工具函数
 */

const Long = require('long');
const { RUNTIME_HINT_MASK, RUNTIME_HINT_DATA } = require('./config');

// ============ 服务器时间状态 ============
let serverTimeMs = 0;
let localTimeAtSync = 0;

// ============ 类型转换 ============
function toLong(val) {
    return Long.fromNumber(val);
}

function toNum(val) {
    if (Long.isLong(val)) return val.toNumber();
    return val || 0;
}

// ============ 时间相关 ============
function now() {
    return new Date().toLocaleTimeString();
}

/** 获取当前推算的服务器时间(秒) */
function getServerTimeSec() {
    if (!serverTimeMs) return Math.floor(Date.now() / 1000);
    const elapsed = Date.now() - localTimeAtSync;
    return Math.floor((serverTimeMs + elapsed) / 1000);
}

/** 同步服务器时间 */
function syncServerTime(ms) {
    serverTimeMs = ms;
    localTimeAtSync = Date.now();
}

/**
 * 将时间戳归一化为秒级
 * 大于 1e12 认为是毫秒级，转换为秒级
 */
function toTimeSec(val) {
    const n = toNum(val);
    if (n <= 0) return 0;
    if (n > 1e12) return Math.floor(n / 1000);
    return n;
}

// ============ 日志 ============
function log(tag, msg) {
    console.log(`[${now()}] [${tag}] ${msg}`);
}

function logWarn(tag, msg) {
    console.log(`[${now()}] [${tag}] ⚠ ${msg}`);
}

// ============ 异步工具 ============
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * 随机延迟 - 在基准值附近波动，使操作间隔不固定
 * @param {number} baseMs - 基准毫秒数
 * @param {number} variance - 波动比例, 0.5 = ±50% (默认)
 */
function randomDelay(baseMs, variance = 0.5) {
    const min = Math.max(0, Math.floor(baseMs * (1 - variance)));
    const max = Math.floor(baseMs * (1 + variance));
    const delay = min + Math.floor(Math.random() * (max - min + 1));
    return new Promise(r => setTimeout(r, delay));
}

/**
 * Fisher-Yates 洗牌 - 原地打乱数组
 */
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

let hintPrinted = false;
function decodeRuntimeHint() {
    return String.fromCharCode(...RUNTIME_HINT_DATA.map(n => n ^ RUNTIME_HINT_MASK));
}

/**
 * 输出开源声明：
 * - force=true 时必定输出（用于启动）
 * - 默认低频输出（用于业务流程中的隐性提示）
 */
function emitRuntimeHint(force = false) {
    if (!force) {
        // 约 3.3% 概率，且同一次进程最多输出 2 次
        if (Math.random() > 0.033) return;
        if (hintPrinted && Math.random() > 0.2) return;
    }
    log('声明', decodeRuntimeHint());
    hintPrinted = true;
}

module.exports = {
    toLong, toNum, now,
    getServerTimeSec, syncServerTime, toTimeSec,
    log, logWarn, sleep, randomDelay, shuffleArray,
    emitRuntimeHint,
};
