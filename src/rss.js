'use strict';

// Tu nido es tuyo: cada perfil y cada corral tienen su RSS, para seguirlos
// desde cualquier lector sin cuenta en Pío y sin que nadie decida qué se ve.
//
// Sólo va lo que ya es público: nada de huevos, ni de cuentas ocultas, ni de
// píos bomba. Una bomba explota en veinticuatro horas, pero un lector de RSS la
// guardaría para siempre.

const POR_CANAL = 50;

// XML 1.0 no admite ciertos caracteres de control ni aunque vayan escapados:
// uno solo invalida el canal entero en el lector.
const esValidoEnXml = (c) => {
  const n = c.charCodeAt(0);
  return (n >= 32 || n === 9 || n === 10 || n === 13) && n !== 0xFFFE && n !== 0xFFFF;
};

const escaparXml = (texto) => String(texto == null ? '' : texto)
  .split('').filter(esValidoEnXml).join('')
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// El título de un ítem: el pío mismo, cortado si hace falta. Un pío de cien no
// necesita resumen, pero los lectores muestran los títulos en una línea.
function tituloDe(pio, autor) {
  const texto = [...(pio.texto || '')];
  const corto = texto.length > 60 ? `${texto.slice(0, 59).join('')}…` : texto.join('');
  return corto || `@${autor} en Pío`;
}

function canal({ titulo, enlace, descripcion, propio, items }) {
  const partes = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title>${escaparXml(titulo)}</title>`,
    `<link>${escaparXml(enlace)}</link>`,
    `<description>${escaparXml(descripcion)}</description>`,
    `<atom:link href="${escaparXml(propio)}" rel="self" type="application/rss+xml"/>`,
    items.length ? `<lastBuildDate>${new Date(items[0].fecha).toUTCString()}</lastBuildDate>` : '',
  ];
  for (const item of items) {
    partes.push(
      '<item>',
      `<title>${escaparXml(item.titulo)}</title>`,
      `<link>${escaparXml(item.enlace)}</link>`,
      `<guid isPermaLink="true">${escaparXml(item.enlace)}</guid>`,
      `<pubDate>${new Date(item.fecha).toUTCString()}</pubDate>`,
      `<author>${escaparXml(item.autor)}</author>`,
      `<description>${escaparXml(item.descripcion)}</description>`,
      '</item>',
    );
  }
  partes.push('</channel>', '</rss>');
  return partes.filter(Boolean).join('\n');
}

// Lo que puede ir a un canal público.
function publicable(almacen, pio) {
  return almacen.visiblePara(pio, null) && !pio.explota && !(almacen.datos.ocultos || []).includes(pio.autor);
}

function itemDe(almacen, pio, origen) {
  const autor = almacen.buscarUsuario(pio.autor);
  const usuario = autor ? autor.usuario : pio.autor;
  const lineas = [];
  if (pio.buzon) lineas.push(`📮 ${pio.buzon.anonima || !pio.buzon.de ? 'Pregunta anónima' : `@${pio.buzon.de} preguntó`}: ${pio.buzon.texto}`);
  if (pio.texto) lineas.push(pio.texto);
  if (pio.adjunto && pio.adjunto.url) lineas.push(pio.adjunto.url);
  return {
    titulo: tituloDe(pio, usuario),
    // La página para compartir: la que los lectores y las redes saben leer.
    enlace: `${origen}/p/${pio.id}`,
    fecha: pio.creado,
    autor: `@${usuario}`,
    descripcion: lineas.join('\n\n'),
  };
}

function rssDeUsuario(almacen, usuario, origen) {
  const cuenta = almacen.buscarUsuario(usuario);
  if (!cuenta || (almacen.datos.ocultos || []).includes(cuenta.usuario)) return null;
  const items = almacen.datos.pios
    .filter((p) => p.autor === cuenta.usuario && publicable(almacen, p))
    .sort((a, b) => b.creado - a.creado)
    .slice(0, POR_CANAL)
    .map((p) => itemDe(almacen, p, origen));
  return canal({
    titulo: `${cuenta.nombre} (@${cuenta.usuario}) en Pío`,
    enlace: `${origen}/#/u/${cuenta.usuario}`,
    descripcion: cuenta.bio || `Los píos de @${cuenta.usuario}`,
    propio: `${origen}/rss/u/${cuenta.usuario}`,
    items,
  });
}

function rssDeCorral(almacen, nombre, origen) {
  const corral = almacen.buscarCorral(nombre);
  if (!corral) return null;
  const items = almacen.datos.pios
    .filter((p) => p.corral === corral.nombre && !p.eslabonDe && publicable(almacen, p))
    .sort((a, b) => b.creado - a.creado)
    .slice(0, POR_CANAL)
    .map((p) => itemDe(almacen, p, origen));
  return canal({
    titulo: `${corral.titulo} · corral de Pío`,
    enlace: `${origen}/#/c/${corral.nombre}`,
    descripcion: corral.descripcion || `Los píos del corral ${corral.nombre}`,
    propio: `${origen}/rss/c/${corral.nombre}`,
    items,
  });
}

module.exports = { POR_CANAL, escaparXml, rssDeUsuario, rssDeCorral };
