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
    'nemotron-lightning':                   'nvidia/nemotron-3.5-lightning:free',
    'nemotron':                             'nvidia/nemotron-3.5-lightning:free',
    'liquid':                               'liquid/lfm-2.5-2.6b:free',
    'lfm':                                  'liquid/lfm-2.5-2.6b:free',
    'nvidia/nemotron-3.5-lightning:free':   'nvidia/nemotron-3.5-lightning:free',
    'liquid/lfm-2.5-2.6b:free':             'liquid/lfm-2.5-2.6b:free',
    'nemotron-3-super-120b-a12b:free':      'nvidia/nemotron-3-super-120b-a12b:free',
    'deepseek-chat':                        'deepseek/deepseek-chat',
    'gpt-4o-mini':                          'openai/gpt-4o-mini',
    'gpt-4o':                               'openai/gpt-4o',
    'claude-3-haiku':                       'anthropic/claude-3-haiku',
    'claude-3.5-sonnet':                    'anthropic/claude-3.5-sonnet',
    'gemini-flash-1.5':                     'google/gemini-flash-1.5',
    'gemini-2.0-flash-001':                 'google/gemini-2.0-flash-001',
};

function resolveModel(model) {
    return MODEL_MAP[model] || model;
}

const FAST_FALLBACK_MODELS = [
    'nvidia/nemotron-3.5-lightning:free',
    'liquid/lfm-2.5-2.6b:free',
    'deepseek/deepseek-chat',
    'nvidia/nemotron-3-super-120b-a12b:free'
];

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

    const { messages, model = 'nvidia/nemotron-3.5-lightning:free' } = body;

    if (!messages || !messages.length) {
        return new Response(
            JSON.stringify({ success: false, error: 'Thieu messages' }),
            { status: 400, headers: CORS_HEADERS }
        );
    }

    try {
        const primaryModel = resolveModel(model);
        const candidateModels = [primaryModel, ...FAST_FALLBACK_MODELS.filter(m => m !== primaryModel)];

        let lastError = null;
        for (const curModel of candidateModels) {
            try {
                const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${OPENROUTER_KEY}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': context.request.headers.get('Origin') || context.request.headers.get('Referer') || 'https://tsuk1shima-cs.github.io',
                        'X-Title': 'Chuyen Gia Tai Chinh'
                    },
                    body: JSON.stringify({
                        model: curModel,
                        messages,
                        temperature: 0.6,
                        max_tokens: 1000
                    })
                });

                const data = await res.json();
                if (res.ok && data.choices?.[0]?.message?.content) {
                    return new Response(
                        JSON.stringify({ success: true, message: data.choices[0].message.content, usage: data.usage, modelUsed: curModel }),
                        { status: 200, headers: CORS_HEADERS }
                    );
                }
                lastError = new Error(data.error?.message || `Model ${curModel} error`);
            } catch (err) {
                lastError = err;
            }
        }

        throw lastError || new Error('Khong nhan duoc noi dung tu AI');
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
