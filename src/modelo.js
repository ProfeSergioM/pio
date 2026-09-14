'use strict';

// Reglas de dominio de Pio. Sin estado ni E/S: todo lo de aqui es puro,
// para poder probarlo sin levantar el servidor.

const LIMITE_PIO = 100;
const LIMITE_BIO = 100;
const LIMITE_NOMBRE = 30;
const RE_USUARIO = /^[a-z0-9_]{3,15}$/;

const { esReservado } = require('./reservados');

// Cuenta puntos de codigo, no unidades UTF-16: un emoji vale 1 caracter.
function largo(texto) {
  return [...String(texto == null ? '' : texto)].length;
}

function recortar(texto, limite) {
  return [...String(texto == null ? '' : texto)].slice(0, limite).join('');
}

function normalizarUsuario(usuario) {
  return String(usuario == null ? '' : usuario).trim().toLowerCase().replace(/^@+/, '');
}

// Colapsa espacios y saltos de linea de mas, pero conserva un salto simple.
function normalizarTexto(texto) {
  return String(texto == null ? '' : texto)
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Las validaciones devuelven una clave y sus datos, no una frase. El texto
// se arma despues: en espanol aca mismo, y en el idioma que sea del otro
// lado, que tiene la misma tabla de claves.
const CLAVE_MINIMA = 6;
const CLAVE_MAXIMA = 200;

function validarUsuario(usuario) {
  const u = normalizarUsuario(usuario);
  if (!u) return { clave: 'usuario.falta' };
  if (!RE_USUARIO.test(u)) return { clave: 'usuario.forma', datos: { min: 3, max: 15 } };
  if (esReservado(u)) return { clave: 'usuario.reservado' };
  return null;
}

function validarNombre(nombre) {
  const n = normalizarTexto(nombre);
  if (!n) return { clave: 'nombre.falta' };
  if (largo(n) > LIMITE_NOMBRE) return { clave: 'nombre.largo', datos: { limite: LIMITE_NOMBRE } };
  return null;
}

function validarClave(clave) {
  const c = String(clave == null ? '' : clave);
  if (largo(c) < CLAVE_MINIMA) return { clave: 'clave.corta', datos: { minimo: CLAVE_MINIMA } };
  if (largo(c) > CLAVE_MAXIMA) return { clave: 'clave.larga', datos: { maximo: CLAVE_MAXIMA } };
  return null;
}

function validarPio(texto) {
  const t = normalizarTexto(texto);
  if (!t) return { clave: 'pio.vacio' };
  if (largo(t) > LIMITE_PIO) {
    return { clave: 'pio.largo', datos: { sobra: largo(t) - LIMITE_PIO, limite: LIMITE_PIO } };
  }
  return null;
}

function validarBio(bio) {
  if (largo(normalizarTexto(bio)) > LIMITE_BIO) {
    return { clave: 'bio.larga', datos: { limite: LIMITE_BIO } };
  }
  return null;
}

// El espanol es el idioma de respaldo del servidor: si el cliente no sabe
// traducir una clave, muestra esto y se entiende igual.
const EN_ESPANOL = {
  'usuario.falta': () => 'Elige un nombre de usuario.',
  'usuario.forma': (d) => `El usuario va de ${d.min} a ${d.max} caracteres: minúsculas, números y _.`,
  'usuario.reservado': () => 'Ese nombre está guardado para el sitio. Elige otro.',
  'nombre.falta': () => 'Pon un nombre para mostrar.',
  'nombre.largo': (d) => `El nombre no puede pasar de ${d.limite} caracteres.`,
  'clave.corta': (d) => `La clave necesita al menos ${d.minimo} caracteres.`,
  'clave.larga': () => 'Esa clave es demasiado larga.',
  'pio.vacio': () => 'Un pío vacío no es un pío.',
  'pio.largo': (d) => `Te pasaste por ${d.sobra}. El límite es ${d.limite}.`,
  'bio.larga': (d) => `La bio tampoco pasa de ${d.limite} caracteres.`,
};

function mensaje(error) {
  if (!error) return null;
  const armar = EN_ESPANOL[error.clave];
  return armar ? armar(error.datos || {}) : 'Eso no se puede guardar así.';
}

function etiquetas(texto) {
  const encontradas = new Set();
  for (const m of String(texto == null ? '' : texto).matchAll(/#([\p{L}\p{N}_]{1,50})/gu)) {
    encontradas.add(m[1].toLowerCase());
  }
  return [...encontradas];
}

function menciones(texto) {
  const encontradas = new Set();
  for (const m of String(texto == null ? '' : texto).matchAll(/@([a-zA-Z0-9_]{3,15})/g)) {
    encontradas.add(m[1].toLowerCase());
  }
  return [...encontradas];
}

module.exports = {
  LIMITE_PIO,
  LIMITE_BIO,
  LIMITE_NOMBRE,
  RE_USUARIO,
  largo,
  recortar,
  normalizarUsuario,
  normalizarTexto,
  validarUsuario,
  validarNombre,
  validarClave,
  validarPio,
  validarBio,
  mensaje,
  etiquetas,
  menciones,
};
