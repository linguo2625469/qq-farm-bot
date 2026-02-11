/**
 * 仓库系统 - 自动出售果实
 * 协议说明：BagReply 使用 item_bag（ItemBag），item_bag.items 才是背包物品列表
 */

const { types } = require('./proto');
const { sendMsgAsync } = require('./network');
const { toLong, toNum, log, logWarn, sleep } = require('./utils');
const { getFruitName } = require('./gameConfig');

// 果实 ID 范围：Plant.json 中。fruit.id 为 4xxxx；部分接口可能用 3xxx，两段都视为果实
const FRUIT_ID_MIN = 3001;
const FRUIT_ID_MAX = 49999;

// 单次 Sell 请求最多条数，过多可能触发 1000020 参数错误
const SELL_BATCH_SIZE = 15;

let sellTimer = null;
let sellInterval = 60000;
let lastSellTime = 0;
let totalSoldGold = 0;
let fruitCount = 0;

async function getBag() {
    const body = types.BagRequest.encode(types.BagRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'Bag', body);
    return types.BagReply.decode(replyBody);
}

/**
 * 将 item 转为 Sell 请求所需格式（id/count/uid 保留 Long 或转成 Long，与游戏一致）
 */
function toSellItem(item) {
    const id = item.id != null ? toLong(item.id) : undefined;
    const count = item.count != null ? toLong(item.count) : undefined;
    const uid = item.uid != null ? toLong(item.uid) : undefined;
    return { id, count, uid };
}

async function sellItems(items) {
    const payload = items.map(toSellItem);
    const body = types.SellRequest.encode(types.SellRequest.create({ items: payload })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'Sell', body);
    return types.SellReply.decode(replyBody);
}

/**
 * 从 BagReply 取出物品列表（兼容 item_bag 与旧版 items）
 */
function getBagItems(bagReply) {
    if (bagReply.item_bag && bagReply.item_bag.items && bagReply.item_bag.items.length)
        return bagReply.item_bag.items;
    return bagReply.items || [];
}

async function sellAllFruits() {
    try {
        const bagReply = await getBag();
        const items = getBagItems(bagReply);

        const toSell = [];
        const names = [];
        for (const item of items) {
            const id = toNum(item.id);
            const count = toNum(item.count);
            if (id >= FRUIT_ID_MIN && id <= FRUIT_ID_MAX && count > 0) {
                toSell.push(item);
                names.push(`${getFruitName(id)}x${count}`);
            }
        }

        if (toSell.length === 0) return;

        let totalGold = 0;
        for (let i = 0; i < toSell.length; i += SELL_BATCH_SIZE) {
            const batch = toSell.slice(i, i + SELL_BATCH_SIZE);
            const reply = await sellItems(batch);
            totalGold += toNum(reply.gold || 0);
            if (i + SELL_BATCH_SIZE < toSell.length) await sleep(300);
        }
        lastSellTime = Date.now();
        totalSoldGold += totalGold;
        log('仓库', `出售 ${names.join(', ')}，获得 ${totalGold} 金币`);
    } catch (e) {
        logWarn('仓库', `出售失败: ${e.message}`);
    }
}

async function debugSellFruits() {
    try {
        log('仓库', '正在检查背包...');
        const bagReply = await getBag();
        const items = getBagItems(bagReply);
        log('仓库', `背包共 ${items.length} 种物品`);

        for (const item of items) {
            const id = toNum(item.id);
            const count = toNum(item.count);
            const isFruit = id >= FRUIT_ID_MIN && id <= FRUIT_ID_MAX;
            if (isFruit) {
                const name = getFruitName(id);
                log('仓库', `  [果实] ${name}(${id}) x${count}`);
            }
        }

        const toSell = [];
        for (const item of items) {
            const id = toNum(item.id);
            const count = toNum(item.count);
            if (id >= FRUIT_ID_MIN && id <= FRUIT_ID_MAX && count > 0)
                toSell.push(item);
        }

        fruitCount = toSell.length;

        if (toSell.length === 0) {
            log('仓库', '没有果实可出售');
            return;
        }

        log('仓库', `准备出售 ${toSell.length} 种果实，每批 ${SELL_BATCH_SIZE} 条...`);
        let totalGold = 0;
        for (let i = 0; i < toSell.length; i += SELL_BATCH_SIZE) {
            const batch = toSell.slice(i, i + SELL_BATCH_SIZE);
            const reply = await sellItems(batch);
            const g = toNum(reply.gold || 0);
            totalGold += g;
            log('仓库', `  第 ${Math.floor(i / SELL_BATCH_SIZE) + 1} 批: 获得 ${g} 金币`);
            if (i + SELL_BATCH_SIZE < toSell.length) await sleep(300);
        }
        log('仓库', `出售完成，共获得 ${totalGold} 金币`);
    } catch (e) {
        logWarn('仓库', `调试出售失败: ${e.message}`);
        console.error(e);
    }
}

function startSellLoop(interval = 60000) {
    if (sellTimer) return;
    sellInterval = interval;
    setTimeout(() => {
        sellAllFruits();
        sellTimer = setInterval(() => sellAllFruits(), sellInterval);
    }, 10000);
}

function stopSellLoop() {
    if (sellTimer) {
        clearInterval(sellTimer);
        sellTimer = null;
    }
}

function getWarehouseState() {
    return {
        fruitCount,
        lastSellTime,
        totalSoldGold,
        sellInterval,
        isSelling: sellTimer !== null,
    };
}

module.exports = {
    getBag,
    sellItems,
    sellAllFruits,
    debugSellFruits,
    getBagItems,
    startSellLoop,
    stopSellLoop,
    getWarehouseState,
};
