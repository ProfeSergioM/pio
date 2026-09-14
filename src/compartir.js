'use strict';

// Las redes arman la vista previa de un enlace leyendo las etiquetas de la
// pagina, sin ejecutar nada. Pio vive detras de un # que esos lectores no
// miran, asi que un enlace a #/p/abc se veria en todas partes como la portada.
//
// Por eso cada pio compartido tiene ademas su propia direccion, /p/<id>: una
// pagina minima con el texto del pio en las etiquetas, que a las personas las
// manda enseguida a la vista de verdad.

const escapar = (texto) => String(texto == null ? '' : texto).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const ID = /^[a-z0-9]{1,40}$/;

function paginaParaCompartir(almacen, id) {
  if (!ID.test(String(id || ''))) return null;
  const pio = almacen.buscarPio(id);
  if (!pio) return null;

  const autor = almacen.buscarUsuario(pio.autor);
  const usuario = autor ? autor.usuario : pio.autor;
  const nombre = autor ? autor.nombre : pio.autor;
  const titulo = `${nombre} (@${usuario}) en Pío`;
  const texto = pio.texto || '';
  // Solo https: la direccion la leen servicios de afuera, y una imagen por
  // http la descartan o la marcan como insegura.
  const imagen = pio.adjunto && /^https:\/\//.test(pio.adjunto.url || '') ? pio.adjunto.url : null;
  const destino = `/#/p/${pio.id}`;

  return [
    '<!doctype html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapar(titulo)}</title>`,
    `<meta name="description" content="${escapar(texto)}">`,
    '<meta property="og:site_name" content="Pío">',
    '<meta property="og:type" content="article">',
    `<meta property="og:title" content="${escapar(titulo)}">`,
    `<meta property="og:description" content="${escapar(texto)}">`,
    imagen ? `<meta property="og:image" content="${escapar(imagen)}">` : '',
    `<meta name="twitter:card" content="${imagen ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escapar(titulo)}">`,
    `<meta name="twitter:description" content="${escapar(texto)}">`,
    imagen ? `<meta name="twitter:image" content="${escapar(imagen)}">` : '',
    // Dos formas de mandar a la persona a la vista de verdad: la de la
    // cabecera anda aunque el navegador tenga los scripts apagados.
    `<meta http-equiv="refresh" content="0; url=${escapar(destino)}">`,
    '</head>',
    '<body>',
    `<p>${escapar(texto)}</p>`,
    `<p><a href="${escapar(destino)}">Ver el pío</a></p>`,
    `<script>location.replace(${JSON.stringify(destino)});</script>`,
    '</body>',
    '</html>',
  ].filter(Boolean).join('\n');
}

module.exports = { paginaParaCompartir };
