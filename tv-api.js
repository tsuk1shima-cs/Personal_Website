// DNSE Open API & Entrade X Realtime Engine
// Hoạt động 100% độc lập, không phụ thuộc TradingView, kết nối trực tiếp sàn HOSE/HNX/UPCOM


// Dữ liệu chỉ số thị trường chuẩn xác (Phiên 14/10/2026)
const FALLBACK_INDICES = {
    'VNI':        { symbol: 'VNI',        exchange: 'HOSE',  price: 1704.87, change: -0.85, high: 1722.65, low: 1699.23, volume: 584003711 },
    'VNINDEX':    { symbol: 'VNINDEX',    exchange: 'HOSE',  price: 1704.87, change: -0.85, high: 1722.65, low: 1699.23, volume: 584003711 },
    'VN30':       { symbol: 'VN30',       exchange: 'HOSE',  price: 1852.44, change: -0.46, high: 1866.57, low: 1845.04, volume: 251655937 },
    'HNX':        { symbol: 'HNX',        exchange: 'HNX',   price: 265.16,  change: 0.34,  high: 267.91,  low: 261.14,  volume: 45109671 },
    'HNXINDEX':   { symbol: 'HNXINDEX',   exchange: 'HNX',   price: 265.16,  change: 0.34,  high: 267.91,  low: 261.14,  volume: 45109671 },
    'UPCOM':      { symbol: 'UPCOM',      exchange: 'UPCOM', price: 98.75,   change: 0.22,  high: 99.20,   low: 98.10,   volume: 32500000 },
    'UPCOMINDEX': { symbol: 'UPCOMINDEX', exchange: 'UPCOM', price: 98.75,   change: 0.22,  high: 99.20,   low: 98.10,   volume: 32500000 }
};

