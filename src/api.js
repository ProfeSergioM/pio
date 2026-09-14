'use strict';

const { ErrorPio } = require('./almacen');
const M = require('./modelo');

const PAGINA = 50;

function crearApi(almacen) {
  // Devuelve true si la peticion era de la API (y ya fue respondida).
  return async function api(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;

    try {
      const cuerpo = await leerCuerpo(req);
      const yo = almacen.porToken(tokenDe(req));
      const partes = url.pathname.split('/').filter(Boolean).slice(1); // sin "api"
      const resultado = await enrutar(almacen, req, url, partes, cuerpo, yo);
      responder(res, resultado.codigo || 200, resultado.datos);
    } catch (err) {
      if (err instanceof ErrorPio) responder(res, err.codigo, { error: err.message });
      else {
        console.error('[pio] error interno:', err);
        responder(res, 500, { error: 'Se nos cayó el nido. Probá de nuevo.' });
      }
    }
    return true;
  };
}

async function enrutar(almacen, req, url, partes, cuerpo, yo) {
  const metodo = req.method.toUpperCase();
  const [recurso, id, accion] = partes;

  // --- sesión -------------------------------------------------------------

  if (recurso === 'registro' && metodo === 'POST') {
    const cuenta = almacen.crearUsuario(cuerpo.usuario, cuerpo.nombre, cuerpo.clave);
    return {
      codigo: 201,
      datos: { token: almacen.abrirSesion(cuenta), yo: perfil(almacen, cuenta, cuenta) },
    };
  }

  if (recurso === 'sesion') {
    if (metodo === 'POST') {
      const cuenta = almacen.verificarClave(cuerpo.usuario, cuerpo.clave);
      if (!cuenta) throw new ErrorPio(401, 'Usuario o clave incorrectos.');
      return { datos: { token: almacen.abrirSesion(cuenta), yo: perfil(almacen, cuenta, cuenta) } };
    }
    if (metodo === 'DELETE') {
      almacen.cerrarSesion(tokenDe(req));
      return { datos: { ok: true } };
    }
  }

  if (recurso === 'yo') {
    if (metodo === 'GET') {
      exigir(yo);
      return { datos: { yo: perfil(almacen, yo, yo) } };
    }
    if (metodo === 'PATCH') {
      exigir(yo);
      almacen.actualizarPerfil(yo, cuerpo);
      return { datos: { yo: perfil(almacen, yo, yo) } };
    }
  }

  // --- píos ---------------------------------------------------------------

  if (recurso === 'pios') {
    if (metodo === 'GET' && !id) {
      return { datos: linea(almacen, url.searchParams, yo) };
    }
    if (metodo === 'POST' && !id) {
      exigir(yo);
      const pio = almacen.publicar(yo, cuerpo.texto, cuerpo.respuestaA);
      return { codigo: 201, datos: { pio: serializar(almacen, pio, yo) } };
    }
    if (metodo === 'DELETE' && id) {
      exigir(yo);
      almacen.borrar(yo, id);
      return { datos: { ok: true } };
    }
    if (metodo === 'POST' && id && accion === 'megusta') {
      exigir(yo);
      almacen.alternarMeGusta(yo, id);
      return { datos: { pio: serializar(almacen, almacen.buscarPio(id), yo) } };
    }
    if (metodo === 'POST' && id && accion === 'repio') {
      exigir(yo);
      almacen.alternarRepio(yo, id);
      return { datos: { pio: serializar(almacen, almacen.buscarPio(id), yo) } };
    }
    if (metodo === 'GET' && id && accion === 'hilo') {
      const pio = almacen.buscarPio(id);
      if (!pio) throw new ErrorPio(404, 'Ese pío ya no está.');
      const antes = [];
      let actual = pio;
      while (actual.respuestaA) {
        actual = almacen.buscarPio(actual.respuestaA);
        if (!actual) break;
        antes.unshift(actual);
      }
      const despues = almacen.respuestasDe(id).sort((a, b) => a.creado - b.creado);
      return {
        datos: {
          antes: antes.map((p) => serializar(almacen, p, yo)),
          pio: serializar(almacen, pio, yo),
          despues: despues.map((p) => serializar(almacen, p, yo)),
        },
      };
    }
  }

  // --- usuarios -----------------------------------------------------------

  if (recurso === 'usuarios' && id) {
    const cuenta = almacen.buscarUsuario(id);
    if (!cuenta) throw new ErrorPio(404, 'No existe ese pollito.');
    if (metodo === 'GET' && !accion) return { datos: { perfil: perfil(almacen, cuenta, yo) } };
    if (metodo === 'POST' && accion === 'seguir') {
      exigir(yo);
      almacen.alternarSeguir(yo, id);
      return { datos: { perfil: perfil(almacen, cuenta, yo) } };
    }
  }

  // --- descubrir ----------------------------------------------------------

  if (recurso === 'buscar' && metodo === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    if (!q) return { datos: { pios: [], usuarios: [] } };
    const usuarios = almacen.datos.usuarios
      .filter((u) => u.usuario.includes(q.replace(/^@/, '')) || u.nombre.toLowerCase().includes(q))
      .slice(0, 10)
      .map((u) => perfil(almacen, u, yo));
    const pios = almacen.datos.pios
      .filter((p) => p.texto.toLowerCase().includes(q))
      .sort((a, b) => b.creado - a.creado)
      .slice(0, PAGINA)
      .map((p) => serializar(almacen, p, yo));
    return { datos: { pios, usuarios } };
  }

  if (recurso === 'tendencias' && metodo === 'GET') {
    const cuenta = new Map();
    const corte = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const p of almacen.datos.pios) {
      if (p.creado < corte) continue;
      for (const e of p.etiquetas) cuenta.set(e, (cuenta.get(e) || 0) + 1);
    }
    const tendencias = [...cuenta.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([etiqueta, total]) => ({ etiqueta, total }));
    return { datos: { tendencias } };
  }

  throw new ErrorPio(404, 'Ruta desconocida.');
}

