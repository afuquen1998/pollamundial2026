// Mini cookie jar sobre fetch nativo (Node 20 / undici).
// Útil para clientes HTTP puros que necesitan mantener sesión por cookie.

function createJar() {
  return new Map(); // nombre -> valor
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function updateJar(jar, res) {
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const sc of setCookies) {
    const pair = sc.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    jar.set(name, value);
  }
}

// fetch con cookie jar: envía las cookies guardadas y guarda las que llegan en la respuesta.
// Soporta opts.redirect = 'manual' para capturar Set-Cookie de un 302 sin seguirlo.
async function fetchWithJar(jar, url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const cookie = cookieHeader(jar);
  if (cookie) headers.cookie = cookie;
  const res = await fetch(url, { ...opts, headers });
  updateJar(jar, res);
  return res;
}

module.exports = { createJar, fetchWithJar, cookieHeader, updateJar };
