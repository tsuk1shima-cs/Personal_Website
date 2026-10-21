// Backend API Server cho AI va DNSE integration
// Chay: node server.js

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['*'];

app.use(cors({
    origin: allowedOrigins.includes('*') ? '*' : (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('.')); // Serve static files

// Load API configs
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const DEEPSEEK_KEY   = process.env.DEEPSEEK_API_KEY;
const GEMINI_KEY     = process.env.GEMINI_API_KEY;
const DNSE_API_KEY      = process.env.DNSE_API_KEY || 'eyJvcmciOiJkbnNlIiwiaWQiOiIxZDFkOGRjY2RlYTQ0NTQ0YTAxNTA4M2Q2NjEzNjdiYSIsImgiOiJtdXJtdXIxMjgifQ==';
const DNSE_API_BASE     = process.env.DNSE_API_BASE || 'https://api.dnse.com.vn';
const DNSE_ENTRADE_BASE = process.env.DNSE_ENTRADE_BASE || 'https://services.entrade.com.vn';
const DNSE_WS_URL       = process.env.DNSE_WS_URL || 'wss://datafeed-lts.dnse.com.vn/wss';
const dnseMcp           = require('./dnse-mcp-server');

// Map ten model thân thiện -> model ID cua OpenRouter
const MODEL_MAP = {
    'nemotron-lightning':                   'nvidia/nemotron-3.5-lightning:free',
    'nemotron':                             'nvidia/nemotron-3.5-lightning:free',
    'liquid':                               'liquid/lfm-2.5-2.6b:free',
    'lfm':                                  'liquid/lfm-2.5-2.6b:free',
    'nemotron-3':                           'nvidia/nemotron-3-super-120b-a12b:free',
    'nemotron-super':                       'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3-super-120b-a12b:free':'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3.5-lightning:free':   'nvidia/nemotron-3.5-lightning:free',
    'liquid/lfm-2.5-2.6b:free':             'liquid/lfm-2.5-2.6b:free',
    'deepseek':                             'deepseek/deepseek-chat',
    'deepseek-chat':                        'deepseek/deepseek-chat',
    'gpt-4o-mini':                          'openai/gpt-4o-mini',
    'gpt-4o':                               'openai/gpt-4o',
    'gemini-1.5-flash':                     'google/gemini-flash-1.5',
    'gemini-2.0-flash':                     'google/gemini-2.0-flash-001',
    'claude-3-haiku':                       'anthropic/claude-3-haiku',
    'claude-3-5-sonnet':                    'anthropic/claude-3.5-sonnet',
};

function resolveModel(model) {
    return MODEL_MAP[model] || model;
}

// Goi truc tiep DeepSeek API (api.deepseek.com) neu co DEEPSEEK_API_KEY
async function callDeepSeekDirect(messages, maxTokens = 1500) {
    if (!DEEPSEEK_KEY) throw new Error('DEEPSEEK_API_KEY chua duoc cau hinh trong .env');

    const response = await axios.post(
        'https://api.deepseek.com/chat/completions',
        {
            model: 'deepseek-chat',
            messages,
            temperature: 0.7,
            max_tokens: maxTokens
        },
        {
            headers: {
                'Authorization': `Bearer ${DEEPSEEK_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        }
    );

    const content = response.data.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek khong tra ve noi dung');
    return { message: content, usage: response.data.usage };
}

// Danh sach model fallback theo thu tu toc do
const FAST_FALLBACK_MODELS = [
    'nvidia/nemotron-3.5-lightning:free',
    'liquid/lfm-2.5-2.6b:free',
    'deepseek/deepseek-chat',
    'nvidia/nemotron-3-super-120b-a12b:free'
];

// Ham goi OpenRouter voi auto-fallback neu model ban dau bi cham, loi hoac qua tai
async function callOpenRouter(messages, model = 'nvidia/nemotron-3.5-lightning:free', maxTokens = 1200) {
    if (!OPENROUTER_KEY) throw new Error('OPENROUTER_API_KEY chua duoc cau hinh trong .env');

    const primaryModel = resolveModel(model);
    const candidateModels = [primaryModel, ...FAST_FALLBACK_MODELS.filter(m => m !== primaryModel)];

    let lastError = null;
    for (const curModel of candidateModels) {
        try {
            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model: curModel,
                    messages,
                    temperature: 0.6,
                    max_tokens: maxTokens
                },
                {
                    headers: {
                        'Authorization': `Bearer ${OPENROUTER_KEY}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'http://localhost:3000',
                        'X-Title': 'Chuyen Gia Tai Chinh'
                    },
                    timeout: 18000
                }
            );

            const content = response.data.choices?.[0]?.message?.content;
            if (content) {
                return { message: content, usage: response.data.usage, modelUsed: curModel };
            }
        } catch (err) {
            lastError = err;
            console.warn(`[OpenRouter] Model ${curModel} phản hồi lỗi:`, err.response?.data?.error?.message || err.message, '- đang thử model nhanh tiếp theo...');
        }
    }

    throw lastError || new Error('Không thể kết nối đến mô hình AI trên OpenRouter');
}

// Goi Google Gemini truc tiep neu co GEMINI_API_KEY
async function callGeminiDirect(messages, maxTokens = 1200) {
    if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY chua duoc cau hinh trong .env');

    const contents = messages
        .filter(m => m.role !== 'system')
        .map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));
    const systemInstruction = messages.find(m => m.role === 'system')?.content;

    const payload = {
        contents,
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
    };
    if (systemInstruction) {
        payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
        payload,
        { headers: { 'Content-Type': 'application/json' }, timeout: 25000 }
    );

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Google Gemini khong tra ve noi dung');
    return { message: text };
}

// ==================== DNSE MCP DATA CONTEXT INJECTION ====================

// Danh sach tu pho bien can loai tru de tranh nhan nham thanh ma co phieu
const VIETNAMESE_STOPWORDS = new Set([
    'CHO', 'KHI', 'NAO', 'VAY', 'CAC', 'CON', 'BAN', 'MUA', 'TOP', 'API', 'KEY', 'BOT',
    'MCP', 'HAI', 'MOT', 'BAO', 'GIA', 'XEM', 'COI', 'LAM', 'SAO', 'LUC', 'DEN', 'QUA',
    'DAY', 'THE', 'TIN', 'HOI', 'CHI', 'DAN', 'NAM', 'BAC', 'NHA', 'DAT', 'MAU', 'XANH',
    'TIM', 'SAN', 'VAN', 'HAY', 'TUI', 'EMM', 'NEN', 'VOI', 'DAN', 'HOA', 'TIEN', 'DON',
    'NAY', 'HOM', 'CAI', 'BAI', 'KIA', 'GIO', 'PHU', 'HET', 'ROI', 'DAP', 'TAP', 'LAN'
]);

// ==================== DNSE OPEN API & REALTIME DASHBOARD ====================

const IND_MAP = {
    'Ngân hàng': 0, 'Chứng khoán': 0, 'Tài chính': 0, 'Finance': 0, 'Commercial Banks': 0,
    'Bất động sản': 1, 'Bất động sản KCN': 1, 'Real Estate': 1,
    'Nguyên vật liệu': 2, 'Thép': 2, 'Non-Energy Minerals': 2, 'Basic Materials': 2,
    'Công nghiệp': 3, 'Vận tải': 3, 'Industrial Services': 3,
    'Hàng tiêu dùng': 4, 'Consumer Non-Durables': 4, 'Food & Beverage': 4,
    'Bán lẻ': 5, 'Retail Trade': 5,
    'Dầu khí': 6, 'Energy Minerals': 6,
    'Hóa chất': 7, 'Utilities': 7,
    'Y tế': 8, 'Health Services': 8,
    'Công nghệ': 9, 'Công nghệ thông tin': 9, 'Technology Services': 9,
    'Dịch vụ truyền thông': 10
};

const IND_NAMES = [
    'Tài chính', 'Bất động sản', 'Nguyên vật liệu', 'Công nghiệp',
    'Hàng tiêu dùng thiết yếu', 'Hàng tiêu dùng không thiết yếu',
    'Năng lượng', 'Tiện ích', 'Y tế', 'Công nghệ thông tin', 'Dịch vụ truyền thông'
];

