// Cloudflare Worker - RSS CORS Proxy
// Deploy tai: https://workers.cloudflare.com (mien phi 100k requests/ngay)
//
// Huong dan deploy:
// 1. Vao https://workers.cloudflare.com -> Sign up mien phi
// 2. Create Worker -> dan noi dung file nay vao
// 3. Save & Deploy -> copy URL Worker (dang: https://ten-worker.username.workers.dev)
// 4. Cap nhat WORKER_URL trong tin-tuc.html

const ALLOWED_ORIGINS = [
    'https://tsuk1shima-cs.github.io',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1'
];

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
    while ((m = re.exec(xml)) !== null) {
        const block = m[1];
        const get = (tag) => {
            const cd = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, 'i').exec(block);
            if (cd) return cd[1].trim();
            const pl = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
            return pl ? pl[1].replace(/<[^>]+>/g, '').trim() : '';
        };
        const title = get('title');
        const link  = get('link') || get('guid');
        const desc  = get('description');
        const pub   = get('pubDate');
        if (!title || !link || !link.startsWith('http')) continue;
        const summary = desc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
        let time = '';
        if (pub) try { time = new Date(pub).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch(e){}
        items.push({ title, link, summary, source: sourceName, category, time });
        if (items.length >= 7) break;
    }
    return items;
}

export default {
    async fetch(request) {
        const origin = request.headers.get('Origin') || '';
        const corsOk = ALLOWED_ORIGINS.some(o => origin.startsWith(o));

        const corsHeaders = {
            'Access-Control-Allow-Origin': corsOk ? origin : ALLOWED_ORIGINS[0],
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=300'
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        try {
            const results = await Promise.allSettled(
                RSS_FEEDS.map(feed =>
                    fetch(feed.url, {
                        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,*/*' },
                        cf: { cacheEverything: true, cacheTtl: 300 }
                    })
                    .then(r => r.text())
                    .then(xml => parseRSS(xml, feed.source, feed.category))
                    .catch(() => [])
                )
            );

            const items = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

            return new Response(
                JSON.stringify({ success: true, items, total: items.length }),
                { status: 200, headers: corsHeaders }
            );
        } catch (err) {
            return new Response(
                JSON.stringify({ success: false, error: err.message }),
                { status: 500, headers: corsHeaders }
            );
        }
    }
};
