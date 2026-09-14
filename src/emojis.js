'use strict';

// Los emojis propios del sitio: los que se escriben como :pollito: y salen
// como una imagen, al estilo de los foros de siempre.
//
// Por ahora cada uno es el emoji estandar dibujado dentro de un SVG, que es
// exactamente lo que hace el icono de la pestana en index.html. No hace falta
// ningun archivo ni ningun servicio, pesa unos doscientos bytes, y el dia que
// el panel de administracion suba una imagen de verdad, se cambia el campo
// `caracter` por `url` y no hay que tocar nada mas.

const NOMBRE = /^[a-z0-9_]{2,20}$/;

const POR_DEFECTO = [
  { nombre: 'pollito', caracter: '🐤' },
  { nombre: 'huevo', caracter: '🥚' },
  { nombre: 'nido', caracter: '🪹' },
  { nombre: 'gallo', caracter: '🐓' },
  { nombre: 'maiz', caracter: '🌽' },
];

function comoImagen(caracter) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    + `<text y=".9em" font-size="90">${caracter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Solo https: la direccion termina en un <img src> de todas las paginas del
// sitio, y la pone quien administra, no cualquiera, pero el descuido de un
// administrador tambien es un descuido.
function urlSegura(crudo) {
  try {
    const u = new URL(String(crudo));
    return u.protocol === 'https:' ? u.href : null;
  } catch (err) {
    return null;
  }
}

// Deja cada emoji en {nombre, src}, que es lo unico que el cliente necesita.
// Lo que no tenga nombre valido ni con que dibujarse, se descarta en silencio:
// un emoji roto en la lista rompe el texto de todos los pios.
function servibles(lista) {
  const vistos = new Set();
  const salida = [];
  for (const crudo of Array.isArray(lista) ? lista : []) {
    const nombre = String((crudo && crudo.nombre) || '').trim().toLowerCase();
    if (!NOMBRE.test(nombre) || vistos.has(nombre)) continue;
    const src = crudo.url ? urlSegura(crudo.url) : (crudo.caracter ? comoImagen(crudo.caracter) : null);
    if (!src) continue;
    vistos.add(nombre);
    salida.push({ nombre, src });
  }
  return salida;
}

function porDefecto() {
  return servibles(POR_DEFECTO);
}

module.exports = { POR_DEFECTO, NOMBRE, comoImagen, urlSegura, servibles, porDefecto };
