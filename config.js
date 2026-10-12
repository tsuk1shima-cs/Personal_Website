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

    // Dang chay tren Render (cung domain voi backend)
    if (host.includes('onrender.com')) {
        return '/api';
    }

    // Dang chay tren GitHub Pages hoac domain khac
    // Neu co Render URL thi dung, con khong thi fallback ve truc tiep
    if (RENDER_URL) {
        return RENDER_URL + '/api';
    }

    // Khong co backend — cac tinh nang AI se khong hoat dong
    return null;
}

const APP_CONFIG = {
    apiBase: getAPIBase(),
    hasBackend: !!getAPIBase(),
    renderUrl: RENDER_URL,
    isLocal: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    isGitHubPages: window.location.hostname.includes('github.io'),
    workerUrl: WORKER_URL || null,
};