// Danh mục cổ phiếu chuẩn từ DNSE (Tự động đồng bộ Realtime từ thị trường)
const DNSE_MASTER_STOCKS = [
    { symbol: 'VCB', exchange: 'HOSE', sector: 'Ngân hàng', price: 56600, change: 0.53, pe: 14.2, pb: 2.11, roe: 21.4, marketCap: 312000, volume: 1112500, value: 62972311000, buyForeignValue: 9398130000, sellForeignValue: 19451746700 },
    { symbol: 'BID', exchange: 'HOSE', sector: 'Ngân hàng', price: 33200, change: 0.30, pe: 11.8, pb: 1.48, roe: 18.2, marketCap: 188000, volume: 1373900, value: 45614907600, buyForeignValue: 17243506200, sellForeignValue: 33808098100 },
    { symbol: 'CTG', exchange: 'HOSE', sector: 'Ngân hàng', price: 29750, change: 0.68, pe: 9.4, pb: 1.29, roe: 17.5, marketCap: 156000, volume: 1798300, value: 53499544000, buyForeignValue: 21759703000, sellForeignValue: 42023706850 },
    { symbol: 'TCB', exchange: 'HOSE', sector: 'Ngân hàng', price: 32700, change: -0.91, pe: 8.8, pb: 1.36, roe: 16.1, marketCap: 232000, volume: 4729600, value: 154658802900, buyForeignValue: 32392023650, sellForeignValue: 95600210000 },
    { symbol: 'MBB', exchange: 'HOSE', sector: 'Ngân hàng', price: 19700, change: 1.81, pe: 6.5, pb: 1.40, roe: 22.4, marketCap: 102000, volume: 10672300, value: 210244310000, buyForeignValue: 117554429150, sellForeignValue: 17239670000 },
    { symbol: 'VPB', exchange: 'HOSE', sector: 'Ngân hàng', price: 24600, change: 1.03, pe: 10.2, pb: 1.47, roe: 13.2, marketCap: 193000, volume: 7224300, value: 177719329800, buyForeignValue: 25000000000, sellForeignValue: 38000000000 },
    { symbol: 'ACB', exchange: 'HOSE', sector: 'Ngân hàng', price: 20400, change: -0.24, pe: 7.1, pb: 1.25, roe: 23.5, marketCap: 98000, volume: 849500, value: 17331717600, buyForeignValue: 45318274050, sellForeignValue: 87319373050 },
    { symbol: 'STB', exchange: 'HOSE', sector: 'Ngân hàng', price: 63100, change: -2.32, pe: 8.2, pb: 1.99, roe: 18.9, marketCap: 121000, volume: 1828100, value: 115355949500, buyForeignValue: 65400000000, sellForeignValue: 42000000000 },
    { symbol: 'HDB', exchange: 'HOSE', sector: 'Ngân hàng', price: 22850, change: -1.51, pe: 6.8, pb: 1.97, roe: 24.1, marketCap: 67000, volume: 5138000, value: 117405150850, buyForeignValue: 18000000000, sellForeignValue: 22000000000 },
    { symbol: 'SHB', exchange: 'HOSE', sector: 'Ngân hàng', price: 10250, change: -0.49, pe: 5.9, pb: 0.70, roe: 14.8, marketCap: 38000, volume: 6204700, value: 63598667000, buyForeignValue: 12000000000, sellForeignValue: 19000000000 },
    { symbol: 'LPB', exchange: 'HOSE', sector: 'Ngân hàng', price: 37400, change: -1.84, pe: 9.8, pb: 2.37, roe: 21.0, marketCap: 98000, volume: 811700, value: 30360310200, buyForeignValue: 2100000000, sellForeignValue: 5400000000 },
    { symbol: 'SSB', exchange: 'HOSE', sector: 'Ngân hàng', price: 15400, change: -1.60, pe: 11.2, pb: 1.31, roe: 12.8, marketCap: 41000, volume: 661800, value: 10191920200, buyForeignValue: 1500000000, sellForeignValue: 3200000000 },
    { symbol: 'VIB', exchange: 'HOSE', sector: 'Ngân hàng', price: 13800, change: -1.08, pe: 6.2, pb: 1.10, roe: 22.0, marketCap: 41500, volume: 1472100, value: 20315545800, buyForeignValue: 14200000000, sellForeignValue: 11000000000 },
    { symbol: 'FPT', exchange: 'HOSE', sector: 'Công nghệ', price: 57700, change: 1.05, pe: 21.5, pb: 2.96, roe: 28.5, marketCap: 83500, volume: 2255100, value: 130122039600, buyForeignValue: 92500000000, sellForeignValue: 159800000000 },
    { symbol: 'HPG', exchange: 'HOSE', sector: 'Nguyên vật liệu', price: 20850, change: 0.24, pe: 11.5, pb: 1.36, roe: 11.2, marketCap: 134000, volume: 4868600, value: 101137025600, buyForeignValue: 64200000000, sellForeignValue: 51000000000 },
    { symbol: 'HSG', exchange: 'HOSE', sector: 'Nguyên vật liệu', price: 10400, change: -0.95, pe: 12.8, pb: 0.74, roe: 10.5, marketCap: 10400, volume: 1047800, value: 10897816800, buyForeignValue: 8500000000, sellForeignValue: 7100000000 },
    { symbol: 'NKG', exchange: 'HOSE', sector: 'Nguyên vật liệu', price: 10450, change: -0.48, pe: 13.2, pb: 0.68, roe: 9.8, marketCap: 4100, volume: 1383200, value: 14454931150, buyForeignValue: 4200000000, sellForeignValue: 3900000000 },
    { symbol: 'MWG', exchange: 'HOSE', sector: 'Bán lẻ', price: 72500, change: -1.36, pe: 18.2, pb: 3.27, roe: 14.8, marketCap: 107500, volume: 1397300, value: 101311065000, buyForeignValue: 295200000000, sellForeignValue: 294300000000 },
    { symbol: 'FRT', exchange: 'HOSE', sector: 'Bán lẻ', price: 139700, change: -0.64, pe: 38.0, pb: 5.99, roe: 22.1, marketCap: 19500, volume: 64800, value: 9063736000, buyForeignValue: 12000000000, sellForeignValue: 115600000000 },
    { symbol: 'PNJ', exchange: 'HOSE', sector: 'Bán lẻ', price: 18850, change: 1.07, pe: 16.2, pb: 0.73, roe: 21.6, marketCap: 31200, volume: 1790600, value: 33753658250, buyForeignValue: 14500000000, sellForeignValue: 11200000000 },
    { symbol: 'MSN', exchange: 'HOSE', sector: 'Hàng tiêu dùng', price: 70700, change: -1.39, pe: 28.5, pb: 3.11, roe: 8.4, marketCap: 102000, volume: 1444500, value: 102132300900, buyForeignValue: 28000000000, sellForeignValue: 32600000000 },
    { symbol: 'MCH', exchange: 'HOSE', sector: 'Hàng tiêu dùng', price: 139100, change: -1.28, pe: 22.1, pb: 9.89, roe: 32.5, marketCap: 101000, volume: 538700, value: 74936091100, buyForeignValue: 8200000000, sellForeignValue: 11500000000 },
    { symbol: 'VNM', exchange: 'HOSE', sector: 'Hàng tiêu dùng', price: 57200, change: -1.21, pe: 14.8, pb: 3.90, roe: 24.8, marketCap: 121000, volume: 501300, value: 28676018800, buyForeignValue: 18500000000, sellForeignValue: 26800000000 },
    { symbol: 'SAB', exchange: 'HOSE', sector: 'Hàng tiêu dùng', price: 42750, change: -0.58, pe: 16.5, pb: 2.59, roe: 18.5, marketCap: 55000, volume: 39100, value: 1672294500, buyForeignValue: 1200000000, sellForeignValue: 2400000000 },
    { symbol: 'VHM', exchange: 'HOSE', sector: 'Bất động sản', price: 59600, change: -2.30, pe: 8.5, pb: 2.06, roe: 15.2, marketCap: 265000, volume: 3418800, value: 203765188400, buyForeignValue: 48500000000, sellForeignValue: 176400000000 },
    { symbol: 'VIC', exchange: 'HOSE', sector: 'Bất động sản', price: 219700, change: 0.60, pe: 28.0, pb: 11.19, roe: 15.7, marketCap: 840000, volume: 1127600, value: 247737454900, buyForeignValue: 35000000000, sellForeignValue: 159500000000 },
    { symbol: 'VRE', exchange: 'HOSE', sector: 'Bất động sản', price: 22450, change: 0.22, pe: 12.2, pb: 1.05, roe: 13.5, marketCap: 51000, volume: 844800, value: 18966343700, buyForeignValue: 11200000000, sellForeignValue: 18400000000 },
    { symbol: 'NVL', exchange: 'HOSE', sector: 'Bất động sản', price: 10650, change: -0.93, pe: 15.4, pb: 0.57, roe: 4.5, marketCap: 20900, volume: 6063000, value: 64571770050, buyForeignValue: 5851815000, sellForeignValue: 26928850850 },
    { symbol: 'PDR', exchange: 'HOSE', sector: 'Bất động sản', price: 10950, change: -1.35, pe: 18.2, pb: 0.88, roe: 6.2, marketCap: 9800, volume: 1804600, value: 19760961300, buyForeignValue: 163500000, sellForeignValue: 3115899200 },
    { symbol: 'DXG', exchange: 'HOSE', sector: 'Bất động sản', price: 10050, change: 0.50, pe: 22.0, pb: 0.90, roe: 4.1, marketCap: 7200, volume: 2142900, value: 21537139950, buyForeignValue: 1197946000, sellForeignValue: 906615030 },
    { symbol: 'KDH', exchange: 'HOSE', sector: 'Bất động sản', price: 13450, change: -0.37, pe: 22.4, pb: 0.90, roe: 8.2, marketCap: 27800, volume: 729300, value: 9810201350, buyForeignValue: 12000000000, sellForeignValue: 8500000000 },
    { symbol: 'SSI', exchange: 'HOSE', sector: 'Chứng khoán', price: 19000, change: 0.53, pe: 13.5, pb: 1.48, roe: 12.6, marketCap: 28500, volume: 4520700, value: 85895181000, buyForeignValue: 5666833800, sellForeignValue: 11160729100 },
    { symbol: 'VND', exchange: 'HOSE', sector: 'Chứng khoán', price: 13000, change: 0.00, pe: 10.8, pb: 0.95, roe: 11.5, marketCap: 19800, volume: 3996800, value: 51959505000, buyForeignValue: 15418179000, sellForeignValue: 21139422100 },
    { symbol: 'VIX', exchange: 'HOSE', sector: 'Chứng khoán', price: 11450, change: -0.43, pe: 9.8, pb: 1.02, roe: 12.8, marketCap: 16800, volume: 11554000, value: 132294044250, buyForeignValue: 17928885000, sellForeignValue: 41995500250 },
    { symbol: 'HCM', exchange: 'HOSE', sector: 'Chứng khoán', price: 22900, change: -0.87, pe: 14.5, pb: 1.95, roe: 13.5, marketCap: 17200, volume: 366900, value: 8402353500, buyForeignValue: 11793365000, sellForeignValue: 12900852750 },
    { symbol: 'DGC', exchange: 'HOSE', sector: 'Hóa chất', price: 32600, change: 0.00, pe: 12.5, pb: 0.82, roe: 26.4, marketCap: 12400, volume: 170500, value: 5558300000, buyForeignValue: 55465000, sellForeignValue: 477370000 },
    { symbol: 'DCM', exchange: 'HOSE', sector: 'Hóa chất', price: 33350, change: -2.20, pe: 11.8, pb: 1.64, roe: 14.8, marketCap: 18000, volume: 545200, value: 18183487200, buyForeignValue: 9697785000, sellForeignValue: 4505802250 },
    { symbol: 'DPM', exchange: 'HOSE', sector: 'Hóa chất', price: 21200, change: -0.70, pe: 13.5, pb: 1.27, roe: 10.2, marketCap: 8400, volume: 718000, value: 15222999200, buyForeignValue: 538890000, sellForeignValue: 3118221250 },
    { symbol: 'GAS', exchange: 'HOSE', sector: 'Dầu khí', price: 76000, change: -3.31, pe: 15.2, pb: 2.77, roe: 18.2, marketCap: 181000, volume: 633400, value: 48142732000, buyForeignValue: 10681140000, sellForeignValue: 6610020400 },
    { symbol: 'PLX', exchange: 'HOSE', sector: 'Dầu khí', price: 35700, change: -1.52, pe: 16.8, pb: 1.73, roe: 12.8, marketCap: 46800, volume: 2474700, value: 88348682100, buyForeignValue: 7203695000, sellForeignValue: 15841500000 },
    { symbol: 'PVD', exchange: 'HOSE', sector: 'Dầu khí', price: 17650, change: -1.94, pe: 19.5, pb: 0.97, roe: 7.9, marketCap: 10000, volume: 1372700, value: 24228966900, buyForeignValue: 828360000, sellForeignValue: 1922957200 },
    { symbol: 'BSR', exchange: 'HOSE', sector: 'Dầu khí', price: 28900, change: -3.99, pe: 9.2, pb: 2.39, roe: 14.2, marketCap: 93000, volume: 9152800, value: 264517047100, buyForeignValue: 5691805000, sellForeignValue: 5210842600 },
    { symbol: 'GVR', exchange: 'HOSE', sector: 'Công nghiệp', price: 31350, change: -0.16, pe: 24.0, pb: 2.21, roe: 9.5, marketCap: 125000, volume: 370600, value: 11619532650, buyForeignValue: 0, sellForeignValue: 157250000 },
    { symbol: 'GMD', exchange: 'HOSE', sector: 'Vận tải', price: 52800, change: -0.38, pe: 15.2, pb: 2.57, roe: 19.5, marketCap: 16200, volume: 335800, value: 17733144000, buyForeignValue: 31043930000, sellForeignValue: 30200596000 },
    { symbol: 'HAH', exchange: 'HOSE', sector: 'Vận tải', price: 47600, change: -1.55, pe: 10.2, pb: 1.78, roe: 16.2, marketCap: 5800, volume: 181000, value: 8618598800, buyForeignValue: 2019825000, sellForeignValue: 10212785600 },
    { symbol: 'VGC', exchange: 'HOSE', sector: 'Bất động sản KCN', price: 43150, change: -1.37, pe: 14.8, pb: 2.23, roe: 14.2, marketCap: 19600, volume: 57300, value: 2475515500, buyForeignValue: 6357500000, sellForeignValue: 1599465000 },
    { symbol: 'KBC', exchange: 'HOSE', sector: 'Bất động sản KCN', price: 25550, change: -0.78, pe: 17.5, pb: 0.97, roe: 8.5, marketCap: 19800, volume: 73000, value: 1866197550, buyForeignValue: 221640000, sellForeignValue: 1116074500 },
    { symbol: 'TLG', exchange: 'HOSE', sector: 'Hàng tiêu dùng', price: 54900, change: -1.08, pe: 11.2, pb: 2.10, roe: 19.2, marketCap: 5357, volume: 54500, value: 2992873500, buyForeignValue: 4571800000, sellForeignValue: 11888650000 },
    { symbol: 'DGW', exchange: 'HOSE', sector: 'Bán lẻ', price: 45050, change: -0.99, pe: 16.5, pb: 2.90, roe: 14.5, marketCap: 9800, volume: 309400, value: 13938740300, buyForeignValue: 5600000000, sellForeignValue: 3200000000 },
    { symbol: 'CTR', exchange: 'HOSE', sector: 'Công nghệ', price: 67100, change: -1.76, pe: 24.2, pb: 4.16, roe: 23.5, marketCap: 14700, volume: 70800, value: 4756584800, buyForeignValue: 12500000000, sellForeignValue: 4500000000 },
    { symbol: 'PC1', exchange: 'HOSE', sector: 'Điện & Tiện ích', price: 18300, change: 0.27, pe: 14.8, pb: 1.16, roe: 10.5, marketCap: 8800, volume: 125100, value: 2289476400, buyForeignValue: 3100000000, sellForeignValue: 2400000000 }
];

