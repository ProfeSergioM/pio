'use strict';

// Medallitas por cantidad de seguidores. Una sola por pollito: la mas alta que
// haya alcanzado, no una hilera que crece para siempre.
//
// Van SOLO en el perfil. En cada pio serian un adorno repetido cien veces por
// pantalla, y lo que se pidio fue un sitio poco recargado.
//
// El nombre de cada una viaja como clave, no como texto: quien las muestra las
// dice en el idioma que corresponda.

const ESCALONES = [
  { desde: 10, clave: 'huevo', figura: '🥚' },
  { desde: 25, clave: 'cascaron', figura: '🐣' },
  { desde: 50, clave: 'pollito', figura: '🐤' },
  { desde: 100, clave: 'gallo', figura: '🐓' },
  { desde: 200, clave: 'pato', figura: '🦆' },
  { desde: 500, clave: 'cisne', figura: '🦢' },
  { desde: 1000, clave: 'buho', figura: '🦉' },
  { desde: 5000, clave: 'aguila', figura: '🦅' },
  { desde: 10000, clave: 'pavoreal', figura: '🦚' },
];

// Devuelve la medalla alcanzada, o null si todavia no llego a la primera.
// Se recorre de arriba hacia abajo para quedarse con la mas alta.
function medallaDe(seguidores) {
  const cuantos = Number(seguidores);
  if (!Number.isFinite(cuantos) || cuantos < 0) return null;
  for (let i = ESCALONES.length - 1; i >= 0; i -= 1) {
    if (cuantos >= ESCALONES[i].desde) {
      return { clave: ESCALONES[i].clave, figura: ESCALONES[i].figura, desde: ESCALONES[i].desde };
    }
  }
  return null;
}

// Cuantos seguidores faltan para la siguiente, o null si ya esta en la ultima.
// Sirve para decirlo en el perfil propio sin que el de al lado lo vea.
function faltanPara(seguidores) {
  const cuantos = Number(seguidores) || 0;
  const proximo = ESCALONES.find((e) => cuantos < e.desde);
  return proximo ? { clave: proximo.clave, desde: proximo.desde, faltan: proximo.desde - cuantos } : null;
}

module.exports = { ESCALONES, medallaDe, faltanPara };
