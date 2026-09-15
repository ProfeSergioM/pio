'use strict';

// La granja duerme: de noche las notificaciones no suenan en el teléfono, y
// quien quiera puede ponerse un tope suave de píos por día. Las dos cosas son
// de cada cuenta y las decide cada uno; acá viven sus reglas.

const PR = require('./preguntas');

// Encendido de fábrica, de once a siete: la mayoría de la gente no entra a
// buscar este ajuste, y que un "le gustó tu pío" despierte a alguien a las tres
// de la mañana es justo lo que Pío no quiere ser.
const POR_DEFECTO = { silencio: true, desde: 23, hasta: 7, zona: null, tope: 0 };

// Pocos topes y claros, como los plazos del bloqueo. Cero es sin tope.
const TOPES = [0, 5, 10, 20];

const esHora = (n) => Number.isInteger(n) && n >= 0 && n <= 23;

function zonaValida(zona) {
  if (typeof zona !== 'string' || !zona || zona.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zona });
    return true;
  } catch (err) {
    return false;
  }
}

// Lo guardado, con lo que falte rellenado de fábrica.
function deCuenta(cuenta) {
  return Object.assign({}, POR_DEFECTO, (cuenta && cuenta.descanso) || {});
}

// Valida un pedido parcial contra lo que ya había. Devuelve el descanso
// completo o un error con clave, igual que las validaciones del modelo.
function combinar(actual, pedido) {
  if (!pedido || typeof pedido !== 'object' || Array.isArray(pedido)) {
    return { error: { clave: 'descanso.malo' } };
  }
  const nuevo = Object.assign({}, POR_DEFECTO, actual || {});
  if (pedido.silencio !== undefined) {
    if (typeof pedido.silencio !== 'boolean') return { error: { clave: 'descanso.malo' } };
    nuevo.silencio = pedido.silencio;
  }
  for (const campo of ['desde', 'hasta']) {
    if (pedido[campo] === undefined) continue;
    if (!esHora(pedido[campo])) return { error: { clave: 'descanso.hora' } };
    nuevo[campo] = pedido[campo];
  }
  if (nuevo.desde === nuevo.hasta) return { error: { clave: 'descanso.igual' } };
  if (pedido.zona !== undefined) {
    if (!zonaValida(pedido.zona)) return { error: { clave: 'descanso.zona' } };
    nuevo.zona = pedido.zona;
  }
  if (pedido.tope !== undefined) {
    if (!TOPES.includes(pedido.tope)) return { error: { clave: 'descanso.tope' } };
    nuevo.tope = pedido.tope;
  }
  return { descanso: nuevo };
}

// La hora del reloj de quien duerme, no la del servidor.
function horaEn(zona, ahora) {
  const formato = (tz) => Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', hourCycle: 'h23',
  }).format(new Date(ahora)));
  try {
    return formato(zona || 'UTC');
  } catch (err) {
    return formato('UTC');
  }
}

// Si el horario cruza la medianoche —de 23 a 7— se duerme antes de "hasta" o
// desde "desde"; si no —de 13 a 15, una siesta—, entre los dos.
function durmiendo(descanso, zonaDelSitio, ahora = Date.now()) {
  if (!descanso.silencio) return false;
  const hora = horaEn(descanso.zona || zonaDelSitio, ahora);
  return descanso.desde > descanso.hasta
    ? hora >= descanso.desde || hora < descanso.hasta
    : hora >= descanso.desde && hora < descanso.hasta;
}

// Cuántos píos lleva hoy, contado en el día de quien pía.
function piosDeHoy(pios, usuario, zona, ahora = Date.now()) {
  const hoy = PR.hoy(zona, ahora);
  const desde = ahora - 36 * 60 * 60 * 1000; // ningún día dura más que esto en ninguna zona
  return pios.filter((p) => p.autor === usuario && p.creado >= desde && PR.hoy(zona, p.creado) === hoy).length;
}

const MENSAJES = {
  'descanso.malo': 'Ese ajuste de descanso no se entiende.',
  'descanso.hora': 'Las horas van de 0 a 23.',
  'descanso.igual': 'El silencio tiene que empezar y terminar a horas distintas.',
  'descanso.zona': 'Esa zona horaria no existe.',
  'descanso.tope': 'Ese tope no está entre los que se ofrecen.',
};

const mensaje = (error) => MENSAJES[error.clave] || MENSAJES['descanso.malo'];

module.exports = { POR_DEFECTO, TOPES, deCuenta, combinar, durmiendo, piosDeHoy, horaEn, mensaje };