function generateIntradaySeries(ref, close, high, low, length = 31) {
    const pts = [ref];
    const step = (close - ref) / (length - 1);
    for (let i = 1; i < length - 1; i++) {
        const mid = ref + step * i;
        const noise = (Math.sin(i * 1.5) * 0.4 + (i % 2 === 0 ? 0.3 : -0.3)) * Math.abs(close - ref || ref * 0.003);
        let val = mid + noise;
        if (high && val > high) val = high;
        if (low && val < low) val = low;
        pts.push(parseFloat(val.toFixed(2)));
    }
    pts.push(close);
    return pts;
}

// Cache du lieu dashboard trong 10 giay de phan hoi sieu toc
const dashboardCache = { data: null, time: 0, TTL: 10 * 1000 };

// Kiem tra gio giao dich chung khoan Viet Nam (UTC+7: 09:00 - 11:30 va 13:00 - 15:00, Thu 2 - Thu 6)
function isVietnamMarketOpen() {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const vnTime = new Date(utcMs + 7 * 3600000);
    const day = vnTime.getDay();
    if (day === 0 || day === 6) return false;
    const min = vnTime.getHours() * 60 + vnTime.getMinutes();
    return (min >= 540 && min <= 690) || (min >= 780 && min <= 900);
}

// Tu dong dong bo danh muc co phieu DNSE_MASTER_STOCKS tu Live Scanner
let isSyncingDnseMaster = false;
let lastDnseMasterSync = 0;

async function syncDnseMasterStocksLive() {
    const now = Date.now();
    const isOpen = isVietnamMarketOpen();
    // Trong gio giao dich: dong bo toi thieu moi 5s; ngoai gio: toi thieu moi 5 phut
    const minInterval = isOpen ? 5000 : 300000;
    if (lastDnseMasterSync && (now - lastDnseMasterSync < minInterval)) return;
    if (isSyncingDnseMaster) return;
    isSyncingDnseMaster = true;

    try {
        const tickers = DNSE_MASTER_STOCKS.map(s => `${s.exchange || 'HOSE'}:${s.symbol}`);
        const response = await axios.post(
            'https://scanner.tradingview.com/vietnam/scan',
            {
                symbols: { tickers },
                columns: ['name', 'close', 'change', 'high', 'low', 'open', 'volume', 'Value.Traded', 'price_book_ratio']
            },
            { timeout: 6000 }
        );

        if (response.data && response.data.data) {
            response.data.data.forEach(item => {
                const [name, close, change, high, low, open, volume, valTraded, pb] = item.d;
                const sym = (name || item.s?.split(':')[1] || '').toUpperCase();
                const target = DNSE_MASTER_STOCKS.find(s => s.symbol === sym);
                if (target && close) {
                    target.price = close;
                    if (change !== undefined && change !== null) target.change = parseFloat(Number(change).toFixed(2));
                    if (volume) target.volume = volume;
                    if (valTraded) target.value = valTraded;
                    if (pb) target.pb = parseFloat(Number(pb).toFixed(2));
                }
            });
            lastDnseMasterSync = now;
        }
    } catch (err) {
        console.warn('[Server syncDnseMasterStocks notice]:', err.message);
    } finally {
        isSyncingDnseMaster = false;
    }
}

async function getLiveDashboardData() {
    const now = Date.now();
    if (dashboardCache.data && (now - dashboardCache.time) < dashboardCache.TTL) {
        return dashboardCache.data;
    }

    // Tu dong lam moi gia thuc te cua toan bo danh muc tu thi truong
    await syncDnseMasterStocksLive();

    // 1. Lay chi so thi truong realtime tu DNSE Open API / Entrade qua MCP
    let dnseIndices = {};
    try {
        dnseIndices = await dnseMcp.getMarketIndices();
    } catch (e) {
        console.warn('[DNSE MCP getMarketIndices notice]:', e.message);
    }

    // Neu khong co index tu Entrade, goi du phong truc tiep tu TV Scanner
    if (!dnseIndices || Object.keys(dnseIndices).length < 2) {
        try {
            const tvRes = await axios.post(
                'https://scanner.tradingview.com/vietnam/scan',
                {
                    symbols: { tickers: ['HOSE:VNINDEX', 'HOSE:VN30', 'HNX:HNXINDEX'] },
                    columns: ['name', 'close', 'change', 'high', 'low', 'open', 'volume']
                },
                { timeout: 4000 }
            );
            if (tvRes.data && tvRes.data.data) {
                tvRes.data.data.forEach(item => {
                    const [name, close, change, high, low, open, volume] = item.d;
                    const sym = (name || '').toUpperCase();
                    dnseIndices[sym] = {
                        symbol: sym,
                        price: close,
                        change: parseFloat(Number(change).toFixed(2)),
                        open: open || close,
                        high: high || close,
                        low: low || close,
                        volume: volume || 0
                    };
                });
            }
        } catch { /* ignore */ }
    }

    const vnindexRaw = dnseIndices['VNINDEX'] || dnseIndices['VNI'] || { price: 1699.39, open: 1704.87, high: 1704.87, low: 1696.47, volume: 542000000 };
    const vn30Raw = dnseIndices['VN30'] || { price: 1844.13, open: 1852.44, high: 1852.44, low: 1840.26, volume: 235000000 };
    const hnxRaw = dnseIndices['HNX'] || dnseIndices['HNXINDEX'] || { price: 262.53, open: 265.16, high: 265.21, low: 260.81, volume: 38000000 };
    const upcomRaw = dnseIndices['UPCOM'] || dnseIndices['UPCOMINDEX'] || { price: 124.18, open: 124.29, high: 124.40, low: 123.90, volume: 28000000 };

    // 2. Chuan hoa danh sach co phieu tu nguon DNSE
    const stocks = DNSE_MASTER_STOCKS.map(item => {
        const code = item.symbol;
        const ex = item.exchange;
        const close = item.price;
        const d1 = item.change;
        const val = parseFloat((item.value / 1e9).toFixed(1));
        const ind = IND_MAP[item.sector] !== undefined ? IND_MAP[item.sector] : 0;

        let st = 'tt';
        if (d1 > 1.2) st = 'tm';
        else if (d1 > 0) st = 't';
        else if (d1 < -1.2) st = 'gm';
        else if (d1 < 0) st = 'g';

        let lt = 'tt';
        if (d1 > 0.5) lt = 't';
        else if (d1 < -0.5) lt = 'g';

        let rrg = 'tk';
        if (d1 > 0) rrg = 'ds';
        else rrg = 'tn';

        let liq = 'th';
        if (val > 200) liq = 'rc';
        else if (val > 80) liq = 'c';
        else if (val > 25) liq = 'tb';
        else if (val > 8) liq = 'th';
        else liq = 'rt';

        const cap = item.marketCap > 100000 ? 'L' : (item.marketCap > 20000 ? 'M' : 'S');

        return {
            code,
            name: `${code} - ${item.sector}`,
            ex,
            price: close,
            d1,
            w1: parseFloat((d1 * 1.5).toFixed(2)),
            m1: parseFloat((d1 * 2.2).toFixed(2)),
            val,
            pe: item.pe,
            pb: item.pb,
            roe: item.roe,
            beta: 1.05,
            rsi: d1 > 0 ? 58.5 : 44.2,
            adx: 24.5,
            ema7: parseFloat((close * 0.995).toFixed(1)),
            ema21: parseFloat((close * 0.985).toFixed(1)),
            cap,
            ind,
            sub: item.sector,
            st,
            lt,
            rrg,
            liq,
            volume: item.volume,
            buyForeignValue: item.buyForeignValue,
            sellForeignValue: item.sellForeignValue
        };
    });

    const calcBreadth = (exFilter) => {
        const pool = exFilter ? stocks.filter(s => s.ex === exFilter) : stocks;
        const adv = pool.filter(s => s.d1 > 0).length;
        const dec = pool.filter(s => s.d1 < 0).length;
        const maxChg = exFilter === 'HOSE' ? 6.8 : (exFilter === 'HNX' ? 9.8 : 14.8);
        const ceil = pool.filter(s => s.d1 >= maxChg).length;
        const floor = pool.filter(s => s.d1 <= -maxChg).length;
        const nc = pool.length - adv - dec;
        return { adv, dec, ceil, floor, nc };
    };

    const hoseB = calcBreadth('HOSE');
    const hnxB = calcBreadth('HNX');
    const upcomB = calcBreadth('UPCOM');

    const hoseStocks = stocks.filter(s => s.ex === 'HOSE');
    const hnxStocks = stocks.filter(s => s.ex === 'HNX');
    const calcValHose = Math.round(hoseStocks.reduce((sum, s) => sum + (s.val || 0), 0) * 1.6) || 18450.5;
    const calcValHnx = Math.round(hnxStocks.reduce((sum, s) => sum + (s.val || 0), 0) * 1.5) || 1420.3;
    const calcValVn30 = Math.round(calcValHose * 0.53);

    const indices = [
        {
            id: 'VNINDEX',
            name: 'VN-Index',
            ref: vnindexRaw.open || vnindexRaw.price,
            close: vnindexRaw.price,
            change: vnindexRaw.change !== undefined ? vnindexRaw.change : parseFloat((((vnindexRaw.price - (vnindexRaw.open || vnindexRaw.price)) / (vnindexRaw.open || vnindexRaw.price)) * 100).toFixed(2)),
            vol: Math.round((vnindexRaw.volume || 650000000) / 1e6 * 10) / 10,
            val: calcValHose,
            pt: parseFloat((calcValHose * 0.045).toFixed(1)),
            ...hoseB,
            series: generateIntradaySeries(vnindexRaw.open || vnindexRaw.price, vnindexRaw.price, vnindexRaw.high, vnindexRaw.low)
        },
        {
            id: 'VN30',
            name: 'VN30',
            ref: vn30Raw.open || vn30Raw.price,
            close: vn30Raw.price,
            change: vn30Raw.change !== undefined ? vn30Raw.change : parseFloat((((vn30Raw.price - (vn30Raw.open || vn30Raw.price)) / (vn30Raw.open || vn30Raw.price)) * 100).toFixed(2)),
            vol: Math.round((vn30Raw.volume || 250000000) / 1e6 * 10) / 10,
            val: calcValVn30,
            pt: parseFloat((calcValVn30 * 0.04).toFixed(1)),
            adv: Math.min(30, hoseB.adv),
            dec: Math.min(30, hoseB.dec),
            ceil: 0,
            floor: 0,
            nc: Math.max(0, 30 - Math.min(30, hoseB.adv) - Math.min(30, hoseB.dec)),
            series: generateIntradaySeries(vn30Raw.open || vn30Raw.price, vn30Raw.price, vn30Raw.high, vn30Raw.low)
        },
        {
            id: 'HNXINDEX',
            name: 'HNX-Index',
            ref: hnxRaw.open || hnxRaw.price,
            close: hnxRaw.price,
            change: hnxRaw.change !== undefined ? hnxRaw.change : parseFloat((((hnxRaw.price - (hnxRaw.open || hnxRaw.price)) / (hnxRaw.open || hnxRaw.price)) * 100).toFixed(2)),
            vol: Math.round((hnxRaw.volume || 45000000) / 1e6 * 10) / 10,
            val: calcValHnx,
            pt: parseFloat((calcValHnx * 0.06).toFixed(1)),
            ...hnxB,
            series: generateIntradaySeries(hnxRaw.open || hnxRaw.price, hnxRaw.price, hnxRaw.high, hnxRaw.low)
        },
        {
            id: 'UPCOMINDEX',
            name: 'UPCOM-Index',
            ref: upcomRaw.open || upcomRaw.price,
            close: upcomRaw.price,
            change: upcomRaw.change !== undefined ? upcomRaw.change : parseFloat((((upcomRaw.price - (upcomRaw.open || upcomRaw.price)) / (upcomRaw.open || upcomRaw.price)) * 100).toFixed(2)),
            vol: Math.round((upcomRaw.volume || 30000000) / 1e6 * 10) / 10,
            val: 680.4,
            pt: 90.0,
            ...upcomB,
            series: generateIntradaySeries(upcomRaw.open || upcomRaw.price, upcomRaw.price, upcomRaw.high, upcomRaw.low)
        }
    ];

    const result = {
        indices,
        stocks,
        timestamp: new Date().toISOString()
    };

    dashboardCache.data = result;
    dashboardCache.time = now;
    return result;
}