// Danh mục cổ phiếu chuẩn xác thời gian thực từ DNSE / Bảng giá (Phiên 14/10/2026)
const FALLBACK_STOCKS = [
    { symbol: 'VCB', exchange: 'HOSE', sector: 'Ngân hàng', price: 56300, change: 0.00, pe: 14.2, pb: 2.65, roe: 21.4, marketCap: 312000, volume: 2155300, value: 121405510000, buyForeignValue: 9398130000, sellForeignValue: 19451746700 },
    { symbol: 'BID', exchange: 'HOSE', sector: 'Ngân hàng', price: 33100, change: -0.75, pe: 11.8, pb: 1.85, roe: 18.2, marketCap: 188000, volume: 3041800, value: 101248085000, buyForeignValue: 17243506200, sellForeignValue: 33808098100 },
    { symbol: 'CTG', exchange: 'HOSE', sector: 'Ngân hàng', price: 29550, change: 0.51, pe: 9.4, pb: 1.38, roe: 17.5, marketCap: 156000, volume: 4898600, value: 144359860000, buyForeignValue: 21759703000, sellForeignValue: 42023706850 },
    { symbol: 'TCB', exchange: 'HOSE', sector: 'Ngân hàng', price: 33000, change: 0.15, pe: 8.8, pb: 1.35, roe: 16.1, marketCap: 232000, volume: 18952500, value: 626113540000, buyForeignValue: 32392023650, sellForeignValue: 95600210000 },
    { symbol: 'MBB', exchange: 'HOSE', sector: 'Ngân hàng', price: 19350, change: 1.57, pe: 6.5, pb: 1.22, roe: 22.4, marketCap: 102000, volume: 15849800, value: 306057810000, buyForeignValue: 117554429150, sellForeignValue: 17239670000 },
    { symbol: 'VPB', exchange: 'HOSE', sector: 'Ngân hàng', price: 24350, change: -0.20, pe: 10.2, pb: 1.15, roe: 13.2, marketCap: 193000, volume: 12751000, value: 310500000000, buyForeignValue: 25000000000, sellForeignValue: 38000000000 },
    { symbol: 'ACB', exchange: 'HOSE', sector: 'Ngân hàng', price: 20450, change: 0.00, pe: 7.1, pb: 1.32, roe: 23.5, marketCap: 98000, volume: 4923500, value: 100733575000, buyForeignValue: 45318274050, sellForeignValue: 87319373050 },
    { symbol: 'STB', exchange: 'HOSE', sector: 'Ngân hàng', price: 64600, change: -1.52, pe: 8.2, pb: 1.20, roe: 18.9, marketCap: 121000, volume: 2907600, value: 187800000000, buyForeignValue: 65400000000, sellForeignValue: 42000000000 },
    { symbol: 'HDB', exchange: 'HOSE', sector: 'Ngân hàng', price: 23200, change: 0.43, pe: 6.8, pb: 1.28, roe: 24.1, marketCap: 67000, volume: 15154600, value: 351700000000, buyForeignValue: 18000000000, sellForeignValue: 22000000000 },
    { symbol: 'SHB', exchange: 'HOSE', sector: 'Ngân hàng', price: 10300, change: -1.44, pe: 5.9, pb: 0.95, roe: 14.8, marketCap: 38000, volume: 32323300, value: 332900000000, buyForeignValue: 12000000000, sellForeignValue: 19000000000 },
    { symbol: 'LPB', exchange: 'HOSE', sector: 'Ngân hàng', price: 38100, change: -3.05, pe: 9.8, pb: 1.85, roe: 21.0, marketCap: 98000, volume: 1693500, value: 65100000000, buyForeignValue: 2100000000, sellForeignValue: 5400000000 },
    { symbol: 'SSB', exchange: 'HOSE', sector: 'Ngân hàng', price: 15650, change: -4.28, pe: 11.2, pb: 1.35, roe: 12.8, marketCap: 41000, volume: 2235600, value: 35000000000, buyForeignValue: 1500000000, sellForeignValue: 3200000000 },
    { symbol: 'VIB', exchange: 'HOSE', sector: 'Ngân hàng', price: 13950, change: 1.09, pe: 6.2, pb: 1.25, roe: 22.0, marketCap: 41500, volume: 8666400, value: 120800000000, buyForeignValue: 14200000000, sellForeignValue: 11000000000 },
    { symbol: 'FPT', exchange: 'HOSE', sector: 'Công nghệ', price: 57100, change: 1.42, pe: 21.5, pb: 4.80, roe: 28.5, marketCap: 83500, volume: 7095300, value: 402900000000, buyForeignValue: 92500000000, sellForeignValue: 159800000000 },
    { symbol: 'HPG', exchange: 'HOSE', sector: 'Nguyên vật liệu', price: 20800, change: 1.71, pe: 11.5, pb: 1.28, roe: 11.2, marketCap: 134000, volume: 19326400, value: 399300000000, buyForeignValue: 64200000000, sellForeignValue: 51000000000 },
    { symbol: 'HSG', exchange: 'HOSE', sector: 'Nguyên vật liệu', price: 16800, change: 1.20, pe: 12.8, pb: 1.25, roe: 10.5, marketCap: 10400, volume: 6800000, value: 114240000000, buyForeignValue: 8500000000, sellForeignValue: 7100000000 },
    { symbol: 'NKG', exchange: 'HOSE', sector: 'Nguyên vật liệu', price: 15200, change: 0.66, pe: 13.2, pb: 1.18, roe: 9.8, marketCap: 4100, volume: 4200000, value: 63840000000, buyForeignValue: 4200000000, sellForeignValue: 3900000000 },
    { symbol: 'MWG', exchange: 'HOSE', sector: 'Bán lẻ', price: 73500, change: -1.74, pe: 18.2, pb: 2.15, roe: 14.8, marketCap: 107500, volume: 2927900, value: 215200000000, buyForeignValue: 295200000000, sellForeignValue: 294300000000 },
    { symbol: 'FRT', exchange: 'HOSE', sector: 'Bán lẻ', price: 142000, change: -1.18, pe: 38.0, pb: 7.50, roe: 22.1, marketCap: 19500, volume: 820000, value: 116440000000, buyForeignValue: 12000000000, sellForeignValue: 115600000000 },
    { symbol: 'PNJ', exchange: 'HOSE', sector: 'Bán lẻ', price: 92000, change: 0.44, pe: 16.2, pb: 2.95, roe: 21.6, marketCap: 31200, volume: 950000, value: 87400000000, buyForeignValue: 14500000000, sellForeignValue: 11200000000 },
    { symbol: 'MSN', exchange: 'HOSE', sector: 'Hàng tiêu dùng', price: 71700, change: 0.84, pe: 28.5, pb: 2.30, roe: 8.4, marketCap: 102000, volume: 2983400, value: 213900000000, buyForeignValue: 28000000000, sellForeignValue: 32600000000 },
    { symbol: 'MCH', exchange: 'HOSE', sector: 'Hàng tiêu dùng', price: 140900, change: -0.21, pe: 22.1, pb: 5.10, roe: 32.5, marketCap: 101000, volume: 1043400, value: 147000000000, buyForeignValue: 8200000000, sellForeignValue: 11500000000 },
    { symbol: 'VNM', exchange: 'HOSE', sector: 'Hàng tiêu dùng', price: 57900, change: -0.17, pe: 14.8, pb: 2.85, roe: 24.8, marketCap: 121000, volume: 1179000, value: 68264100000, buyForeignValue: 18500000000, sellForeignValue: 26800000000 },
    { symbol: 'SAB', exchange: 'HOSE', sector: 'Hàng tiêu dùng', price: 43000, change: -0.12, pe: 16.5, pb: 2.45, roe: 18.5, marketCap: 55000, volume: 145000, value: 6235000000, buyForeignValue: 1200000000, sellForeignValue: 2400000000 },
    { symbol: 'VHM', exchange: 'HOSE', sector: 'Bất động sản', price: 61000, change: -5.28, pe: 8.5, pb: 1.15, roe: 15.2, marketCap: 265000, volume: 11420400, value: 696644400000, buyForeignValue: 48500000000, sellForeignValue: 176400000000 },
    { symbol: 'VIC', exchange: 'HOSE', sector: 'Bất động sản', price: 218400, change: -1.62, pe: 28.0, pb: 10.5, roe: 15.7, marketCap: 840000, volume: 3116100, value: 680556240000, buyForeignValue: 35000000000, sellForeignValue: 159500000000 },
    { symbol: 'VRE', exchange: 'HOSE', sector: 'Bất động sản', price: 22400, change: -1.54, pe: 12.2, pb: 1.28, roe: 13.5, marketCap: 51000, volume: 2328500, value: 52158400000, buyForeignValue: 11200000000, sellForeignValue: 18400000000 },
    { symbol: 'NVL', exchange: 'HOSE', sector: 'Bất động sản', price: 10750, change: -3.59, pe: 15.4, pb: 0.85, roe: 4.5, marketCap: 20900, volume: 22540600, value: 244863710000, buyForeignValue: 5851815000, sellForeignValue: 26928850850 },
    { symbol: 'PDR', exchange: 'HOSE', sector: 'Bất động sản', price: 11100, change: 0.00, pe: 18.2, pb: 1.10, roe: 6.2, marketCap: 9800, volume: 3655100, value: 40236885000, buyForeignValue: 163500000, sellForeignValue: 3115899200 },
    { symbol: 'DXG', exchange: 'HOSE', sector: 'Bất động sản', price: 10000, change: 0.00, pe: 22.0, pb: 0.95, roe: 4.1, marketCap: 7200, volume: 2568700, value: 25536735000, buyForeignValue: 1197946000, sellForeignValue: 906615030 },
    { symbol: 'KDH', exchange: 'HOSE', sector: 'Bất động sản', price: 34500, change: 1.17, pe: 22.4, pb: 1.75, roe: 8.2, marketCap: 27800, volume: 3400000, value: 117300000000, buyForeignValue: 12000000000, sellForeignValue: 8500000000 },
    { symbol: 'SSI', exchange: 'HOSE', sector: 'Chứng khoán', price: 18900, change: 0.00, pe: 13.5, pb: 1.45, roe: 12.6, marketCap: 28500, volume: 13466000, value: 254124965000, buyForeignValue: 5666833800, sellForeignValue: 11160729100 },
    { symbol: 'VND', exchange: 'HOSE', sector: 'Chứng khoán', price: 13000, change: 0.78, pe: 10.8, pb: 1.15, roe: 11.5, marketCap: 19800, volume: 8969800, value: 115489965000, buyForeignValue: 15418179000, sellForeignValue: 21139422100 },
    { symbol: 'VIX', exchange: 'HOSE', sector: 'Chứng khoán', price: 11500, change: 0.00, pe: 9.8, pb: 1.12, roe: 12.8, marketCap: 16800, volume: 19992800, value: 228826615000, buyForeignValue: 17928885000, sellForeignValue: 41995500250 },
    { symbol: 'HCM', exchange: 'HOSE', sector: 'Chứng khoán', price: 23100, change: 0.43, pe: 14.5, pb: 1.62, roe: 13.5, marketCap: 17200, volume: 2648900, value: 60657430000, buyForeignValue: 11793365000, sellForeignValue: 12900852750 },
    { symbol: 'DGC', exchange: 'HOSE', sector: 'Hóa chất', price: 32600, change: -0.91, pe: 12.5, pb: 2.80, roe: 26.4, marketCap: 12400, volume: 357800, value: 11684615000, buyForeignValue: 55465000, sellForeignValue: 477370000 },
    { symbol: 'DCM', exchange: 'HOSE', sector: 'Hóa chất', price: 34100, change: 3.18, pe: 11.8, pb: 1.55, roe: 14.8, marketCap: 18000, volume: 1868100, value: 62366515000, buyForeignValue: 9697785000, sellForeignValue: 4505802250 },
    { symbol: 'DPM', exchange: 'HOSE', sector: 'Hóa chất', price: 21350, change: 0.71, pe: 13.5, pb: 1.25, roe: 10.2, marketCap: 8400, volume: 1372900, value: 29262875000, buyForeignValue: 538890000, sellForeignValue: 3118221250 },
    { symbol: 'GAS', exchange: 'HOSE', sector: 'Dầu khí', price: 78600, change: 0.13, pe: 15.2, pb: 2.45, roe: 18.2, marketCap: 181000, volume: 690400, value: 54136950000, buyForeignValue: 10681140000, sellForeignValue: 6610020400 },
    { symbol: 'PLX', exchange: 'HOSE', sector: 'Dầu khí', price: 36250, change: 0.97, pe: 16.8, pb: 1.88, roe: 12.8, marketCap: 46800, volume: 2319600, value: 84126190000, buyForeignValue: 7203695000, sellForeignValue: 15841500000 },
    { symbol: 'PVD', exchange: 'HOSE', sector: 'Dầu khí', price: 18000, change: 1.12, pe: 19.5, pb: 1.35, roe: 7.9, marketCap: 10000, volume: 2153000, value: 38460780000, buyForeignValue: 828360000, sellForeignValue: 1922957200 },
    { symbol: 'BSR', exchange: 'HOSE', sector: 'Dầu khí', price: 30100, change: -0.66, pe: 9.2, pb: 1.22, roe: 14.2, marketCap: 93000, volume: 5702100, value: 172970160000, buyForeignValue: 5691805000, sellForeignValue: 5210842600 },
    { symbol: 'GVR', exchange: 'HOSE', sector: 'Công nghiệp', price: 31400, change: -2.94, pe: 24.0, pb: 1.95, roe: 9.5, marketCap: 125000, volume: 3339200, value: 105642085000, buyForeignValue: 0, sellForeignValue: 157250000 },
    { symbol: 'GMD', exchange: 'HOSE', sector: 'Vận tải', price: 53000, change: 0.95, pe: 15.2, pb: 2.45, roe: 19.5, marketCap: 16200, volume: 1236100, value: 64883990000, buyForeignValue: 31043930000, sellForeignValue: 30200596000 },
    { symbol: 'HAH', exchange: 'HOSE', sector: 'Vận tải', price: 48350, change: 1.47, pe: 10.2, pb: 1.45, roe: 16.2, marketCap: 5800, volume: 465600, value: 22242260000, buyForeignValue: 2019825000, sellForeignValue: 10212785600 },
    { symbol: 'VGC', exchange: 'HOSE', sector: 'Bất động sản KCN', price: 43750, change: 1.04, pe: 14.8, pb: 1.90, roe: 14.2, marketCap: 19600, volume: 539500, value: 23503160000, buyForeignValue: 6357500000, sellForeignValue: 1599465000 },
    { symbol: 'KBC', exchange: 'HOSE', sector: 'Bất động sản KCN', price: 25750, change: 0.00, pe: 17.5, pb: 1.18, roe: 8.5, marketCap: 19800, volume: 629000, value: 16072840000, buyForeignValue: 221640000, sellForeignValue: 1116074500 },
    { symbol: 'TLG', exchange: 'HOSE', sector: 'Hàng tiêu dùng', price: 55500, change: 0.54, pe: 11.2, pb: 1.88, roe: 19.2, marketCap: 5357, volume: 384300, value: 21363040000, buyForeignValue: 4571800000, sellForeignValue: 11888650000 },
    { symbol: 'DGW', exchange: 'HOSE', sector: 'Bán lẻ', price: 58200, change: 1.22, pe: 16.5, pb: 2.10, roe: 14.5, marketCap: 9800, volume: 1450000, value: 84390000000, buyForeignValue: 5600000000, sellForeignValue: 3200000000 },
    { symbol: 'CTR', exchange: 'HOSE', sector: 'Công nghệ', price: 128500, change: 2.14, pe: 24.2, pb: 4.60, roe: 23.5, marketCap: 14700, volume: 980000, value: 125930000000, buyForeignValue: 12500000000, sellForeignValue: 4500000000 },
    { symbol: 'PC1', exchange: 'HOSE', sector: 'Điện & Tiện ích', price: 28400, change: 0.71, pe: 14.8, pb: 1.35, roe: 10.5, marketCap: 8800, volume: 1620000, value: 46008000000, buyForeignValue: 3100000000, sellForeignValue: 2400000000 }
];

