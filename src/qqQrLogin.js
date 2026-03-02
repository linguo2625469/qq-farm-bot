const axios = require('axios');
const qrcodeTerminal = require('qrcode-terminal');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const QUA = 'V1_HT5_QDT_0.70.2209190_x64_0_DEV_D';
const FARM_APP_ID = '1112386029';

function getHeaders() {
    return {
        qua: QUA,
        host: 'q.qq.com',
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': CHROME_UA,
    };
}

async function requestLoginCode() {
    const response = await axios.get('https://q.qq.com/ide/devtoolAuth/GetLoginCode', {
        headers: getHeaders(),
    });

    const { code, data } = response.data || {};
    if (+code !== 0 || !data || !data.code) {
        throw new Error('获取QQ扫码登录码失败');
    }

    return {
        loginCode: data.code,
        url: `https://h5.qzone.qq.com/qqq/code/${data.code}?_proxy=1&from=ide`,
    };
}

async function queryScanStatus(loginCode) {
    const response = await axios.get(
        `https://q.qq.com/ide/devtoolAuth/syncScanSateGetTicket?code=${encodeURIComponent(loginCode)}`,
        { headers: getHeaders() }
    );

    if (response.status !== 200) return { status: 'Error' };

    const { code, data } = response.data || {};
    if (+code === 0) {
        if (+data?.ok !== 1) return { status: 'Wait' };
        return { status: 'OK', ticket: data.ticket || '' };
    }
    if (+code === -10003) return { status: 'Used' };
    return { status: 'Error' };
}

async function getAuthCode(ticket) {
    const response = await axios.post(
        'https://q.qq.com/ide/login',
        { appid: FARM_APP_ID, ticket },
        { headers: getHeaders() }
    );

    if (response.status !== 200 || !response.data || !response.data.code) {
        throw new Error('获取农场登录 code 失败');
    }

    return response.data.code;
}

function printQr(url) {
    console.log('');
    console.log('[扫码登录] 请用 QQ 扫描下方二维码确认登录:');
    qrcodeTerminal.generate(url, { small: true });
    console.log(`[扫码登录] 若二维码显示异常，可直接打开链接: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`);
    console.log('');
}

async function getQQFarmCodeByScan(options = {}) {
    const pollIntervalMs = Number(options.pollIntervalMs) > 0 ? Number(options.pollIntervalMs) : 2000;
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 180000;

    const { loginCode, url } = await requestLoginCode();
    printQr(url);

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const status = await queryScanStatus(loginCode);
        if (status.status === 'OK') {
            const authCode = await getAuthCode(status.ticket);
            return authCode;
        }
        if (status.status === 'Used') {
            throw new Error('二维码已失效，请重试');
        }
        if (status.status === 'Error') {
            throw new Error('扫码状态查询失败，请重试');
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error('扫码超时，请重试');
}

module.exports = {
    getQQFarmCodeByScan,
    requestLoginCode,
    queryScanStatus,
    getAuthCode,
};