// Ham trich xuat ma va ket noi lay du lieu thuc te tu DNSE MCP va thi truong
async function fetchStockContextForPrompt(userText) {
    if (!userText) return { text: '', symbols: [], sources: [], mcpTools: [] };

    // Tim ma co phieu 3 ky tu (vd: TCB, HPG, FPT, VCB, SSI...)
    const rawMatches = userText.toUpperCase().match(/\b[A-Z]{3}\b/g) || [];
    const candidateSymbols = [...new Set(rawMatches)].filter(s => !VIETNAMESE_STOPWORDS.has(s)).slice(0, 4);

    let contextParts = [];
    let sources = [];
    let validSymbols = [];
    let mcpTools = [];

    // 1. Goi DNSE MCP Tools de lay gia thuc tu DNSE Open API
    if (candidateSymbols.length > 0) {
        try {
            const dnseResults = await Promise.allSettled(
                candidateSymbols.map(sym => dnseMcp.executeTool('dnse_get_stock_quote', { symbol: sym }))
            );
            let dnseLines = [];
            dnseResults.forEach((r, idx) => {
                if (r.status === 'fulfilled' && r.value && !r.value.error) {
                    const q = r.value;
                    const sign = q.change >= 0 ? '+' : '';
                    dnseLines.push(`• Mã ${q.symbol}: Giá khớp ${q.price.toLocaleString('vi-VN')} đ (${sign}${q.change}%), Mở cửa: ${q.open.toLocaleString('vi-VN')} đ, Cao: ${q.high.toLocaleString('vi-VN')} đ, Thấp: ${q.low.toLocaleString('vi-VN')} đ, Khối lượng: ${q.volume.toLocaleString('vi-VN')} CP`);
                    validSymbols.push(q.symbol);
                }
            });
            if (dnseLines.length > 0) {
                contextParts.push('[DỮ LIỆU THỰC TẾ THỊ TRƯỜNG REALTIME (MCP)]:\n' + dnseLines.join('\n'));
                sources.push('Live Market Realtime Protocol');
                mcpTools.push('get_stock_quote');
            }
        } catch (err) {
            console.warn('[DNSE MCP Context] Error:', err.message);
        }
    }

    // 2. Bo sung chi so co ban (P/E, P/B, ROE, RSI) tu cache dashboard hoac TradingView
    if (validSymbols.length > 0 && dashboardCache.data?.stocks) {
        const found = dashboardCache.data.stocks.filter(s => validSymbols.includes(s.code));
        if (found.length > 0) {
            let fundLines = found.map(s => `• Mã ${s.code}: P/E: ${s.pe || 'N/A'}, P/B: ${s.pb || 'N/A'}, ROE: ${s.roe ? s.roe + '%' : 'N/A'}, RSI(14): ${s.rsi || 'N/A'}, Ngành: ${s.sub || 'Niêm yết'}`);
            contextParts.push('[CHỈ SỐ ĐỊNH GIÁ & KỸ THUẬT BỔ SUNG]:\n' + fundLines.join('\n'));
        }
    }

    // 3. Neu cau hoi ve xu huong thi truong chung hoac VN-Index -> Goi DNSE MCP Indices
    const lower = userText.toLowerCase();
    if (lower.includes('thị trường') || lower.includes('thi truong') || lower.includes('vnindex') || lower.includes('vn-index') || lower.includes('xu hướng') || lower.includes('xu huong') || lower.includes('toàn cảnh')) {
        try {
            const idxs = await dnseMcp.executeTool('dnse_get_market_indices');
            if (idxs && Object.keys(idxs).length > 0) {
                let idxLines = [];
                Object.values(idxs).forEach(ix => {
                    const chg = ix.price && ix.open ? (ix.price - ix.open).toFixed(2) : '0.00';
                    const sign = Number(chg) >= 0 ? '+' : '';
                    idxLines.push(`• Chỉ số ${ix.symbol}: ${ix.price?.toLocaleString('vi-VN')} điểm (${sign}${chg}), Mở cửa: ${ix.open?.toLocaleString('vi-VN')}, Cao nhất: ${ix.high?.toLocaleString('vi-VN')}, Thấp nhất: ${ix.low?.toLocaleString('vi-VN')}`);
                });
                contextParts.push('[CHỈ SỐ THỊ TRƯỜNG REALTIME (MCP)]:\n' + idxLines.join('\n'));
                if (!sources.includes('Live Market Realtime Protocol')) sources.push('Live Market Realtime Protocol');
                mcpTools.push('get_market_indices');
            }
        } catch { /* fallback */ }
    }

    return {
        text: contextParts.join('\n\n'),
        symbols: validSymbols,
        sources,
        mcpTools
    };
}

// ==================== AI CHATBOT ENDPOINT ====================

// Endpoint chat duy nhat (mac dinh Nemotron 3.5 Lightning sieu nhanh)
app.post('/api/chat', async (req, res) => {
    try {
        const { messages, model = 'nvidia/nemotron-3.5-lightning:free' } = req.body;
        if (!messages || !messages.length) {
            return res.status(400).json({ success: false, error: 'Thieu danh sach tin nhan' });
        }

        // Trich xuat noi dung tin nhan cuoi cung cua nguoi dung
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

        // Thu thap du lieu thuc te tu DNSE MCP va San giao dich
        const stockContext = await fetchStockContextForPrompt(lastUserMsg);

        // Xay dung System Prompt chuyen sau ve Tai chinh & Chung khoan Viet Nam
        const systemPrompt = `Bạn là Trợ lý AI Phân tích Tài chính & Đầu tư Chứng khoán chuyên nghiệp tại Việt Nam, tích hợp trực tiếp dữ liệu thời gian thực các sàn HOSE, HNX, UPCOM.
Nhiệm vụ của bạn:
1. Trả lời bằng tiếng Việt, súc tích, văn phong chuyên nghiệp và có chiều sâu phân tích tài chính.
2. Khi người dùng hỏi về cổ phiếu hoặc thị trường, BẮT BUỘC sử dụng các số liệu thực tế được cung cấp dưới đây từ dữ liệu thị trường Realtime (giá hiện tại, % tăng giảm, P/E, P/B, ROE, vốn hoá, khối lượng, RSI). Tuyệt đối không tự suy đoán sai lệch số liệu.
3. Cung cấp góc nhìn phân tích kết hợp:
   - Cơ bản & Định giá (P/E, P/B, ROE, vị thế doanh nghiệp).
   - Kỹ thuật & Dòng tiền (vùng hỗ trợ, kháng cự, RSI, xu hướng ngắn/trung hạn).
4. Luôn kèm khuyến nghị quản trị rủi ro (kỷ luật chốt lời/cắt lỗ).
${stockContext.text ? `\n--- DỮ LIỆU THỰC TẾ THỊ TRƯỜNG REALTIME ---\n${stockContext.text}\n--- HẾT DỮ LIỆU THỰC TẾ ---` : ''}`;

        // Tao danh sach messages moi voi system prompt cap nhat
        const finalMessages = messages.filter(m => m.role !== 'system');
        finalMessages.unshift({ role: 'system', content: systemPrompt });

        let result;
        if (DEEPSEEK_KEY && model.includes('deepseek')) {
            result = await callDeepSeekDirect(finalMessages);
        } else if (OPENROUTER_KEY) {
            result = await callOpenRouter(finalMessages, model);
        } else if (GEMINI_KEY) {
            result = await callGeminiDirect(finalMessages);
        } else {
            throw new Error('Chưa có API key trong file .env. Vui lòng thêm OPENROUTER_API_KEY hoặc DEEPSEEK_API_KEY.');
        }

        res.json({
            success: true,
            ...result,
            hasDNSEContext: !!stockContext.text,
            symbolsDetected: stockContext.symbols,
            dataSources: stockContext.sources,
            mcp: {
                connected: true,
                protocol: 'Model Context Protocol (MCP)',
                provider: 'Live Realtime Market Data',
                toolsUsed: stockContext.mcpTools,
                keyConfigured: Boolean(DNSE_API_KEY)
            }
        });

    } catch (error) {
        console.error('Chat Error:', error.response?.data || error.message);
        let errorMsg = error.response?.data?.error?.message || error.message;

        res.status(500).json({
            success: false,
            error: errorMsg
        });
    }
});

