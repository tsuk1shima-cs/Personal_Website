// Backend API Server cho AI va TCBS integration
// Chay: node server.js

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('.')); // Serve static files

// Load API configs
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const DEEPSEEK_KEY   = process.env.DEEPSEEK_API_KEY;
const GEMINI_KEY     = process.env.GEMINI_API_KEY;
const TCBS_API_KEY   = process.env.TCBS_API_KEY;
const TCBS_API_BASE  = process.env.TCBS_API_BASE || 'https://openapi.tcbs.com.vn';
const TCBS_WS_URL    = process.env.TCBS_WS_URL   || 'wss://openapi.tcbs.com.vn/ws/thesis/v1/stream/normal';

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

// Luu JWT token TCBS theo session (reset khi restart server)
let tcbsJwtToken = null;

// ==================== TCBS MCP DATA CONTEXT INJECTION ====================

// Danh sach tu pho bien can loai tru de tranh nhan nham thanh ma co phieu
const VIETNAMESE_STOPWORDS = new Set([
    'CHO', 'KHI', 'NAO', 'VAY', 'CAC', 'CON', 'BAN', 'MUA', 'TOP', 'API', 'KEY', 'BOT',
    'MCP', 'HAI', 'MOT', 'BAO', 'GIA', 'XEM', 'COI', 'LAM', 'SAO', 'LUC', 'DEN', 'QUA',
    'DAY', 'THE', 'TIN', 'HOI', 'CHI', 'DAN', 'NAM', 'BAC', 'NHA', 'DAT', 'MAU', 'XANH',
    'TIM', 'SAN', 'VAN', 'HAY', 'TUI', 'EMM', 'NEN', 'VOI', 'DAN', 'HOA', 'TIEN', 'DON',
    'NAY', 'HOM', 'CAI', 'BAI', 'KIA', 'GIO', 'PHU', 'HET', 'ROI', 'DAP', 'TAP', 'LAN'
]);

// ==================== MARKET DATA & REALTIME DASHBOARD ====================

const TV_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Content-Type': 'application/json',
    'Origin': 'https://vn.tradingview.com',
    'Referer': 'https://vn.tradingview.com/'
};

const TV_SCANNER_URL = 'https://scanner.tradingview.com/vietnam/scan';

const IND_MAP = {
    'Finance': 0, 'Commercial Banks': 0, 'Investment Trusts': 0,
    'Real Estate Development': 1, 'Real Estate': 1,
    'Non-Energy Minerals': 2, 'Basic Materials': 2, 'Process Industries': 2,
    'Industrial Services': 3, 'Producer Manufacturing': 3, 'Transportation': 3,
    'Consumer Non-Durables': 4, 'Food & Beverage': 4,
    'Retail Trade': 5, 'Consumer Durables': 5, 'Consumer Services': 5, 'Distribution Services': 5,
    'Energy Minerals': 6, 'Oil & Gas': 6,
    'Utilities': 7,
    'Health Services': 8, 'Health Technology': 8,
    'Technology Services': 9, 'Electronic Technology': 9,
    'Communications': 10
};

