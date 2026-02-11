/**
 * 好友农场操作 - 进入/离开/帮忙/偷菜/巡查
 */

const { CONFIG, PlantPhase, PHASE_NAMES } = require('./config');
const { types } = require('./proto');
const { sendMsgAsync, getUserState, networkEvents } = require('./network');
const { toLong, toNum, getServerTimeSec, log, logWarn, sleep } = require('./utils');
const { getCurrentPhase, setOperationLimitsCallback } = require('./farm');
const { getPlantName } = require('./gameConfig');

// ============ 内部状态 ============
let isCheckingFriends = false;
let isFirstFriendCheck = true;
let friendCheckTimer = null;
let friendLoopRunning = false;
let lastResetDate = '';  // 上次重置日期 (YYYY-MM-DD)

// 操作限制状态 (从服务器响应中更新)
// 操作类型ID (根据游戏代码):
// 10001 = 收获, 10002 = 铲除, 10003 = 放草, 10004 = 放虫
// 10005 = 除草(帮好友), 10006 = 除虫(帮好友), 10007 = 浇水(帮好友), 10008 = 偷菜
const operationLimits = new Map();

// 操作类型名称映射
const OP_NAMES = {
    10001: '收获',
    10002: '铲除',
    10003: '放草',
    10004: '放虫',
    10005: '除草',
    10006: '除虫',
    10007: '浇水',
    10008: '偷菜',
};

// 配置: 是否只在有经验时才帮助好友
const HELP_ONLY_WITH_EXP = true;

// 配置: 是否启用放虫放草功能
const ENABLE_PUT_BAD_THINGS = false;  // 暂时关闭放虫放草功能

// ============ 好友 API ============

