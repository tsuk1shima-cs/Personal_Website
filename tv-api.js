// TradingView Scanner — goi truc tiep tu browser (khong can backend)
// Dung cho GitHub Pages va cac moi truong chi co static hosting

const TV_SCAN_URL = 'https://scanner.tradingview.com/vietnam/scan';
const TV_SCAN_HEADERS = {
    'Content-Type': 'application/json',
    'Origin': 'https://vn.tradingview.com',
    'Referer': 'https://vn.tradingview.com/'
};
const TV_COLS = ['name', 'close', 'change', 'return_on_equity', 'price_book_ratio',
                 'pe_ratio', 'market_cap_basic', 'sector', 'high', 'low', 'volume'];

// Kiem tra co backend dang chay khong
async function hasBackend() {
    try {
        const r = await fetch('/api/health', { signal: AbortSignal.timeout(2000) });
        return r.ok;
    } catch { return false; }
}

// Lay du lieu FA tu TradingView truc tiep (fallback khi khong co backend)
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

// Lay gia nhieu ma tu TradingView
async function tvPrices(symbols) {
    if (!symbols || !symbols.length) return {};

    const res = await fetch(`${TV_SCAN_URL}?label-product=screener-stock`, {
        method: 'POST',
        headers: TV_SCAN_HEADERS,
        body: JSON.stringify({
            symbols: {
                tickers: symbols.map(s => `HOSE:${s}`),
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
        const sym = item.s?.split(':')[1] || name;
        if (sym) prices[sym] = {
            symbol: sym, price: close,
            change: change !== null ? parseFloat(change.toFixed(2)) : null,
            high, low, volume, pb, pe, roe
        };
    });
    return prices;
}

// Ham chung: uu tien backend, fallback TV truc tiep
async function getScreenerData(size = 200) {
    // Lay API base tu config neu co, nguoc lai tu APP_CONFIG
    const base = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.apiBase)
        ? APP_CONFIG.apiBase
        : (window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : null);

    // Thu backend truoc
    if (base) {
        try {
            const r = await fetch(`${base}/market/screener?size=${size}`,
                { signal: AbortSignal.timeout(4000) });
            if (r.ok) {
                const d = await r.json();
                if (d.success && d.data?.length) return { data: d.data, source: 'backend' };
            }
        } catch { /* fallback */ }
    }

    // Fallback: goi TV truc tiep
    const data = await tvScreener(size);
    return { data, source: 'direct' };
}

async function getPricesData(symbols) {
    const base = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.apiBase)
        ? APP_CONFIG.apiBase
        : (window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : null);

    // Thu backend truoc
    if (base) {
        try {
            const r = await fetch(`${base}/market/prices`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols }),
                signal: AbortSignal.timeout(4000)
            });
            if (r.ok) {
                const d = await r.json();
                if (d.success && d.prices) return { prices: d.prices, source: 'backend' };
            }
        } catch { /* fallback */ }
    }

    // Fallback: goi TV truc tiep
    const prices = await tvPrices(symbols);
    return { prices, source: 'direct' };
}
