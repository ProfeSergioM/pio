'use strict';

const crypto = require('crypto');

// Codigos de recuperacion. Pio no guarda el correo de nadie, asi que no hay a
// donde mandar un enlace: en vez de eso, al crear la cuenta se entrega un
// codigo que sirve una sola vez para poner una clave nueva.
//
// El codigo se guarda HASHEADO, igual que la clave. Si alguien se lleva la
// base, se lleva hashes: no se lleva la llave de todas las cuentas.

// Sin 0, O, 1, I ni L: son las que se copian mal de un papel, y este codigo
// esta hecho para copiarse de un papel.
const LETRAS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const GRUPOS = 3;
const POR_GRUPO = 5;

function generar() {
  // randomInt del modulo crypto, no Math.random: esto es una credencial.
  const partes = [];
  for (let g = 0; g < GRUPOS; g += 1) {
    let grupo = '';
    for (let i = 0; i < POR_GRUPO; i += 1) grupo += LETRAS[crypto.randomInt(LETRAS.length)];
    partes.push(grupo);
  }
  return `PIO-${partes.join('-')}`;
}

// Se acepta escrito como sea: con guiones o sin ellos, en minusculas, con
// espacios de mas. Lo que no se acepta es que sea otro codigo.
function normalizar(crudo) {
  return String(crudo == null ? '' : crudo)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^PIO/, '');
}

function hashear(codigo, sal) {
  return crypto.scryptSync(normalizar(codigo), sal, 32).toString('hex');
}

function guardable(codigo) {
  const sal = crypto.randomBytes(16).toString('hex');
  return { sal, hash: hashear(codigo, sal) };
}

// Comparacion en tiempo constante: si tardara distinto segun cuantas letras
// coinciden, se podria adivinar el codigo letra por letra.
function coincide(codigo, guardado) {
  if (!guardado || !guardado.sal || !guardado.hash) return false;
  const limpio = normalizar(codigo);
  if (limpio.length !== GRUPOS * POR_GRUPO) return false;
  const intento = Buffer.from(hashear(limpio, guardado.sal), 'hex');
  const bueno = Buffer.from(guardado.hash, 'hex');
  if (intento.length !== bueno.length) return false;
  return crypto.timingSafeEqual(intento, bueno);
}

module.exports = { generar, normalizar, guardable, coincide, LETRAS, GRUPOS, POR_GRUPO };
