'use strict';

const { ErrorPio } = require('./almacen');
const { Limite, deDonde, enEspera } = require('./limite');
const { Google } = require('./google');
const { crearSubidor, ErrorImagen } = require('./imagenes');
const { crearGifs, ErrorGif } = require('./gifs');
const { crearAcortador, ErrorEnlace } = require('./enlaces');

// De donde se acepta que venga un adjunto. El cliente manda una URL, y una URL
// que manda el cliente es un dato, no una verdad: si no se comprobara, cualquiera
// podria colgar de un pio la direccion que se le antoje.
const ORIGENES = /(^|\.)cloudinary\.com$|(^|\.)ibb\.co$|(^|\.)imgbb\.com$|(^|\.)giphy\.com$/;
const M = require('./modelo');

const PAGINA = 50;
const ALTAS_POR_HORA = 5;
const SUBIDAS_POR_HORA = 20;
const TOPE_CUERPO = 64 * 1024;
// Una imagen no entra en 64 KB. El base64 infla un tercio, asi que 8 MB de
// cuerpo dan lugar a los 5 MB de imagen que acepta el subidor.
const TOPE_IMAGEN = 8 * 1024 * 1024;
// Topes del árbol de respuestas. La hondura es para que la sangría del cliente
// no se coma la pantalla; la cantidad, para que un hilo popular no devuelva
// una respuesta de megabytes. Los dos sirven además de red contra un ciclo
// armado a mano en el JSON.
const HONDO_MAXIMO = 8;
const RAMAS_MAXIMAS = 200;

function crearApi(almacen, opciones = {}) {
  // Una instancia por servidor: asi cada prueba arranca con la cuenta en cero
  // y no hereda el castigo de la anterior.
  const altas = new Limite({
    cuantos: opciones.altas || ALTAS_POR_HORA,
    ventana: opciones.ventanaAltas || 60 * 60 * 1000,
  });
  const servicios = {
    proxies: Number(opciones.proxies) || 0,
    ipCabecera: opciones.ipCabecera || null,
    altas,
    subidas: new Limite({
      cuantos: opciones.subidas || SUBIDAS_POR_HORA,
      ventana: opciones.ventanaSubidas || 60 * 60 * 1000,
    }),
    google: new Google(opciones.googleClienteId, opciones.google),
    imagenes: crearSubidor(opciones, opciones.imagenes),
    gifs: crearGifs(opciones, opciones.gifs),
    enlaces: crearAcortador(opciones, opciones.enlaces),
  };

  // Devuelve true si la peticion era de la API (y ya fue respondida).
  return async function api(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;

    // La primera petición espera a que termine la carga inicial; el resto la
    // encuentra resuelta y no paga nada.
    await almacen.listo;

    try {
      const cuerpo = await leerCuerpo(req, url);
      const yo = almacen.porToken(tokenDe(req));
      const partes = url.pathname.split('/').filter(Boolean).slice(1); // sin "api"
      const resultado = await enrutar(almacen, req, url, partes, cuerpo, yo, servicios);
      responder(res, resultado.codigo || 200, resultado.datos);
    } catch (err) {
      if (err instanceof ErrorPio) {
        const fallo = { error: err.message };
        if (err.clave) fallo.clave = err.clave;
        if (err.datos) fallo.datos = err.datos;
        responder(res, err.codigo, fallo);
      } else {
        console.error('[pio] error interno:', err);
        responder(res, 500, { error: 'Se nos cayó el nido. Intenta de nuevo.', clave: 'interno' });
      }
    }
    return true;
  };
}