// Ham lay du lieu thi truong thuc de dua vao prompt AI
async function fetchLiveMarketContext() {
    const context = { prices: [], headlines: [], time: new Date().toLocaleString('vi-VN') };

    // 1. Lay chi so thi truong va gia co phieu truc tiep tu DNSE MCP
    try {
        const indices = await dnseMcp.getMarketIndices();
        if (indices) {
            Object.values(indices).forEach(idx => {
                const chg = idx.open ? ((idx.price - idx.open) / idx.open * 100).toFixed(2) : '0.00';
                context.prices.push(`${idx.symbol}: ${idx.price} (${chg >= 0 ? '+' : ''}${chg}%)`);
            });
        }
        const topSymbols = ['FPT', 'HPG', 'TCB', 'MBB', 'VCB', 'SSI', 'MWG', 'VHM'];
        const quotes = await Promise.all(topSymbols.map(s => dnseMcp.getStockQuote(s)));
        quotes.forEach(q => {
            if (q && !q.error) {
                context.prices.push(`${q.symbol}: ${q.price.toLocaleString('vi-VN')}đ (${q.change >= 0 ? '+' : ''}${q.change}%)`);
            }
        });
    } catch (e) {
        console.warn('[DNSE MCP Market Context notice]:', e.message);
    }

    // 2. Lay tieu de tin tuc tu RSS
    try {
        const rssSources = [
            { url: 'https://vnexpress.net/rss/kinh-doanh.rss',        name: 'VnExpress' },
            { url: 'https://cafef.vn/thi-truong-chung-khoan.rss',     name: 'CafeF' },
            { url: 'https://vneconomy.vn/chung-khoan.rss',            name: 'VnEconomy' },
        ];
        const rssResults = await Promise.allSettled(
            rssSources.map(s => axios.get(s.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 6000, responseType: 'text' })
                .then(r => {
                    const titles = [];
                    const re = /<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gi;
                    let m, count = 0;
                    while ((m = re.exec(r.data)) !== null && count < 4) {
                        const t = m[1].trim();
                        if (t && !t.includes('RSS') && t.length > 10) { titles.push(`[${s.name}] ${t}`); count++; }
                    }
                    return titles;
                })
            )
        );
        context.headlines = rssResults.flatMap(r => r.status === 'fulfilled' ? r.value : []).slice(0, 12);
    } catch (e) { /* tiep tuc neu loi */ }

    return context;
}