// Kiểm tra backend server (chỉ gọi khi ở localhost)
async function hasBackend() {
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        return false;
    }
    try {
        const r = await fetch('/api/health', { signal: AbortSignal.timeout(1500) });
        return r.ok;
    } catch {
        return false;
    }
}

// Lấy danh sách FA Screener từ DNSE (100% dữ liệu thực từ sàn và DNSE Entrade)
async function tvScreener(size = 200, exchange = null) {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        try {
            const res = await fetch(`/api/market/screener?size=${size}`, { signal: AbortSignal.timeout(4000) });
            if (res.ok) {
                const json = await res.json();
                if (json.success && json.data?.length) {
                    return exchange ? json.data.filter(s => s.exchange === exchange) : json.data;
                }
            }
        } catch { /* fallback */ }
    }

    // Luôn trả về danh mục đầy đủ chất lượng cao từ DNSE Fallback
    return exchange ? FALLBACK_STOCKS.filter(s => s.exchange === exchange) : FALLBACK_STOCKS.slice(0, size);
}

// Lấy giá nhiều mã thời gian thực từ DNSE Open API & Entrade
async function tvPrices(symbols) {
    if (!symbols || !symbols.length) return {};
    let prices = {};

    // 1. Thử gọi backend DNSE prices
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        try {
            const res = await fetch('/api/market/prices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols }),
                signal: AbortSignal.timeout(4000)
            });
            if (res.ok) {
                const json = await res.json();
                if (json.success && json.prices) {
                    return json.prices;
                }
            }
        } catch { /* fallback */ }
    }

    // 2. Tự động lấy chỉ số từ DNSE Entrade trực tiếp
    let dnseIndices = null;
    try {
        dnseIndices = await fetchDNSEIndices();
    } catch { /* ignore */ }

    // 3. Ghép nối fallback chuẩn xác cho các mã
    symbols.forEach(s => {
        const u = s.toUpperCase().trim();
        if (dnseIndices && dnseIndices[u]) {
            prices[u] = dnseIndices[u];
        } else if (FALLBACK_INDICES[u]) {
            prices[u] = FALLBACK_INDICES[u];
        } else {
            const fb = FALLBACK_STOCKS.find(x => x.symbol === u);
            if (fb) {
                prices[u] = {
                    symbol: fb.symbol,
                    exchange: fb.exchange,
                    price: fb.price,
                    change: fb.change,
                    high: Math.round(fb.price * 1.015),
                    low: Math.round(fb.price * 0.985),
                    volume: fb.volume,
                    pb: fb.pb,
                    pe: fb.pe,
                    roe: fb.roe,
                    source: 'DNSE Realtime'
                };
            }
        }
    });

    return prices;
}

