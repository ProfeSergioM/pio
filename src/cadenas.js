'use strict';

// La cadena: un cuento escrito entre varios. Alguien la empieza con un pío y
// cada uno suma el siguiente eslabón, de cien caracteres como todo. Nadie pone
// dos seguidos, y a los veinte se termina sola.
//
// El primer pío lleva `cadena: { terminada }`; cada eslabón lleva
// `eslabonDe: <id del primero>`. El orden es el de creación.

const MAXIMO = 20;

// Por qué alguien no puede sumar ahora. null es que puede.
function motivoParaNoSumar({ terminada, total, ultimo, yo, ahora, esHuevo }) {
  if (terminada) return 'cadena.terminada';
  if (total >= MAXIMO) return 'cadena.llena';
  if (yo && ultimo.autor === yo.usuario) return 'cadena.seguido';
  // El último todavía es huevo: quien lo escribió puede deshacerlo, y seguir
  // desde ahí sería contestarle a algo que nadie más ve.
  if (esHuevo(ultimo, ahora)) return 'cadena.ocupada';
  return null;
}

const MENSAJES = {
  'cadena.noes': 'Ese pío no es una cadena.',
  'cadena.terminada': 'Esa cadena ya terminó.',
  'cadena.llena': `Esa cadena ya tiene sus ${MAXIMO} eslabones.`,
  'cadena.ocupada': 'Alguien está escribiendo el eslabón anterior. Espera unos segundos.',
  'cadena.seguido': 'El último eslabón es tuyo: deja que siga otro.',
  'cadena.enMedio': 'Sólo se puede borrar el último eslabón de una cadena.',
  'cadena.ajena': 'Sólo quien empezó la cadena puede terminarla.',
};

const mensaje = (clave) => MENSAJES[clave] || MENSAJES['cadena.noes'];

module.exports = { MAXIMO, motivoParaNoSumar, mensaje };
