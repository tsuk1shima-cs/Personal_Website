// Cloudflare Pages Function — AI news summary
// Endpoint: /api/news
// Lay OPENROUTER_API_KEY tu Cloudflare Pages environment variables

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
};

export async function onRequestPost(context) {
    const OPENROUTER_KEY = context.env.OPENROUTER_API_KEY;

    if (!OPENROUTER_KEY) {
        return new Response(
            JSON.stringify({ success: false, error: 'OPENROUTER_API_KEY chua duoc cau hinh trong Cloudflare Pages environment variables' }),
            { status: 400, headers: CORS_HEADERS }
        );
    }

    const { section = 'full_summary' } = await context.request.json().catch(() => ({}));
    const today = new Date().toLocaleDateString('vi-VN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const systemPrompt = `Bạn là chuyên gia phân tích tài chính chứng khoán Việt Nam. Trả về HTML với thẻ <p>, <strong>, <ul>, <li>, <h3>. Không dùng markdown.`;

    const userPrompt = section === 'market_overview'
        ? `Hôm nay ${today}. Viết 1 đoạn tổng quan (3-4 câu) về thị trường chứng khoán Việt Nam. Dùng <p> và <strong>.`
        : `Hôm nay ${today}. Viết bản tổng hợp thị trường chứng khoán Việt Nam với 4 phần <h3>: Tổng quan, Điểm nhấn, Cổ phiếu đáng chú ý, Vĩ mô. Tiếng Việt, chuyên nghiệp.`;

    try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://tsuk1shima-cs.github.io',
                'X-Title': 'Chuyen Gia Tai Chinh'
            },
            body: JSON.stringify({
                model: 'openai/gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: userPrompt }
                ],
                max_tokens: 1200
            })
        });

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) throw new Error('No content from AI');

        return new Response(
            JSON.stringify({ success: true, content, date: today }),
            { status: 200, headers: CORS_HEADERS }
        );
    } catch (err) {
        return new Response(
            JSON.stringify({ success: false, error: err.message }),
            { status: 500, headers: CORS_HEADERS }
        );
    }
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}
