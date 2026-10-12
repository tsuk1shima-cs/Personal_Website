// Cau hinh URL backend
// - Local: dung localhost:3000
// - Render/Production: dien URL Render cua ban vao RENDER_URL

const RENDER_URL = ''; // VD: 'https://chuyen-gia-tai-chinh.onrender.com'
const WORKER_URL = ''; // VD: 'https://rss-proxy.username.workers.dev' (Cloudflare Worker)

function getAPIBase() {
    const host = window.location.hostname;

    // Dang chay local
    if (host === 'localhost' || host === '127.0.0.1') {
        return 'http://localhost:3000/api';
    }

    // Dang chay tren Cloudflare Pages hoac Render (co /api/rss endpoint)
    // Cloudflare Pages Functions tu dong tao /api/rss, /api/news
    if (host.includes('pages.dev') || host.includes('onrender.com') || RENDER_URL) {
        return '/api';
    }

    // Dang chay tren GitHub Pages — Cloudflare Pages Functions khong hoat dong
    // Tra ve null de dung fallback truc tiep
    if (host.includes('github.io')) {
        return RENDER_URL ? RENDER_URL + '/api' : null;
    }

    return '/api';
}

const APP_CONFIG = {
    apiBase: getAPIBase(),
    hasBackend: !!getAPIBase(),
    renderUrl: RENDER_URL,
    isLocal: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    isGitHubPages: window.location.hostname.includes('github.io'),
    workerUrl: WORKER_URL || null,
};
