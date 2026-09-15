'use strict';

// Lo que el owner decide desde el panel: quién administra, qué funciones están
// encendidas, los límites y tiempos, si el registro está abierto y el anuncio
// de la plaza. Se guarda en la base como un solo registro, y se aplica sin
// reiniciar nada.
//
// Los roles:
//   owner  — se fija en el despliegue (PIO_OWNER). Nombra administradores y
//            toca todo lo de acá. Nadie puede actuar sobre el owner.
//   admin  — modera: borra píos y preguntas, oculta cuentas, borra corrales.
//            Nada irreversible sobre personas: borrar una cuenta o editar los
//            emojis del sitio es del owner. Un admin no actúa sobre otro.

const crypto = require('crypto');
const M = require('./modelo');

const FUNCIONES = ['bomba', 'aMano', 'buzon', 'cadenas', 'gifs', 'imagenes', 'chat'];

// Los límites que se pueden tocar, con su rango. Vacío es "el de siempre": lo
// del despliegue o lo de fábrica.
const LIMITES = {
  altas: { min: 1, max: 1000 },
  subidas: { min: 1, max: 1000 },
  incubacionSegundos: { min: 0, max: 120 },
  mechaHoras: { min: 1, max: 168 },
  eslabones: { min: 2, max: 100 },
  buzonPorDia: { min: 1, max: 50 },
};

const MODOS_DE_REGISTRO = ['abierto', 'cerrado', 'invitacion'];

// Sin las letras y números que se confunden al dictarlos o copiarlos.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function nuevoCodigo() {
  return Array.from(crypto.randomBytes(8), (b) => ALFABETO[b % ALFABETO.length]).join('');
}

function deDatos(guardado) {
  const s = guardado && typeof guardado === 'object' ? guardado : {};
  const funciones = {};
  for (const f of FUNCIONES) funciones[f] = !(s.funciones && s.funciones[f] === false);
  const limites = {};
  for (const clave of Object.keys(LIMITES)) {
    if (s.limites && Number.isFinite(s.limites[clave])) limites[clave] = s.limites[clave];
  }
  if (s.limites && typeof s.limites.zona === 'string') limites.zona = s.limites.zona;
  const registro = s.registro && MODOS_DE_REGISTRO.includes(s.registro.modo)
    ? { modo: s.registro.modo, codigo: s.registro.codigo || null }
    : { modo: 'abierto', codigo: null };
  return {
    admins: Array.isArray(s.admins) ? s.admins.slice() : [],
    funciones,
    limites,
    registro,
    anuncio: s.anuncio && s.anuncio.texto ? s.anuncio : null,
  };
}

function zonaValida(zona) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zona });
    return true;
  } catch (err) {
    return false;
  }
}

// Valida un pedido parcial del owner contra lo que ya había, sin tocar nada.
// Devuelve el sitio completo o un error con clave.
function combinar(actual, pedido, quien, ahora = Date.now()) {
  const malo = (clave, datos) => ({ error: { clave, datos } });
  if (!pedido || typeof pedido !== 'object') return malo('sitio.malo');
  const nuevo = deDatos(actual);

  if (pedido.funciones !== undefined) {
    if (!pedido.funciones || typeof pedido.funciones !== 'object') return malo('sitio.malo');
    for (const [f, valor] of Object.entries(pedido.funciones)) {
      if (!FUNCIONES.includes(f) || typeof valor !== 'boolean') return malo('sitio.malo');
      nuevo.funciones[f] = valor;
    }
  }

  if (pedido.limites !== undefined) {
    if (!pedido.limites || typeof pedido.limites !== 'object') return malo('sitio.malo');
    for (const [clave, valor] of Object.entries(pedido.limites)) {
      if (clave === 'zona') {
        if (valor === null || valor === '') { delete nuevo.limites.zona; continue; }
        if (typeof valor !== 'string' || !zonaValida(valor)) return malo('sitio.zona');
        nuevo.limites.zona = valor;
        continue;
      }
      const rango = LIMITES[clave];
      if (!rango) return malo('sitio.malo');
      if (valor === null || valor === '') { delete nuevo.limites[clave]; continue; }
      if (!Number.isInteger(valor) || valor < rango.min || valor > rango.max) {
        return malo('sitio.limite', { campo: clave, min: rango.min, max: rango.max });
      }
      nuevo.limites[clave] = valor;
    }
  }

  if (pedido.registro !== undefined) {
    const r = pedido.registro;
    if (!r || typeof r !== 'object') return malo('sitio.malo');
    if (r.modo !== undefined) {
      if (!MODOS_DE_REGISTRO.includes(r.modo)) return malo('sitio.malo');
      nuevo.registro.modo = r.modo;
    }
    // Pasar a invitación sin código lo estrena; pedir uno nuevo anula el viejo.
    if (r.nuevoCodigo === true || (nuevo.registro.modo === 'invitacion' && !nuevo.registro.codigo)) {
      nuevo.registro.codigo = nuevoCodigo();
    }
  }

  if (pedido.anuncio !== undefined) {
    if (pedido.anuncio === null || (pedido.anuncio && pedido.anuncio.texto === '')) {
      nuevo.anuncio = null;
    } else {
      const texto = pedido.anuncio && pedido.anuncio.texto;
      const error = M.validarPio(texto);
      if (error) return { error };
      nuevo.anuncio = { texto: M.normalizarTexto(texto), creado: ahora, por: quien };
    }
  }

  return { sitio: nuevo };
}

// Un código de invitación se escribe como salga: minúsculas, espacios de más.
function invitacionValida(registro, pedida) {
  if (!registro.codigo) return false;
  const limpio = String(pedida || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const a = Buffer.from(limpio);
  const b = Buffer.from(registro.codigo);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const MENSAJES = {
  'sitio.malo': 'Ese ajuste del sitio no se entiende.',
  'sitio.zona': 'Esa zona horaria no existe.',
  'sitio.limite': 'Ese límite está fuera de rango.',
  'rol.owner': 'Esto es sólo del owner del sitio.',
  'rol.intocable': 'No se puede actuar sobre el owner ni sobre otro administrador.',
  'registro.cerrado': 'Este Pío no está recibiendo cuentas nuevas.',
  'registro.invitacion': 'Para crear una cuenta hace falta un código de invitación válido.',
  'funcion.apagada': 'Esa función está apagada en este Pío.',
};

const mensaje = (clave) => MENSAJES[clave] || MENSAJES['sitio.malo'];

module.exports = { FUNCIONES, LIMITES, MODOS_DE_REGISTRO, deDatos, combinar, invitacionValida, mensaje };
