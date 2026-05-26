const https = require('https');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    const body = JSON.parse(event.body);

    const payload = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: body.max_tokens || 4000,
      stream: true,
      system: body.system,
      messages: body.messages
    });

    const fullText = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }
      };

      let result = '';
      let errorBody = '';

      const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
          res.on('data', chunk => errorBody += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(errorBody);
              reject(new Error(parsed.error?.message || `API error ${res.statusCode}`));
            } catch(e) {
              reject(new Error(`API error ${res.statusCode}`));
            }
          });
          return;
        }

        res.on('data', chunk => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') return;
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  result += parsed.delta.text;
                }
              } catch(e) { /* skip malformed lines */ }
            }
          }
        });

        res.on('end', () => resolve(result));
        res.on('error', reject);
      });

      req.on('error', reject);
      req.setTimeout(25000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.write(payload);
      req.end();
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: [{ type: 'text', text: fullText }] })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
