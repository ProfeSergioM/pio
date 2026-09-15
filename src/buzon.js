'use strict';

// El buzón: cada perfil puede abrir uno para recibir preguntas, firmadas o
// anónimas si quien lo abre lo permite. Las preguntas son privadas hasta que
// se responden, y la respuesta sale como pío con la pregunta arriba.
//
// Viven dentro de la cuenta de quien las recibe, como sus seguidos o sus
// silenciados: así no hace falta otra tabla, y se van con la cuenta.

// Cuántas puede dejar una misma cuenta en un mismo buzón, en un día. Sin tope,
// quien insiste llena el buzón de otro en un minuto.
const POR_DIA = 3;
const DIA = 24 * 60 * 60 * 1000;
// Cuántas pueden quedar sin responder. Un buzón no es un archivo.
const PENDIENTES = 100;

function deCuenta(cuenta) {
  const b = (cuenta && cuenta.buzon) || {};
  return {
    abierto: !!b.abierto,
    anonimas: !!b.anonimas,
    preguntas: Array.isArray(b.preguntas) ? b.preguntas : [],
    // Quién preguntó cuándo, para el tope por día. Se guarda aparte de las
    // preguntas: borrar o responder una no devuelve el cupo.
    envios: b.envios && typeof b.envios === 'object' ? b.envios : {},
    // Bloqueos puestos desde una pregunta. Van aparte del bloqueo del perfil a
    // propósito: si fueran el mismo, el perfil de quien preguntó anónimo
    // mostraría "bloqueado hasta…" y delataría quién era.
    bloqueados: b.bloqueados && typeof b.bloqueados === 'object' ? b.bloqueados : {},
  };
}

// Deja sólo lo que todavía vale: envíos del último día y bloqueos vigentes.
function podar(buzon, ahora) {
  const envios = {};
  for (const [quien, fechas] of Object.entries(buzon.envios)) {
    const vigentes = (Array.isArray(fechas) ? fechas : []).filter((f) => ahora - f < DIA);
    if (vigentes.length) envios[quien] = vigentes;
  }
  const bloqueados = Object.fromEntries(Object.entries(buzon.bloqueados).filter(([, hasta]) => hasta > ahora));
  return Object.assign({}, buzon, { envios, bloqueados });
}

// Lo que de una pregunta ve quien la recibe: si es anónima, ni rastro de quién.
function publica(pregunta, buscarUsuario) {
  const autor = pregunta.anonima ? null : buscarUsuario(pregunta.de);
  return {
    id: pregunta.id,
    texto: pregunta.texto,
    creado: pregunta.creado,
    anonima: !!pregunta.anonima,
    de: pregunta.anonima
      ? null
      : (autor
        ? { usuario: autor.usuario, nombre: autor.nombre, avatar: autor.avatar || null }
        : { usuario: pregunta.de, nombre: pregunta.de }),
  };
}

const MENSAJES = {
  'buzon.cerrado': 'Este buzón está cerrado.',
  'buzon.propio': 'No puedes dejarte preguntas a ti mismo.',
  'buzon.sinAnonimas': 'Este buzón sólo recibe preguntas firmadas.',
  'buzon.muchas': (d) => `Ya dejaste ${d.n} preguntas hoy en este buzón. Vuelve mañana.`,
  'buzon.lleno': 'Este buzón está lleno. Vuelve más tarde.',
  'buzon.noesta': 'Esa pregunta ya no está.',
  'buzon.malo': 'Ese ajuste del buzón no se entiende.',
};

const mensaje = (clave, datos = {}) => {
  const m = MENSAJES[clave] || MENSAJES['buzon.malo'];
  return typeof m === 'function' ? m(datos) : m;
};

module.exports = { POR_DIA, DIA, PENDIENTES, deCuenta, podar, publica, mensaje };
