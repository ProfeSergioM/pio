'use strict';

// Piobot: publica un pío cada tanto, al azar, para que la plaza no esté nunca
// del todo callada mientras el sitio se prueba.
//
// Vive en GitHub Actions, cuyo programador es poco de fiar: llega tarde, y las
// tareas que caen en minutos redondos las descarta sin aviso. Por eso el
// intervalo entre pios NO se le pide al cron: cada ejecucion se queda su ronda
// dando vueltas y va piando con esperas al azar de tres a catorce minutos. El
// cron solo tiene que lograr arrancar una ronda cada tanto.
//
// Variables que necesita:
//   PIO_SITIO       https://tu-sitio.onrender.com
//   PIOBOT_USUARIO  el usuario del bot
//   PIOBOT_CLAVE    su clave
//   PIOBOT_MINUTOS  cuanto dura la ronda (por defecto 25)

const { armarPio } = require('../src/frases');

const SITIO = (process.env.PIO_SITIO || '').replace(/\/+$/, '');
const USUARIO = process.env.PIOBOT_USUARIO;
const CLAVE = process.env.PIOBOT_CLAVE;
const RONDA = (Number(process.env.PIOBOT_MINUTOS) || 25) * 60 * 1000;

const ESPERA_MINIMA = 3 * 60 * 1000;
const ESPERA_MAXIMA = 14 * 60 * 1000;

const entre = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const dormir = (ms) => new Promise((listo) => setTimeout(listo, ms));

async function pedir(ruta, opciones = {}) {
  const respuesta = await fetch(`${SITIO}/api${ruta}`, {
    method: opciones.metodo || 'GET',
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      opciones.token ? { Authorization: `Bearer ${opciones.token}` } : {},
    ),
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
  });
  const datos = await respuesta.json().catch(() => ({}));
  return { estado: respuesta.status, datos };
}

async function main() {
  if (!SITIO || !USUARIO || !CLAVE) {
    console.error('Faltan PIO_SITIO, PIOBOT_USUARIO o PIOBOT_CLAVE.');
    process.exit(1);
  }

  const entrada = await pedir('/sesion', {
    metodo: 'POST',
    cuerpo: { usuario: USUARIO, clave: CLAVE },
  });
  if (entrada.estado !== 200) {
    console.error(`No pude entrar como @${USUARIO}: ${entrada.estado} ${entrada.datos.error || ''}`);
    process.exit(1);
  }
  const token = entrada.datos.token;
  console.log(`Entré como @${USUARIO}. Ronda de ${Math.round(RONDA / 60000)} minutos.`);

  const hasta = Date.now() + RONDA;
  let piados = 0;

  // Se pía primero y se espera despues: si la ronda se corta, ya hubo un pio.
  while (Date.now() < hasta) {
    const texto = armarPio();
    const r = await pedir('/pios', { metodo: 'POST', token, cuerpo: { texto } });
    if (r.estado === 201) {
      piados += 1;
      console.log(`pío: ${texto}`);
    } else {
      console.error(`no pude piar: ${r.estado} ${r.datos.error || ''}`);
      // Un 429 o un 401 no se arreglan reintentando en treinta segundos.
      if (r.estado === 401 || r.estado === 429) break;
    }

    const espera = entre(ESPERA_MINIMA, ESPERA_MAXIMA);
    if (Date.now() + espera >= hasta) break;
    console.log(`espero ${Math.round(espera / 60000)} minutos`);
    await dormir(espera);
  }

  // Sin esto queda una sesión abierta por ronda —casi cien por día— tirada en
  // la base para siempre. Pío todavía no las vence solo.
  await pedir('/sesion', { metodo: 'DELETE', token }).catch(() => {});

  console.log(`Ronda terminada: ${piados} pío${piados === 1 ? '' : 's'}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
