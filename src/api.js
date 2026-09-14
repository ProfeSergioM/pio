'use strict';

const { ErrorPio } = require('./almacen');
const { Limite, deDonde, enEspera } = require('./limite');
const { Google } = require('./google');
const { crearSubidor, ErrorImagen } = require('./imagenes');
const { crearGifs, ErrorGif } = require('./gifs');
const { crearAcortador, ErrorEnlace } = require('./enlaces');
const { medallaDe, faltanPara } = require('./medallas');
const C = require('./corrales');
const MSG = require('./mensajes');
const E = require('./emojis');
const { crearLatido } = require('./latido');

// De donde se acepta que venga un adjunto. El cliente manda una URL, y una URL
// que manda el cliente es un dato, no una verdad: si no se comprobara, cualquiera
// podria colgar de un pio la direccion que se le antoje.
const ORIGENES = /(^|\.)cloudinary\.com$|(^|\.)ibb\.co$|(^|\.)imgbb\.com$|(^|\.)giphy\.com$/;
const M = require('./modelo');

const PAGINA = 50;
const ALTAS_POR_HORA = 5;
const SUBIDAS_POR_HORA = 20;
// Adivinar un codigo de quince letras a fuerza de intentos es inviable, pero
// solo mientras haya un tope de intentos.
const INTENTOS_POR_HORA = 10;
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
    intentos: new Limite({
      cuantos: opciones.intentos || INTENTOS_POR_HORA,
      ventana: opciones.ventanaIntentos || 60 * 60 * 1000,
    }),
    subidas: new Limite({
      cuantos: opciones.subidas || SUBIDAS_POR_HORA,
      ventana: opciones.ventanaSubidas || 60 * 60 * 1000,
    }),
    google: new Google(opciones.googleClienteId, opciones.google),
    latido: crearLatido(almacen, opciones),
    // Se normalizan una vez acá: comparar a mano en cada petición es donde se
    // cuela el descuido que deja entrar a quien no debe.
    admins: new Set((opciones.admins || []).map((x) => String(x).toLowerCase())),
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
    // Que una barrida falle no es motivo para tirar abajo la petición.
    await almacen.barrerSesiones().catch(() => {});

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

  // El alias no sirve: se compara contra el nombre de ahora. Si alguien se
  // renombra, hay que actualizar PIO_ADMINS.
  const mando = () => !!yo && servicios.admins.has(yo.usuario);
  const exigirMando = () => {
    exigir(yo);
    if (!mando()) throw new ErrorPio(403, 'Esto es del corral de los que mandan.', 'admin.no');
  };
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
    const { cuenta, codigo } = await almacen.crearUsuario(cuerpo.usuario, cuerpo.nombre, cuerpo.clave);
    altas.anotar(desde);
    return {
      codigo: 201,
      datos: {
        token: await almacen.abrirSesion(cuenta),
        yo: perfil(almacen, cuenta, cuenta),
        // La única vez que este código viaja en claro.
        recuperacion: codigo,
      },
    };
  }

  // La puerta que golpea el cron de afuera. La clave va en la cabecera y no
  // en la direccion: una direccion con la clave adentro queda escrita en todos
  // los registros por los que pasa.
  if (recurso === 'latido') {
    const { latido } = servicios;
    if (!latido.activo) throw new ErrorPio(404, 'Acá no hay nada.', 'ruta.noexiste');
    if (!latido.autoriza(tokenDe(req))) {
      throw new ErrorPio(401, 'Esa no es la clave del latido.', 'latido.clave');
    }
    return { datos: await latido.golpear() };
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
        soyAdmin: mando(),
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

    // Cambiar la clave sabiendo la actual.
    if (metodo === 'POST' && id === 'clave') {
      exigir(yo);
      const { codigo } = await almacen.cambiarClave(yo, cuerpo.actual, cuerpo.nueva, tokenDe(req));
      // Si la cuenta no tenía clave —venía de Google— ahora estrena código.
      return { datos: Object.assign({ ok: true }, codigo ? { recuperacion: codigo } : {}) };
    }

    // Pedir un código nuevo, que anula el anterior.
    if (metodo === 'POST' && id === 'codigo') {
      exigir(yo);
      return { datos: { recuperacion: await almacen.nuevoCodigo(yo) } };
    }
  }

  // --- recuperar la clave con el código -----------------------------------

  if (recurso === 'recuperar' && metodo === 'POST') {
    const desde = dedonde();
    const espera = servicios.intentos.esperaDe(desde);
    if (espera) {
      throw new ErrorPio(
        429,
        `Demasiados intentos desde aquí. Intenta ${enEspera(espera)}.`,
        'intentos.muchos',
        { minutos: Math.ceil(espera / 60000) },
      );
    }
    // Se cuenta el intento ANTES de saber si acertó: contar sólo los fallos
    // deja la puerta abierta a probar mientras no se acierte.
    servicios.intentos.anotar(desde);

    const { cuenta, codigo } = await almacen.recuperar(cuerpo.usuario, cuerpo.codigo, cuerpo.clave);
    return {
      datos: {
        token: await almacen.abrirSesion(cuenta),
        yo: perfil(almacen, cuenta, cuenta),
        recuperacion: codigo,
      },
    };
  }

  // --- píos ---------------------------------------------------------------

  if (recurso === 'pios') {
    if (metodo === 'GET' && !id) {
      return { datos: linea(almacen, url.searchParams, yo) };
    }
    if (metodo === 'POST' && !id) {
      exigir(yo);
      // Se comprueba que exista antes de escribir: un pío colgado de un
      // corral inventado no lo ve nadie nunca más.
      const dondeVa = cuerpo.corral ? almacen.buscarCorral(cuerpo.corral) : null;
      if (cuerpo.corral && !dondeVa) {
        throw new ErrorPio(404, C.mensaje({ clave: 'corral.noexiste' }), 'corral.noexiste');
      }
      const pio = await almacen.publicar(
        yo, cuerpo.texto, cuerpo.respuestaA, limpiarAdjunto(cuerpo.adjunto),
        dondeVa ? dondeVa.nombre : null,
      );
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
    if (metodo === 'POST' && accion === 'silenciar') {
      exigir(yo);
      await almacen.alternarSilencio(yo, id);
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

  // --- panel de administración ----------------------------------------------

  if (recurso === 'admin') {
    exigirMando();

    if (metodo === 'GET' && id === 'resumen') {
      const d = almacen.datos;
      return {
        datos: {
          resumen: {
            usuarios: d.usuarios.length,
            pios: d.pios.length,
            corrales: d.corrales.length,
            mensajes: d.mensajes.length,
            avisos: d.notificaciones.length,
            sesiones: Object.keys(d.sesiones).length,
            deposito: almacen.deposito.nombre,
          },
        },
      };
    }

    if (metodo === 'GET' && id === 'usuarios') {
      return {
        datos: {
          usuarios: almacen.datos.usuarios.map((u) => ({
            usuario: u.usuario,
            nombre: u.nombre,
            creado: u.creado,
            porGoogle: !!u.google,
            tieneClave: !!(u.sal && u.hash),
            alias: u.alias || [],
            pios: almacen.datos.pios.filter((p) => p.autor === u.usuario).length,
            seguidores: almacen.seguidores(u.usuario).length,
            manda: servicios.admins.has(u.usuario),
            oculto: (almacen.datos.ocultos || []).includes(u.usuario),
          })).sort((a, b) => b.creado - a.creado),
        },
      };
    }

    if (metodo === 'DELETE' && id === 'usuarios' && accion) {
      // Quien manda no se puede borrar desde acá: sería la forma más rápida de
      // quedarse sin nadie que administre el sitio.
      if (servicios.admins.has(String(accion).toLowerCase())) {
        throw new ErrorPio(403, 'A quien administra no se lo borra desde acá.', 'admin.protegido');
      }
      return { datos: { borrado: await almacen.borrarCuenta(accion) } };
    }

    // La plaza deja afuera lo que se dijo adentro de un corral, y lo que no
    // se ve no se modera. Acá se ven todos, del más nuevo al más viejo.
    if (metodo === 'GET' && id === 'pios') {
      const lista = almacen.datos.pios
        .slice()
        .sort((a, b) => b.creado - a.creado)
        .slice(0, PAGINA)
        .map((p) => serializar(almacen, p, yo));
      return { datos: { pios: lista } };
    }

    if (metodo === 'POST' && id === 'ocultos' && accion) {
      return { datos: { oculto: await almacen.alternarOculto(accion) } };
    }

    if (metodo === 'DELETE' && id === 'pios' && accion) {
      return { datos: { borrado: await almacen.borrarPio(accion) } };
    }

    if (metodo === 'DELETE' && id === 'corrales' && accion) {
      return { datos: { borrado: await almacen.borrarCorral(accion) } };
    }

    if (metodo === 'GET' && id === 'emojis') {
      // Van tambien los de fabrica: sin ellos, el panel no tiene de donde
      // partir la primera vez y habria que escribir los cinco a mano.
      return {
        datos: { emojis: almacen.datos.emojis, enUso: almacen.emojis(), defecto: E.POR_DEFECTO },
      };
    }

    if (metodo === 'PUT' && id === 'emojis') {
      const guardados = await almacen.guardarEmojis(cuerpo.emojis);
      return { datos: { emojis: almacen.datos.emojis, enUso: guardados } };
    }
  }

  // --- corrales -------------------------------------------------------------

  if (recurso === 'corrales') {
    if (metodo === 'GET' && !id) {
      const lista = almacen.datos.corrales
        .map((c) => serializarCorral(almacen, c, yo))
        .sort((a, b) => b.pios - a.pios || a.nombre.localeCompare(b.nombre));
      return { datos: { corrales: lista } };
    }

    if (metodo === 'POST' && !id) {
      exigir(yo);
      const corral = await almacen.crearCorral(yo, cuerpo);
      return { codigo: 201, datos: { corral: serializarCorral(almacen, corral, yo) } };
    }

    if (id) {
      const corral = almacen.buscarCorral(id);
      if (!corral) {
        throw new ErrorPio(404, C.mensaje({ clave: 'corral.noexiste' }), 'corral.noexiste');
      }
      if (metodo === 'GET' && !accion) {
        return { datos: { corral: serializarCorral(almacen, corral, yo) } };
      }
      if (metodo === 'POST' && accion === 'seguir') {
        exigir(yo);
        await almacen.alternarCorral(yo, corral.nombre);
        return { datos: { corral: serializarCorral(almacen, corral, yo) } };
      }

      // El chat. Se lee sin sesión —el corral es público— pero para escribir
      // hay que haber entrado: eso es lo que significa entrar.
      if (metodo === 'GET' && accion === 'chat') {
        const desde = url.searchParams.get('desde');
        return {
          datos: {
            mensajes: almacen.mensajesDe(corral.nombre, desde)
              .map((m) => serializarMensaje(almacen, m)),
          },
        };
      }

      if (metodo === 'POST' && accion === 'chat') {
        exigir(yo);
        const dicho = await almacen.decir(yo, corral, cuerpo.texto);
        return { codigo: 201, datos: { mensaje: serializarMensaje(almacen, dicho) } };
      }
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
          notificaciones: almacen.avisosDe(yo)
            .filter((n) => !callado(almacen, yo, n.de))
            .map((n) => serializarAviso(almacen, n, yo)),
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
      .filter((p) => p.texto.toLowerCase().includes(q) && !callado(almacen, yo, p.autor))
      .sort((a, b) => b.creado - a.creado)
      .slice(0, PAGINA)
      .map((p) => serializar(almacen, p, yo));
    return { datos: { pios, usuarios } };
  }

  if (recurso === 'tendencias' && metodo === 'GET') {
    const cuenta = new Map();
    const corte = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const p of almacen.datos.pios) {
      if (p.creado < corte || (almacen.datos.ocultos || []).includes(p.autor)) continue;
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
    const mios = new Set(yo.corrales || []);
    for (const p of almacen.datos.pios) {
      // De quien sigo, sólo lo que dijo en la plaza: si sigo a alguien pero no
      // estoy en su corral, ese corral no es asunto mío.
      const deQuienSigo = !p.corral && seguidos.has(p.autor);
      const deMisCorrales = !!p.corral && mios.has(p.corral);
      if ((deQuienSigo || deMisCorrales) && !p.respuestaA) agregar(p, p.creado, null);
      for (const r of p.repios) {
        if (seguidos.has(r.usuario) && r.usuario !== p.autor) agregar(p, r.fecha, r.usuario);
      }
    }
  } else if (tipo === 'corral') {
    const cual = C.aNombre(params.get('corral'));
    for (const p of almacen.datos.pios) {
      if (p.corral === cual && !p.respuestaA) agregar(p, p.creado, null);
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
    // La plaza es el tema general, sin necesidad de llamarlo así: todo lo que
    // no vive dentro de un corral.
    for (const p of almacen.datos.pios) if (!p.respuestaA && !p.corral) agregar(p, p.creado, null);
  }

  // Lo silenciado no se muestra en ninguna línea, salvo en el perfil de esa
  // misma cuenta: si alguien entra a mirarla a propósito, esconderle lo que
  // fue a buscar sería confuso.
  if (tipo !== 'usuario') {
    for (let i = entradas.length - 1; i >= 0; i -= 1) {
      const e = entradas[i];
      if (callado(almacen, yo, e.pio.autor) || callado(almacen, yo, e.repiadoPor)) entradas.splice(i, 1);
    }
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
    corral: pio.corral || null,
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

function serializarMensaje(almacen, m) {
  const quien = almacen.buscarUsuario(m.autor);
  return {
    id: m.id,
    texto: m.texto,
    creado: m.creado,
    autor: quien
      ? { usuario: quien.usuario, nombre: quien.nombre }
      : { usuario: m.autor, nombre: m.autor },
  };
}

function serializarCorral(almacen, corral, yo) {
  return {
    nombre: corral.nombre,
    titulo: corral.titulo,
    descripcion: corral.descripcion || '',
    creado: corral.creado,
    dueno: corral.dueno,
    pios: almacen.piosDe(corral.nombre),
    suscritos: almacen.suscritos(corral.nombre),
    estoy: !!yo && (yo.corrales || []).includes(corral.nombre),
    esMio: !!yo && yo.usuario === corral.dueno,
  };
}

function perfil(almacen, cuenta, yo) {
  const propio = !!yo && yo.usuario === cuenta.usuario;
  const seguidores = almacen.seguidores(cuenta.usuario).length;
  return {
    usuario: cuenta.usuario,
    // Sólo en el perfil propio: a los demás no les importa cuándo puedes
    // cambiarlo, y es información de más sobre otra persona.
    tieneClave: propio ? !!(cuenta.sal && cuenta.hash) : undefined,
    tieneCodigo: propio ? !!cuenta.recuperacion : undefined,
    puedeCambiarUsuario: propio
      ? !cuenta.usuarioCambiado || Date.now() - cuenta.usuarioCambiado >= 30 * 24 * 60 * 60 * 1000
      : undefined,
    nombre: cuenta.nombre,
    bio: cuenta.bio,
    creado: cuenta.creado,
    siguiendo: cuenta.siguiendo.length,
    seguidores,
    medalla: medallaDe(seguidores),
    // Cuánto falta para la próxima sólo en el perfil propio: a los demás no
    // les interesa, y es información de más sobre otra persona.
    proxima: propio ? faltanPara(seguidores) : undefined,
    pios: almacen.datos.pios.filter((p) => p.autor === cuenta.usuario).length,
    loSigo: !!yo && yo.siguiendo.includes(cuenta.usuario),
    loSilencio: silenciado(yo, cuenta.usuario),
    soyYo: !!yo && yo.usuario === cuenta.usuario,
  };
}

function silenciado(yo, usuario) {
  return !!(yo && usuario && Array.isArray(yo.silenciados) && yo.silenciados.includes(usuario));
}

// Lo que no se le muestra a quien mira: lo que silenció, más lo que el panel
// escondió para todos.
function callado(almacen, yo, usuario) {
  if (!usuario) return false;
  return (almacen.datos.ocultos || []).includes(usuario) || silenciado(yo, usuario);
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

module.exports = { crearApi, serializar, serializarAviso, serializarCorral, perfil, limpiarAdjunto };
