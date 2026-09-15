'use strict';

// El logo de Pío: sobre un cuadrado redondeado naranja, la mitad de abajo de
// un huevo quebrado y, asomando, un pollito que mira hacia arriba con el ojo
// cerrado, contento.
//
// Vive en un solo lugar, en una grilla de 100 × 100. De acá sale el SVG que usa
// la página —la marca, el ícono de la pestaña, la portada— y las figuras que
// dibujan los PNG —los íconos de la app y la imagen para compartir—. Cambiar
// el logo es cambiar este archivo, y nunca quedan dos versiones distintas.

const COLORES = {
  fondo: '#f07c1f',
  pollito: '#f2b705',
  claro: '#fff4d1',
};

// El huevo entero, del que se ve sólo lo que queda debajo del quiebre.
const HUEVO = { cx: 50, cy: 61, rx: 28, ry: 30 };
const QUIEBRE = [[22, 61], [30, 53], [37, 62], [44, 53], [50, 62], [56, 53], [63, 62], [70, 53], [78, 61]];

// Lo de abajo primero.
const FIGURAS = [
  { tipo: 'rectangulo', x: 2, y: 2, ancho: 96, alto: 96, radio: 22, color: 'fondo', esFondo: true },
  { tipo: 'circulo', cx: 50, cy: 58, r: 20, color: 'pollito' },
  // La cabeza, inclinada hacia arriba desde el cuello.
  {
    tipo: 'grupo', giro: -20, cx: 50, cy: 46,
    figuras: [
      { tipo: 'circulo', cx: 50, cy: 38, r: 15.5, color: 'pollito' },
      { tipo: 'elipse', cx: 48, cy: 21.5, rx: 2.8, ry: 5.4, color: 'pollito' },
      { tipo: 'poligono', puntos: [[63.5, 37], [70, 39.5], [63.5, 42]], color: 'claro' },
      // El ojo: un arco, cerrado y sonriente.
      { tipo: 'curva', desde: [51, 37.5], control: [55, 32], hasta: [59, 37.5], grosor: 2.8, color: 'claro' },
    ],
  },
  { tipo: 'cascara', color: 'claro' },
];

// --- como SVG ---------------------------------------------------------------------

const n = (v) => Number(Number(v).toFixed(2));

function svgDeFigura(f) {
  const color = COLORES[f.color];
  switch (f.tipo) {
    case 'rectangulo':
      return `<rect x="${f.x}" y="${f.y}" width="${f.ancho}" height="${f.alto}" rx="${f.radio}" fill="${color}"/>`;
    case 'circulo':
      return `<circle cx="${f.cx}" cy="${f.cy}" r="${f.r}" fill="${color}"/>`;
    case 'elipse':
      return `<ellipse cx="${f.cx}" cy="${f.cy}" rx="${f.rx}" ry="${f.ry}" fill="${color}"/>`;
    case 'poligono':
      return `<polygon points="${f.puntos.map((p) => p.join(',')).join(' ')}" fill="${color}"/>`;
    case 'curva':
      return `<path d="M${f.desde.join(' ')} Q${f.control.join(' ')} ${f.hasta.join(' ')}" fill="none" stroke="${color}" stroke-width="${f.grosor}" stroke-linecap="round"/>`;
    case 'grupo':
      return `<g transform="rotate(${f.giro} ${f.cx} ${f.cy})">${f.figuras.map(svgDeFigura).join('')}</g>`;
    case 'cascara': {
      // El zigzag de izquierda a derecha, y de vuelta por abajo siguiendo el huevo.
      const [xi, yi] = QUIEBRE[0];
      const camino = [`M${n(xi)} ${n(yi)}`, ...QUIEBRE.slice(1).map(([x, y]) => `L${n(x)} ${n(y)}`),
        `A${HUEVO.rx} ${HUEVO.ry} 0 1 1 ${n(xi)} ${n(yi)}`, 'Z'].join(' ');
      return `<path d="${camino}" fill="${color}"/>`;
    }
    default:
      return '';
  }
}

function svgDelLogo() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Pío">${FIGURAS.map(svgDeFigura).join('')}</svg>`;
}

