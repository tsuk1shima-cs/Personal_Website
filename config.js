// Cau hinh URL backend
// - Local: dung localhost:3000
// - Render/Production: dien URL Render cua ban vao RENDER_URL

const RENDER_URL = ''; // VD: 'https://chuyen-gia-tai-chinh.onrender.com'
const WORKER_URL = ''; // VD: 'https://rss-proxy.username.workers.dev' (Cloudflare Worker)

function getAPIBase() {
    const host = window.location.hostname;

    // Dang chay local (localhost, 127.0.0.1, Live Server hoac mo file truc tiep tren may)
    if (host === 'localhost' || host === '127.0.0.1' || host === '' || (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:')) {
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
    isLocal: (typeof window !== 'undefined' && window.location) ? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '' || window.location.protocol === 'file:') : true,
    isGitHubPages: (typeof window !== 'undefined' && window.location) ? window.location.hostname.includes('github.io') : false,
    workerUrl: WORKER_URL || null,
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    defaultModelName: 'Nemotron 3 Ultra 550B Free (NVIDIA)',
};
