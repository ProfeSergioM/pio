'use strict';

// Reglas de dominio de Pio. Sin estado ni E/S: todo lo de aqui es puro,
// para poder probarlo sin levantar el servidor.

const LIMITE_PIO = 100;
const LIMITE_BIO = 100;
const LIMITE_NOMBRE = 30;
const RE_USUARIO = /^[a-z0-9_]{3,15}$/;

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

function validarUsuario(usuario) {
  const u = normalizarUsuario(usuario);
  if (!u) return 'Elegi un nombre de usuario.';
  if (!RE_USUARIO.test(u)) return 'El usuario va de 3 a 15 caracteres: minusculas, numeros y _.';
  return null;
}

function validarNombre(nombre) {
  const n = normalizarTexto(nombre);
  if (!n) return 'Poné un nombre para mostrar.';
  if (largo(n) > LIMITE_NOMBRE) return `El nombre no puede pasar de ${LIMITE_NOMBRE} caracteres.`;
  return null;
}

function validarClave(clave) {
  const c = String(clave == null ? '' : clave);
  if (largo(c) < 6) return 'La clave necesita al menos 6 caracteres.';
  if (largo(c) > 200) return 'Esa clave es demasiado larga.';
  return null;
}

function validarPio(texto) {
  const t = normalizarTexto(texto);
  if (!t) return 'Un pio vacio no es un pio.';
  if (largo(t) > LIMITE_PIO) return `Te pasaste por ${largo(t) - LIMITE_PIO}. El limite es ${LIMITE_PIO}.`;
  return null;
}

function validarBio(bio) {
  if (largo(normalizarTexto(bio)) > LIMITE_BIO) return `La bio tampoco pasa de ${LIMITE_BIO} caracteres.`;
  return null;
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
  etiquetas,
  menciones,
};