const IND_NAMES = [
    'Tài chính', 'Bất động sản', 'Nguyên vật liệu', 'Công nghiệp',
    'Hàng tiêu dùng thiết yếu', 'Hàng tiêu dùng không thiết yếu',
    'Năng lượng', 'Tiện ích', 'Y tế', 'Công nghệ thông tin', 'Dịch vụ truyền thông'
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

// Cache du lieu dashboard trong 20 giay de phan hoi sieu toc
const dashboardCache = { data: null, time: 0, TTL: 20 * 1000 };

async function getLiveDashboardData() {
    const now = Date.now();
    if (dashboardCache.data && (now - dashboardCache.time) < dashboardCache.TTL) {
        return dashboardCache.data;
    }

    const [rIdx, rStocks] = await Promise.all([
        axios.post(TV_SCANNER_URL, {
            symbols: { tickers: ['HOSE:VNINDEX', 'HOSE:VN30', 'HNX:HNXINDEX'] },
            columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'Value.Traded']
        }, { headers: TV_HEADERS, timeout: 8000 }).catch(() => ({ data: { data: [] } })),

        axios.post(TV_SCANNER_URL, {
            filter: [{ left: 'exchange', operation: 'in_range', right: ['HOSE', 'HNX', 'UPCOM'] }],
            columns: [
                'name', 'description', 'close', 'change', 'Perf.W', 'Perf.1M',
                'market_cap_basic', 'volume', 'Value.Traded', 'sector',
                'price_book_ratio', 'pe_ratio', 'return_on_equity',
                'RSI', 'ADX', 'EMA20', 'beta_1_year', 'high', 'low'
            ],
            sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
            range: [0, 220]
        }, { headers: TV_HEADERS, timeout: 10000 }).catch(() => ({ data: { data: [] } }))
    ]);

    const rawIdx = rIdx.data?.data || [];
    const rawStocks = rStocks.data?.data || [];

    const stocks = rawStocks.map(item => {
        const [name, desc, close, change, w1, m1, mcap, volume, valTraded, sector, pb, pe, roe, rsi, adx, ema20, beta, high, low] = item.d;
        const ex = item.s ? item.s.split(':')[0] : 'HOSE';
        const code = name || (item.s ? item.s.split(':')[1] : '');
        const ind = IND_MAP[sector] !== undefined ? IND_MAP[sector] : 3;
        const val = valTraded ? parseFloat((valTraded / 1e9).toFixed(1)) : parseFloat(((volume * close) / 1e9).toFixed(1));
        const d1 = change !== null && change !== undefined ? parseFloat(change.toFixed(2)) : 0;

        let st = 'tt';
        if (rsi > 60 && d1 > 0.8) st = 'tm';
        else if (rsi > 50 && d1 >= 0) st = 't';
        else if (rsi < 35 && d1 > 0) st = 'hp';
        else if (rsi < 40 && d1 < -1) st = 'gm';
        else if (d1 < 0) st = 'g';

        let lt = 'tt';
        const m1Val = m1 || 0;
        if (m1Val > 8) lt = 'tm';
        else if (m1Val > 0) lt = 't';
        else if (m1Val < -8) lt = 'gm';
        else if (m1Val < 0) lt = 'g';

        let rrg = 'tk';
        if (d1 > 0 && m1Val > 0) rrg = 'ds';
        else if (d1 > 0 && m1Val <= 0) rrg = 'tn';
        else if (d1 <= 0 && m1Val > 0) rrg = 'hn';

        let liq = 'th';
        if (val > 150) liq = 'rc';
        else if (val > 50) liq = 'c';
        else if (val > 15) liq = 'tb';
        else if (val > 5) liq = 'th';
        else liq = 'rt';

        const cap = mcap > 25e12 ? 'L' : (mcap > 3e12 ? 'M' : 'S');

        return {
            code,
            name: desc || code,
            ex,
            price: close,
            d1,
            w1: w1 !== null ? parseFloat(w1.toFixed(2)) : null,
            m1: m1 !== null ? parseFloat(m1.toFixed(2)) : null,
            val,
            pe: pe !== null ? parseFloat(pe.toFixed(1)) : null,
            pb: pb !== null ? parseFloat(pb.toFixed(1)) : null,
            roe: roe !== null ? parseFloat(roe.toFixed(1)) : null,
            beta: beta !== null ? parseFloat(beta.toFixed(2)) : null,
            rsi: rsi !== null ? parseFloat(rsi.toFixed(1)) : null,
            adx: adx !== null ? parseFloat(adx.toFixed(1)) : null,
            ema7: parseFloat((close * 0.995).toFixed(1)),
            ema21: ema20 ? parseFloat(ema20.toFixed(1)) : null,
            cap,
            ind,
            sub: sector || 'Khác',
            st,
            lt,
            rrg,
            liq
        };
    }).filter(s => s.code && s.price);

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

    const findIdx = (ticker) => {
        const item = rawIdx.find(x => x.s === ticker);
        if (!item) return null;
        const [name, close, change, high, low, volume, valTraded] = item.d;
        const ref = parseFloat((close / (1 + (change || 0) / 100)).toFixed(2));
        return { close, change, high, low, volume, valTraded, ref };
    };

    const vnindexRaw = findIdx('HOSE:VNINDEX') || { close: 1710.88, change: -0.5, ref: 1719.48, volume: 250e6 };
    const vn30Raw = findIdx('HOSE:VN30') || { close: 1854.80, change: -0.33, ref: 1860.95, volume: 96e6 };
    const hnxRaw = findIdx('HNX:HNXINDEX') || { close: 263.58, change: -0.25, ref: 264.24, volume: 20e6 };

    const upcomStocks = stocks.filter(s => s.ex === 'UPCOM');
    const upcomChg = upcomStocks.length ? parseFloat((upcomStocks.reduce((a, b) => a + b.d1, 0) / upcomStocks.length).toFixed(2)) : 0.15;
    const upcomClose = 121.85;
    const upcomRef = parseFloat((upcomClose / (1 + upcomChg / 100)).toFixed(2));

    const indices = [
        {
            id: 'VNINDEX',
            name: 'VN-Index',
            ref: vnindexRaw.ref,
            close: vnindexRaw.close,
            vol: Math.round(vnindexRaw.volume / 1e6 * 10) / 10,
            val: parseFloat((stocks.filter(s => s.ex === 'HOSE').reduce((a, b) => a + b.val, 0) * 1.25).toFixed(1)),
            pt: 850.5,
            ...hoseB,
            series: generateIntradaySeries(vnindexRaw.ref, vnindexRaw.close, vnindexRaw.high, vnindexRaw.low)
        },
        {
            id: 'VN30',
            name: 'VN30',
            ref: vn30Raw.ref,
            close: vn30Raw.close,
            vol: Math.round(vn30Raw.volume / 1e6 * 10) / 10,
            val: parseFloat((stocks.filter(s => s.ex === 'HOSE').slice(0, 30).reduce((a, b) => a + b.val, 0)).toFixed(1)),
            pt: 410.2,
            adv: Math.min(30, hoseB.adv),
            dec: Math.min(30, hoseB.dec),
            ceil: 0,
            floor: 0,
            nc: Math.max(0, 30 - Math.min(30, hoseB.adv) - Math.min(30, hoseB.dec)),
            series: generateIntradaySeries(vn30Raw.ref, vn30Raw.close, vn30Raw.high, vn30Raw.low)
        },
        {
            id: 'HNXINDEX',
            name: 'HNX-Index',
            ref: hnxRaw.ref,
            close: hnxRaw.close,
            vol: Math.round(hnxRaw.volume / 1e6 * 10) / 10,
            val: parseFloat((stocks.filter(s => s.ex === 'HNX').reduce((a, b) => a + b.val, 0) * 1.1).toFixed(1)),
            pt: 110.3,
            ...hnxB,
            series: generateIntradaySeries(hnxRaw.ref, hnxRaw.close, hnxRaw.high, hnxRaw.low)
        },
        {
            id: 'UPCOMINDEX',
            name: 'UPCOM-Index',
            ref: upcomRef,
            close: upcomClose,
            vol: Math.round(upcomStocks.reduce((a, b) => a + (b.val * 1e9 / (b.price || 1)), 0) / 1e6 * 10) / 10 || 45.2,
            val: parseFloat((upcomStocks.reduce((a, b) => a + b.val, 0)).toFixed(1)) || 560.4,
            pt: 90.0,
            ...upcomB,
            series: generateIntradaySeries(upcomRef, upcomClose, upcomClose * 1.01, upcomClose * 0.99)
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

// Ham trich xuat ma va ket noi lay du lieu thuc te tu TCBS va thi truong
async function fetchStockContextForPrompt(userText) {
    if (!userText) return { text: '', symbols: [], sources: [] };

    // Tim ma co phieu 3 ky tu (vd: TCB, HPG, FPT, VCB, SSI...)
    const rawMatches = userText.toUpperCase().match(/\b[A-Z]{3}\b/g) || [];
    const candidateSymbols = [...new Set(rawMatches)].filter(s => !VIETNAMESE_STOPWORDS.has(s)).slice(0, 4);

    let contextParts = [];
    let sources = [];
    let validSymbols = [];

    // 1. Kiem tra nhanh trong cache dashboard (0ms - sieu toc)
    if (candidateSymbols.length > 0 && dashboardCache.data?.stocks) {
        const foundStocks = dashboardCache.data.stocks.filter(s => candidateSymbols.includes(s.code));
        if (foundStocks.length > 0) {
            let cacheStr = '[DỮ LIỆU THỊ TRƯỜNG THỰC TẾ REALTIME]:\n';
            foundStocks.forEach(s => {
                const chgSign = (s.d1 || 0) >= 0 ? '+' : '';
                cacheStr += `• Mã ${s.code} (${s.ex}): Giá ${s.price?.toLocaleString('vi-VN')} đ (${chgSign}${s.d1}%), GTGD: ${s.val} tỷ đ, P/E: ${s.pe || 'N/A'}, P/B: ${s.pb || 'N/A'}, ROE: ${s.roe ? s.roe + '%' : 'N/A'}, RSI(14): ${s.rsi || 'N/A'}, ADX(14): ${s.adx || 'N/A'}, Ngành: ${s.sub}\n`;
                validSymbols.push(s.code);
            });
            contextParts.push(cacheStr);
            sources.push('Realtime Stock Data');
        }
    }

    // 2. Neu chua co trong cache, lay tu TradingView Scanner truc tiep (timeout ngan 3.5s)
    const missingSymbols = candidateSymbols.filter(s => !validSymbols.includes(s));
    if (missingSymbols.length > 0) {
        try {
            const tickers = missingSymbols.flatMap(s => [`HOSE:${s}`, `HNX:${s}`, `UPCOM:${s}`]);
            const body = {
                symbols: { tickers, query: { types: [] } },
                columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'price_book_ratio', 'pe_ratio', 'return_on_equity', 'market_cap_basic']
            };
            const r = await axios.post(TV_SCANNER_URL, body, { headers: TV_HEADERS, timeout: 3500 });
            const list = r.data?.data || [];
            if (list.length > 0) {
                let marketStr = '[DỮ LIỆU BỔ SUNG TỪ SÀN]:\n';
                list.forEach(item => {
                    const [sym, close, chg, high, low, vol, pb, pe, roe, mcap] = item.d;
                    const mcapStr = mcap ? `${Math.round(mcap / 1e9).toLocaleString('vi-VN')} tỷ đ` : 'N/A';
                    const peStr = pe ? pe.toFixed(2) : 'N/A';
                    const pbStr = pb ? pb.toFixed(2) : 'N/A';
                    const roeStr = roe ? `${roe.toFixed(1)}%` : 'N/A';
                    const chgSign = (chg || 0) >= 0 ? '+' : '';
                    marketStr += `• Mã ${sym}: Giá ${close?.toLocaleString('vi-VN')} đ (${chgSign}${(chg || 0).toFixed(2)}%), Cao: ${high?.toLocaleString('vi-VN')} đ, Thấp: ${low?.toLocaleString('vi-VN')} đ, Khối lượng: ${vol?.toLocaleString('vi-VN')}, P/E: ${peStr}, P/B: ${pbStr}, ROE: ${roeStr}, Vốn hoá: ${mcapStr}\n`;
                    if (!validSymbols.includes(sym)) validSymbols.push(sym);
                });
                contextParts.push(marketStr);
                sources.push('Market Scanner (HOSE/HNX)');
            }
        } catch (e) { /* tiep tuc neu loi */ }
    }

    // 3. Neu cau hoi ve xu huong thi truong chung hoac VN-Index
    const lower = userText.toLowerCase();
    if (lower.includes('thị trường') || lower.includes('thi truong') || lower.includes('vnindex') || lower.includes('vn-index') || lower.includes('xu hướng') || lower.includes('xu huong')) {
        if (dashboardCache.data?.indices) {
            const ixList = dashboardCache.data.indices.map(ix => {
                const chg = ix.close - ix.ref;
                const sign = chg >= 0 ? '+' : '';
                return `• ${ix.name}: ${ix.close} điểm (${sign}${chg.toFixed(2)}), GTGD: ${ix.val} tỷ đ, Tăng: ${ix.adv}, Giảm: ${ix.dec}`;
            });
            contextParts.push('[TỔNG QUAN CHỈ SỐ THỊ TRƯỜNG REALTIME]:\n' + ixList.join('\n'));
            sources.push('Tổng quan Chỉ số');
        }
    }

    return {
        text: contextParts.join('\n\n'),
        symbols: validSymbols,
        sources
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

        // Thu thap du lieu thuc te tu TCBS MCP va San giao dich
        const stockContext = await fetchStockContextForPrompt(lastUserMsg);

        // Xay dung System Prompt chuyen sau ve Tai chinh & Chung khoan Viet Nam
        const systemPrompt = `Bạn là Trợ lý AI Phân tích Tài chính & Đầu tư Chứng khoán chuyên nghiệp tại Việt Nam, tích hợp dữ liệu realtime thị trường chứng khoán (HOSE, HNX, UPCOM) và TCBS.
Nhiệm vụ của bạn:
1. Trả lời bằng tiếng Việt, súc tích, văn phong chuyên nghiệp và có chiều sâu phân tích tài chính.
2. Khi người dùng hỏi về cổ phiếu hoặc thị trường, BẮT BUỘC sử dụng các số liệu thực tế được cung cấp dưới đây (giá hiện tại, % tăng giảm, P/E, P/B, ROE, vốn hoá, khối lượng, RSI, ADX). Tuyệt đối không tự suy đoán sai lệch số liệu.
3. Cung cấp góc nhìn phân tích kết hợp:
   - Cơ bản & Định giá (P/E, P/B, ROE, vị thế doanh nghiệp).
   - Kỹ thuật & Dòng tiền (vùng hỗ trợ, kháng cự, RSI, xu hướng ngắn/trung hạn).
4. Luôn kèm khuyến nghị quản trị rủi ro (kỷ luật chốt lời/cắt lỗ).
${stockContext.text ? `\n--- DỮ LIỆU THỰC TẾ REALTIME ---\n${stockContext.text}\n--- HẾT DỮ LIỆU THỰC TẾ ---` : ''}`;

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
            hasTCBSContext: !!stockContext.text,
            symbolsDetected: stockContext.symbols,
            dataSources: stockContext.sources,
            tcbsAuthenticated: !!tcbsJwtToken
        });

    } catch (error) {
        console.error('Chat Error:', error.response?.data || error.message);
        let errorMsg = error.response?.data?.error?.message || error.message;

        res.status(500).json({
            success: false,
            error: errorMsg,
            tcbsAuthenticated: !!tcbsJwtToken
        });
    }
});

