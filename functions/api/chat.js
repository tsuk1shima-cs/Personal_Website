// Cloudflare Pages Function — AI Chat
// Endpoint: POST /api/chat
// Can them OPENROUTER_API_KEY vao Cloudflare Pages -> Settings -> Environment Variables

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
};

const MODEL_MAP = {
    'gpt-3.5-turbo':                        'openai/gpt-3.5-turbo',
    'gpt-4o-mini':                          'openai/gpt-4o-mini',
    'gpt-4o':                               'openai/gpt-4o',
    'claude-3-haiku':                       'anthropic/claude-3-haiku',
    'claude-3.5-sonnet':                    'anthropic/claude-3.5-sonnet',
    'gemini-flash-1.5':                     'google/gemini-flash-1.5',
    'gemini-2.0-flash-001':                 'google/gemini-2.0-flash-001',
    'deepseek-chat':                        'deepseek/deepseek-chat',
    'llama-3.1-8b-instruct:free':           'meta-llama/llama-3.1-8b-instruct:free',
    'nemotron-3-super-120b-a12b:free':      'nvidia/nemotron-3-super-120b-a12b:free',
};

function resolveModel(model) {
    return MODEL_MAP[model] || model;
}

export async function onRequestPost(context) {
    const OPENROUTER_KEY = context.env.OPENROUTER_API_KEY;

    if (!OPENROUTER_KEY) {
        return new Response(
            JSON.stringify({ success: false, error: 'OPENROUTER_API_KEY chua duoc cau hinh. Vao Cloudflare Pages -> Settings -> Environment Variables de them key.' }),
            { status: 400, headers: CORS_HEADERS }
        );
    }

    let body;
    try {
        body = await context.request.json();
    } catch {
        return new Response(
            JSON.stringify({ success: false, error: 'Invalid request body' }),
            { status: 400, headers: CORS_HEADERS }
        );
    }

    const { messages, model = 'openai/gpt-4o-mini' } = body;

    if (!messages || !messages.length) {
        return new Response(
            JSON.stringify({ success: false, error: 'Thieu messages' }),
            { status: 400, headers: CORS_HEADERS }
        );
    }

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
                model: resolveModel(model),
                messages,
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error?.message || `OpenRouter error ${res.status}`);
        }

        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error('Khong nhan duoc noi dung tu AI');

        return new Response(
            JSON.stringify({ success: true, message: content, usage: data.usage }),
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
