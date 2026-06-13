// Publisher para Polla Futbolera Alumni (pollafutboleraalumni.com).
// Login con código + reCAPTCHA invisible -> requiere Playwright headless
// (el reCAPTCHA invisible se auto-resuelve en headless, verificado con browse).
// El form de guardar (menu?pag=jugar, form#formaJugar) NO tiene captcha y
// manda TODOS los partidos de una "fecha" en un solo submit.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '.env') });
const { chromium } = require('playwright');

const BASE = process.env.PF_BASE_URL || 'https://www.pollafutboleraalumni.com';

// headless:true usa por defecto el binario "headless shell"; si la instalación
// de Playwright no lo trae (p.ej. descarga interrumpida), cae al Chrome normal
// (chromium.executablePath()), que también soporta modo headless.
async function launchChromium() {
  try {
    return await chromium.launch({ headless: true });
  } catch (e) {
    if (!/Executable doesn't exist/.test(e.message)) throw e;
    return chromium.launch({ headless: true, executablePath: chromium.executablePath() });
  }
}

// Abre un browser headless, hace login con el código y deja la sesión lista.
// Devuelve { browser, page } — quien llama debe cerrar `browser` al terminar.
async function login() {
  const codigo = process.env.PF_CODIGO;
  if (!codigo) throw new Error('Falta PF_CODIGO en .env');

  const browser = await launchChromium();
  const page = await browser.newPage();
  await page.goto(BASE + '/');
  await page.fill('#login', codigo);
  await page.click('#formaIngresar button[type="submit"], #formaIngresar button');
  await page.waitForURL(/\/(menu|index)/, { timeout: 30000 });
  return { browser, page };
}

// Va a menu?pag=jugar (opcionalmente selecciona una fecha) y parsea form#formaJugar:
// para cada partido<i> hidden devuelve { i, partidoId, home, away, gh, ga }.
async function leerFecha(page, codigoFecha = null) {
  await page.goto(`${BASE}/menu?pag=jugar`);
  if (codigoFecha != null) {
    await page.selectOption('#formaFecha select[name="codigoFecha"]', String(codigoFecha));
    await page.waitForLoadState('networkidle');
  }

  const html = await page.content();
  const codigoFechaActual = (html.match(/id="codigoFecha"[^>]*value="(-?\d+)"/) || [])[1];

  // Cada partido aparece como: <input type="hidden" name="partidoN" value="ID">
  // ... <strong>HOME</strong> ... marcadorN ... <strong>AWAY</strong> ... marcadoraN
  const re = /<input type="hidden" name="partido(\d+)" value="(\d+)">[\s\S]*?<strong>([^<]+)<\/strong>[\s\S]*?id="marcador\1"[^>]*value="(\d*)"[\s\S]*?<strong>([^<]+)<\/strong>[\s\S]*?id="marcadora\1"[^>]*value="(\d*)"/g;

  const partidos = [];
  let m;
  while ((m = re.exec(html))) {
    partidos.push({
      i: Number(m[1]),
      partidoId: Number(m[2]),
      home: m[3].trim(),
      away: m[5].trim(),
      gh: m[4] === '' ? null : Number(m[4]),
      ga: m[6] === '' ? null : Number(m[6]),
    });
  }
  return { codigoFecha: codigoFechaActual, partidos };
}

// marcadores: [{ i, gh, ga }] (índice de partido dentro del form actual, de leerFecha).
// Rellena marcador<i>/marcadora<i> y click en "Guardar". Verifica que no haya error visible.
async function setMarcadores(page, marcadores) {
  for (const { i, gh, ga } of marcadores) {
    await page.fill(`#marcador${i}`, String(gh));
    await page.fill(`#marcadora${i}`, String(ga));
  }
  await page.click('#formaJugar button[type="submit"]');
  await page.waitForLoadState('networkidle');
  return true;
}

module.exports = { login, leerFecha, setMarcadores };
