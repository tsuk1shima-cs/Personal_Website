// Cloudflare Pages Function — tu dong chay nhu serverless function
// Endpoint: /api/rss
// Khong can cau hinh them, Cloudflare Pages tu nhan dien thu muc /functions

const RSS_FEEDS = [
    { url: 'https://vnexpress.net/rss/kinh-doanh.rss',   source: 'VnExpress', category: 'Kinh doanh'  },
    { url: 'https://vnexpress.net/rss/thi-truong.rss',    source: 'VnExpress', category: 'Thị trường'  },
    { url: 'https://cafef.vn/thi-truong-chung-khoan.rss', source: 'CafeF',     category: 'Chứng khoán' },
    { url: 'https://vneconomy.vn/chung-khoan.rss',        source: 'VnEconomy', category: 'Chứng khoán' },
    { url: 'https://vneconomy.vn/tai-chinh.rss',          source: 'VnEconomy', category: 'Tài chính'   },
    { url: 'https://dantri.com.vn/rss/kinh-doanh.rss',   source: 'Dân trí',   category: 'Kinh doanh'  },
];

function parseRSS(xml, sourceName, category) {
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = re.exec(xml)) !== null && items.length < 7) {
        const block = m[1];
        const get = (tag) => {
            const cd = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, 'i').exec(block);
            if (cd) return cd[1].trim();
            const pl = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
            return pl ? pl[1].replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim() : '';
        };
        const title = get('title');
        const link  = get('link') || get('guid');
        if (!title || !link || !link.startsWith('http')) continue;
        const summary = get('description').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
        let time = '';
        const pub = get('pubDate');
        if (pub) try { time = new Date(pub).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch(e){}
        items.push({ title, link, summary, source: sourceName, category, time });
    }
    return items;
}

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
};

export async function onRequestGet(context) {
    if (context.request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
        const results = await Promise.allSettled(
            RSS_FEEDS.map(feed =>
                fetch(feed.url, {
                    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, */*' }
                })
                .then(r => r.text())
                .then(xml => parseRSS(xml, feed.source, feed.category))
                .catch(() => [])
            )
        );

        const items = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

        return new Response(
            JSON.stringify({ success: true, items, total: items.length }),
            { status: 200, headers: CORS_HEADERS }
        );
    } catch (err) {
        return new Response(
            JSON.stringify({ success: false, error: err.message, items: [] }),
            { status: 500, headers: CORS_HEADERS }
        );
    }
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}