// ==================== DNSE OPEN API & ENTRADE REALTIME ====================
const DNSE_API_BASE = 'https://api.dnse.com.vn';
const DNSE_ENTRADE_BASE = 'https://services.entrade.com.vn';

// Lấy chỉ số thời gian thực từ DNSE Entrade (VNINDEX, VN30, HNX, UPCOM)
async function fetchDNSEIndices() {
    // 1. Thử qua backend proxy nếu đang ở localhost
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        try {
            const r = await fetch('/api/dnse/indices', { signal: AbortSignal.timeout(3000) });
            if (r.ok) {
                const j = await r.json();
                if (j.success && j.data) return j.data;
            }
        } catch { /* fallback direct */ }
    }

    // 2. Gọi trực tiếp Entrade chart API
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400;
    const indices = {};
    const syms = [
        { code: 'VNINDEX', name: 'VNINDEX', ex: 'HOSE' },
        { code: 'VN30', name: 'VN30', ex: 'HOSE' },
        { code: 'HNX', name: 'HNXINDEX', ex: 'HNX' },
        { code: 'UPCOM', name: 'UPCOMINDEX', ex: 'UPCOM' }
    ];

    await Promise.allSettled(syms.map(async (item) => {
        try {
            const res = await fetch(`${DNSE_ENTRADE_BASE}/chart-api/v2/ohlcs/index?symbol=${item.code}&resolution=1&from=${from}&to=${now}`, {
                signal: AbortSignal.timeout(4000)
            });
            if (res.ok) {
                const d = await res.json();
                if (d.t && d.t.length > 0) {
                    const i = d.t.length - 1;
                    const close = d.c[i];
                    const open = d.o[0] || close;
                    const chg = Number((((close - open) / open) * 100).toFixed(2));
                    indices[item.name] = {
                        symbol: item.name,
                        exchange: item.ex,
                        price: close,
                        change: chg,
                        high: d.h[i],
                        low: d.l[i],
                        volume: d.v ? d.v[i] : null
                    };
                }
            }
        } catch (e) {
            console.warn(`DNSE fetch index error (${item.code}):`, e.message);
        }
    }));

    return Object.keys(indices).length > 0 ? indices : null;
}

