'use strict';

const zlib = require('zlib');
const LOGO = require('./logo');

// Las imágenes PNG de Pío: la que acompaña a un pío compartido cuando el pío no
// trae la suya, y los íconos de la app instalada.
//
// Las redes no aceptan SVG en la vista previa, y el proyecto no usa
// dependencias, así que se dibuja a mano: un lienzo de píxeles, unas pocas
// figuras y un PNG armado con el zlib que ya trae Node. El logo sale de
// src/logo.js, el mismo del que sale el SVG de la página. Cada imagen se dibuja
// una vez, la primera vez que alguien la pide, y queda en memoria.

const ANCHO = 1200;
const ALTO = 630;
// Cada píxel se muestrea cuatro veces: sin eso los bordes quedan en escalera.
const MUESTRAS = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];

const CREMA = [255, 244, 209];
const LETRA = [32, 29, 22];

const anillo = (cx, cy, fuera, dentroR, recorte = () => true) => ({
  caja: [cx - fuera, cy - fuera, cx + fuera, cy + fuera],
  dentro: (x, y) => {
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    return d <= fuera * fuera && d >= dentroR * dentroR && recorte(x, y);
  },
});

const rectangulo = (x0, y0, x1, y1) => ({
  caja: [x0, y0, x1, y1],
  dentro: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1,
});

const poligono = (puntos) => ({
  caja: [
    Math.min(...puntos.map((p) => p[0])), Math.min(...puntos.map((p) => p[1])),
    Math.max(...puntos.map((p) => p[0])), Math.max(...puntos.map((p) => p[1])),
  ],
  dentro: (x, y) => {
    let adentro = false;
    for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i, i += 1) {
      const [xi, yi] = puntos[i];
      const [xj, yj] = puntos[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) adentro = !adentro;
    }
    return adentro;
  },
});

// La misma figura, agrandada `k` veces desde la grilla de 100 del logo y con
// su esquina (0, 0) llevada a (ox, oy).
function escalada(figura, k, ox, oy) {
  const [x0, y0, x1, y1] = figura.caja;
  return {
    caja: [x0 * k + ox, y0 * k + oy, x1 * k + ox, y1 * k + oy],
    dentro: (x, y) => figura.dentro((x - ox) / k, (y - oy) / k),
  };
}

// El logo en un cuadrado de `lado` píxeles con esquina en (ox, oy).
function logoEn(lado, ox, oy, opciones) {
  const k = lado / 100;
  return LOGO.figurasDelLogo(opciones).map(([figura, color]) => [escalada(figura, k, ox, oy), color]);
}

// La imagen para compartir: el logo a la izquierda y "Pío" en letras hechas de
// figuras a la derecha.
function figuras() {
  return [
    ...logoEn(430, 175, 100),
    [rectangulo(700, 195, 748, 430), LETRA],
    [anillo(756, 272, 77, 29, (x) => x >= 748), LETRA],
    [rectangulo(888, 282, 936, 430), LETRA],
    [poligono([[898, 260], [940, 260], [988, 192], [946, 192]]), LETRA],
    [anillo(1070, 356, 78, 30), LETRA],
  ];
}

function pintarLienzo(ancho, alto, lista, fondo = CREMA) {
  const pixeles = Buffer.alloc(ancho * alto * 3);
  for (let i = 0; i < ancho * alto; i += 1) pixeles.set(fondo, i * 3);

  for (const [figura, color] of lista) {
    const [x0, y0, x1, y1] = figura.caja;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(alto - 1, Math.ceil(y1)); y += 1) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(ancho - 1, Math.ceil(x1)); x += 1) {
        let cubre = 0;
        for (const [dx, dy] of MUESTRAS) if (figura.dentro(x + dx, y + dy)) cubre += 1;
        if (!cubre) continue;
        const k = cubre / MUESTRAS.length;
        const i = (y * ancho + x) * 3;
        for (let c = 0; c < 3; c += 1) {
          pixeles[i + c] = Math.round(pixeles[i + c] * (1 - k) + color[c] * k);
        }
      }
    }
  }
  return pixeles;
}

// --- PNG -------------------------------------------------------------------

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const b of buffer) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const tipoYDatos = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tipoYDatos));
  return Buffer.concat([largo, tipoYDatos, crc]);
}

function comoPng(pixeles, ancho, alto) {
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(ancho, 0);
  cabecera.writeUInt32BE(alto, 4);
  cabecera[8] = 8; // bits por canal
  cabecera[9] = 2; // color verdadero, sin transparencia
  // Cada fila empieza con su filtro; cero es "sin filtro".
  const crudo = Buffer.alloc((ancho * 3 + 1) * alto);
  for (let y = 0; y < alto; y += 1) {
    pixeles.copy(crudo, y * (ancho * 3 + 1) + 1, y * ancho * 3, (y + 1) * ancho * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', cabecera),
    trozo('IDAT', zlib.deflateSync(crudo, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

let guardada = null;

function imagenParaCompartir() {
  if (!guardada) guardada = comoPng(pintarLienzo(ANCHO, ALTO, figuras()), ANCHO, ALTO);
  return guardada;
}

// --- íconos de la app ----------------------------------------------------------

// El ícono es el logo mismo, pero sin su cuadrado redondeado: el fondo naranja
// llega hasta el borde, porque Android y el iPhone ya le ponen su propia forma.
// `ocupa` es cuánto del lado usa el dibujo; el enmascarable deja más aire,
// porque cada Android lo recorta distinto y sólo respeta el centro.
const ICONOS = {
  'pio-192.png': { lado: 192, ocupa: 1 },
  'pio-512.png': { lado: 512, ocupa: 1 },
  'pio-mascara-512.png': { lado: 512, ocupa: 0.8 },
  'apple-180.png': { lado: 180, ocupa: 1 },
};

const iconosGuardados = new Map();

function icono(nombre) {
  const pedido = ICONOS[nombre];
  if (!pedido) return null;
  if (!iconosGuardados.has(nombre)) {
    const { lado, ocupa } = pedido;
    const dibujo = lado * ocupa;
    const margen = (lado - dibujo) / 2;
    const lista = logoEn(dibujo, margen, margen, { conFondo: false });
    const fondo = LOGO.rgb(LOGO.COLORES.fondo);
    iconosGuardados.set(nombre, comoPng(pintarLienzo(lado, lado, lista, fondo), lado, lado));
  }
  return iconosGuardados.get(nombre);
}

module.exports = { imagenParaCompartir, icono, ICONOS, ANCHO, ALTO };
