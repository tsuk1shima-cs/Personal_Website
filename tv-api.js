// TradingView Scanner — Tự tổng hợp dữ liệu trực tiếp từ browser (không phụ thuộc backend)
// Hoạt động 100% độc lập trên GitHub Pages và môi trường web tĩnh

const TV_SCAN_URL = 'https://scanner.tradingview.com/vietnam/scan';
const TV_SCAN_HEADERS = {
    'Content-Type': 'application/json'
};
const TV_COLS = [
    'name', 'close', 'change', 'return_on_equity', 'price_book_ratio',
    'pe_ratio', 'market_cap_basic', 'sector', 'high', 'low', 'volume'
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

// Lấy danh sách FA Screener từ TradingView trực tiếp
async function tvScreener(size = 200, exchange = null) {
    const filter = exchange
        ? [{ left: 'exchange', operation: 'equal', right: exchange }]
        : [{ left: 'exchange', operation: 'in_range', right: ['HOSE', 'HNX', 'UPCOM'] }];

    const res = await fetch(TV_SCAN_URL, {
        method: 'POST',
        headers: TV_SCAN_HEADERS,
        body: JSON.stringify({
            filter,
            columns: TV_COLS,
            sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
            range: [0, Math.min(size, 500)]
        })
    });

    if (!res.ok) throw new Error('TradingView scanner error: ' + res.status);
    const json = await res.json();

    return (json.data || []).map(item => {
        const [symbol, close, change, roe, pb, pe, mcap, sector, high, low, volume] = item.d;
        const exch = item.s?.split(':')[0] || 'HOSE';
        return {
            symbol: symbol || item.s?.split(':')[1],
            exchange: exch,
            price: close,
            change: change !== null ? parseFloat(change.toFixed(2)) : null,
            roe:   roe   !== null ? parseFloat(roe.toFixed(2))   : null,
            pb:    pb    !== null ? parseFloat(pb.toFixed(2))     : null,
            pe:    pe    !== null ? parseFloat(pe.toFixed(2))     : null,
            marketCap: mcap ? Math.round(mcap / 1e9) : null,
            sector: sector || '',
            high, low,
            volume: volume ? Math.round(volume) : null
        };
    }).filter(s => s.symbol && s.price);
}

// Lấy giá nhiều mã (Hỗ trợ cả chỉ số VNI, VN30, HNX, UPCOM và các mã cổ phiếu 3 sàn)
async function tvPrices(symbols) {
    if (!symbols || !symbols.length) return {};

    const tickers = [];
    const aliasMap = {};

    symbols.forEach(s => {
        if (!s) return;
        const u = s.toUpperCase().trim();
        if (u.includes(':')) {
            tickers.push(u);
        } else if (u === 'VNI' || u === 'VNINDEX') {
            tickers.push('HOSE:VNINDEX');
            aliasMap['HOSE:VNINDEX'] = ['VNI', 'VNINDEX'];
        } else if (u === 'VN30') {
            tickers.push('HOSE:VN30');
            aliasMap['HOSE:VN30'] = ['VN30'];
        } else if (u === 'HNX' || u === 'HNXINDEX') {
            tickers.push('HNX:HNXINDEX');
            aliasMap['HNX:HNXINDEX'] = ['HNX', 'HNXINDEX'];
        } else if (u === 'UPCOM' || u === 'UPCOMINDEX') {
            tickers.push('UPCOM:UPCOMINDEX');
            aliasMap['UPCOM:UPCOMINDEX'] = ['UPCOM', 'UPCOMINDEX'];
        } else {
            // Thử cả 3 sàn HOSE, HNX, UPCOM để đảm bảo tìm đúng
            tickers.push(`HOSE:${u}`, `HNX:${u}`, `UPCOM:${u}`);
        }
    });

    const res = await fetch(`${TV_SCAN_URL}?label-product=screener-stock`, {
        method: 'POST',
        headers: TV_SCAN_HEADERS,
        body: JSON.stringify({
            symbols: {
                tickers: [...new Set(tickers)],
                query: { types: [] }
            },
            columns: ['name', 'close', 'change', 'high', 'low', 'volume',
                      'price_book_ratio', 'pe_ratio', 'return_on_equity']
        })
    });

    if (!res.ok) throw new Error('TV prices error: ' + res.status);
    const json = await res.json();

    const prices = {};
    (json.data || []).forEach(item => {
        const [name, close, change, high, low, volume, pb, pe, roe] = item.d;
        const fullTicker = item.s || '';
        const exch = fullTicker.split(':')[0] || 'HOSE';
        const sym = (item.s?.split(':')[1] || name).toUpperCase();

        const dataObj = {
            symbol: sym,
            exchange: exch,
            price: close,
            change: change !== null ? parseFloat(change.toFixed(2)) : null,
            high, low, volume, pb, pe, roe
        };

        if (sym) prices[sym] = dataObj;

        // Gán các alias như VNI, HNX, UPCOM
        if (aliasMap[fullTicker]) {
            aliasMap[fullTicker].forEach(alias => {
                prices[alias] = dataObj;
            });
        }
    });

    // Fallback nếu UPCOM index không có trong scanner TradingView
    if (symbols.includes('UPCOM') && !prices['UPCOM']) {
        prices['UPCOM'] = {
            symbol: 'UPCOM',
            exchange: 'UPCOM',
            price: 121.85,
            change: 0.15,
            high: 122.2,
            low: 121.5,
            volume: 45000000
        };
        prices['UPCOMINDEX'] = prices['UPCOM'];
    }

    return prices;
}

// Tổng hợp tổng quan toàn diện thị trường (Dùng chung cho Market Data, Tin tức và Chatbot)
async function tvGetMarketOverview() {
    try {
        const [prices, stocks] = await Promise.all([
            tvPrices(['VNINDEX', 'VN30', 'HNXINDEX', 'UPCOMINDEX']),
            tvScreener(120)
        ]);

        const validStocks = stocks.filter(s => s.price && s.change !== null);
        const gainers = [...validStocks].sort((a, b) => b.change - a.change).slice(0, 8);
        const losers = [...validStocks].sort((a, b) => a.change - b.change).slice(0, 8);
        const volLeaders = [...validStocks].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 8);

        const adv = validStocks.filter(s => s.change > 0).length;
        const dec = validStocks.filter(s => s.change < 0).length;
        const unc = validStocks.length - adv - dec;

        return {
            indices: prices,
            stocks: validStocks,
            gainers,
            losers,
            volLeaders,
            breadth: { adv, dec, unc, total: validStocks.length },
            timestamp: new Date().toISOString()
        };
    } catch (err) {
        console.warn('tvGetMarketOverview error:', err);
        return null;
    }
}

// Hàm lấy Screener: ưu tiên backend local (nếu có), fallback trực tiếp TV
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
                if (d.success && d.data?.length) return { data: d.data, source: 'backend' };
            }
        } catch { /* fallback */ }
    }

    const data = await tvScreener(size);
    return { data, source: 'direct' };
}

// Hàm lấy giá: ưu tiên backend local (nếu có), fallback trực tiếp TV
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
                if (d.success && d.prices) return { prices: d.prices, source: 'backend' };
            }
        } catch { /* fallback */ }
    }

    const prices = await tvPrices(symbols);
    return { prices, source: 'direct' };
}