// --- como figuras para dibujar en píxeles ------------------------------------------

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function alturaDelQuiebre(x) {
  for (let i = 0; i < QUIEBRE.length - 1; i += 1) {
    const [x0, y0] = QUIEBRE[i];
    const [x1, y1] = QUIEBRE[i + 1];
    if (x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return Infinity;
}

// Distancia de un punto a un segmento.
function distanciaASegmento(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// "¿Este punto está adentro?" para cada tipo, con su caja para no recorrer de más.
function forma(f) {
  switch (f.tipo) {
    case 'rectangulo': {
      const { x, y, ancho, alto, radio } = f;
      return {
        caja: [x, y, x + ancho, y + alto],
        dentro: (px, py) => {
          if (px < x || px > x + ancho || py < y || py > y + alto) return false;
          const qx = Math.min(Math.max(px, x + radio), x + ancho - radio);
          const qy = Math.min(Math.max(py, y + radio), y + alto - radio);
          return (px - qx) ** 2 + (py - qy) ** 2 <= radio ** 2;
        },
      };
    }
    case 'circulo':
      return { caja: [f.cx - f.r, f.cy - f.r, f.cx + f.r, f.cy + f.r], dentro: (x, y) => (x - f.cx) ** 2 + (y - f.cy) ** 2 <= f.r ** 2 };
    case 'elipse':
      return { caja: [f.cx - f.rx, f.cy - f.ry, f.cx + f.rx, f.cy + f.ry], dentro: (x, y) => ((x - f.cx) / f.rx) ** 2 + ((y - f.cy) / f.ry) ** 2 <= 1 };
    case 'poligono': {
      const p = f.puntos;
      return {
        caja: [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))],
        dentro: (x, y) => {
          let adentro = false;
          for (let i = 0, j = p.length - 1; i < p.length; j = i, i += 1) {
            const [xi, yi] = p[i];
            const [xj, yj] = p[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) adentro = !adentro;
          }
          return adentro;
        },
      };
    }
    case 'curva': {
      // La curva se aproxima con tramos rectos; con cuarenta no se nota.
      const tramos = [];
      for (let i = 0; i <= 40; i += 1) {
        const t = i / 40;
        const u = 1 - t;
        tramos.push([
          u * u * f.desde[0] + 2 * u * t * f.control[0] + t * t * f.hasta[0],
          u * u * f.desde[1] + 2 * u * t * f.control[1] + t * t * f.hasta[1],
        ]);
      }
      const medio = f.grosor / 2;
      const xs = tramos.map((q) => q[0]);
      const ys = tramos.map((q) => q[1]);
      return {
        caja: [Math.min(...xs) - medio, Math.min(...ys) - medio, Math.max(...xs) + medio, Math.max(...ys) + medio],
        dentro: (x, y) => tramos.some((a, i) => i > 0 && distanciaASegmento(x, y, tramos[i - 1], a) <= medio),
      };
    }
    case 'cascara':
      return {
        caja: [HUEVO.cx - HUEVO.rx, 50, HUEVO.cx + HUEVO.rx, HUEVO.cy + HUEVO.ry],
        dentro: (x, y) => ((x - HUEVO.cx) / HUEVO.rx) ** 2 + ((y - HUEVO.cy) / HUEVO.ry) ** 2 <= 1 && y >= alturaDelQuiebre(x),
      };
    default:
      return null;
  }
}

// Gira una forma alrededor de (cx, cy): se gira el punto al revés y se pregunta
// a la forma sin girar.
function girada(f, grados, cx, cy) {
  const a = (grados * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const [x0, y0, x1, y1] = f.caja;
  const esquinas = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [
    cx + (x - cx) * cos - (y - cy) * sin,
    cy + (x - cx) * sin + (y - cy) * cos,
  ]);
  return {
    caja: [Math.min(...esquinas.map((e) => e[0])), Math.min(...esquinas.map((e) => e[1])),
      Math.max(...esquinas.map((e) => e[0])), Math.max(...esquinas.map((e) => e[1]))],
    dentro: (x, y) => f.dentro(cx + (x - cx) * cos + (y - cy) * sin, cy - (x - cx) * sin + (y - cy) * cos),
  };
}

// Todas las figuras, aplanadas y con su color, en la grilla de 100. Sin el
// cuadrado de fondo si se pide: los íconos de la app ya son el cuadrado.
function figurasDelLogo({ conFondo = true } = {}) {
  const salida = [];
  for (const f of FIGURAS) {
    if (f.esFondo && !conFondo) continue;
    if (f.tipo === 'grupo') {
      for (const hija of f.figuras) salida.push([girada(forma(hija), f.giro, f.cx, f.cy), rgb(COLORES[hija.color])]);
    } else {
      salida.push([forma(f), rgb(COLORES[f.color])]);
    }
  }
  return salida;
}

module.exports = { svgDelLogo, figurasDelLogo, COLORES, rgb };