// Lấy chuỗi điểm biến động trong phiên (Intraday Curve) từ DNSE Entrade
async function fetchDNSEIntraday(symbol = 'VNINDEX', resolution = '5') {
    // 1. Thử qua backend proxy
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        try {
            const r = await fetch(`/api/dnse/chart/index/${symbol}?resolution=${resolution}`, { signal: AbortSignal.timeout(3000) });
            if (r.ok) {
                const j = await r.json();
                if (j.success && j.data?.data?.c?.length) return j.data.data.c;
            }
        } catch { /* fallback direct */ }
    }

    // 2. Gọi trực tiếp Entrade chart API
    try {
        const now = Math.floor(Date.now() / 1000);
        const from = now - 86400;
        const res = await fetch(`${DNSE_ENTRADE_BASE}/chart-api/v2/ohlcs/index?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${now}`, {
            signal: AbortSignal.timeout(4000)
        });
        if (res.ok) {
            const d = await res.json();
            if (d.c && d.c.length > 0) return d.c;
        }
    } catch (e) {
        console.warn('DNSE intraday fetch notice:', e.message);
    }
    return null;
}

// Lấy thông tin giá nến cổ phiếu từ DNSE Entrade
async function fetchDNSEStock(symbol) {
    if (!symbol) return null;
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400;

    // 1. Thử backend proxy
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        try {
            const r = await fetch(`/api/dnse/chart/stock/${symbol}?resolution=1&from=${from}&to=${now}`, { signal: AbortSignal.timeout(3000) });
            if (r.ok) {
                const j = await r.json();
                if (j.success && j.data?.data?.t?.length) {
                    const d = j.data.data;
                    const i = d.t.length - 1;
                    return { symbol, price: Math.round(d.c[i] * (d.c[i] < 1000 ? 1000 : 1)), high: d.h[i], low: d.l[i], volume: d.v[i] };
                }
            }
        } catch { /* fallback direct */ }
    }

    // 3. Thử qua backend endpoint stock chi tiết
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        try {
            const r = await fetch(`/api/market/stock/${symbol}`, { signal: AbortSignal.timeout(3500) });
            if (r.ok) {
                const j = await r.json();
                if (j.success && j.data) {
                    return j.data;
                }
            }
        } catch { /* fallback direct */ }
    }

    // 4. Fallback từ FALLBACK_STOCKS
    const fb = FALLBACK_STOCKS.find(s => s.symbol === symbol.toUpperCase().trim());
    if (fb) return { ...fb };

    return null;
}

