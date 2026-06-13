// Prueba OFFLINE del mensaje de B1 (sin LLM, sin costo): toma los partidos reales
// de hoy de la BD y les inyecta lambdas sintéticas, incluyendo casos donde PG y PF
// sugieren marcadores distintos. Renderiza el mensaje WhatsApp tal como saldría.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { select } = require('../src/lib/supabase');
const { analizarPartido, buildMensaje } = require('../src/refresh');

// lambdas pensadas para forzar variedad: favorito claro (PG≠PF), parejo, visitante favorito.
const LAMBDAS = [
  { lh: 2.1, la: 0.7 }, // favorito local fuerte → PG caza 2-0, PF asegura 1-0
  { lh: 1.4, la: 1.3 }, // parejo → suele coincidir
  { lh: 0.8, la: 2.3 }, // visitante favorito → PG 0-2, PF 0-1
  { lh: 1.7, la: 1.0 }, // favorito local moderado
];

(async () => {
  const ahora = new Date();
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
  const lim = new Date(`${f}T23:59:59-05:00`);
  const rows = await select(
    `select=*&cerrado=eq.false&kickoff=gt.${ahora.toISOString()}&kickoff=lte.${lim.toISOString()}&order=kickoff`
  );
  console.log(`partidos: ${rows.length}\n`);

  const analizados = rows.map((p, i) => {
    const L = LAMBDAS[i % LAMBDAS.length];
    const est0 = { id: p.id, lh: L.lh, la: L.la, conf: 'Media', trascendente: true, facts: `λ sintética ${L.lh}-${L.la} (prueba)`, odds: null };
    const d = analizarPartido(p, est0);
    console.log(`[${p.id}] cargado PG ${p.c_h}-${p.c_a} / PF ${p.c_pf_h}-${p.c_pf_a} | ` +
      `PGseg ${d.anPG.conservative.h}-${d.anPG.conservative.a} PFseg ${d.anPF.conservative.h}-${d.anPF.conservative.a} ` +
      `difiere=${d.difSeguro} cambiar=${d.cambiar} (pg:${d.pg.cambiar} pf:${d.pf.cambiar})`);
    return d;
  });

  const { texto, nCambios } = buildMensaje(analizados);
  console.log(`\nnCambios=${nCambios}\n`);
  console.log('────────── MENSAJE WHATSAPP (simulado, NO enviado) ──────────');
  console.log(texto);
  console.log('─────────────────────────────────────────────────────────────');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