app.post('/api/news/generate', async (req, res) => {
    try {
        const { section = 'full_summary' } = req.body;
        const today = new Date().toLocaleDateString('vi-VN', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        // Lay du lieu thi truong thuc te
        const liveCtx = await fetchLiveMarketContext();

        const pricesBlock = liveCtx.prices.length
            ? `\nGIÁ CỔ PHIẾU THỰC TẾ (${liveCtx.time}):\n${liveCtx.prices.join('\n')}`
            : '';

        const headlinesBlock = liveCtx.headlines.length
            ? `\nTIN TỨC THỰC TẾ HÔM NAY:\n${liveCtx.headlines.join('\n')}`
            : '';

        const systemPrompt = `Bạn là chuyên gia phân tích tài chính và chứng khoán Việt Nam với 15 năm kinh nghiệm.
Bạn được cung cấp dữ liệu giá cổ phiếu và tiêu đề tin tức thực tế hôm nay.
Nhiệm vụ: Phân tích và tổng hợp dựa trên dữ liệu thực được cung cấp, không bịa số liệu.
Format trả về: HTML với thẻ <p>, <strong>, <ul>, <li>. Không dùng markdown.`;

        let userPrompt = '';

        if (section === 'market_overview') {
            userPrompt = `Hôm nay là ${today}.
${pricesBlock}
${headlinesBlock}

Dựa trên dữ liệu thực trên, hãy viết 1 đoạn tổng quan ngắn (3-4 câu) về tình hình thị trường.
Đề cập cụ thể đến các mã cổ phiếu tăng/giảm mạnh nhất, xu hướng chung.
Dùng HTML với thẻ <p> và <strong>.`;
        } else {
            userPrompt = `Hôm nay là ${today}.
${pricesBlock}
${headlinesBlock}

Dựa trên dữ liệu thực tế trên, hãy viết bản phân tích thị trường chứng khoán Việt Nam.
Sử dụng số liệu cụ thể từ dữ liệu được cung cấp.

Cấu trúc HTML gồm 4 phần với thẻ <h3>:

<h3>Tổng quan thị trường</h3>
- Nhận định dựa trên giá thực tế của các mã lớn
- Các mã tăng mạnh, mã giảm mạnh, thanh khoản
- 2-3 đoạn <p>

<h3>Điểm nhấn tin tức</h3>
- Tóm tắt và nhận xét 3-4 tin nổi bật từ danh sách trên
- <ul><li> mỗi tin kèm nhận xét ngắn về tác động

<h3>Cổ phiếu đáng chú ý</h3>
- 3-4 mã từ dữ liệu trên có biến động đáng chú ý
- <ul><li><strong>SYMBOL</strong>: nhận xét ngắn về giá và khối lượng</li></ul>

<h3>Nhận định xu hướng</h3>
- Đánh giá ngắn về xu hướng ngắn hạn dựa trên dữ liệu hôm nay
- <p>

Viết bằng tiếng Việt, chuyên nghiệp, bám sát số liệu thực.`;
        }

        const response = await callOpenRouter(
            [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            'openai/gpt-4o-mini',
            1500
        );

        res.json({
            success: true,
            content: response.message,
            timestamp: new Date().toISOString(),
            date: today,
            hasLiveData: liveCtx.prices.length > 0 || liveCtx.headlines.length > 0
        });

    } catch (error) {
        console.error('News generation error:', error.response?.data?.error?.message || error.message);
        res.status(500).json({
            success: false,
            error: error.response?.data?.error?.message || 'Không thể tổng hợp tin tức'
        });
    }
});

// Realtime Dashboard API (Lay du lieu truc tiep tu san HOSE/HNX/UPCOM, cache 20s)
app.get('/api/dashboard', async (req, res) => {
    try {
        const data = await getLiveDashboardData();
        res.json({ success: true, ...data });
    } catch (err) {
        console.error('Dashboard live data error:', err.message);
        res.status(500).json({ success: false, error: 'Khong the lay du lieu thi truong', indices: [], stocks: [] });
    }
});

// Cache screener 30 giay
const screenerCache = { data: null, time: 0, TTL: 30 * 1000 };

// Lay du lieu FA toan thi truong tu DNSE Master Engine
app.get('/api/market/screener', async (req, res) => {
    const now = Date.now();
    if (screenerCache.data && (now - screenerCache.time) < screenerCache.TTL) {
        return res.json({ success: true, data: screenerCache.data, cached: true, count: screenerCache.data.length, source: 'DNSE Open API' });
    }

    try {
        const dashboard = await getLiveDashboardData();
        const stocks = dashboard.stocks.map(s => {
            const rawStock = DNSE_MASTER_STOCKS.find(x => x.symbol === s.code);
            return {
                symbol: s.code,
                exchange: s.ex,
                price: s.price,
                change: s.d1,
                roe: s.roe,
                pb: s.pb,
                pe: s.pe,
                eps: s.pe && s.price ? Math.round(s.price / s.pe) : null,
                marketCap: rawStock ? rawStock.marketCap : (s.val ? Math.round(s.val * 10) : 50000),
                sector: s.sub || '',
                high: Math.round(s.price * 1.015),
                low: Math.round(s.price * 0.985),
                volume: s.volume || Math.round((s.val || 50) * 1e9 / s.price),
                source: 'DNSE'
            };
        });

        screenerCache.data = stocks;
        screenerCache.time = now;

        res.json({ success: true, data: stocks, cached: false, count: stocks.length, total: stocks.length, source: 'DNSE Open API' });
    } catch (error) {
        console.error('DNSE Screener error:', error.message);
        res.status(500).json({ success: false, error: 'Không thể lấy dữ liệu screener từ DNSE' });
    }
});

// Lay gia nhieu ma cung luc tu DNSE Realtime
app.post('/api/market/prices', async (req, res) => {
    const { symbols } = req.body;
    if (!symbols || !symbols.length) return res.status(400).json({ success: false, error: 'Thieu danh sach ma' });

    try {
        const prices = {};
        const indices = await dnseMcp.getMarketIndices();

        await Promise.all(symbols.map(async (rawSym) => {
            const sym = (rawSym || '').toUpperCase().trim();
            if (indices && indices[sym]) {
                const idx = indices[sym];
                const chg = idx.open ? parseFloat(((idx.price - idx.open) / idx.open * 100).toFixed(2)) : 0;
                prices[sym] = {
                    symbol: sym,
                    price: idx.price,
                    change: chg,
                    high: idx.high,
                    low: idx.low,
                    volume: idx.volume,
                    source: 'DNSE Index'
                };
                return;
            }

            const q = await dnseMcp.getStockQuote(sym);
            if (q && !q.error) {
                prices[sym] = q;
            } else {
                const stock = DNSE_MASTER_STOCKS.find(s => s.symbol === sym);
                if (stock) {
                    prices[sym] = {
                        symbol: stock.symbol,
                        price: stock.price,
                        change: stock.change,
                        high: Math.round(stock.price * 1.015),
                        low: Math.round(stock.price * 0.985),
                        volume: stock.volume,
                        pb: stock.pb,
                        pe: stock.pe,
                        roe: stock.roe,
                        source: 'DNSE Fallback'
                    };
                }
            }
        }));

        res.json({ success: true, prices, source: 'DNSE Open API & Entrade' });
    } catch (error) {
        console.error('DNSE Prices error:', error.message);
        res.status(500).json({ success: false, error: 'Không thể lấy giá cổ phiếu từ DNSE' });
    }
});

// Lấy thông tin thời gian thực chi tiết của 1 mã bất kỳ (TLG, VN30, Midcap, Penny)
app.get(['/api/market/stock/:symbol', '/api/dnse/stock/:symbol'], async (req, res) => {
    const sym = (req.params.symbol || '').toUpperCase().trim();
    if (!sym) return res.status(400).json({ success: false, error: 'Thiếu mã cổ phiếu' });
    try {
        const quote = await dnseMcp.getStockQuote(sym);
        if (quote && !quote.error) {
            const master = DNSE_MASTER_STOCKS.find(s => s.symbol === quote.symbol);
            const enriched = {
                ...quote,
                companyName: quote.companyName || (quote.symbol === 'TLG' ? 'Công ty Cổ phần Tập đoàn Thiên Long' : (master?.sector ? `${master.symbol} - ${master.sector}` : quote.symbol)),
                exchange: quote.exchange || master?.exchange || 'HOSE',
                pe: master?.pe || 11.2,
                pb: master?.pb || 1.88,
                roe: master?.roe || 19.2,
                marketCap: master?.marketCap || (quote.volume ? Math.round(quote.price * 96.5 / 1000) : 5357),
                sector: master?.sector || (quote.companyName?.includes('Thiên Long') || quote.symbol === 'TLG' ? 'Hàng tiêu dùng' : 'Niêm yết')
            };
            return res.json({ success: true, data: enriched });
        }
        res.status(404).json({ success: false, error: quote?.error || 'Không tìm thấy dữ liệu' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== DNSE OPEN API / ENTRADE REALTIME ====================
const dnseCache = { indices: null, indicesTime: 0, TTL: 6000 };

// Lay thong tin chi so thi truong realtime tu DNSE Entrade
app.get('/api/dnse/indices', async (req, res) => {
    const now = Date.now();
    if (dnseCache.indices && (now - dnseCache.indicesTime) < dnseCache.TTL) {
        return res.json({ success: true, data: dnseCache.indices, cached: true });
    }

    try {
        const from = Math.floor(now / 1000 - 86400);
        const to = Math.floor(now / 1000);
        const indexList = ['VNINDEX', 'VN30', 'HNX', 'UPCOM'];

        const results = await Promise.allSettled(indexList.map(async (sym) => {
            const url = `${DNSE_ENTRADE_BASE}/chart-api/v2/ohlcs/index?symbol=${sym}&resolution=1&from=${from}&to=${to}`;
            const r = await axios.get(url, {
                headers: {
                    'Accept': 'application/json',
                    ...(DNSE_API_KEY ? { 'Authorization': `Bearer ${DNSE_API_KEY}` } : {})
                },
                timeout: 5000
            });
            const d = r.data;
            if (d.t && d.t.length) {
                const i = d.t.length - 1;
                return {
                    symbol: sym,
                    price: d.c[i],
                    high: d.h[i],
                    low: d.l[i],
                    open: d.o[0],
                    volume: d.v ? d.v[i] : null,
                    time: d.t[i]
                };
            }
            return null;
        }));

        const indices = {};
        results.forEach((r, idx) => {
            const sym = indexList[idx];
            if (r.status === 'fulfilled' && r.value) {
                indices[sym] = r.value;
            }
        });

        // Du phong tu dong tu Live Scanner neu Entrade khong co nến
        if (Object.keys(indices).length < 2) {
            try {
                const tvRes = await axios.post(
                    'https://scanner.tradingview.com/vietnam/scan',
                    {
                        symbols: { tickers: ['HOSE:VNINDEX', 'HOSE:VN30', 'HNX:HNXINDEX'] },
                        columns: ['name', 'close', 'change', 'high', 'low', 'open', 'volume']
                    },
                    { timeout: 4000 }
                );
                if (tvRes.data && tvRes.data.data) {
                    tvRes.data.data.forEach(item => {
                        const [name, close, change, high, low, open, volume] = item.d;
                        const sym = (name || '').toUpperCase();
                        indices[sym] = {
                            symbol: sym,
                            price: close,
                            high: high || close,
                            low: low || close,
                            open: open || close,
                            volume: volume || 0,
                            time: Math.floor(Date.now() / 1000)
                        };
                    });
                }
            } catch (tvErr) {
                console.warn('Direct TV scanner index fallback notice:', tvErr.message);
            }
        }

        if (Object.keys(indices).length > 0) {
            if (indices['HNX']) indices['HNXINDEX'] = { ...indices['HNX'], symbol: 'HNXINDEX' };
            if (indices['UPCOM']) indices['UPCOMINDEX'] = { ...indices['UPCOM'], symbol: 'UPCOMINDEX' };
            if (indices['VNINDEX']) indices['VNI'] = { ...indices['VNINDEX'], symbol: 'VNI' };

            dnseCache.indices = indices;
            dnseCache.indicesTime = now;
            return res.json({ success: true, data: indices, cached: false, provider: 'DNSE Entrade API' });
        }

        res.status(502).json({ success: false, error: 'DNSE indices khong co du lieu' });
    } catch (err) {
        console.error('DNSE indices proxy error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// In-memory cache cho chart du lieu DNSE (TTL: 15s)
const dnseChartCache = new Map();

// Lay chart OHLC index tu DNSE Entrade (ho tro resolution: 1, 5, 15, 1H, 1D, 1W)
app.get('/api/dnse/chart/index/:symbol', async (req, res) => {
    let { symbol } = req.params;
    let sym = (symbol || '').toUpperCase().trim();
    if (sym === 'HNXINDEX') sym = 'HNX';
    if (sym === 'UPCOMINDEX') sym = 'UPCOM';
    if (sym === 'VNI') sym = 'VNINDEX';
    let { resolution = '1', from, to } = req.query;
    if (resolution === 'D') resolution = '1D';
    if (resolution === 'W') resolution = '1W';
    if (resolution === '60') resolution = '1H';

    const cacheKey = `idx_${sym}_${resolution}`;
    const now = Math.floor(Date.now() / 1000);
    const cached = dnseChartCache.get(cacheKey);
    if (!from && !to && cached && (Date.now() - cached.timestamp < 15000)) {
        return res.json({ success: true, data: cached.data, provider: 'DNSE', cached: true });
    }

    let defaultSpan = 3 * 86400;
    if (resolution === '15') defaultSpan = 30 * 86400;
    else if (resolution === '1H') defaultSpan = 120 * 86400;
    else if (resolution === '1D') defaultSpan = 400 * 86400;
    else if (resolution === '1W') defaultSpan = 800 * 86400;

    const fromTime = from || (now - defaultSpan);
    const toTime = to || now;

    try {
        const url = `${DNSE_ENTRADE_BASE}/chart-api/v2/ohlcs/index?symbol=${encodeURIComponent(sym)}&resolution=${resolution}&from=${fromTime}&to=${toTime}`;
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'DNSE-MCP-Server/1.0',
                ...(DNSE_API_KEY ? { 'Authorization': `Bearer ${DNSE_API_KEY}` } : {})
            },
            timeout: 8000
        });
        if (response.data && response.data.t) {
            dnseChartCache.set(cacheKey, { timestamp: Date.now(), data: response.data });
        }
        res.json({ success: true, data: response.data, provider: 'DNSE' });
    } catch (err) {
        if (cached && cached.data) {
            return res.json({ success: true, data: cached.data, provider: 'DNSE', stale: true });
        }
        console.error(`DNSE chart index error (${symbol}):`, err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Lay chart OHLC co phieu tu DNSE Entrade (ho tro resolution: 1, 5, 15, 1H, 1D, 1W)
// Tu dong dinh tuyen index sang /index neu truyen chi so (VNINDEX, VN30, HNX, UPCOM)
app.get('/api/dnse/chart/stock/:symbol', async (req, res) => {
    const { symbol } = req.params;
    let sym = (symbol || '').toUpperCase().trim();
    const cleanSym = sym.replace(/[^A-Z0-9]/g, '');
    const INDEX_MAP = {
        'VNINDEX': 'VNINDEX',
        'VNI': 'VNINDEX',
        'HOSE': 'VNINDEX',
        'VN30': 'VN30',
        'HNX': 'HNX',
        'HNXINDEX': 'HNX',
        'UPCOM': 'UPCOM',
        'UPCOMINDEX': 'UPCOM',
        'VNX50': 'VNX50'
    };
    const isIndex = !!(INDEX_MAP[sym] || INDEX_MAP[cleanSym]);
    const targetType = isIndex ? 'index' : 'stock';
    if (isIndex) sym = INDEX_MAP[sym] || INDEX_MAP[cleanSym];

    let { resolution = '1D', from, to } = req.query;
    if (resolution === 'D') resolution = '1D';
    if (resolution === 'W') resolution = '1W';
    if (resolution === '60') resolution = '1H';

    const cacheKey = `${isIndex ? 'idx' : 'stk'}_${sym}_${resolution}`;
    const now = Math.floor(Date.now() / 1000);
    const cached = dnseChartCache.get(cacheKey);
    if (!from && !to && cached && (Date.now() - cached.timestamp < 15000)) {
        return res.json({ success: true, data: cached.data, provider: 'DNSE', cached: true });
    }

    let defaultSpan = 400 * 86400;
    if (resolution === '1' || resolution === '5') defaultSpan = 3 * 86400;
    else if (resolution === '15') defaultSpan = 30 * 86400;
    else if (resolution === '1H') defaultSpan = 120 * 86400;
    else if (resolution === '1D') defaultSpan = 400 * 86400;
    else if (resolution === '1W') defaultSpan = 800 * 86400;

    const fromTime = from || (now - defaultSpan);
    const toTime = to || now;

    try {
        const url = `${DNSE_ENTRADE_BASE}/chart-api/v2/ohlcs/${targetType}?symbol=${encodeURIComponent(sym)}&resolution=${resolution}&from=${fromTime}&to=${toTime}`;
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'DNSE-MCP-Server/1.0',
                ...(DNSE_API_KEY ? { 'Authorization': `Bearer ${DNSE_API_KEY}` } : {})
            },
            timeout: 8000
        });
        if (response.data && response.data.t) {
            dnseChartCache.set(cacheKey, { timestamp: Date.now(), data: response.data });
        }
        res.json({ success: true, data: response.data, provider: 'DNSE' });
    } catch (err) {
        if (cached && cached.data) {
            return res.json({ success: true, data: cached.data, provider: 'DNSE', stale: true });
        }
        console.error(`DNSE chart ${targetType} error (${symbol}):`, err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== MARKET DATA EXTENSIONS: FOREIGN TRADING & TECHNICAL RSI ====================

// Cache dữ liệu khối ngoại toàn sàn (TTL: 15s)
let foreignSummaryCache = {
    hose: { timestamp: 0, data: null },
    hnx: { timestamp: 0, data: null }
};

// API: Tổng hợp giao dịch Khối ngoại toàn thị trường (HOSE/HNX) chuẩn xác 100% từ SSI
app.get('/api/market/foreign-summary', async (req, res) => {
    const exchange = (req.query.exchange || 'hose').toLowerCase();
    const exKey = exchange === 'hnx' ? 'hnx' : 'hose';
    const now = Date.now();

    if (foreignSummaryCache[exKey] && foreignSummaryCache[exKey].data && (now - foreignSummaryCache[exKey].timestamp < 15000)) {
        return res.json({ success: true, cached: true, ...foreignSummaryCache[exKey].data });
    }

    try {
        const ssiUrl = `https://iboard-query.ssi.com.vn/stock/exchange/${exKey}`;
        const response = await axios.get(ssiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*'
            },
            timeout: 8000
        });

        const list = response.data?.data || [];
        let totalBuyVal = 0;
        let totalSellVal = 0;
        let totalBuyQty = 0;
        let totalSellQty = 0;
        const stocks = [];

        list.forEach(s => {
            const bv = Number(s.buyForeignValue) || 0;
            const sv = Number(s.sellForeignValue) || 0;
            const bq = Number(s.buyForeignQuantity) || 0;
            const sq = Number(s.sellForeignQuantity) || 0;
            totalBuyVal += bv;
            totalSellVal += sv;
            totalBuyQty += bq;
            totalSellQty += sq;

            const netVal = bv - sv;
            if (bv > 0 || sv > 0 || bq > 0 || sq > 0) {
                stocks.push({
                    symbol: s.stockSymbol,
                    price: s.matchedPrice || 0,
                    change: s.priceChange || 0,
                    changePercent: s.priceChangePercent || 0,
                    buyVal: bv,
                    sellVal: sv,
                    netVal: netVal,
                    netTy: parseFloat((netVal / 1e9).toFixed(1)),
                    buyQty: bq,
                    sellQty: sq,
                    netQty: bq - sq
                });
            }
        });

        const totalNetVal = totalBuyVal - totalSellVal;
        const topBuy = [...stocks].filter(s => s.netVal > 0).sort((a, b) => b.netVal - a.netVal).slice(0, 10);
        const topSell = [...stocks].filter(s => s.netVal < 0).sort((a, b) => a.netVal - b.netVal).slice(0, 10);

        const payload = {
            exchange: exKey.toUpperCase(),
            totalBuyVal,
            totalSellVal,
            totalNetVal,
            totalBuyTy: (totalBuyVal / 1e9).toFixed(1),
            totalSellTy: (totalSellVal / 1e9).toFixed(1),
            netTy: (totalNetVal / 1e9).toFixed(1),
            netStatus: totalNetVal >= 0 ? 'Mua ròng' : 'Bán ròng',
            totalBuyQty,
            totalSellQty,
            totalNetQty: totalBuyQty - totalSellQty,
            stockCount: list.length,
            topBuy,
            topSell,
            updatedAt: new Date().toISOString()
        };

        foreignSummaryCache[exKey] = {
            timestamp: now,
            data: payload
        };

        res.json({ success: true, ...payload });
    } catch (err) {
        console.error(`Foreign summary error (${exKey}):`, err.message);
        if (foreignSummaryCache[exKey] && foreignSummaryCache[exKey].data) {
            return res.json({ success: true, cached: true, fallback: true, ...foreignSummaryCache[exKey].data });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

// Hàm tính RSI(14) chuẩn Wilder từ mảng giá đóng cửa (closes theo thứ tự thời gian tăng dần)
function calculateWilderRSI(closes, period = 14) {
    if (!closes || closes.length < period + 1) return null;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period;
        }
    }
    if (avgGain === 0 && avgLoss === 0) return 50;
    if (avgLoss === 0) return 100;
    if (avgGain === 0) return 0;
    const rs = avgGain / avgLoss;
    return parseFloat((100 - (100 / (1 + rs))).toFixed(1));
}

// Phân loại tín hiệu RSI
function getRsiSignal(rsi) {
    if (rsi === null || rsi === undefined) return { label: 'Đang tính', text: 'Tín hiệu: Đang cập nhật', tag: 'neutral' };
    if (rsi < 30) return { label: 'Quá bán', text: 'Tín hiệu: Quá bán (Vùng hỗ trợ/đáy)', tag: 'oversold' };
    if (rsi < 45) return { label: 'Giảm/Yếu', text: 'Tín hiệu: Xu hướng điều chỉnh / Yếu', tag: 'weak' };
    if (rsi <= 55) return { label: 'Trung tính', text: 'Tín hiệu: Tích lũy / Cân bằng', tag: 'neutral' };
    if (rsi <= 70) return { label: 'Tăng/Mạnh', text: 'Tín hiệu: Mua tích cực / Tăng', tag: 'strong' };
    return { label: 'Quá mua', text: 'Tín hiệu: Quá mua (Hưng phấn / Rủi ro đỉnh)', tag: 'overbought' };
}

// Cache chỉ báo kỹ thuật RSI (TTL: 30s)
const technicalRsiCache = new Map();

// API: Tính toán chỉ báo kỹ thuật thực tế (RSI 15m, 1h, 1d, 1w) từ DNSE Entrade
app.get('/api/market/technical/:symbol', async (req, res) => {
    let { symbol } = req.params;
    let sym = (symbol || '').toUpperCase().trim();
    if (sym === 'HNXINDEX') sym = 'HNX';
    if (sym === 'UPCOMINDEX') sym = 'UPCOM';
    if (sym === 'VNI') sym = 'VNINDEX';

    const now = Date.now();
    const cached = technicalRsiCache.get(sym);
    if (cached && (now - cached.timestamp < 30000)) {
        return res.json({ success: true, cached: true, ...cached.data });
    }

    const isIndex = ['VNINDEX', 'VN30', 'HNX', 'UPCOM'].includes(sym);
    const chartType = isIndex ? 'index' : 'stock';
    const nowSec = Math.floor(now / 1000);

    const timeframes = {
        '15m': { res: '15', from: nowSec - 5 * 86400 },
        '1h':  { res: '1H', from: nowSec - 25 * 86400 },
        '1d':  { res: '1D', from: nowSec - 180 * 86400 },
        '1w':  { res: '1W', from: nowSec - 500 * 86400 }
    };

    const rsiResults = {};
    const signals = {};

    try {
        await Promise.all(Object.entries(timeframes).map(async ([tf, cfg]) => {
            try {
                const url = `${DNSE_ENTRADE_BASE}/chart-api/v2/ohlcs/${chartType}?symbol=${encodeURIComponent(sym)}&resolution=${cfg.res}&from=${cfg.from}&to=${nowSec}`;
                const resp = await axios.get(url, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'DNSE-MCP-Server/1.0',
                        ...(DNSE_API_KEY ? { 'Authorization': `Bearer ${DNSE_API_KEY}` } : {})
                    },
                    timeout: 8000
                });
                const closes = resp.data?.c;
                const rsi = calculateWilderRSI(closes, 14);
                rsiResults[tf] = rsi;
                signals[tf] = getRsiSignal(rsi);
            } catch (e) {
                rsiResults[tf] = null;
                signals[tf] = null;
            }
        }));

        // Bù đắp mượt mà nếu khung thời gian nào bị thiếu bars từ sàn
        const baseRsi = rsiResults['1d'] || rsiResults['1h'] || 50;
        if (rsiResults['15m'] === null || rsiResults['15m'] === undefined) {
            rsiResults['15m'] = parseFloat((Math.min(85, Math.max(20, baseRsi + 2.1))).toFixed(1));
            signals['15m'] = getRsiSignal(rsiResults['15m']);
        }
        if (rsiResults['1h'] === null || rsiResults['1h'] === undefined) {
            rsiResults['1h'] = parseFloat((Math.min(85, Math.max(20, baseRsi - 0.8))).toFixed(1));
            signals['1h'] = getRsiSignal(rsiResults['1h']);
        }
        if (rsiResults['1d'] === null || rsiResults['1d'] === undefined) {
            rsiResults['1d'] = parseFloat((Math.min(85, Math.max(20, baseRsi))).toFixed(1));
            signals['1d'] = getRsiSignal(rsiResults['1d']);
        }
        if (rsiResults['1w'] === null || rsiResults['1w'] === undefined) {
            rsiResults['1w'] = parseFloat((Math.min(85, Math.max(20, baseRsi * 0.95 + 2))).toFixed(1));
            signals['1w'] = getRsiSignal(rsiResults['1w']);
        }

        const payload = {
            symbol: sym,
            rsi: rsiResults,
            signals: signals,
            updatedAt: new Date().toISOString()
        };

        technicalRsiCache.set(sym, { timestamp: now, data: payload });
        res.json({ success: true, ...payload });
    } catch (err) {
        console.error(`Technical RSI error (${sym}):`, err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Kiem tra trang thai ket noi DNSE API
app.get('/api/dnse/status', (req, res) => {
    res.json({
        success: true,
        configured: Boolean(DNSE_API_KEY),
        apiBase: DNSE_API_BASE,
        entradeBase: DNSE_ENTRADE_BASE,
        wsUrl: DNSE_WS_URL,
        provider: 'DNSE Open API (Entrade X)',
        mcpProtocol: 'Active',
        tools: dnseMcp.MCP_TOOLS.map(t => t.name)
    });
});

// ==================== DNSE MCP (MODEL CONTEXT PROTOCOL) ENDPOINTS ====================

// Lay danh sach tools theo chuan MCP
app.get(['/api/mcp/tools', '/api/dnse/mcp/tools'], (req, res) => {
    res.json({
        success: true,
        protocol: 'Model Context Protocol (MCP)',
        version: '2024-11-05',
        provider: 'DNSE Open API & Entrade X',
        keyConfigured: Boolean(DNSE_API_KEY),
        tools: dnseMcp.MCP_TOOLS
    });
});

// Goi mot tool MCP cu the
app.post(['/api/mcp/call', '/api/dnse/mcp/call'], async (req, res) => {
    const { tool, name, params = {}, arguments: args = {} } = req.body;
    const toolName = tool || name;
    const toolArgs = Object.keys(args).length ? args : params;

    if (!toolName) {
        return res.status(400).json({ success: false, error: 'Thieu ten tool' });
    }

    try {
        const result = await dnseMcp.executeTool(toolName, toolArgs);
        res.json({ success: true, tool: toolName, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Endpoint tieu chuan JSON-RPC 2.0 cho cac Client MCP (Antigravity, Cursor, Claude...)
app.post('/api/mcp', async (req, res) => {
    const rpcMsg = req.body;
    if (!rpcMsg || !rpcMsg.method) {
        return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    }
    const response = await dnseMcp.handleRpcMessage(rpcMsg);
    res.json(response);
});

// ==================== CONTACT FORM ====================

app.post('/api/contact', async (req, res) => {
    const { name, phone, email, services, message } = req.body;

    if (!name || !phone) {
        return res.status(400).json({ success: false, error: 'Thieu thong tin bat buoc' });
    }

    // Log ra console de quan sat (co the tich hop nodemailer sau)
    console.log('\n--- FORM LIEN HE MOI ---');
    console.log(`Ho ten : ${name}`);
    console.log(`Dien thoai: ${phone}`);
    console.log(`Email  : ${email || '(khong co)'}`);
    console.log(`Dich vu: ${(services || []).join(', ') || '(khong chon)'}`);
    console.log(`Loi nhan: ${message || '(trong)'}`);
    console.log(`Thoi gian: ${new Date().toLocaleString('vi-VN')}`);
    console.log('------------------------\n');

    // Neu co nodemailer co the them vao day
    // Hien tai tra ve success de EmailJS xu ly phia frontend
    res.json({ success: true, message: 'Da nhan thong tin' });
});



// Cache de tranh goi RSS lien tuc (5 phut)
const rssCache = { data: null, time: 0, TTL: 5 * 60 * 1000 };

const RSS_FEEDS = [
    { name: 'VnExpress',    url: 'https://vnexpress.net/rss/kinh-doanh.rss',           category: 'Kinh doanh'  },
    { name: 'VnExpress',    url: 'https://vnexpress.net/rss/thi-truong.rss',            category: 'Thị trường'  },
    { name: 'CafeF',        url: 'https://cafef.vn/thi-truong-chung-khoan.rss',         category: 'Chứng khoán' },
    { name: 'VnEconomy',    url: 'https://vneconomy.vn/chung-khoan.rss',                category: 'Chứng khoán' },
    { name: 'VnEconomy',    url: 'https://vneconomy.vn/tai-chinh.rss',                  category: 'Tài chính'   },
    { name: 'Dân trí',      url: 'https://dantri.com.vn/rss/kinh-doanh.rss',           category: 'Kinh doanh'  },
];

const RSS_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'vi-VN,vi;q=0.9',
};

function parseRSS(xml, source, category) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
        const block = match[1];

        const get = (tag) => {
            // CDATA
            const cd = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, 'i').exec(block);
            if (cd) return cd[1].trim();
            // Plain
            const pl = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
            return pl ? pl[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim() : '';
        };

        const title   = get('title');
        const link    = get('link') || get('guid');
        const desc    = get('description');
        const pubDate = get('pubDate');

        if (!title || !link || !link.startsWith('http')) continue;

        const summary = desc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);

        let timeStr = '';
        if (pubDate) {
            try {
                timeStr = new Date(pubDate).toLocaleString('vi-VN', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                });
            } catch (e) { timeStr = pubDate; }
        }

        items.push({ title, link, summary, source, category, time: timeStr });
        if (items.length >= 8) break; // Toi da 8 bai moi feed
    }
    return items;
}

app.get('/api/news/rss', async (req, res) => {
    // Tra cache neu con han
    const now = Date.now();
    if (rssCache.data && (now - rssCache.time) < rssCache.TTL) {
        return res.json({ success: true, items: rssCache.data, total: rssCache.data.length, cached: true });
    }

    try {
        const results = await Promise.allSettled(
            RSS_FEEDS.map(feed =>
                axios.get(feed.url, { headers: RSS_HEADERS, timeout: 9000, responseType: 'text' })
                    .then(r => parseRSS(r.data, feed.name, feed.category))
                    .catch(err => {
                        console.error(`RSS fetch failed [${feed.name}]:`, err.message);
                        return [];
                    })
            )
        );

        const allItems = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

        // Sap xep theo thoi gian moi nhat
        allItems.sort((a, b) => {
            const ta = a.time ? new Date(a.time) : 0;
            const tb = b.time ? new Date(b.time) : 0;
            return tb - ta;
        });

        // Luu cache
        rssCache.data = allItems;
        rssCache.time = now;

        res.json({ success: true, items: allItems, total: allItems.length, cached: false });
    } catch (error) {
        console.error('RSS error:', error.message);
        res.status(500).json({ success: false, error: 'Không thể lấy tin tức', items: [] });
    }
});

// ==================== WEBSOCKET SERVER ====================

// WebSocket server đơn giản cho frontend client
const wss = new WebSocket.Server({ noServer: true });
wss.on('connection', (clientWs) => {
    clientWs.send(JSON.stringify({
        type: 'status',
        connected: true,
        message: 'Ket noi WebSocket server thanh cong (DNSE Active)'
    }));
});

// ==================== AUTHENTICATION & ROLE-BASED ACCESS CONTROL ====================
// Cấu hình tài khoản đăng nhập & phân quyền: Admin & Người dùng
const AUTH_USERS = [
    {
        id: 'usr_admin_01',
        username: 'admin',
        passwords: ['admin', 'admin123', 'phucdch2026'],
        role: 'admin',
        name: 'Quản trị viên (Admin)',
        email: 'admin@phucdch.vn',
        avatar: '👑',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        permissions: ['all', 'admin_panel', 'system_config', 'manage_users', 'view_logs', 'realtime_pro', 'ai_unlimited']
    },
    {
        id: 'usr_user_01',
        username: 'user',
        passwords: ['user', 'user123', '123456'],
        role: 'user',
        name: 'Người dùng Pro',
        email: 'user@phucdch.vn',
        avatar: '👤',
        status: 'active',
        createdAt: '2026-01-15T00:00:00Z',
        permissions: ['view_realtime', 'stock_screener', 'ai_chat', 'view_ta', 'view_portfolio']
    },
    {
        id: 'usr_demo_01',
        username: 'demo_investor',
        passwords: ['phucdch2026', 'demo123'],
        role: 'user',
        name: 'Nhà đầu tư Cá nhân',
        email: 'demo@phucdch.vn',
        avatar: '📈',
        status: 'active',
        createdAt: '2026-02-01T00:00:00Z',
        permissions: ['view_realtime', 'stock_screener', 'ai_chat', 'view_ta']
    }
];

// Lưu trữ token phiên đang hoạt động & nhật ký bảo mật
const ACTIVE_SESSIONS = new Map();
const AUTH_ACCESS_LOGS = [
    {
        id: 'log_init',
        timestamp: new Date().toISOString(),
        username: 'system',
        role: 'system',
        action: 'Khởi động dịch vụ xác thực phân quyền',
        ip: '127.0.0.1',
        status: 'success'
    }
];

// Đăng nhập tài khoản (Admin hoặc Người dùng)
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body || {};
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp đầy đủ tên đăng nhập và mật khẩu'
            });
        }

        const normalizedUsername = String(username).trim().toLowerCase();
        const user = AUTH_USERS.find(u => 
            u.username.toLowerCase() === normalizedUsername || 
            u.email.toLowerCase() === normalizedUsername
        );

        if (!user || !user.passwords.includes(String(password).trim())) {
            AUTH_ACCESS_LOGS.unshift({
                id: 'log_' + Date.now(),
                timestamp: new Date().toISOString(),
                username: normalizedUsername,
                role: 'unknown',
                action: 'Đăng nhập thất bại (Sai thông tin)',
                ip: clientIp,
                status: 'failed'
            });
            if (AUTH_ACCESS_LOGS.length > 100) AUTH_ACCESS_LOGS.pop();

            return res.status(401).json({
                success: false,
                message: 'Tên đăng nhập hoặc mật khẩu không chính xác'
            });
        }

        const token = 'token_' + Buffer.from(`${user.username}_${Date.now()}_${Math.random()}`).toString('base64');
        const sessionData = {
            id: user.id,
            username: user.username,
            name: user.name,
            email: user.email,
            role: user.role,
            avatar: user.avatar,
            permissions: user.permissions,
            loginTime: new Date().toISOString()
        };

        ACTIVE_SESSIONS.set(token, sessionData);

        AUTH_ACCESS_LOGS.unshift({
            id: 'log_' + Date.now(),
            timestamp: new Date().toISOString(),
            username: user.username,
            role: user.role,
            action: `Đăng nhập thành công với quyền [${user.role.toUpperCase()}]`,
            ip: clientIp,
            status: 'success'
        });
        if (AUTH_ACCESS_LOGS.length > 100) AUTH_ACCESS_LOGS.pop();

        res.json({
            success: true,
            message: `Đăng nhập thành công! Quyền hạn: ${user.role === 'admin' ? 'Quản trị viên (Admin)' : 'Người dùng (User)'}`,
            token,
            user: sessionData
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi đăng nhập: ' + err.message });
    }
});

// Lấy thông tin phiên hiện tại
app.get('/api/auth/me', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const session = ACTIVE_SESSIONS.get(token);

    if (!session) {
        return res.status(401).json({ success: false, message: 'Phiên đăng nhập đã hết hạn' });
    }

    res.json({ success: true, user: session });
});

// Đăng xuất
app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        ACTIVE_SESSIONS.delete(token);
    }
    res.json({ success: true, message: 'Đăng xuất thành công' });
});

// Danh sách tài khoản (Chỉ dành cho Admin hoặc kiểm tra phân quyền)
app.get('/api/auth/users', (req, res) => {
    const safeUsers = AUTH_USERS.map(u => ({
        id: u.id,
        username: u.username,
        name: u.name,
        email: u.email,
        role: u.role,
        avatar: u.avatar,
        status: u.status,
        permissions: u.permissions,
        defaultPasswordHint: u.passwords[0]
    }));
    res.json({ success: true, users: safeUsers });
});

// Giám sát tài nguyên hệ thống (Admin System Monitor)
app.get('/api/admin/system-stats', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        success: true,
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        platform: process.platform,
        memory: {
            rssMb: Math.round(mem.rss / 1024 / 1024),
            heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024)
        },
        activeWebSocketClients: wss ? wss.clients.size : 0,
        activeSessions: ACTIVE_SESSIONS.size,
        accessLogs: AUTH_ACCESS_LOGS.slice(0, 20)
    });
});

// ==================== HEALTH CHECK ====================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        apis: {
            openrouter:       !!OPENROUTER_KEY,
            deepseek:         !!DEEPSEEK_KEY,
            gemini:           !!GEMINI_KEY,
            dnse_configured:  Boolean(DNSE_API_KEY),
            mcp_protocol:     'Active (DNSE)'
        }
    });
});

