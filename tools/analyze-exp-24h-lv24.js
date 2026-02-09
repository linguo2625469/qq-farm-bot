/**
 * 24小时最大经验分析
 * 
 * 用法: node analyze-exp-24h-lv24.js [--lv 等级] [--land 土地数]
 * 示例: node analyze-exp-24h-lv24.js --lv 9 --land 9
 * 
 * lv等级数 = 可种植的植物种类数（Plant.json从上往下数）
 */

const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================
const FERTILIZER_SPEED_SECONDS = 1080;  // 普通肥料加速1080秒（18分钟）
const TIME_LIMIT_HOURS = 24;
const TIME_LIMIT_SECONDS = TIME_LIMIT_HOURS * 3600;
const OPERATION_TIME = 15;  // 每轮操作时间（秒）

// 命令行参数解析
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        PLAYER_LEVEL: 9,   // 默认等级9（可种9种植物）
        LAND_COUNT: 9,     // 默认9块地
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--lv' && args[i + 1]) {
            config.PLAYER_LEVEL = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--land' && args[i + 1]) {
            config.LAND_COUNT = parseInt(args[i + 1]);
            i++;
        }
    }
    return config;
}

const { PLAYER_LEVEL, LAND_COUNT } = parseArgs();
// ==================== 配置结束 ====================

// 读取植物配置（Plant.json 按字典顺序排列）
const plantPath = path.join(__dirname, '..', 'gameConfig', 'Plant.json');
const plants = JSON.parse(fs.readFileSync(plantPath, 'utf8'));

// 解析生长阶段时间
function parseGrowTime(growPhases) {
    if (!growPhases) return 0;
    const phases = growPhases.split(';').filter(p => p.length > 0);
    let totalTime = 0;
    for (const phase of phases) {
        const match = phase.match(/:(\d+)$/);
        if (match) totalTime += parseInt(match[1]);
    }
    return totalTime;
}

// 格式化时间
function formatTime(seconds) {
    if (seconds <= 0) return '瞬间';
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${mins}分${secs}秒` : `${mins}分`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`;
}

// 按Plant.json数组顺序（字典顺序），取前 PLAYER_LEVEL 种作物
const availablePlants = plants.slice(0, PLAYER_LEVEL);

const firstName = availablePlants[0]?.name || '无';
const lastName = availablePlants[availablePlants.length - 1]?.name || '无';

console.log('=============================================');
console.log(`   Lv${PLAYER_LEVEL} 玩家 - 24小时最大经验分析`);
console.log('=============================================');
console.log('');
console.log('配置:');
console.log(`  - 等级: Lv${PLAYER_LEVEL}（可种 ${availablePlants.length} 种植物）`);
console.log(`  - 可种植物: ${firstName} ~ ${lastName}`);
console.log(`  - 土地数量: ${LAND_COUNT} 块`);
console.log(`  - 时间限制: ${TIME_LIMIT_HOURS} 小时`);
console.log(`  - 肥料加速: ${FERTILIZER_SPEED_SECONDS} 秒（${FERTILIZER_SPEED_SECONDS / 60}分钟）`);
console.log(`  - 每轮操作: ${OPERATION_TIME} 秒`);
console.log('');

// 计算每种作物的数据
const results = [];

for (const plant of availablePlants) {
    const growTime = parseGrowTime(plant.grow_phases);
    if (growTime <= 0) continue;
    
    const expPerHarvest = plant.exp || 0;  // 直接使用配置中的经验值
    
    // 不施肥
    const cycleNoFert = growTime + OPERATION_TIME;
    const cyclesNoFert = Math.floor(TIME_LIMIT_SECONDS / cycleNoFert);
    const totalExpNoFert = cyclesNoFert * expPerHarvest * LAND_COUNT;
    
    // 施肥（每块地每轮施一次肥）
    const growTimeFert = Math.max(growTime - FERTILIZER_SPEED_SECONDS, 1);
    const cycleFert = growTimeFert + OPERATION_TIME;
    const cyclesFert = Math.floor(TIME_LIMIT_SECONDS / cycleFert);
    const totalExpFert = cyclesFert * expPerHarvest * LAND_COUNT;
    const fertCount = cyclesFert * LAND_COUNT;  // 总共消耗肥料数量
    
    results.push({
        seedId: plant.seed_id,
        name: plant.name,
        growTime,
        expPerHarvest,
        // 不施肥
        cycleNoFert,
        cyclesNoFert,
        totalExpNoFert,
        // 施肥
        growTimeFert,
        cycleFert,
        cyclesFert,
        totalExpFert,
        fertCount,
    });
}

console.log('【完整作物列表 - 按配置文件顺序】');
console.log('');
console.log('作物         | 成熟时间    | 单次经验 | 不施肥               | 施肥后');
console.log('             |            |         | 周期/轮数/24h经验     | 周期/轮数/24h经验/肥料数');
console.log('-------------|------------|---------|----------------------|------------------------');

for (const r of results) {
    console.log(
        `${r.name.padEnd(12)} | ${formatTime(r.growTime).padEnd(10)} | ${String(r.expPerHarvest).padStart(7)} | ` +
        `${formatTime(r.cycleNoFert).padEnd(8)}/${String(r.cyclesNoFert).padStart(5)}轮/${String(r.totalExpNoFert).padStart(7)} | ` +
        `${formatTime(r.cycleFert).padEnd(8)}/${String(r.cyclesFert).padStart(5)}轮/${String(r.totalExpFert).padStart(7)}/${String(r.fertCount).padStart(5)}个`
    );
}

console.log('');
console.log('=============================================');
console.log('');

// 最优方案（按24h总经验排序）
const bestFert = [...results].sort((a, b) => b.totalExpFert - a.totalExpFert)[0];
const bestNoFert = [...results].sort((a, b) => b.totalExpNoFert - a.totalExpNoFert)[0];

console.log('【最优方案】');
console.log('');
console.log(`🥇 施肥最佳: ${bestFert.name}`);
console.log(`   成熟时间: ${formatTime(bestFert.growTime)} → 施肥后 ${formatTime(bestFert.growTimeFert)}`);
console.log(`   每轮周期: ${formatTime(bestFert.cycleFert)}`);
console.log(`   24小时轮数: ${bestFert.cyclesFert} 轮`);
console.log(`   24小时经验: ${bestFert.totalExpFert}`);
console.log(`   消耗肥料: ${bestFert.fertCount} 个`);
console.log('');

console.log(`🥈 不施肥最佳: ${bestNoFert.name}`);
console.log(`   成熟时间: ${formatTime(bestNoFert.growTime)}`);
console.log(`   每轮周期: ${formatTime(bestNoFert.cycleNoFert)}`);
console.log(`   24小时轮数: ${bestNoFert.cyclesNoFert} 轮`);
console.log(`   24小时经验: ${bestNoFert.totalExpNoFert}`);
console.log('');

const diff = bestFert.totalExpFert - bestNoFert.totalExpNoFert;
const diffPercent = (diff / bestNoFert.totalExpNoFert * 100).toFixed(1);
console.log(`📊 施肥比不施肥多 ${diff} 经验 (+${diffPercent}%)`);
console.log('');
console.log('=============================================');
console.log('');
console.log('【结论】');
console.log('');
console.log(`24小时内最快升级选择: ${bestFert.name} + 施肥`);
console.log(`可获得 ${bestFert.totalExpFert} 经验，需要每 ${formatTime(bestFert.cycleFert)} 操作一次`);
console.log(`消耗肥料 ${bestFert.fertCount} 个`);
console.log('');
