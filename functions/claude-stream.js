export async function onRequestPost(context) {
  const apiKey = context.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await context.request.json();
    const model = context.env.CLAUDE_MODEL || 'claude-haiku-4-5';

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        stream: true,
        system: body.system,
        messages: body.messages
      })
    });

    if (!anthropicResponse.ok) {
      const err = await anthropicResponse.json();
      return new Response(
        JSON.stringify({ error: err.error?.message || `API error ${anthropicResponse.status}` }),
        { status: anthropicResponse.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Stream SSE directly to browser
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    context.waitUntil((async () => {
      const reader = anthropicResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'event: message_stop') continue;

            if (trimmed.startsWith('data: ')) {
              const data = trimmed.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                  await writer.write(encoder.encode(
                    `data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`
                  ));
                } else if (parsed.type === 'message_stop') {
                  await writer.write(encoder.encode('data: [DONE]\n\n'));
                }
              } catch(_) {}
            }
          }
        }
      } finally {
        writer.close();
      }
    })());

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