// --- líneas de tiempo -----------------------------------------------------

function linea(almacen, params, yo) {
  const tipo = params.get('tipo') || 'plaza';
  const entradas = [];

  const agregar = (pio, orden, repiadoPor) => entradas.push({ pio, orden, repiadoPor });

  if (tipo === 'nido') {
    exigir(yo);
    const seguidos = new Set([yo.usuario, ...yo.siguiendo]);
    for (const p of almacen.datos.pios) {
      if (seguidos.has(p.autor) && !p.respuestaA) agregar(p, p.creado, null);
      for (const r of p.repios) {
        if (seguidos.has(r.usuario) && r.usuario !== p.autor) agregar(p, r.fecha, r.usuario);
      }
    }
  } else if (tipo === 'usuario') {
    const quien = M.normalizarUsuario(params.get('usuario'));
    for (const p of almacen.datos.pios) {
      if (p.autor === quien) agregar(p, p.creado, null);
      for (const r of p.repios) if (r.usuario === quien) agregar(p, r.fecha, quien);
    }
  } else if (tipo === 'etiqueta') {
    const etiqueta = String(params.get('etiqueta') || '').toLowerCase().replace(/^#/, '');
    for (const p of almacen.datos.pios) if (p.etiquetas.includes(etiqueta)) agregar(p, p.creado, null);
  } else if (tipo === 'megusta') {
    const quien = M.normalizarUsuario(params.get('usuario'));
    for (const p of almacen.datos.pios) if (p.meGusta.includes(quien)) agregar(p, p.creado, null);
  } else {
    for (const p of almacen.datos.pios) if (!p.respuestaA) agregar(p, p.creado, null);
  }

  entradas.sort((a, b) => b.orden - a.orden);
  const antes = Number(params.get('antes') || 0);
  const restantes = antes ? entradas.filter((e) => e.orden < antes) : entradas;
  const pagina = restantes.slice(0, PAGINA);

  return {
    tipo,
    pios: pagina.map((e) =>
      Object.assign(serializar(almacen, e.pio, yo), { orden: e.orden, repiadoPor: e.repiadoPor })
    ),
    hayMas: restantes.length > pagina.length,
  };
}

// --- serialización --------------------------------------------------------

function serializar(almacen, pio, yo) {
  const autor = almacen.buscarUsuario(pio.autor);
  return {
    id: pio.id,
    texto: pio.texto,
    creado: pio.creado,
    respuestaA: pio.respuestaA,
    autor: autor
      ? { usuario: autor.usuario, nombre: autor.nombre }
      : { usuario: pio.autor, nombre: pio.autor },
    meGusta: pio.meGusta.length,
    yoMeGusta: !!yo && pio.meGusta.includes(yo.usuario),
    repios: pio.repios.length,
    yoRepio: !!yo && pio.repios.some((r) => r.usuario === yo.usuario),
    respuestas: almacen.contarRespuestas(pio.id),
    mio: !!yo && pio.autor === yo.usuario,
  };
}

function perfil(almacen, cuenta, yo) {
  return {
    usuario: cuenta.usuario,
    nombre: cuenta.nombre,
    bio: cuenta.bio,
    creado: cuenta.creado,
    siguiendo: cuenta.siguiendo.length,
    seguidores: almacen.seguidores(cuenta.usuario).length,
    pios: almacen.datos.pios.filter((p) => p.autor === cuenta.usuario).length,
    loSigo: !!yo && yo.siguiendo.includes(cuenta.usuario),
    soyYo: !!yo && yo.usuario === cuenta.usuario,
  };
}

// --- utilidades HTTP ------------------------------------------------------

function exigir(yo) {
  if (!yo) throw new ErrorPio(401, 'Entrá a tu nido primero.');
}

function tokenDe(req) {
  const cabecera = req.headers.authorization || '';
  const m = cabecera.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'DELETE') return resolve({});
    let crudo = '';
    req.on('data', (trozo) => {
      crudo += trozo;
      if (crudo.length > 64 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!crudo) return resolve({});
      try {
        resolve(JSON.parse(crudo));
      } catch (err) {
        reject(new ErrorPio(400, 'El cuerpo no es JSON válido.'));
      }
    });
    req.on('error', reject);
  });
}

function responder(res, codigo, datos) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo),
    'Cache-Control': 'no-store',
  });
  res.end(cuerpo);
}

module.exports = { crearApi, serializar, perfil };