async function getAllFriends() {
    const body = types.GetAllFriendsRequest.encode(types.GetAllFriendsRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.friendpb.FriendService', 'GetAll', body);
    return types.GetAllFriendsReply.decode(replyBody);
}

// ============ 好友申请 API (微信同玩) ============

async function getApplications() {
    const body = types.GetApplicationsRequest.encode(types.GetApplicationsRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.friendpb.FriendService', 'GetApplications', body);
    return types.GetApplicationsReply.decode(replyBody);
}

async function acceptFriends(gids) {
    const body = types.AcceptFriendsRequest.encode(types.AcceptFriendsRequest.create({
        friend_gids: gids.map(g => toLong(g)),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.friendpb.FriendService', 'AcceptFriends', body);
    return types.AcceptFriendsReply.decode(replyBody);
}

async function enterFriendFarm(friendGid) {
    const body = types.VisitEnterRequest.encode(types.VisitEnterRequest.create({
        host_gid: toLong(friendGid),
        reason: 2,  // ENTER_REASON_FRIEND
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.visitpb.VisitService', 'Enter', body);
    return types.VisitEnterReply.decode(replyBody);
}

async function leaveFriendFarm(friendGid) {
    const body = types.VisitLeaveRequest.encode(types.VisitLeaveRequest.create({
        host_gid: toLong(friendGid),
    })).finish();
    try {
        await sendMsgAsync('gamepb.visitpb.VisitService', 'Leave', body);
    } catch (e) { /* 离开失败不影响主流程 */ }
}

/**
 * 检查是否需要重置每日限制 (0点刷新)
 */
function checkDailyReset() {
    const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
    if (lastResetDate !== today) {
        if (lastResetDate !== '') {
            log('系统', '跨日重置，清空操作限制缓存');
        }
        operationLimits.clear();
        lastResetDate = today;
    }
}

/**
 * 更新操作限制状态
 */
function updateOperationLimits(limits) {
    if (!limits || limits.length === 0) return;
    checkDailyReset();
    for (const limit of limits) {
        const id = toNum(limit.id);
        if (id > 0) {
            const data = {
                dayTimes: toNum(limit.day_times),
                dayTimesLimit: toNum(limit.day_times_lt),
                dayExpTimes: toNum(limit.day_exp_times),
                dayExpTimesLimit: toNum(limit.day_ex_times_lt),  // 注意: 字段名是 day_ex_times_lt (少个p)
            };
            operationLimits.set(id, data);
        }
    }
}

/**
 * 检查某操作是否还能获得经验
 */
function canGetExp(opId) {
    const limit = operationLimits.get(opId);
    if (!limit) return false;  // 没有限制信息，保守起见不帮助（等待农场检查获取限制）
    if (limit.dayExpTimesLimit <= 0) return true;  // 没有经验上限
    return limit.dayExpTimes < limit.dayExpTimesLimit;
}

/**
 * 检查某操作是否还有次数
 */
function canOperate(opId) {
    const limit = operationLimits.get(opId);
    if (!limit) return true;
    if (limit.dayTimesLimit <= 0) return true;
    return limit.dayTimes < limit.dayTimesLimit;
}

/**
 * 获取某操作剩余次数
 */
function getRemainingTimes(opId) {
    const limit = operationLimits.get(opId);
    if (!limit || limit.dayTimesLimit <= 0) return 999;
    return Math.max(0, limit.dayTimesLimit - limit.dayTimes);
}

/**
 * 获取操作限制摘要 (用于日志显示)
 */
function getOperationLimitsSummary() {
    const parts = [];
    // 帮助好友操作 (10005=除草, 10006=除虫, 10007=浇水, 10008=偷菜)
    for (const id of [10005, 10006, 10007, 10008]) {
        const limit = operationLimits.get(id);
        if (limit && limit.dayExpTimesLimit > 0) {
            const name = OP_NAMES[id] || `#${id}`;
            const expLeft = limit.dayExpTimesLimit - limit.dayExpTimes;
            parts.push(`${name}${expLeft}/${limit.dayExpTimesLimit}`);
        }
    }
    // 捣乱操作 (10003=放草, 10004=放虫)
    for (const id of [10003, 10004]) {
        const limit = operationLimits.get(id);
        if (limit && limit.dayTimesLimit > 0) {
            const name = OP_NAMES[id] || `#${id}`;
            const left = limit.dayTimesLimit - limit.dayTimes;
            parts.push(`${name}${left}/${limit.dayTimesLimit}`);
        }
    }
    return parts;
}

async function helpWater(friendGid, landIds) {
    const body = types.WaterLandRequest.encode(types.WaterLandRequest.create({
        land_ids: landIds,
        host_gid: toLong(friendGid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'WaterLand', body);
    const reply = types.WaterLandReply.decode(replyBody);
    updateOperationLimits(reply.operation_limits);
    return reply;
}

async function helpWeed(friendGid, landIds) {
    const body = types.WeedOutRequest.encode(types.WeedOutRequest.create({
        land_ids: landIds,
        host_gid: toLong(friendGid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'WeedOut', body);
    const reply = types.WeedOutReply.decode(replyBody);
    updateOperationLimits(reply.operation_limits);
    return reply;
}

async function helpInsecticide(friendGid, landIds) {
    const body = types.InsecticideRequest.encode(types.InsecticideRequest.create({
        land_ids: landIds,
        host_gid: toLong(friendGid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Insecticide', body);
    const reply = types.InsecticideReply.decode(replyBody);
    updateOperationLimits(reply.operation_limits);
    return reply;
}

async function stealHarvest(friendGid, landIds) {
    const body = types.HarvestRequest.encode(types.HarvestRequest.create({
        land_ids: landIds,
        host_gid: toLong(friendGid),
        is_all: true,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Harvest', body);
    const reply = types.HarvestReply.decode(replyBody);
    updateOperationLimits(reply.operation_limits);
    return reply;
}

async function putInsects(friendGid, landIds) {
    const body = types.PutInsectsRequest.encode(types.PutInsectsRequest.create({
        land_ids: landIds,
        host_gid: toLong(friendGid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'PutInsects', body);
    const reply = types.PutInsectsReply.decode(replyBody);
    updateOperationLimits(reply.operation_limits);
    return reply;
}

async function putWeeds(friendGid, landIds) {
    const body = types.PutWeedsRequest.encode(types.PutWeedsRequest.create({
        land_ids: landIds,
        host_gid: toLong(friendGid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'PutWeeds', body);
    const reply = types.PutWeedsReply.decode(replyBody);
    updateOperationLimits(reply.operation_limits);
    return reply;
}

// ============ 好友土地分析 ============

// 调试开关 - 设为好友名字可只查看该好友的土地分析详情，设为 true 查看全部，false 关闭
const DEBUG_FRIEND_LANDS = false;

function analyzeFriendLands(lands, myGid, friendName = '') {
    const result = {
        stealable: [],   // 可偷
        stealableInfo: [],  // 可偷植物信息 { landId, plantId, name }
        needWater: [],   // 需要浇水
        needWeed: [],    // 需要除草
        needBug: [],     // 需要除虫
        canPutWeed: [],  // 可以放草
        canPutBug: [],   // 可以放虫
    };

    for (const land of lands) {
        const id = toNum(land.id);
        const plant = land.plant;
        // 是否显示此好友的调试信息
        const showDebug = DEBUG_FRIEND_LANDS === true || DEBUG_FRIEND_LANDS === friendName;

        if (!plant || !plant.phases || plant.phases.length === 0) {
            if (showDebug) console.log(`  [${friendName}] 土地#${id}: 无植物或无阶段数据`);
            continue;
        }

        const currentPhase = getCurrentPhase(plant.phases, showDebug, `[${friendName}]土地#${id}`);
        if (!currentPhase) {
            if (showDebug) console.log(`  [${friendName}] 土地#${id}: getCurrentPhase返回null`);
            continue;
        }
        const phaseVal = currentPhase.phase;

        if (showDebug) {
            const insectOwners = plant.insect_owners || [];
            const weedOwners = plant.weed_owners || [];
            console.log(`  [${friendName}] 土地#${id}: phase=${phaseVal} stealable=${plant.stealable} dry=${toNum(plant.dry_num)} weed=${weedOwners.length} bug=${insectOwners.length}`);
        }

        if (phaseVal === PlantPhase.MATURE) {
            if (plant.stealable) {
                result.stealable.push(id);
                const plantId = toNum(plant.id);
                const plantName = getPlantName(plantId) || plant.name || '未知';
                result.stealableInfo.push({ landId: id, plantId, name: plantName });
            } else if (showDebug) {
                console.log(`  [${friendName}] 土地#${id}: 成熟但stealable=false (可能已被偷过)`);
            }
            continue;
        }

        if (phaseVal === PlantPhase.DEAD) continue;

        // 帮助操作
        if (toNum(plant.dry_num) > 0) result.needWater.push(id);
        if (plant.weed_owners && plant.weed_owners.length > 0) result.needWeed.push(id);
        if (plant.insect_owners && plant.insect_owners.length > 0) result.needBug.push(id);

        // 捣乱操作: 检查是否可以放草/放虫
        // 条件: 没有草且我没放过草
        const weedOwners = plant.weed_owners || [];
        const insectOwners = plant.insect_owners || [];
        const iAlreadyPutWeed = weedOwners.some(gid => toNum(gid) === myGid);
        const iAlreadyPutBug = insectOwners.some(gid => toNum(gid) === myGid);

        // 每块地最多2个草/虫，且我没放过
        if (weedOwners.length < 2 && !iAlreadyPutWeed) {
            result.canPutWeed.push(id);
        }
        if (insectOwners.length < 2 && !iAlreadyPutBug) {
            result.canPutBug.push(id);
        }
    }
    return result;
}

// ============ 拜访好友 ============

async function visitFriend(friend, totalActions, myGid) {
    const { gid, name } = friend;
    const showDebug = DEBUG_FRIEND_LANDS === true || DEBUG_FRIEND_LANDS === name;

    if (showDebug) {
        console.log(`\n========== 调试: 进入好友 [${name}] 农场 ==========`);
    }

    let enterReply;
    try {
        enterReply = await enterFriendFarm(gid);
    } catch (e) {
        logWarn('好友', `进入 ${name} 农场失败: ${e.message}`);
        return;
    }

    const lands = enterReply.lands || [];
    if (showDebug) {
        console.log(`  [${name}] 获取到 ${lands.length} 块土地`);
    }
    if (lands.length === 0) {
        await leaveFriendFarm(gid);
        return;
    }

    const status = analyzeFriendLands(lands, myGid, name);
    
    if (showDebug) {
        console.log(`  [${name}] 分析结果: 可偷=${status.stealable.length} 浇水=${status.needWater.length} 除草=${status.needWeed.length} 除虫=${status.needBug.length}`);
        console.log(`========== 调试结束 ==========\n`);
    }

    // 执行操作
    const actions = [];

    // 帮助操作: 只在有经验时执行 (如果启用了 HELP_ONLY_WITH_EXP)
    if (status.needWeed.length > 0) {
        const shouldHelp = !HELP_ONLY_WITH_EXP || canGetExp(10005);  // 10005=除草
        if (shouldHelp) {
            let ok = 0;
            for (const landId of status.needWeed) {
                try { await helpWeed(gid, [landId]); ok++; } catch (e) { /* ignore */ }
                await sleep(100);
            }
            if (ok > 0) { actions.push(`草${ok}`); totalActions.weed += ok; }
        }
    }

    if (status.needBug.length > 0) {
        const shouldHelp = !HELP_ONLY_WITH_EXP || canGetExp(10006);  // 10006=除虫
        if (shouldHelp) {
            let ok = 0;
            for (const landId of status.needBug) {
                try { await helpInsecticide(gid, [landId]); ok++; } catch (e) { /* ignore */ }
                await sleep(100);
            }
            if (ok > 0) { actions.push(`虫${ok}`); totalActions.bug += ok; }
        }
    }

    if (status.needWater.length > 0) {
        const shouldHelp = !HELP_ONLY_WITH_EXP || canGetExp(10007);  // 10007=浇水
        if (shouldHelp) {
            let ok = 0;
            for (const landId of status.needWater) {
                try { await helpWater(gid, [landId]); ok++; } catch (e) { /* ignore */ }
                await sleep(100);
            }
            if (ok > 0) { actions.push(`水${ok}`); totalActions.water += ok; }
        }
    }

    // 偷菜: 始终执行
    if (status.stealable.length > 0) {
        let ok = 0;
        const stolenPlants = [];
        for (let i = 0; i < status.stealable.length; i++) {
            const landId = status.stealable[i];
            try {
                await stealHarvest(gid, [landId]);
                ok++;
                if (status.stealableInfo[i]) {
                    stolenPlants.push(status.stealableInfo[i].name);
                }
            } catch (e) { /* ignore */ }
            await sleep(100);
        }
        if (ok > 0) {
            const plantNames = [...new Set(stolenPlants)].join('/');
            actions.push(`偷${ok}${plantNames ? '(' + plantNames + ')' : ''}`);
            totalActions.steal += ok;
        }
    }

    // 捣乱操作: 放虫(10004)/放草(10003)
    if (ENABLE_PUT_BAD_THINGS && status.canPutBug.length > 0 && canOperate(10004)) {
        let ok = 0;
        const remaining = getRemainingTimes(10004);
        const toProcess = status.canPutBug.slice(0, remaining);
        for (const landId of toProcess) {
            if (!canOperate(10004)) break;
            try { await putInsects(gid, [landId]); ok++; } catch (e) { /* ignore */ }
            await sleep(100);
        }
        if (ok > 0) { actions.push(`放虫${ok}`); totalActions.putBug += ok; }
    }

    if (ENABLE_PUT_BAD_THINGS && status.canPutWeed.length > 0 && canOperate(10003)) {
        let ok = 0;
        const remaining = getRemainingTimes(10003);
        const toProcess = status.canPutWeed.slice(0, remaining);
        for (const landId of toProcess) {
            if (!canOperate(10003)) break;
            try { await putWeeds(gid, [landId]); ok++; } catch (e) { /* ignore */ }
            await sleep(100);
        }
        if (ok > 0) { actions.push(`放草${ok}`); totalActions.putWeed += ok; }
    }

    if (actions.length > 0) {
        log('好友', `${name}: ${actions.join('/')}`);
    }

    await leaveFriendFarm(gid);
}

// ============ 好友巡查主循环 ============

async function checkFriends() {
    const state = getUserState();
    if (isCheckingFriends || !state.gid) return;
    isCheckingFriends = true;

    // 检查是否跨日需要重置
    checkDailyReset();

    // 经验限制状态（移到有操作时才显示）

    try {
        const friendsReply = await getAllFriends();
        const friends = friendsReply.game_friends || [];
        if (friends.length === 0) { log('好友', '没有好友'); return; }

        // 检查是否还有捣乱次数 (放虫/放草)
        const canPutBugOrWeed = canOperate(10004) || canOperate(10003);  // 10004=放虫, 10003=放草

        // 分两类：有预览信息的优先访问，其他的放后面（用于放虫放草）
        const priorityFriends = [];  // 有可偷/可帮助的好友
        const otherFriends = [];     // 其他好友（仅用于放虫放草）
        const visitedGids = new Set();
        
        for (const f of friends) {
            const gid = toNum(f.gid);
            if (gid === state.gid) continue;
            if (visitedGids.has(gid)) continue;
            const name = f.remark || f.name || `GID:${gid}`;
            const p = f.plant;

            const stealNum = p ? toNum(p.steal_plant_num) : 0;
            const dryNum = p ? toNum(p.dry_num) : 0;
            const weedNum = p ? toNum(p.weed_num) : 0;
            const insectNum = p ? toNum(p.insect_num) : 0;

            // 调试：显示指定好友的预览信息
            const showDebug = DEBUG_FRIEND_LANDS === true || DEBUG_FRIEND_LANDS === name;
            if (showDebug) {
                console.log(`[调试] 好友列表预览 [${name}]: steal=${stealNum} dry=${dryNum} weed=${weedNum} insect=${insectNum}`);
            }

            // 只加入有预览信息的好友
            if (stealNum > 0 || dryNum > 0 || weedNum > 0 || insectNum > 0) {
                priorityFriends.push({ gid, name });
                visitedGids.add(gid);
                if (showDebug) {
                    console.log(`[调试] 好友 [${name}] 加入优先列表 (位置: ${priorityFriends.length})`);
                }
            } else if (ENABLE_PUT_BAD_THINGS && canPutBugOrWeed) {
                // 没有预览信息但可以放虫放草（仅在开启放虫放草功能时）
                otherFriends.push({ gid, name });
                visitedGids.add(gid);
            }
        }
        
        // 合并列表：优先好友在前
        const friendsToVisit = [...priorityFriends, ...otherFriends];
        
        // 调试：检查目标好友位置
        if (DEBUG_FRIEND_LANDS && typeof DEBUG_FRIEND_LANDS === 'string') {
            const idx = friendsToVisit.findIndex(f => f.name === DEBUG_FRIEND_LANDS);
            if (idx >= 0) {
                const inPriority = idx < priorityFriends.length;
                console.log(`[调试] 好友 [${DEBUG_FRIEND_LANDS}] 位置: ${idx + 1}/${friendsToVisit.length} (${inPriority ? '优先列表' : '其他列表'})`);
            } else {
                console.log(`[调试] 好友 [${DEBUG_FRIEND_LANDS}] 不在待访问列表中!`);
            }
        }

        if (friendsToVisit.length === 0) {
            // 无需操作时不输出日志
            return;
        }

        let totalActions = { steal: 0, water: 0, weed: 0, bug: 0, putBug: 0, putWeed: 0 };
        for (let i = 0; i < friendsToVisit.length; i++) {
            const friend = friendsToVisit[i];
            const showDebug = DEBUG_FRIEND_LANDS === true || DEBUG_FRIEND_LANDS === friend.name;
            if (showDebug) {
                console.log(`[调试] 准备访问 [${friend.name}] (${i + 1}/${friendsToVisit.length})`);
            }
            try { 
                await visitFriend(friend, totalActions, state.gid); 
            } catch (e) { 
                if (showDebug) {
                    console.log(`[调试] 访问 [${friend.name}] 出错: ${e.message}`);
                }
            }
            await sleep(500);
            // 如果捣乱次数用完了，且没有其他操作，可以提前结束
            if (!canOperate(10004) && !canOperate(10003)) {  // 10004=放虫, 10003=放草
                // 继续巡查，但不再放虫放草
            }
        }

        // 只在有操作时输出日志
        const summary = [];
        if (totalActions.steal > 0) summary.push(`偷${totalActions.steal}`);
        if (totalActions.weed > 0) summary.push(`除草${totalActions.weed}`);
        if (totalActions.bug > 0) summary.push(`除虫${totalActions.bug}`);
        if (totalActions.water > 0) summary.push(`浇水${totalActions.water}`);
        if (totalActions.putBug > 0) summary.push(`放虫${totalActions.putBug}`);
        if (totalActions.putWeed > 0) summary.push(`放草${totalActions.putWeed}`);
        
        if (summary.length > 0) {
            log('好友', `巡查 ${friendsToVisit.length} 人 → ${summary.join('/')}`);
        }
        isFirstFriendCheck = false;
    } catch (err) {
        logWarn('好友', `巡查失败: ${err.message}`);
    } finally {
        isCheckingFriends = false;
    }
}

/**
 * 好友巡查循环 - 本次完成后等待指定秒数再开始下次
 */
async function friendCheckLoop() {
    while (friendLoopRunning) {
        await checkFriends();
        if (!friendLoopRunning) break;
        await sleep(CONFIG.friendCheckInterval);
    }
}

function startFriendCheckLoop() {
    if (friendLoopRunning) return;
    friendLoopRunning = true;

    // 注册操作限制更新回调，从农场检查中获取限制信息
    setOperationLimitsCallback(updateOperationLimits);

    // 监听好友申请推送 (微信同玩)
    networkEvents.on('friendApplicationReceived', onFriendApplicationReceived);

    // 延迟 5 秒后启动循环，等待登录和首次农场检查完成
    friendCheckTimer = setTimeout(() => friendCheckLoop(), 5000);

    // 启动时检查一次待处理的好友申请
    setTimeout(() => checkAndAcceptApplications(), 3000);
}

function stopFriendCheckLoop() {
    friendLoopRunning = false;
    networkEvents.off('friendApplicationReceived', onFriendApplicationReceived);
    if (friendCheckTimer) { clearTimeout(friendCheckTimer); friendCheckTimer = null; }
}

// ============ 自动同意好友申请 (微信同玩) ============

/**
 * 处理服务器推送的好友申请
 */
function onFriendApplicationReceived(applications) {
    const names = applications.map(a => a.name || `GID:${toNum(a.gid)}`).join(', ');
    log('申请', `收到 ${applications.length} 个好友申请: ${names}`);

    // 自动同意
    const gids = applications.map(a => toNum(a.gid));
    acceptFriendsWithRetry(gids);
}

/**
 * 检查并同意所有待处理的好友申请
 */
async function checkAndAcceptApplications() {
    try {
        const reply = await getApplications();
        const applications = reply.applications || [];
        if (applications.length === 0) return;

        const names = applications.map(a => a.name || `GID:${toNum(a.gid)}`).join(', ');
        log('申请', `发现 ${applications.length} 个待处理申请: ${names}`);

        const gids = applications.map(a => toNum(a.gid));
        await acceptFriendsWithRetry(gids);
    } catch (e) {
        // 静默失败，可能是 QQ 平台不支持
    }
}

/**
 * 同意好友申请 (带重试)
 */
async function acceptFriendsWithRetry(gids) {
    if (gids.length === 0) return;
    try {
        const reply = await acceptFriends(gids);
        const friends = reply.friends || [];
        if (friends.length > 0) {
            const names = friends.map(f => f.name || f.remark || `GID:${toNum(f.gid)}`).join(', ');
            log('申请', `已同意 ${friends.length} 人: ${names}`);
        }
    } catch (e) {
        logWarn('申请', `同意失败: ${e.message}`);
    }
}

function getFriendState() {
    const limits = {};
    for (const [opId, data] of operationLimits) {
        const opName = OP_NAMES[opId] || `op_${opId}`;
        limits[opName] = {
            dayTimes: data.dayTimes,
            dayTimesLimit: data.dayTimesLimit,
            dayExpTimes: data.dayExpTimes,
            dayExpTimesLimit: data.dayExpTimesLimit,
        };
    }
    return {
        isCheckingFriends,
        isFirstFriendCheck,
        friendLoopRunning,
        operationLimits: limits,
    };
}

module.exports = {
    checkFriends, startFriendCheckLoop, stopFriendCheckLoop,
    checkAndAcceptApplications,
    getFriendState,
};
