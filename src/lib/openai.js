// Cliente mínimo de OpenAI Responses API con la herramienta web_search.
// gpt-5 es modelo de razonamiento: damos max_output_tokens holgado para que
// quede espacio al JSON final después del razonamiento + búsquedas.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-5';

// Llama a la Responses API. Devuelve { text, searches, raw }.
async function respond({ system, input, webSearch = true, maxOutputTokens = 8000, effort = 'medium' }) {
  if (!KEY) throw new Error('Falta OPENAI_API_KEY en .env');

  const body = {
    model: MODEL,
    instructions: system,
    input,
    max_output_tokens: maxOutputTokens,
    reasoning: { effort },
  };
  if (webSearch) body.tools = [{ type: 'web_search' }];

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(json.error || json).slice(0, 400)}`);

  // status incompleto (se acabaron los tokens) → avisar
  if (json.status === 'incomplete') {
    const reason = json.incomplete_details && json.incomplete_details.reason;
    throw new Error(`OpenAI respuesta incompleta (${reason}). Sube max_output_tokens.`);
  }

  let text = json.output_text;
  if (!text && Array.isArray(json.output)) {
    text = json.output
      .filter((o) => o.type === 'message')
      .flatMap((m) => m.content || [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('');
  }
  const searches = Array.isArray(json.output)
    ? json.output.filter((o) => o.type === 'web_search_call').length
    : 0;

  return { text: (text || '').trim(), searches, raw: json };
}

// Extrae el primer array JSON de un texto, limpiando fences ```json.
function extractJsonArray(text) {
  let t = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) throw new Error('No se encontró array JSON en la respuesta');
  return JSON.parse(t.slice(start, end + 1));
}

module.exports = { respond, extractJsonArray, MODEL };