async function enrutar(almacen, req, url, partes, cuerpo, yo, servicios) {
  const { altas, google, imagenes, gifs, enlaces } = servicios;
  const dedonde = () => deDonde(req, {
    proxies: servicios.proxies,
    cabecera: servicios.ipCabecera,
  });
  const metodo = req.method.toUpperCase();
  const [recurso, id, accion] = partes;

  // --- sesión -------------------------------------------------------------

  if (recurso === 'registro' && metodo === 'POST') {
    // Se cuentan las altas que salieron bien, no los intentos: lo que se
    // quiere frenar es el alta en masa, y un pedido mal formado no crea nada.
    const desde = dedonde();
    frenarAltas(altas, desde);
    const cuenta = await almacen.crearUsuario(cuerpo.usuario, cuerpo.nombre, cuerpo.clave);
    altas.anotar(desde);
    return {
      codigo: 201,
      datos: { token: await almacen.abrirSesion(cuenta), yo: perfil(almacen, cuenta, cuenta) },
    };
  }

  // Lo que el cliente necesita saber antes de dibujar la portada. El client
  // id de Google es publico por diseño: va en el HTML de cualquier sitio.
  if (recurso === 'config' && metodo === 'GET') {
    return {
      datos: {
        google: google.activo ? google.clienteId : null,
        imagenes: imagenes.activo,
        proveedorImagenes: imagenes.nombre,
        gifs: gifs.activo,
        acortador: enlaces.activo,
      },
    };
  }

  if (recurso === 'sesion') {
    if (metodo === 'POST' && id === 'google') {
      if (!google.activo) {
        throw new ErrorPio(501, 'Este Pío no tiene configurado el acceso con Google.', 'google.apagado');
      }
      let quien;
      try {
        quien = await google.verificar(cuerpo.credencial);
      } catch (err) {
        throw new ErrorPio(401, err.message, 'google.malo');
      }

      // Entrar con Google no puede ser la puerta de atrás del límite de altas.
      const desde = dedonde();
      if (!almacen.buscarPorGoogle(quien.sub)) frenarAltas(altas, desde);

      const { cuenta, nueva } = await almacen.desdeGoogle(quien);
      if (nueva) altas.anotar(desde);
      return {
        codigo: nueva ? 201 : 200,
        datos: { token: await almacen.abrirSesion(cuenta), yo: perfil(almacen, cuenta, cuenta) },
      };
    }

    if (metodo === 'POST') {
      const cuenta = almacen.verificarClave(cuerpo.usuario, cuerpo.clave);
      if (!cuenta) throw new ErrorPio(401, 'Usuario o clave incorrectos.', 'acceso.malo');
      return { datos: { token: await almacen.abrirSesion(cuenta), yo: perfil(almacen, cuenta, cuenta) } };
    }
    if (metodo === 'DELETE') {
      await almacen.cerrarSesion(tokenDe(req));
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
      await almacen.actualizarPerfil(yo, cuerpo);
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
      const pio = await almacen.publicar(yo, cuerpo.texto, cuerpo.respuestaA, limpiarAdjunto(cuerpo.adjunto));
      return { codigo: 201, datos: { pio: serializar(almacen, pio, yo) } };
    }
    if (metodo === 'DELETE' && id) {
      exigir(yo);
      await almacen.borrar(yo, id);
      return { datos: { ok: true } };
    }
    if (metodo === 'POST' && id && accion === 'megusta') {
      exigir(yo);
      await almacen.alternarMeGusta(yo, id);
      return { datos: { pio: serializar(almacen, almacen.buscarPio(id), yo) } };
    }
    if (metodo === 'POST' && id && accion === 'repio') {
      exigir(yo);
      await almacen.alternarRepio(yo, id);
      return { datos: { pio: serializar(almacen, almacen.buscarPio(id), yo) } };
    }
    if (metodo === 'GET' && id && accion === 'hilo') {
      const pio = almacen.buscarPio(id);
      if (!pio) throw new ErrorPio(404, 'Ese pío ya no está.', 'pio.noesta');

      // Subir por los padres necesita memoria de por dónde se pasó: sin eso,
      // dos píos que se responden mutuamente cuelgan el servidor para siempre.
      const antes = [];
      const vistos = new Set([pio.id]);
      let actual = pio;
      while (actual.respuestaA && !vistos.has(actual.respuestaA)) {
        vistos.add(actual.respuestaA);
        actual = almacen.buscarPio(actual.respuestaA);
        if (!actual) break;
        antes.unshift(actual);
      }

      const cuenta = { total: 0 };
      const arbol = ramasDe(almacen, pio.id, yo, cuenta, 0);
      return {
        datos: {
          antes: antes.map((p) => serializar(almacen, p, yo)),
          pio: serializar(almacen, pio, yo),
          despues: arbol,
          respuestasTotales: cuenta.total,
          recortado: cuenta.total >= RAMAS_MAXIMAS,
        },
      };
    }
  }

  // --- usuarios -----------------------------------------------------------

  if (recurso === 'usuarios' && id) {
    const cuenta = almacen.buscarUsuario(id);
    if (!cuenta) throw new ErrorPio(404, 'No existe ese pollito.', 'pollito.noexiste');
    if (metodo === 'GET' && !accion) return { datos: { perfil: perfil(almacen, cuenta, yo) } };
    if (metodo === 'POST' && accion === 'seguir') {
      exigir(yo);
      await almacen.alternarSeguir(yo, id);
      return { datos: { perfil: perfil(almacen, cuenta, yo) } };
    }
  }

  // --- imagenes -----------------------------------------------------------

  if (recurso === 'imagenes' && metodo === 'POST') {
    exigir(yo);
    if (!imagenes.activo) {
      throw new ErrorPio(501, 'Este Pío no tiene configurada la subida de imágenes.', 'imagen.apagada');
    }
    const desde = dedonde();
    const espera = servicios.subidas.esperaDe(desde);
    if (espera) {
      throw new ErrorPio(
        429,
        `Demasiadas imágenes desde aquí. Intenta ${enEspera(espera)}.`,
        'subidas.muchas',
        { minutos: Math.ceil(espera / 60000) },
      );
    }
    try {
      const imagen = await imagenes.subir(cuerpo.imagen);
      servicios.subidas.anotar(desde);
      return { codigo: 201, datos: { imagen } };
    } catch (err) {
      if (err instanceof ErrorImagen) throw new ErrorPio(400, err.message, err.clave);
      throw err;
    }
  }

  // --- emojis del sitio ----------------------------------------------------

  // Sin sesión: son parte del decorado del sitio, no de nadie en particular,
  // y el cliente los necesita para dibujar cualquier pío.
  if (recurso === 'emojis' && metodo === 'GET') {
    return { datos: { emojis: almacen.emojis() } };
  }

  // --- acortar direcciones ------------------------------------------------

  // Pide sesión por lo mismo que los GIF: sin eso sería un acortador abierto,
  // y un acortador abierto es una herramienta de phishing esperando que la usen.
  if (recurso === 'acortar' && metodo === 'POST') {
    exigir(yo);
    if (!enlaces.activo) {
      throw new ErrorPio(501, 'Este Pío tiene apagado el acortador.', 'enlace.apagado');
    }
    const desde = dedonde();
    const espera = servicios.subidas.esperaDe(desde);
    if (espera) {
      throw new ErrorPio(
        429,
        `Demasiadas direcciones desde aquí. Intenta ${enEspera(espera)}.`,
        'subidas.muchas',
        { minutos: Math.ceil(espera / 60000) },
      );
    }
    try {
      const corto = await enlaces.acortar(cuerpo.url);
      servicios.subidas.anotar(desde);
      return { datos: corto };
    } catch (err) {
      if (err instanceof ErrorEnlace) throw new ErrorPio(400, err.message, err.clave);
      throw err;
    }
  }

  // --- gifs ---------------------------------------------------------------

  // Pide sesión a propósito: sin eso esto sería un proxy abierto a Giphy con
  // nuestra clave, disponible para cualquiera que encuentre la dirección.
  if (recurso === 'gifs' && metodo === 'GET') {
    exigir(yo);
    if (!gifs.activo) {
      throw new ErrorPio(501, 'Este Pío no tiene configurada la búsqueda de GIF.', 'gif.apagado');
    }
    try {
      return { datos: { gifs: await gifs.buscar(url.searchParams.get('q')) } };
    } catch (err) {
      if (err instanceof ErrorGif) throw new ErrorPio(502, err.message, err.clave);
      throw err;
    }
  }

  // --- avisos -------------------------------------------------------------

  if (recurso === 'notificaciones') {
    exigir(yo);
    if (metodo === 'GET' && !id) {
      return {
        datos: {
          notificaciones: almacen.avisosDe(yo).map((n) => serializarAviso(almacen, n, yo)),
          sinLeer: almacen.sinLeer(yo),
        },
      };
    }
    if (metodo === 'POST' && id === 'leidas') {
      await almacen.marcarLeidos(yo);
      return { datos: { ok: true, sinLeer: 0 } };
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

  throw new ErrorPio(404, 'Ruta desconocida.', 'ruta.desconocida');
}

// Arma el árbol de respuestas en cascada, cada una con sus propias ramas
// adentro. En orden cronológico dentro de cada nivel: en una conversación,
// leer de más viejo a más nuevo es lo que la hace seguible.
function ramasDe(almacen, id, yo, cuenta, hondo) {
  if (hondo >= HONDO_MAXIMO) return [];
  const hijos = almacen.respuestasDe(id).sort((a, b) => a.creado - b.creado);
  const salida = [];
  for (const hijo of hijos) {
    if (cuenta.total >= RAMAS_MAXIMAS) break;
    cuenta.total += 1;
    salida.push(Object.assign(serializar(almacen, hijo, yo), {
      hondo: hondo + 1,
      ramas: ramasDe(almacen, hijo.id, yo, cuenta, hondo + 1),
    }));
  }
  return salida;
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
    adjunto: pio.adjunto || null,
    mio: !!yo && pio.autor === yo.usuario,
  };
}

// El pío viaja adentro del aviso para que la lista se pinte de una sola
// pasada. Si lo borraron, el aviso sobrevive con pio en null.
function serializarAviso(almacen, aviso, yo) {
  const de = almacen.buscarUsuario(aviso.de);
  const pio = aviso.pio ? almacen.buscarPio(aviso.pio) : null;
  return {
    id: aviso.id,
    tipo: aviso.tipo,
    creado: aviso.creado,
    leida: aviso.leida,
    de: de ? { usuario: de.usuario, nombre: de.nombre } : { usuario: aviso.de, nombre: aviso.de },
    pio: pio ? serializar(almacen, pio, yo) : null,
  };
}

function perfil(almacen, cuenta, yo) {
  const propio = !!yo && yo.usuario === cuenta.usuario;
  return {
    usuario: cuenta.usuario,
    // Sólo en el perfil propio: a los demás no les importa cuándo podés
    // cambiarlo, y es información de más sobre otra persona.
    puedeCambiarUsuario: propio
      ? !cuenta.usuarioCambiado || Date.now() - cuenta.usuarioCambiado >= 30 * 24 * 60 * 60 * 1000
      : undefined,
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

function frenarAltas(altas, desde) {
  const espera = altas.esperaDe(desde);
  if (!espera) return;
  throw new ErrorPio(
    429,
    `Demasiadas cuentas nuevas desde aquí. Intenta ${enEspera(espera)}.`,
    'altas.muchas',
    { minutos: Math.ceil(espera / 60000) }
  );
}

function limpiarAdjunto(crudo) {
  if (!crudo) return null;
  const mirar = (valor) => {
    try {
      const u = new URL(String(valor));
      return u.protocol === 'https:' && ORIGENES.test(u.hostname) ? u.href : null;
    } catch (err) {
      return null;
    }
  };
  const url = mirar(crudo.url);
  if (!url) throw new ErrorPio(400, 'Esa imagen no viene de donde debería.', 'adjunto.origen');
  const entero = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
  return {
    url,
    miniatura: mirar(crudo.miniatura) || url,
    ancho: entero(crudo.ancho),
    alto: entero(crudo.alto),
    // Texto alternativo: es lo que lee quien no ve la imagen.
    texto: M.recortar(M.normalizarTexto(crudo.texto || ''), 100) || null,
  };
}

function exigir(yo) {
  if (!yo) throw new ErrorPio(401, 'Entra a tu nido primero.', 'sesion.falta');
}

function tokenDe(req) {
  const cabecera = req.headers.authorization || '';
  const m = cabecera.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function leerCuerpo(req, url) {
  const tope = url.pathname === '/api/imagenes' ? TOPE_IMAGEN : TOPE_CUERPO;
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'DELETE') return resolve({});
    let crudo = '';
    let cortado = false;
    req.on('data', (trozo) => {
      if (cortado) return;
      crudo += trozo;
      if (crudo.length > tope) {
        // Se responde 413 en vez de cortar la conexión a lo bruto: del otro
        // lado se ve un error entendible y no "falló la red".
        cortado = true;
        reject(new ErrorPio(413, 'Eso es demasiado grande.', 'cuerpo.grande'));
      }
    });
    req.on('end', () => {
      if (cortado) return;
      if (!crudo) return resolve({});
      try {
        resolve(JSON.parse(crudo));
      } catch (err) {
        reject(new ErrorPio(400, 'El cuerpo no es JSON válido.', 'cuerpo.malo'));
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

module.exports = { crearApi, serializar, serializarAviso, perfil, limpiarAdjunto };