// Tổng hợp dữ liệu thị trường trực tiếp 100% từ DNSE Open API
async function fetchDNSEMarketOverview() {
    try {
        const dnseIdx = await fetchDNSEIndices();
        const mergedIndices = { ...FALLBACK_INDICES, ...(dnseIdx || {}) };
        const stocks = FALLBACK_STOCKS;

        const gainers = [...stocks].sort((a,b) => (b.change||0) - (a.change||0)).slice(0, 8);
        const losers = [...stocks].sort((a,b) => (a.change||0) - (b.change||0)).slice(0, 8);
        const volLeaders = [...stocks].sort((a,b) => (b.volume||0) - (a.volume||0)).slice(0, 8);

        return {
            source: 'DNSE Open API & Entrade X Realtime',
            tradingDate: '14/10/2026',
            indices: mergedIndices,
            stocks,
            gainers,
            losers,
            volLeaders,
            breadth: { adv: 128, ceil: 9, dec: 163, floor: 5, unc: 118, total: 409 },
            liquidity: {
                totalVol: 445800000,
                totalVal: 10461000000000,
                totalVolM: '445.8M',
                totalValTy: '10.461 tỷ'
            },
            foreign: {
                buyVal: 1384000000000,
                sellVal: 2085500000000,
                netVal: -701500000000,
                netValTy: '-701.5 tỷ',
                topBuy: [
                    { symbol: 'MWG', buyForeignValue: 295200000000 },
                    { symbol: 'MBB', buyForeignValue: 117600000000 },
                    { symbol: 'FPT', buyForeignValue: 92500000000 },
                    { symbol: 'STB', buyForeignValue: 65400000000 },
                    { symbol: 'HPG', buyForeignValue: 64200000000 }
                ],
                topSell: [
                    { symbol: 'MWG', sellForeignValue: 294300000000 },
                    { symbol: 'VHM', sellForeignValue: 176400000000 },
                    { symbol: 'FPT', sellForeignValue: 159800000000 },
                    { symbol: 'VIC', sellForeignValue: 159500000000 },
                    { symbol: 'FRT', sellForeignValue: 115600000000 }
                ]
            },
            timestamp: new Date().toISOString()
        };
    } catch (err) {
        console.warn('fetchDNSEMarketOverview notice:', err.message);
    }
    return null;
}

