'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Almacen } = require('./src/almacen');
const { crearApi } = require('./src/api');
const { leerAjustes } = require('./src/ajustes');
const { paginaParaCompartir } = require('./src/compartir');
const { imagenParaCompartir } = require('./src/portada');

// De dónde vino el pedido, para armar direcciones completas. Detrás del
// balanceador de Render el pedido llega por http; la cabecera dice cómo
// entró de verdad. Un host con cosas raras no se usa: termina dentro de una
// página.
function origenDe(req) {
  const host = String(req.headers.host || '');
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return null;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function crearServidor(opciones = {}) {
  const raizDatos = opciones.datos || path.join(__dirname, 'datos');
  const publico = opciones.publico || path.join(__dirname, 'publico');
  // Lo que venga por opciones gana: es lo que usan las pruebas para no
  // depender de la configuración real de la máquina.
  const ajustes = Object.assign(leerAjustes(raizDatos), opciones.api);
  const almacen = new Almacen(raizDatos, ajustes, opciones.almacen);
  const api = crearApi(almacen, ajustes);

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (await api(req, res, url)) return;

    if (req.method === 'GET' && url.pathname === '/compartir.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      res.end(imagenParaCompartir());
      return;
    }

    // La dirección que se comparte: ver src/compartir.js.
    const compartido = req.method === 'GET' && url.pathname.match(/^\/p\/([a-z0-9]{1,40})\/?$/);
    if (compartido) {
      await almacen.listo;
      const html = paginaParaCompartir(almacen, compartido[1], origenDe(req));
      if (html) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(html);
      } else {
        // Un pío que ya no está lleva a la portada: mejor que una página de error.
        res.writeHead(302, { Location: '/' }).end();
      }
      return;
    }

    servirEstatico(req, res, url, publico);
  });

  servidor.almacen = almacen;
  return servidor;
}

function servirEstatico(req, res, url, publico) {
  // Toda ruta que no sea un archivo real cae en index.html: el ruteo es del cliente.
  const pedido = decodeURIComponent(url.pathname);
  const relativo = path.normalize(pedido).replace(/^([/\\])+/, '');
  let destino = path.join(publico, relativo);

  if (!destino.startsWith(publico)) {
    res.writeHead(403).end('Prohibido');
    return;
  }
  if (!path.extname(destino) || !fs.existsSync(destino)) {
    destino = path.join(publico, 'index.html');
  }

  fs.readFile(destino, (err, contenido) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(destino)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(contenido);
  });
}

if (require.main === module) {
  const puerto = Number(process.env.PUERTO || process.env.PORT || 3100);
  crearServidor().listen(puerto, () => {
    console.log(`Pio volando en http://localhost:${puerto}`);
  });
}

module.exports = { crearServidor };
