'use strict';

const M = require('./modelo');

// Los mensajes del chat de un corral.
//
// No llevan el limite de cien: los cien caracteres son la identidad del pio,
// que es publico y queda. Una conversacion es otra cosa, y "tipo WhatsApp" con
// cien caracteres no seria tipo WhatsApp. Trescientos acota sin ahogar.
const LIMITE = 300;

// Cuantos se traen de una. El chat mira lo reciente; para lo viejo esta el
// historial, que por ahora no existe.
const POR_TANDA = 50;

function validar(texto) {
  const limpio = M.normalizarTexto(texto);
  if (!limpio) return { clave: 'mensaje.vacio' };
  if (M.largo(limpio) > LIMITE) {
    return { clave: 'mensaje.largo', datos: { sobra: M.largo(limpio) - LIMITE, limite: LIMITE } };
  }
  return null;
}

const EN_ESPANOL = {
  'mensaje.vacio': () => 'Un mensaje vacío no dice nada.',
  'mensaje.largo': (d) => `Te pasaste por ${d.sobra}. El límite del chat es ${d.limite}.`,
  'mensaje.afuera': () => 'Entra al corral para poder escribir en él.',
};

function mensaje(error) {
  if (!error) return null;
  const armar = EN_ESPANOL[error.clave];
  return armar ? armar(error.datos || {}) : 'Eso no se puede decir así.';
}

module.exports = { LIMITE, POR_TANDA, validar, mensaje };