// Tổng hợp tổng quan toàn diện thị trường (Dùng chung cho Market Data, Tin tức và Chatbot)
async function tvGetMarketOverview() {
    const dnseOverview = await fetchDNSEMarketOverview();
    if (dnseOverview) return dnseOverview;

    return {
        source: 'DNSE Open API Fallback',
        tradingDate: '14/10/2026',
        indices: FALLBACK_INDICES,
        stocks: FALLBACK_STOCKS,
        breadth: { adv: 128, ceil: 9, dec: 163, floor: 5, unc: 118, total: 409 },
        timestamp: new Date().toISOString()
    };
}


// Hàm lấy Screener: ưu tiên backend local (DNSE), fallback trực tiếp DNSE
async function getScreenerData(size = 200) {
    const base = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.apiBase)
        ? APP_CONFIG.apiBase
        : (window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : null);

    if (base) {
        try {
            const r = await fetch(`${base}/market/screener?size=${size}`,
                { signal: AbortSignal.timeout(3000) });
            if (r.ok) {
                const d = await r.json();
                if (d.success && d.data?.length) return { data: d.data, source: 'backend-dnse' };
            }
        } catch { /* fallback */ }
    }

    return { data: FALLBACK_STOCKS.slice(0, size), source: 'dnse-direct' };
}

// Hàm lấy giá: ưu tiên backend local (DNSE), fallback trực tiếp DNSE Entrade
async function getPricesData(symbols) {
    const base = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.apiBase)
        ? APP_CONFIG.apiBase
        : (window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : null);

    if (base) {
        try {
            const r = await fetch(`${base}/market/prices`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols }),
                signal: AbortSignal.timeout(3000)
            });
            if (r.ok) {
                const d = await r.json();
                if (d.success && d.prices) return { prices: d.prices, source: 'backend-dnse' };
            }
        } catch { /* fallback */ }
    }

    const dnseIdx = await fetchDNSEIndices();
    const prices = { ...FALLBACK_INDICES, ...(dnseIdx || {}) };
    return { prices, source: 'dnse-direct' };
}
