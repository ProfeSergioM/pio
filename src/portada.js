'use strict';

const zlib = require('zlib');

// La imagen que acompaña a un pío compartido cuando el pío no trae la suya.
//
// Las redes no aceptan SVG en la vista previa, y el proyecto no usa
// dependencias, así que se dibuja a mano: un lienzo de píxeles, unas pocas
// figuras —círculos, anillos, polígonos— y un PNG armado con el zlib que ya
// trae Node. Se dibuja una vez, la primera vez que alguien la pide, y queda en
// memoria.

const ANCHO = 1200;
const ALTO = 630;
// Cada píxel se muestrea cuatro veces: sin eso los bordes de los círculos
// quedan en escalera.
const MUESTRAS = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];

const COLOR = {
  fondo: [255, 244, 209],
  cuerpo: [255, 198, 26],
  ala: [242, 169, 0],
  pico: [240, 124, 31],
  ojo: [42, 33, 9],
  letra: [32, 29, 22],
};

const circulo = (cx, cy, r) => ({
  caja: [cx - r, cy - r, cx + r, cy + r],
  dentro: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r,
});

const elipse = (cx, cy, rx, ry) => ({
  caja: [cx - rx, cy - ry, cx + rx, cy + ry],
  dentro: (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1,
});

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

// El pollito, en las coordenadas de la imagen de 1200 por 630. Los íconos
// usan el mismo, achicado: un solo dibujo, así nunca quedan distintos.
function pollito() {
  return [
    [rectangulo(300, 505, 322, 570), COLOR.pico],
    [rectangulo(398, 505, 420, 570), COLOR.pico],
    [circulo(360, 330, 195), COLOR.cuerpo],
    [elipse(300, 380, 88, 58), COLOR.ala],
    [poligono([[530, 300], [612, 335], [530, 370]]), COLOR.pico],
    [circulo(440, 270, 20), COLOR.ojo],
  ];
}

// Lo que ocupa el pollito de punta a punta: del ala a la punta del pico, de
// la coronilla a las patas.
const CAJA_POLLITO = { x0: 165, y0: 135, x1: 612, y1: 570 };

// En orden: lo de abajo primero.
function figuras() {
  return [
    ...pollito(),

    // "Pío", en letras hechas de figuras.
    [rectangulo(660, 195, 708, 430), COLOR.letra],
    [anillo(716, 272, 77, 29, (x) => x >= 708), COLOR.letra],
    [rectangulo(848, 282, 896, 430), COLOR.letra],
    [poligono([[858, 260], [900, 260], [948, 192], [906, 192]]), COLOR.letra],
    [anillo(1030, 356, 78, 30), COLOR.letra],
  ];
}

// La misma figura, achicada `k` veces y con su punto (cx, cy) llevado a (ox, oy).
function escalada(figura, k, cx, cy, ox, oy) {
  const [x0, y0, x1, y1] = figura.caja;
  return {
    caja: [(x0 - cx) * k + ox, (y0 - cy) * k + oy, (x1 - cx) * k + ox, (y1 - cy) * k + oy],
    dentro: (x, y) => figura.dentro((x - ox) / k + cx, (y - oy) / k + cy),
  };
}

function dibujar() {
  return pintarLienzo(ANCHO, ALTO, figuras());
}

function pintarLienzo(ancho, alto, lista) {
  const pixeles = Buffer.alloc(ancho * alto * 3);
  for (let i = 0; i < ancho * alto; i += 1) pixeles.set(COLOR.fondo, i * 3);

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
  if (!guardada) guardada = comoPng(dibujar(), ANCHO, ALTO);
  return guardada;
}

// --- íconos de la app ----------------------------------------------------------

// Los que piden Android e iPhone para instalar Pío. El "enmascarable" deja más
// aire alrededor: cada Android lo recorta con su forma —círculo, gota,
// cuadrado redondeado— y sólo respeta el centro.
const ICONOS = {
  'pio-192.png': { lado: 192, ocupa: 0.72 },
  'pio-512.png': { lado: 512, ocupa: 0.72 },
  'pio-mascara-512.png': { lado: 512, ocupa: 0.56 },
  'apple-180.png': { lado: 180, ocupa: 0.68 },
};

const iconosGuardados = new Map();

function icono(nombre) {
  const pedido = ICONOS[nombre];
  if (!pedido) return null;
  if (!iconosGuardados.has(nombre)) {
    const { lado, ocupa } = pedido;
    const ancho = CAJA_POLLITO.x1 - CAJA_POLLITO.x0;
    const alto = CAJA_POLLITO.y1 - CAJA_POLLITO.y0;
    const k = (lado * ocupa) / Math.max(ancho, alto);
    const cx = (CAJA_POLLITO.x0 + CAJA_POLLITO.x1) / 2;
    const cy = (CAJA_POLLITO.y0 + CAJA_POLLITO.y1) / 2;
    const lista = pollito().map(([figura, color]) => [escalada(figura, k, cx, cy, lado / 2, lado / 2), color]);
    iconosGuardados.set(nombre, comoPng(pintarLienzo(lado, lado, lista), lado, lado));
  }
  return iconosGuardados.get(nombre);
}

module.exports = { imagenParaCompartir, icono, ICONOS, ANCHO, ALTO };