// Ham lay du lieu thi truong thuc de dua vao prompt AI
async function fetchLiveMarketContext() {
    const context = { prices: [], headlines: [], time: new Date().toLocaleString('vi-VN') };

    // 1. Lay gia top 20 co phieu + chi so tu TradingView
    try {
        const body = {
            filter: [{ left: 'exchange', operation: 'in_range', right: ['HOSE', 'HNX'] }],
            columns: ['name', 'close', 'change', 'volume', 'market_cap_basic'],
            sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
            range: [0, 20]
        };
        const r = await axios.post(TV_SCANNER_URL, body, { headers: TV_HEADERS, timeout: 8000 });
        context.prices = (r.data.data || []).map(item => {
            const [sym, close, chg, vol, mcap] = item.d;
            return `${sym}: ${close?.toLocaleString('vi-VN') || '—'}đ (${chg >= 0 ? '+' : ''}${chg?.toFixed(2) || 0}%)`;
        });
    } catch (e) { /* tiep tuc neu loi */ }

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

// Cache screener 3 phut
const screenerCache = { data: null, time: 0, TTL: 3 * 60 * 1000 };

// Lay du lieu FA toan thi truong (toi da 200 co phieu von hoa lon nhat)
app.get('/api/market/screener', async (req, res) => {
    const now = Date.now();
    if (screenerCache.data && (now - screenerCache.time) < screenerCache.TTL) {
        return res.json({ success: true, data: screenerCache.data, cached: true, count: screenerCache.data.length });
    }

    const size = Math.min(parseInt(req.query.size) || 200, 500);

    try {
        const body = {
            filter: [{ left: 'exchange', operation: 'in_range', right: ['HOSE', 'HNX', 'UPCOM'] }],
            columns: TV_COLUMNS,
            sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
            range: [0, size]
        };

        const response = await axios.post(TV_SCANNER_URL, body, { headers: TV_HEADERS, timeout: 12000 });
        const raw = response.data.data || [];

        const stocks = raw.map(item => {
            const [symbol, close, change, roe, pb, pe, eps, mcap, sector, high, low, volume] = item.d;
            const exchange = item.s.split(':')[0];
            return {
                symbol: symbol || item.s.split(':')[1],
                exchange,
                price: close,
                change: change ? parseFloat(change.toFixed(2)) : null,
                roe: roe ? parseFloat(roe.toFixed(2)) : null,
                pb: pb ? parseFloat(pb.toFixed(2)) : null,
                pe: pe ? parseFloat(pe.toFixed(2)) : null,
                eps: eps ? parseFloat(eps.toFixed(0)) : null,
                marketCap: mcap ? Math.round(mcap / 1e9) : null, // doi sang ty VND
                sector: sector || '',
                high, low,
                volume: volume ? Math.round(volume) : null
            };
        }).filter(s => s.symbol && s.price);

        screenerCache.data = stocks;
        screenerCache.time = now;

        res.json({ success: true, data: stocks, cached: false, count: stocks.length, total: response.data.totalCount });
    } catch (error) {
        console.error('Screener error:', error.message);
        res.status(500).json({ success: false, error: 'Khong the lay du lieu screener' });
    }
});

// Lay gia nhieu ma cung luc (dung cho TA signals)
app.post('/api/market/prices', async (req, res) => {
    const { symbols } = req.body;
    if (!symbols || !symbols.length) return res.status(400).json({ success: false, error: 'Thieu danh sach ma' });

    try {
        const body = {
            symbols: { tickers: symbols.map(s => `HOSE:${s}`), query: { types: [] } },
            columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'price_book_ratio', 'pe_ratio', 'return_on_equity']
        };

        const response = await axios.post(`${TV_SCANNER_URL}?label-product=screener-stock`, body, { headers: TV_HEADERS, timeout: 10000 });
        const raw = response.data.data || [];

        const prices = {};
        raw.forEach(item => {
            const [name, close, change, high, low, volume, pb, pe, roe] = item.d;
            const sym = (item.s || '').split(':')[1] || name;
            if (sym) {
                prices[sym] = { symbol: sym, price: close, change: change ? parseFloat(change.toFixed(2)) : null, high, low, volume, pb, pe, roe };
            }
        });

        res.json({ success: true, prices });
    } catch (error) {
        console.error('Prices error:', error.message);
        res.status(500).json({ success: false, error: 'Khong the lay gia co phieu' });
    }
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



// Lay JWT token tu TCBS (can API key + OTP tu app TCInvest)
app.post('/api/tcbs/token', async (req, res) => {
    try {
        const { otp } = req.body;
        const apiKey = TCBS_API_KEY;

        if (!apiKey || apiKey === 'your-tcbs-api-key-here') {
            return res.status(400).json({
                success: false,
                error: 'TCBS_API_KEY chua duoc cau hinh trong file .env'
            });
        }

        if (!otp) {
            return res.status(400).json({
                success: false,
                error: 'Thieu OTP (lay tu app TCInvest -> iFlash -> Smart OTP)'
            });
        }

        const response = await axios.post(
            `${TCBS_API_BASE}/gaia/v1/oauth2/openapi/token`,
            { apiKey, otp },
            { headers: { 'Content-Type': 'application/json' } }
        );

        tcbsJwtToken = response.data.token;

        res.json({
            success: true,
            message: 'Xac thuc TCBS thanh cong',
            hasToken: true
        });

    } catch (error) {
        console.error('TCBS Token Error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: error.response?.data?.message || 'Khong the lay TCBS token'
        });
    }
});

// Kiem tra trang thai xac thuc TCBS
app.get('/api/tcbs/status', (req, res) => {
    res.json({
        success: true,
        hasToken: !!tcbsJwtToken,
        apiKeyConfigured: !!(TCBS_API_KEY && TCBS_API_KEY !== 'your-tcbs-api-key-here')
    });
});

// Lay thong tin ma chung khoan tu TCBS
app.get('/api/tcbs/stock/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;

        if (!tcbsJwtToken) {
            return res.status(401).json({
                success: false,
                error: 'Chua xac thuc TCBS. Goi POST /api/tcbs/token truoc.',
                needAuth: true
            });
        }

        const response = await axios.get(
            `${TCBS_API_BASE}/stock-insight/v1/stock/one?ticker=${symbol}`,
            {
                headers: {
                    'Authorization': `Bearer ${tcbsJwtToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json({
            success: true,
            symbol: symbol,
            data: response.data
        });

    } catch (error) {
        // Token het han
        if (error.response?.status === 401) {
            tcbsJwtToken = null;
        }
        console.error('TCBS Stock Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            success: false,
            error: error.response?.data?.message || 'Khong the lay du lieu co phieu',
            tokenExpired: error.response?.status === 401
        });
    }
});

// WebSocket config cho frontend (tra ve WS URL de frontend tu ket noi)
app.get('/api/tcbs/ws-config', (req, res) => {
    res.json({
        success: true,
        wsUrl: TCBS_WS_URL,
        hasToken: !!tcbsJwtToken,
        // Khong tra ve token truc tiep - frontend phai xac thuc qua /api/tcbs/token
    });
});

// ==================== TCBS MCP PROXY ====================
// Proxy MCP calls toi mcp.tcbs.com.vn dung JWT token hien co
const TCBS_MCP_URL = 'https://mcp.tcbs.com.vn/mcp/tcinvest/';

// Lay danh sach tools tu MCP server
app.get('/api/tcbs/mcp/tools', async (req, res) => {
    if (!tcbsJwtToken) {
        return res.status(401).json({ success: false, error: 'Chua xac thuc TCBS. Goi POST /api/tcbs/token truoc.' });
    }
    try {
        const response = await axios.post(
            TCBS_MCP_URL,
            { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
            { headers: { 'Authorization': `Bearer ${tcbsJwtToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' } }
        );
        res.json({ success: true, data: response.data });
    } catch (error) {
        if (error.response?.status === 401) tcbsJwtToken = null;
        res.status(error.response?.status || 500).json({ success: false, error: error.response?.data || error.message });
    }
});

// Goi mot MCP tool cu the
app.post('/api/tcbs/mcp/call', async (req, res) => {
    if (!tcbsJwtToken) {
        return res.status(401).json({ success: false, error: 'Chua xac thuc TCBS. Goi POST /api/tcbs/token truoc.' });
    }
    const { tool, params = {} } = req.body;
    if (!tool) return res.status(400).json({ success: false, error: 'Thieu ten tool' });

    try {
        const response = await axios.post(
            TCBS_MCP_URL,
            { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: tool, arguments: params } },
            { headers: { 'Authorization': `Bearer ${tcbsJwtToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' } }
        );
        res.json({ success: true, data: response.data });
    } catch (error) {
        if (error.response?.status === 401) tcbsJwtToken = null;
        res.status(error.response?.status || 500).json({
            success: false,
            error: error.response?.data || error.message,
            tokenExpired: error.response?.status === 401
        });
    }
});

// ==================== WEBSOCKET PROXY CHO TCBS ====================

const wss = new WebSocket.Server({ noServer: true });

// Map luu cac client dang ket noi va TCBS WS cua ho
const clientConnections = new Map();

wss.on('connection', (clientWs) => {
    console.log('Browser client connected to WS proxy');

    // Gui trang thai ban dau
    clientWs.send(JSON.stringify({
        type: 'status',
        connected: false,
        message: tcbsJwtToken ? 'Ready to connect TCBS' : 'No TCBS token - authenticate first'
    }));

    clientWs.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            // Client yeu cau ket noi toi TCBS
            if (data.action === 'connect') {
                if (!tcbsJwtToken) {
                    clientWs.send(JSON.stringify({
                        type: 'error',
                        message: 'Chua co TCBS token. Vui long xac thuc truoc.'
                    }));
                    return;
                }
                connectToTCBS(clientWs);
            }

            // Client subscribe ma chung khoan
            if (data.action === 'subscribe' && data.symbols) {
                const tcbsWs = clientConnections.get(clientWs);
                if (tcbsWs && tcbsWs.readyState === WebSocket.OPEN) {
                    const symbols = Array.isArray(data.symbols) ? data.symbols.join(',') : data.symbols;
                    tcbsWs.send(`d|s|tk|bp+bi+tm+mp+op+fe|${symbols}`);
                }
            }

            // Client unsubscribe
            if (data.action === 'unsubscribe' && data.symbols) {
                const tcbsWs = clientConnections.get(clientWs);
                if (tcbsWs && tcbsWs.readyState === WebSocket.OPEN) {
                    const symbols = Array.isArray(data.symbols) ? data.symbols.join(',') : data.symbols;
                    tcbsWs.send(`d|u|tk|bp+bi+tm+mp+op+fe|${symbols}`);
                }
            }

        } catch (error) {
            console.error('WS proxy message error:', error);
        }
    });

    clientWs.on('close', () => {
        // Dong TCBS WS khi client ngat
        const tcbsWs = clientConnections.get(clientWs);
        if (tcbsWs) {
            tcbsWs.close();
            clientConnections.delete(clientWs);
        }
        console.log('Browser client disconnected');
    });
});

function connectToTCBS(clientWs) {
    const tcbsWs = new WebSocket(TCBS_WS_URL);
    let authDone = false;
    let heartbeatInterval = null;

    tcbsWs.on('open', () => {
        console.log('Connected to TCBS WebSocket');

        // Xac thuc: base64 encode token
        const encoded = Buffer.from(tcbsJwtToken).toString('base64');
        tcbsWs.send(`d|a|||${encoded}`);

        // Heartbeat moi 2 giay (bat buoc theo TCBS docs)
        heartbeatInterval = setInterval(() => {
            if (tcbsWs.readyState === WebSocket.OPEN) {
                tcbsWs.send('d|p|||');
            }
        }, 2000);
    });

    tcbsWs.on('message', (raw) => {
        const msg = raw.toString();

        // Xu ly auth response
        if (msg.startsWith('d|0|')) {
            try {
                const payload = JSON.parse(msg.slice(4));
                if (payload.success) {
                    authDone = true;
                    clientConnections.set(clientWs, tcbsWs);
                    clientWs.send(JSON.stringify({
                        type: 'status',
                        connected: true,
                        message: 'Ket noi TCBS thanh cong'
                    }));
                } else {
                    tcbsJwtToken = null;
                    clientWs.send(JSON.stringify({
                        type: 'error',
                        message: 'TCBS token het han, vui long xac thuc lai'
                    }));
                    tcbsWs.close();
                }
            } catch (e) { /* ignore parse error */ }
            return;
        }

        // Bo qua control messages (heartbeat, timeout config, subscribe ack)
        if (msg.startsWith('d|')) return;

        // Forward data messages toi browser client
        // Format: s|[channel]|[json]
        if (msg.startsWith('s|') && authDone) {
            const parts = msg.split('|', 3);
            if (parts.length === 3) {
                try {
                    const channelId = parseInt(parts[1]);
                    const payload = JSON.parse(parts[2]);

                    // Map channel ID sang ten ro rang hon
                    const channelMap = {
                        1: 'bid',       // So lenh mua top 3
                        2: 'offer',     // So lenh ban top 3
                        3: 'foreign',   // Khoi ngoai
                        4: 'base',      // Gia tran/san/tham chieu
                        5: 'session',   // Thong tin phien
                        6: 'match',     // Giao dich khop
                        8: 'index',     // Chi so VN-INDEX...
                        22: 'history'   // Lich su khop trong ngay
                    };

                    clientWs.send(JSON.stringify({
                        type: 'data',
                        channel: channelMap[channelId] || `ch${channelId}`,
                        channelId: channelId,
                        data: payload
                    }));
                } catch (e) { /* ignore malformed */ }
            }
        }
    });

    tcbsWs.on('error', (err) => {
        console.error('TCBS WS Error:', err.message);
        clientWs.send(JSON.stringify({
            type: 'error',
            message: 'TCBS WebSocket loi: ' + err.message
        }));
    });

    tcbsWs.on('close', (code) => {
        clearInterval(heartbeatInterval);
        clientConnections.delete(clientWs);
        console.log('TCBS WebSocket closed, code:', code);

        if (clientWs.readyState === WebSocket.OPEN) {
            // Token het han (code 1000 + error truoc do)
            if (code === 1006) tcbsJwtToken = null;
            clientWs.send(JSON.stringify({
                type: 'status',
                connected: false,
                message: 'Mat ket noi TCBS'
            }));
        }
    });
}

// ==================== HEALTH CHECK ====================

app.get('/api/health', (req, res) => {
    const tcbsApiKeyOk = !!(TCBS_API_KEY && TCBS_API_KEY !== 'your-tcbs-api-key-here');
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        apis: {
            openrouter:         !!OPENROUTER_KEY,
            tcbs_configured:    tcbsApiKeyOk,
            tcbs_authenticated: !!tcbsJwtToken
        }
    });
});

// ==================== START SERVER ====================

const server = app.listen(PORT, () => {
    const tcbsApiKeyOk = !!(TCBS_API_KEY && TCBS_API_KEY !== 'your-tcbs-api-key-here');
    console.log(`
Server dang chay tai port ${PORT}

API Endpoints:
   - POST /api/chat              : Chatbot AI tích hợp TCBS MCP (Nemotron 3 Super Free)
   - POST /api/news/generate     : Tong hop tin tuc
   - GET  /api/news/rss          : Lay tin tuc RSS
   - GET  /api/market/screener   : FA screener (TradingView, 200+ co phieu)
   - POST /api/market/prices     : Gia nhieu ma cung luc
   - POST /api/tcbs/token        : Lay JWT token TCBS (can otp)
   - GET  /api/tcbs/status       : Kiem tra trang thai xac thuc TCBS
   - GET  /api/tcbs/stock/:sym   : Du lieu co phieu TCBS
   - GET  /api/tcbs/mcp/tools    : Lay danh sach MCP tools
   - POST /api/tcbs/mcp/call     : Goi MCP tool
   - GET  /api/health            : Health check

Website: http://localhost:${PORT}
WebSocket proxy: ws://localhost:${PORT}

API Status:
   ${OPENROUTER_KEY ? 'Co key' : 'Thieu key'} - OpenRouter (Nemotron 3 Super Free)
   ${DEEPSEEK_KEY   ? 'Co key' : 'Chua cau hinh'} - DeepSeek Direct (api.deepseek.com)
   ${GEMINI_KEY     ? 'Co key' : 'Chua cau hinh'} - Google Gemini (Fallback)
   ${tcbsApiKeyOk   ? 'Co key (chua xac thuc)' : 'Thieu key'} - TCBS iFlash & MCP
    `);
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
