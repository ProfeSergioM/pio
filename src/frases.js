'use strict';

// De que habla el piobot. Vive aparte porque lo usan dos: el bot de GitHub
// Actions y el latido de adentro del servidor, y una sola copia evita que uno
// de los dos se quede con las frases viejas.
//
// Se arman por partes: con treinta frases sueltas la repeticion se nota a los
// dos dias, y combinando pedazos hay bastante mas variedad por el mismo texto.

const OBSERVACIONES = [
  'Cien caracteres alcanzan para casi todo',
  'Lo que no entra en cien casi nunca era una sola idea',
  'Escribir corto lleva más tiempo que escribir largo',
  'El límite no es un castigo, es un filtro',
  'Nadie extraña los párrafos que no escribió',
  'Un pío que necesita aclaración no estaba listo',
  'Se piensa distinto cuando hay que elegir las palabras',
  'La brevedad obliga a saber qué quería decir uno',
  'Cien caracteres no dan para irse por las ramas',
  'Lo bueno de un límite chico es que se nota enseguida si sobra algo',
];

const REMATES = [
  'y eso está bien',
  'aunque cueste aceptarlo',
  'o al menos eso creo',
  'por suerte',
  'con el tiempo se agradece',
  'digo yo',
  'sin vueltas',
  '',
];

const ETIQUETAS = ['#pio', '#cien', '#breve', '#plaza', '', '', ''];

const alAzar = (lista) => lista[Math.floor(Math.random() * lista.length)];

function armarPio() {
  for (let intento = 0; intento < 20; intento += 1) {
    const partes = [alAzar(OBSERVACIONES)];
    const remate = alAzar(REMATES);
    if (remate) partes.push(remate);
    const texto = `${partes.join(', ')}.`;
    const etiqueta = alAzar(ETIQUETAS);
    const entero = etiqueta ? `${texto} ${etiqueta}` : texto;
    // Se cuenta como cuenta Pio: puntos de codigo, no unidades UTF-16.
    if ([...entero].length <= 100) return entero;
  }
  return `${alAzar(OBSERVACIONES).slice(0, 99)}.`;
}

module.exports = { OBSERVACIONES, REMATES, ETIQUETAS, alAzar, armarPio };
