'use strict';

const M = require('./modelo');

// Reglas de los corrales: los subtemas de Pio. Cada uno tiene su feed y, mas
// adelante, su chat. Puras, sin estado ni E/S, como modelo.js.

const RE_NOMBRE = /^[a-z0-9_]{3,20}$/;
const LIMITE_TITULO = 40;
const LIMITE_DESCRIPCION = 140;

// Nombres que no puede tomar un corral. El criterio es el mismo que con los
// usuarios, pero la lista es mucho mas corta: aca el riesgo no es que alguien
// suplante a una persona, sino que un corral se haga pasar por una seccion del
// sitio o tape una ruta futura.
const RESERVADOS = new Set([
  'general', 'todos', 'inicio', 'home', 'plaza', 'nido', 'avisos', 'buscar',
  'perfil', 'ajustes', 'config', 'admin', 'administracion', 'panel', 'sitio',
  'pio', 'pios', 'oficial', 'staff', 'soporte', 'ayuda', 'moderacion',
  'nuevo', 'crear', 'editar', 'borrar', 'api', 'www', 'corral', 'corrales',
]);

// Lo mismo que hace el cliente al escribir: en vez de rechazar "Cosas de
// Cocina", se lo convierte en "cosas_de_cocina".
function aNombre(crudo) {
  return String(crudo == null ? '' : crudo)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s.-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^_+/, '')
    .slice(0, 20)
    .replace(/_+$/, '');
}

function esReservado(nombre) {
  return RESERVADOS.has(String(nombre == null ? '' : nombre).trim().toLowerCase());
}

function validarNombre(crudo) {
  const nombre = aNombre(crudo);
  if (!nombre) return { clave: 'corral.falta' };
  if (!RE_NOMBRE.test(nombre)) return { clave: 'corral.forma', datos: { min: 3, max: 20 } };
  if (esReservado(nombre)) return { clave: 'corral.reservado' };
  return null;
}

function validarTitulo(crudo) {
  const titulo = M.normalizarTexto(crudo);
  if (!titulo) return { clave: 'corral.sintitulo' };
  if (M.largo(titulo) > LIMITE_TITULO) {
    return { clave: 'corral.titulolargo', datos: { limite: LIMITE_TITULO } };
  }
  return null;
}

function validarDescripcion(crudo) {
  if (M.largo(M.normalizarTexto(crudo)) > LIMITE_DESCRIPCION) {
    return { clave: 'corral.descripcionlarga', datos: { limite: LIMITE_DESCRIPCION } };
  }
  return null;
}

// El espanol de respaldo, igual que en modelo.js: el cliente los dice en su
// idioma a partir de la clave, y esto es lo que se ve si no la conoce.
const EN_ESPANOL = {
  'corral.falta': () => 'Ponle un nombre al corral.',
  'corral.forma': (d) => `El nombre va de ${d.min} a ${d.max} caracteres: minúsculas, números y _.`,
  'corral.reservado': () => 'Ese nombre está guardado para el sitio. Elige otro.',
  'corral.ocupado': () => 'Ya existe un corral con ese nombre.',
  'corral.sintitulo': () => 'Ponle un título, algo que diga de qué se habla.',
  'corral.titulolargo': (d) => `El título no pasa de ${d.limite} caracteres.`,
  'corral.descripcionlarga': (d) => `La descripción no pasa de ${d.limite} caracteres.`,
  'corral.noexiste': () => 'Ese corral no existe.',
  'corral.ajeno': () => 'Ese corral no es tuyo.',
};

function mensaje(error) {
  if (!error) return null;
  const armar = EN_ESPANOL[error.clave];
  return armar ? armar(error.datos || {}) : 'Eso no se puede guardar así.';
}

module.exports = {
  RE_NOMBRE,
  RESERVADOS,
  LIMITE_TITULO,
  LIMITE_DESCRIPCION,
  aNombre,
  esReservado,
  validarNombre,
  validarTitulo,
  validarDescripcion,
  mensaje,
};
