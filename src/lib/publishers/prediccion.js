// Publisher para Predicción Ganadora (prediccionganadora.com, cliente Areandina).
// Cliente HTTP puro con cookie jar (sin captcha). Verificado con browse:
//   - login.asp (POST email/clave/hdnEnviado=S/btnIngresar=Entrar) -> 302 a home.asp
//   - partidos.asp?tc=t lista enlaces predecir.asp?id=N&tc=t&el=LOCAL&ev=VISITANTE
//   - predecir.asp?id=N (POST marcador-local/marcador-visitante/hdnEnviado=S)
//     -> redirige a confirmacion-prediccion.asp con "¡PREDICCIÓN GUARDADA CORRECTAMENTE!"
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '.env') });
const { createJar, fetchWithJar } = require('../http');

const BASE = process.env.PG_BASE_URL || 'https://www.prediccionganadora.com';
const CLIENTE_URL = process.env.PG_CLIENTE_URL || `${BASE}/clientes/areandina`;
const decodeEntities = (s) => s.replace(/&amp;/g, '&');

// Sigue una cadena de redirects 302 (manual) reenviando cookies del jar.
async function followRedirects(jar, url, maxHops = 5) {
  let res = await fetchWithJar(jar, url, { redirect: 'manual' });
  for (let i = 0; i < maxHops; i++) {
    const loc = res.headers.get('location');
    if (!loc) break;
    url = new URL(loc, url).toString();
    res = await fetchWithJar(jar, url, { redirect: 'manual' });
  }
  return res;
}

// Visita /clientes/areandina (fija la sesión al cliente correcto) y luego
// POST login.asp; el redirect 302 (manual) trae la cookie de sesión.
async function login(jar) {
  const email = process.env.PG_EMAIL;
  const clave = process.env.PG_CLAVE;
  if (!email || !clave) throw new Error('Faltan PG_EMAIL / PG_CLAVE en .env');

  await followRedirects(jar, CLIENTE_URL);

  const body = new URLSearchParams({ email, clave, hdnEnviado: 'S', btnIngresar: 'Entrar' });
  const res = await fetchWithJar(jar, `${BASE}/login.asp`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  });
  const loc = res.headers.get('location') || '';
  if (!(res.status >= 300 && res.status < 400 && /home\.asp/i.test(loc))) {
    throw new Error(`Predicción Ganadora: login falló (status ${res.status})`);
  }
  await fetchWithJar(jar, new URL(loc, BASE).toString(), { redirect: 'manual' });
  return true;
}

// GET partidos.asp?tc=t y parsea los enlaces de predicción. Soporta las dos URLs:
//   - predecir.asp?id=N&tc=t&el=LOCAL&ev=VISITANTE            (fase de grupos)
//   - predecir-con-penaltis.asp?id=N&...                       (eliminatorias)
// En eliminatorias el form trae además penaltis-local/visitante → flag `penaltis`.
async function listPartidos(jar) {
  const res = await fetchWithJar(jar, `${BASE}/partidos.asp?tc=t`);
  const html = await res.text();
  const re = /predecir(-con-penaltis)?\.asp\?id=(\d+)&(?:amp;)?tc=t&(?:amp;)?el=([^&"]+)&(?:amp;)?ev=([^&"]+)/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    out.push({
      id: Number(m[2]),
      home: decodeEntities(m[3]),
      away: decodeEntities(m[4]),
      penaltis: !!m[1],
    });
  }
  return out;
}

// POST con el marcador. Hace falta un GET previo a la misma URL (abre el "plazo"
// de la predicción en sesión); sin él el POST redirige a plazo-vencido.asp aunque
// el partido siga abierto. En eliminatorias (partido.penaltis) la página es
// predecir-con-penaltis.asp y el form pide además penaltis-local/visitante: se
// PRESERVAN los penaltis ya cargados (se leen del GET); si están vacíos se usa un
// default (PG_PENALTIS_DEFAULT, p.ej. "4-3"). Los penaltis no afectan el marcador
// del tiempo reglamentario; son un bonus independiente del reglamento de PG.
async function setMarcador(jar, partido, gh, ga) {
  const { id, home, away, penaltis } = partido;
  const page = penaltis ? 'predecir-con-penaltis.asp' : 'predecir.asp';
  const url = `${BASE}/${page}?id=${id}&tc=t&el=${encodeURIComponent(home)}&ev=${encodeURIComponent(away)}`;
  const getHtml = await (await fetchWithJar(jar, url)).text();

  const fields = {
    'marcador-local': String(gh),
    'marcador-visitante': String(ga),
    hdnEnviado: 'S',
  };
  if (penaltis) {
    const cur = (n) => (getHtml.match(new RegExp(`id="penaltis-${n}"[^>]*value="(\\d*)"`, 'i')) || [])[1];
    const [defL, defV] = (process.env.PG_PENALTIS_DEFAULT || '4-3').split('-');
    fields['penaltis-local'] = cur('local') || defL || '4';
    fields['penaltis-visitante'] = cur('visitante') || defV || '3';
  }

  const res = await fetchWithJar(jar, url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  const text = await res.text();
  if (!/GUARDADA CORRECTAMENTE/i.test(text)) {
    throw new Error(`Predicción Ganadora: respuesta inesperada al guardar id=${id}`);
  }
  return true;
}

module.exports = { createJar, login, listPartidos, setMarcador };
