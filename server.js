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
const TCBS_API_KEY   = process.env.TCBS_API_KEY;
const TCBS_API_BASE  = process.env.TCBS_API_BASE || 'https://openapi.tcbs.com.vn';
const TCBS_WS_URL    = process.env.TCBS_WS_URL   || 'wss://openapi.tcbs.com.vn/ws/thesis/v1/stream/normal';

// Map ten model thân thiện -> model ID cua OpenRouter
const MODEL_MAP = {
    'gpt-3.5-turbo':           'openai/gpt-3.5-turbo',
    'gpt-4':                   'openai/gpt-4',
    'gpt-4o':                  'openai/gpt-4o',
    'gpt-4o-mini':             'openai/gpt-4o-mini',
    'claude-3-sonnet':         'anthropic/claude-3-sonnet',
    'claude-3-sonnet-20240229':'anthropic/claude-3-sonnet',
    'claude-3-haiku':          'anthropic/claude-3-haiku',
    'claude-3-5-sonnet':       'anthropic/claude-3.5-sonnet',
    'claude-3-5-haiku':        'anthropic/claude-3-5-haiku',
    'claude':                  'anthropic/claude-3-haiku',
    'gemini-1.5-flash':        'google/gemini-flash-1.5',
    'gemini-1.5-pro':          'google/gemini-pro-1.5',
    'gemini-2.0-flash':        'google/gemini-2.0-flash-001',
    'gemini':                  'google/gemini-flash-1.5',
    'auto':                    'openai/gpt-3.5-turbo',
    'deepseek':                'deepseek/deepseek-chat',
    'llama-3':                 'meta-llama/llama-3.1-8b-instruct:free',
    'nemotron':                'nvidia/nemotron-3-super-120b-a12b:free',
};

function resolveModel(model) {
    return MODEL_MAP[model] || model;
}

// Ham goi OpenRouter chung cho tat ca model
async function callOpenRouter(messages, model = 'openai/gpt-3.5-turbo', maxTokens = 1000) {
    if (!OPENROUTER_KEY) throw new Error('OPENROUTER_API_KEY chua duoc cau hinh trong .env');

    const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
            model: resolveModel(model),
            messages,
            temperature: 0.7,
            max_tokens: maxTokens
        },
        {
            headers: {
                'Authorization': `Bearer ${OPENROUTER_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Chuyen Gia Tai Chinh'
            }
        }
    );

    const content = response.data.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenRouter khong tra ve noi dung');
    return { message: content, usage: response.data.usage };
}

// Luu JWT token TCBS theo session (reset khi restart server)
let tcbsJwtToken = null;

// ==================== AI ENDPOINTS ====================

// Chat chung — dung cho tat ca model qua OpenRouter
app.post('/api/chat/openai', async (req, res) => {
    try {
        const { messages, model = 'gpt-3.5-turbo' } = req.body;
        const result = await callOpenRouter(messages, model);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Chat (OpenAI) Error:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
    }
});

app.post('/api/chat/claude', async (req, res) => {
    try {
        const { messages, model = 'claude-3-haiku' } = req.body;
        const result = await callOpenRouter(messages, model);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Chat (Claude) Error:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
    }
});

app.post('/api/chat/gemini', async (req, res) => {
    try {
        const { messages, model = 'gemini-1.5-flash' } = req.body;
        const result = await callOpenRouter(messages, model);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Chat (Gemini) Error:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
    }
});

// Endpoint tong quat — goi bat ky model nao
app.post('/api/chat', async (req, res) => {
    try {
        const { messages, model = 'openai/gpt-4o-mini' } = req.body;
        const result = await callOpenRouter(messages, model);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Chat Error:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
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

// ==================== MARKET DATA — TRADINGVIEW SCANNER ====================

const TV_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Content-Type': 'application/json',
    'Origin': 'https://vn.tradingview.com',
    'Referer': 'https://vn.tradingview.com/'
};

const TV_SCANNER_URL = 'https://scanner.tradingview.com/vietnam/scan';
const TV_COLUMNS = ['name', 'close', 'change', 'return_on_equity', 'price_book_ratio', 'pe_ratio', 'earnings_per_share_basic_ttm', 'market_cap_basic', 'sector', 'high', 'low', 'volume'];

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
   - POST /api/chat/openai       : Chat voi GPT
   - POST /api/chat/claude       : Chat voi Claude
   - POST /api/chat/gemini       : Chat voi Gemini
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
   ${OPENROUTER_KEY ? 'Co key' : 'Thieu key'} - OpenRouter (GPT / Claude / Gemini / ...)
   ${tcbsApiKeyOk   ? 'Co key (chua xac thuc)' : 'Thieu key'} - TCBS iFlash
    `);
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
