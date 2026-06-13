// Prueba de src/lib/publishers/futbolera.js: login con código (reCAPTCHA
// invisible debe auto-resolverse en headless) y lectura de la fecha por defecto.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const futbolera = require('../src/lib/publishers/futbolera');

(async () => {
  console.log('Login...');
  const { browser, page } = await futbolera.login();
  try {
    console.log('Login OK, url=', page.url());
    const { codigoFecha, partidos } = await futbolera.leerFecha(page);
    console.log(`codigoFecha=${codigoFecha}, ${partidos.length} partidos`);
    console.log(partidos);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