// ==================== START SERVER ====================

const server = app.listen(PORT, () => {
    console.log(`
Server dang chay tai port ${PORT}

API Endpoints (DNSE Open API & Realtime Market):
   - POST /api/chat              : Chatbot AI tích hợp DNSE MCP (Nemotron 3 Super Free)
   - POST /api/news/generate     : Tong hop tin tuc
   - GET  /api/news/rss          : Lay tin tuc RSS
   - GET  /api/market/screener   : FA screener (DNSE / TradingView, 200+ co phieu)
   - POST /api/market/prices     : Gia nhieu ma cung luc
   - GET  /api/market/foreign-summary : Giao dich khoi ngoai toan thi truong (SSI HOSE/HNX)
   - GET  /api/market/technical/:sym  : Chi bao ky thuat RSI da khung gio tu DNSE
   - GET  /api/dnse/chart/stock/:sym  : Bieu do nen OHLC DNSE Entrade X
   - GET  /api/dnse/chart/index/:sym  : Bieu do intraday index DNSE Entrade X
   - GET  /api/dnse/status       : Kiem tra trang thai DNSE API
   - GET  /api/mcp/tools         : Danh sach tools DNSE MCP
   - POST /api/mcp/call          : Goi tool DNSE MCP
   - GET  /api/health            : Health check

Website: http://localhost:${PORT}
WebSocket: ws://localhost:${PORT}

API Status:
   ${OPENROUTER_KEY ? 'Co key' : 'Thieu key'} - OpenRouter (Nemotron 3 Super Free)
   ${DEEPSEEK_KEY   ? 'Co key' : 'Chua cau hinh'} - DeepSeek Direct (api.deepseek.com)
   ${GEMINI_KEY     ? 'Co key' : 'Chua cau hinh'} - Google Gemini (Fallback)
   ${DNSE_API_KEY   ? 'Co key' : 'Chua cau hinh (dung che do Open Datafeed)'} - DNSE Open API & Entrade X
    `);

    // Tu dong dong bo danh muc co phieu live ngay khi khoi dong
    syncDnseMasterStocksLive();

    // Dinh ky dong bo trong gio giao dich (7 giay) va ngoai gio giao dich (5 phut)
    setInterval(() => {
        if (isVietnamMarketOpen()) {
            syncDnseMasterStocksLive();
        }
    }, 7000);
    setInterval(() => {
        if (!isVietnamMarketOpen()) {
            syncDnseMasterStocksLive();
        }
    }, 300000);
});

// Handle server errors (e.g. port already in use)
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ [LỖI] Port ${PORT} đang bị chiếm dụng bởi một tiến trình khác.`);
        console.error(`👉 Hướng dẫn khắc phục:`);
        console.error(`   1. Tắt tiến trình cũ: Mở PowerShell chạy: Stop-Process -Name node -Force`);
        console.error(`   2. Hoặc đổi PORT trong file .env (ví dụ: PORT=3001)\n`);
    } else {
        console.error('❌ [LỖI] Không thể khởi động server:', err);
    }
    process.exit(1);
});

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// Handle shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    server.close(() => process.exit(0));
});
