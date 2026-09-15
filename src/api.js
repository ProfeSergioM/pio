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
const PUSH = require('./push');
const PR = require('./preguntas');
const D = require('./descanso');
const B = require('./buzon');
const CAD = require('./cadenas');

// Dónde vive el sitio si nadie dice otra cosa. Pío nació en Chile.
const ZONA_POR_DEFECTO = 'America/Santiago';

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
    push: PUSH.crearPush(almacen, opciones),
    zona: opciones.zonaHoraria || ZONA_POR_DEFECTO,
    // Se normalizan una vez acá: comparar a mano en cada petición es donde se
    // cuela el descuido que deja entrar a quien no debe.
    admins: new Set((opciones.admins || []).map((x) => String(x).toLowerCase())),
    imagenes: crearSubidor(opciones, opciones.imagenes),
    gifs: crearGifs(opciones, opciones.gifs),
    enlaces: crearAcortador(opciones, opciones.enlaces),
  };

  // Para quien no dijo dónde duerme: el horario de silencio se cuenta en la
  // hora del sitio.
  almacen.zonaDelSitio = servicios.zona;

  // Cada aviso que se anota sale también al teléfono de quien lo recibe.
  almacen.alAvisar = (aviso) => servicios.push.programar(aviso);

  // Devuelve true si la peticion era de la API (y ya fue respondida).
  return async function api(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;

    // La primera petición espera a que termine la carga inicial; el resto la
    // encuentra resuelta y no paga nada.
    await almacen.listo;
    // Que una barrida falle no es motivo para tirar abajo la petición.
    await almacen.barrerSesiones().catch(() => {});
    await almacen.detonar().catch(() => {});

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
  // --- notificaciones al teléfono -------------------------------------------

  if (recurso === 'push') {
    if (metodo === 'GET' && id === 'clave') {
      return { datos: { clave: await servicios.push.clavePublica() } };
    }
    exigir(yo);
    if (metodo === 'POST' && id === 'suscribir') {
      const suscripcion = PUSH.limpiarSuscripcion(cuerpo);
      if (!suscripcion) throw new ErrorPio(400, 'Esa suscripción no se entiende.', 'push.mala');
      await almacen.suscribir(yo, suscripcion, PUSH.SUSCRIPCIONES_POR_CUENTA);
      return { datos: { ok: true } };
    }
    if (metodo === 'POST' && id === 'desuscribir') {
      await almacen.desuscribir(yo, String(cuerpo.endpoint || ''));
      return { datos: { ok: true } };
    }
  }

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
    if (metodo === 'GET' && !id) {
      exigir(yo);
      return { datos: { yo: perfil(almacen, yo, yo) } };
    }
    if (metodo === 'PATCH') {
      exigir(yo);
      const cambios = Object.assign({}, cuerpo);
      // La foto va en un <img> de todas las páginas del sitio: sólo se acepta
      // una dirección de los servicios donde subimos imágenes. Vacío la quita.
      if (cuerpo.avatar !== undefined) {
        cambios.avatar = cuerpo.avatar ? urlDeConfianza(cuerpo.avatar) : null;
        if (cuerpo.avatar && !cambios.avatar) {
          throw new ErrorPio(400, 'Esa imagen no viene de donde debería.', 'adjunto.origen');
        }
      }
      await almacen.actualizarPerfil(yo, cambios);
      return { datos: { yo: perfil(almacen, yo, yo) } };
    }

    // Cambiar la clave sabiendo la actual.
    if (metodo === 'POST' && id === 'clave') {
      exigir(yo);
      const { codigo } = await almacen.cambiarClave(yo, cuerpo.actual, cuerpo.nueva, tokenDe(req));
      // Si la cuenta no tenía clave —venía de Google— ahora estrena código.
      return { datos: Object.assign({ ok: true }, codigo ? { recuperacion: codigo } : {}) };
    }

    // Tu nido es tuyo: todo lo que es de la cuenta, en un JSON para llevárselo.
    if (metodo === 'GET' && id === 'exportar') {
      exigir(yo);
      return { datos: exportarCuenta(almacen, yo) };
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
      // La fecha la pone el servidor: si la mandara el cliente, cualquiera
      // podría contestar la pregunta de otro día.
      const pio = await almacen.publicar(
        yo, cuerpo.texto, cuerpo.respuestaA, adjuntoConEtiquetas(almacen, cuerpo.adjunto),
        dondeVa ? dondeVa.nombre : null,
        { pregunta: cuerpo.pregunta ? PR.hoy(servicios.zona) : null, bomba: cuerpo.bomba === true,
          aMano: cuerpo.aMano === true, cadena: cuerpo.cadena === true },
      );
      return { codigo: 201, datos: { pio: serializar(almacen, pio, yo) } };
    }
    if (metodo === 'POST' && id && accion === 'eslabon') {
      exigir(yo);
      const eslabon = await almacen.sumarEslabon(yo, id, cuerpo.texto, { aMano: cuerpo.aMano === true });
      return { codigo: 201, datos: { pio: serializar(almacen, eslabon, yo) } };
    }
    if (metodo === 'POST' && id && accion === 'terminar') {
      exigir(yo);
      const raiz = await almacen.terminarCadena(yo, id);
      return { datos: { pio: serializar(almacen, raiz, yo) } };
    }
    // La cadena entera, de principio a fin. Un eslabón lleva a su cadena.
    if (metodo === 'GET' && id && accion === 'cadena') {
      const pedido = almacen.buscarPio(id);
      const raiz = pedido && pedido.eslabonDe ? almacen.buscarPio(pedido.eslabonDe) : pedido;
      if (!raiz || !raiz.cadena || !almacen.visiblePara(raiz, yo)) throw new ErrorPio(404, 'Ese pío ya no está.', 'pio.noesta');
      const eslabones = almacen.eslabonesDe(raiz.id)
        .filter((p) => almacen.visiblePara(p, yo) && !callado(almacen, yo, p.autor))
        .map((p) => serializar(almacen, p, yo));
      return { datos: { pio: serializar(almacen, raiz, yo), eslabones } };
    }
    if (metodo === 'DELETE' && id) {
      exigir(yo);
      await almacen.borrar(yo, id);
      return { datos: { ok: true } };
    }
    if (metodo === 'POST' && id && (accion === 'megusta' || accion === 'repio' || accion === 'hilo')
      && almacen.buscarPio(id) && !almacen.visiblePara(almacen.buscarPio(id), yo)) {
      throw new ErrorPio(404, 'Ese pío ya no está.', 'pio.noesta');
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
      if (!pio || !almacen.visiblePara(pio, yo)) throw new ErrorPio(404, 'Ese pío ya no está.', 'pio.noesta');

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
          antes: antes.filter((p) => almacen.visiblePara(p, yo)).map((p) => serializar(almacen, p, yo)),
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
    if (metodo === 'POST' && accion === 'bloquear') {
      exigir(yo);
      await almacen.bloquear(yo, id, cuerpo.minutos);
      return { datos: { perfil: perfil(almacen, cuenta, yo) } };
    }
    if (metodo === 'POST' && accion === 'silenciar') {
      exigir(yo);
      await almacen.alternarSilencio(yo, id);
      return { datos: { perfil: perfil(almacen, cuenta, yo) } };
    }
    // Dejar una pregunta en su buzón. La respuesta es la misma entre o no,
    // para no delatar un bloqueo.
    if (metodo === 'POST' && accion === 'buzon') {
      exigir(yo);
      await almacen.preguntar(yo, id, cuerpo.texto, cuerpo.anonima === true);
      return { codigo: 201, datos: { ok: true } };
    }
  }

  // --- el buzón propio ------------------------------------------------------

  if (recurso === 'buzon') {
    exigir(yo);
    if (metodo === 'GET' && !id) {
      const b = B.deCuenta(yo);
      return {
        datos: {
          buzon: {
            abierto: b.abierto,
            anonimas: b.anonimas,
            preguntas: b.preguntas.slice().sort((x, y) => y.creado - x.creado)
              .map((p) => B.publica(p, (u) => almacen.buscarUsuario(u))),
          },
        },
      };
    }
    if (metodo === 'PATCH' && !id) {
      const b = await almacen.ajustarBuzon(yo, cuerpo);
      return { datos: { buzon: { abierto: b.abierto, anonimas: b.anonimas } } };
    }
    if (metodo === 'DELETE' && id) {
      await almacen.borrarPregunta(yo, id);
      return { datos: { ok: true } };
    }
    if (metodo === 'POST' && id && accion === 'bloquear') {
      return { datos: { hasta: await almacen.bloquearDesdePregunta(yo, id, cuerpo.minutos) } };
    }
    if (metodo === 'POST' && id && accion === 'responder') {
      const pio = await almacen.responderPregunta(yo, id, cuerpo.texto, {
        bomba: cuerpo.bomba === true, aMano: cuerpo.aMano === true,
        adjunto: adjuntoConEtiquetas(almacen, cuerpo.adjunto),
      });
      return { codigo: 201, datos: { pio: serializar(almacen, pio, yo) } };
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
            avatar: u.avatar || null,
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
    // Todos los píos, de a cincuenta, con búsqueda. "@alguien" busca por
    // autor; cualquier otra cosa, en el texto. Acá se ve lo oculto, lo
    // silenciado y los huevos: lo que no se ve no se modera.
    if (metodo === 'GET' && id === 'pios') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const antes = Number(url.searchParams.get('antes') || 0);
      const porAutor = q.startsWith('@') ? M.normalizarUsuario(q.slice(1)) : null;
      const coinciden = almacen.datos.pios
        .filter((p) => {
          if (antes && p.creado >= antes) return false;
          if (!q) return true;
          if (porAutor) return p.autor.startsWith(porAutor);
          return (p.texto || '').toLowerCase().includes(q);
        })
        .sort((a, b) => b.creado - a.creado);
      const pagina = coinciden.slice(0, PAGINA);
      return {
        datos: {
          // Quien administra ve quién hizo una pregunta anónima: el anonimato
          // es entre quien pregunta y quien responde, no un escudo para acosar.
          pios: pagina.map((p) => Object.assign(serializar(almacen, p, yo),
            p.buzon ? { buzonDe: p.buzon.de } : {})),
          hayMas: coinciden.length > pagina.length,
          total: antes ? undefined : coinciden.length,
        },
      };
    }

    // Las preguntas que esperan en todos los buzones, con quién las hizo. Son
    // privadas para el resto del sitio, pero lo que no se ve no se modera.
    if (metodo === 'GET' && id === 'buzones') {
      const preguntas = [];
      for (const u of almacen.datos.usuarios) {
        for (const p of B.deCuenta(u).preguntas) {
          preguntas.push({ id: p.id, para: u.usuario, de: p.de, anonima: !!p.anonima, texto: p.texto, creado: p.creado });
        }
      }
      preguntas.sort((a, b) => b.creado - a.creado);
      return { datos: { preguntas: preguntas.slice(0, PAGINA), total: preguntas.length } };
    }
    if (metodo === 'DELETE' && id === 'buzones' && accion) {
      const duena = almacen.datos.usuarios.find((u) => B.deCuenta(u).preguntas.some((p) => p.id === accion));
      if (!duena) throw new ErrorPio(404, B.mensaje('buzon.noesta'), 'buzon.noesta');
      await almacen.borrarPregunta(duena, accion);
      return { datos: { borrado: accion } };
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
            .filter((n) => !callado(almacen, yo, n.de) && !almacen.bloqueoVigente(yo, n.de))
            .map((n) => serializarAviso(almacen, n, yo)),
          sinLeer: almacen.sinLeer(yo),
        },
      };
    }
    // Sólo el número. Se pregunta cada medio minuto con la pestaña abierta, y
    // armar la lista entera con sus píos cada vez sería mandar lo mismo para
    // pintar un circulito.
    if (metodo === 'GET' && id === 'cuenta') {
      return { datos: { sinLeer: almacen.sinLeer(yo) } };
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
      .filter((p) => p.texto.toLowerCase().includes(q) && !callado(almacen, yo, p.autor)
        && almacen.visiblePara(p, yo))
      .sort((a, b) => b.creado - a.creado)
      .slice(0, PAGINA)
      .map((p) => serializar(almacen, p, yo));
    return { datos: { pios, usuarios } };
  }

  if (recurso === 'pregunta' && metodo === 'GET') {
    const hoy = PR.hoy(servicios.zona);
    const pedida = url.searchParams.get('fecha') || hoy;
    // Las de mañana no: adelantarlas le quita la gracia a la de cada día.
    if (!PR.esFecha(pedida) || pedida > hoy) {
      throw new ErrorPio(404, 'No hay pregunta para ese día.', 'pregunta.noesta');
    }
    const pregunta = PR.preguntaDe(pedida);
    const respuestas = almacen.datos.pios
      .filter((p) => p.pregunta === pedida && almacen.visiblePara(p, yo) && !callado(almacen, yo, p.autor))
      .length;
    return { datos: { pregunta: Object.assign(pregunta, { hoy: pedida === hoy, respuestas }) } };
  }

  if (recurso === 'tendencias' && metodo === 'GET') {
    const cuenta = new Map();
    const corte = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const p of almacen.datos.pios) {
      if (p.creado < corte || (almacen.datos.ocultos || []).includes(p.autor) || almacen.esHuevo(p)) continue;
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
  const hijos = almacen.respuestasDe(id)
    .filter((p) => almacen.visiblePara(p, yo))
    .sort((a, b) => a.creado - b.creado);
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

  // Los eslabones de una cadena no van sueltos por las líneas: una cadena de
  // veinte llenaría la plaza. Va el primero, que sube cada vez que alguien
  // suma. En el perfil de cada uno sí se ven los suyos.
  const conEslabones = tipo === 'usuario' || tipo === 'megusta';
  const agregar = (pio, orden, repiadoPor) => {
    if (pio.eslabonDe && !conEslabones) return;
    const movida = pio.cadena && !repiadoPor && !conEslabones
      ? Math.max(orden, ...almacen.eslabonesDe(pio.id).filter((p) => almacen.visiblePara(p, yo)).map((p) => p.creado))
      : orden;
    entradas.push({ pio, orden: movida, repiadoPor });
  };

  if (tipo === 'nido') {
    exigir(yo);
    const seguidos = new Set([yo.usuario, ...yo.siguiendo]);
    const mios = new Set(yo.corrales || []);
    for (const p of almacen.datos.pios) {
      // De quien sigo, sólo lo que dijo en la plaza: si sigo a alguien pero no
      // estoy en su corral, ese corral no es asunto mío.
      const deQuienSigo = !p.corral && seguidos.has(p.autor);
      const deMisCorrales = !!p.corral && mios.has(p.corral);
      if (deQuienSigo || deMisCorrales) agregar(p, p.creado, null);
      for (const r of p.repios) {
        if (seguidos.has(r.usuario) && r.usuario !== p.autor) agregar(p, r.fecha, r.usuario);
      }
    }
  } else if (tipo === 'corral') {
    const cual = C.aNombre(params.get('corral'));
    for (const p of almacen.datos.pios) {
      if (p.corral === cual) agregar(p, p.creado, null);
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
  } else if (tipo === 'pregunta') {
    const fecha = String(params.get('fecha') || '');
    for (const p of almacen.datos.pios) if (fecha && p.pregunta === fecha) agregar(p, p.creado, null);
  } else if (tipo === 'megusta') {
    const quien = M.normalizarUsuario(params.get('usuario'));
    for (const p of almacen.datos.pios) if (p.meGusta.includes(quien)) agregar(p, p.creado, null);
  } else {
    // La plaza es el tema general, sin necesidad de llamarlo así: todo lo que
    // no vive dentro de un corral. Las respuestas también: una conversación
    // escondida en el hilo es una conversación que nadie encuentra.
    for (const p of almacen.datos.pios) if (!p.corral) agregar(p, p.creado, null);
  }

  // Lo silenciado no se muestra en ninguna línea, salvo en el perfil de esa
  // misma cuenta: si alguien entra a mirarla a propósito, esconderle lo que
  // fue a buscar sería confuso.
  // Los huevos ajenos no se muestran en ninguna línea, ni siquiera en el
  // perfil de quien los puso.
  // Con mano=1, sólo lo escrito a mano, en cualquier línea.
  const soloAMano = params.get('mano') === '1';
  for (let i = entradas.length - 1; i >= 0; i -= 1) {
    if (!almacen.visiblePara(entradas[i].pio, yo) || (soloAMano && !entradas[i].pio.aMano)) entradas.splice(i, 1);
  }

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
    respuestaAUsuario: pio.respuestaA ? ((almacen.buscarPio(pio.respuestaA) || {}).autor || null) : null,
    autor: autor
      ? { usuario: autor.usuario, nombre: autor.nombre, avatar: autor.avatar || null }
      : { usuario: pio.autor, nombre: pio.autor },
    // El número sólo lo ve quien escribió el pío. La competencia por
    // corazones es lo que más cansa de las otras redes; saber si a uno le
    // gustó a alguien no necesita un marcador a la vista de todos.
    meGusta: yo && yo.usuario === pio.autor ? pio.meGusta.length : null,
    yoMeGusta: !!yo && pio.meGusta.includes(yo.usuario),
    repios: pio.repios.length,
    yoRepio: !!yo && pio.repios.some((r) => r.usuario === yo.usuario),
    respuestas: almacen.contarRespuestas(pio.id, yo),
    // Lo que falta para nacer, contado acá: el reloj del teléfono de cada uno
    // puede estar corrido, el del servidor es uno solo.
    huevo: almacen.esHuevo(pio),
    naceEn: almacen.esHuevo(pio) ? pio.nace - Date.now() : 0,
    // Con el mismo reloj: cuánto le queda a la mecha.
    bomba: !!pio.explota,
    explotaEn: pio.explota ? Math.max(0, pio.explota - Date.now()) : 0,
    aMano: !!pio.aMano,
    // La pregunta del buzón que responde. De una anónima no sale quién la hizo.
    buzon: pio.buzon ? preguntaDelPio(almacen, pio.buzon) : null,
    cadena: pio.cadena ? resumenDeCadena(almacen, pio, yo) : null,
    eslabonDe: pio.eslabonDe || null,
    adjunto: adjuntoPublico(almacen, pio.adjunto),
    corral: pio.corral || null,
    pregunta: pio.pregunta || null,
    // Sólo le importa a quien bloqueó: con esto la tarjeta sale borrosa.
    bloqueadoHasta: almacen.bloqueoVigente(yo, pio.autor),
    mio: !!yo && pio.autor === yo.usuario,
  };
}

// Lo que se lleva quien exporta su cuenta. Va lo suyo: lo que escribió, a quién
// sigue, sus ajustes, lo que marcó. No va lo que no le sirve a nadie fuera de
// Pío ni lo que es de otros: la clave y su sal, el código de recuperación, las
// sesiones, las suscripciones del teléfono, quién le dio me gusta, ni quién
// hizo una pregunta anónima.
function exportarCuenta(almacen, cuenta) {
  const referencia = (p) => {
    const autor = almacen.buscarUsuario(p.autor);
    return { id: p.id, autor: autor ? autor.usuario : p.autor, texto: p.texto, creado: p.creado };
  };
  const preguntaSin = (p) => ({
    texto: p.texto,
    creado: p.creado,
    anonima: !!p.anonima,
    de: p.anonima ? null : p.de,
  });
  const propios = almacen.datos.pios.filter((p) => p.autor === cuenta.usuario).sort((a, b) => a.creado - b.creado);
  const b = B.deCuenta(cuenta);
  const hechas = [];
  for (const otra of almacen.datos.usuarios) {
    if (otra === cuenta) continue;
    for (const p of B.deCuenta(otra).preguntas) {
      if (p.de === cuenta.usuario) hechas.push({ para: otra.usuario, texto: p.texto, creado: p.creado, anonima: !!p.anonima });
    }
  }
  return {
    formato: 'pio-exportacion-1',
    exportado: new Date().toISOString(),
    cuenta: {
      usuario: cuenta.usuario,
      nombre: cuenta.nombre,
      bio: cuenta.bio || '',
      avatar: cuenta.avatar || null,
      creado: cuenta.creado,
      nombresAnteriores: cuenta.alias || [],
      conGoogle: !!cuenta.google,
      siguiendo: cuenta.siguiendo.slice(),
      silenciados: (cuenta.silenciados || []).slice(),
      corrales: (cuenta.corrales || []).slice(),
      descanso: D.deCuenta(cuenta),
      buzon: { abierto: b.abierto, anonimas: b.anonimas },
    },
    pios: propios.map((p) => ({
      id: p.id,
      texto: p.texto,
      creado: p.creado,
      respuestaA: p.respuestaA || null,
      corral: p.corral || null,
      adjunto: p.adjunto ? { tipo: p.adjunto.tipo || null, url: p.adjunto.url || null, texto: p.adjunto.texto || '' } : null,
      etiquetas: p.etiquetas || [],
      menciones: p.menciones || [],
      meGusta: p.meGusta.length,
      repios: p.repios.length,
      preguntaDelDia: p.pregunta || null,
      explota: p.explota || null,
      aMano: !!p.aMano,
      cadena: p.cadena ? { terminada: !!p.cadena.terminada } : null,
      eslabonDe: p.eslabonDe || null,
      respondeAlBuzon: p.buzon ? preguntaSin(p.buzon) : null,
    })),
    meGusta: almacen.datos.pios.filter((p) => p.meGusta.includes(cuenta.usuario)).map(referencia),
    repios: almacen.datos.pios.filter((p) => p.repios.some((r) => r.usuario === cuenta.usuario)).map(referencia),
    buzon: {
      pendientes: b.preguntas.map(preguntaSin),
      preguntasQueHice: hechas,
    },
    mensajesDeChat: almacen.datos.mensajes
      .filter((m) => m.autor === cuenta.usuario)
      .map((m) => ({ corral: m.corral, texto: m.texto, creado: m.creado })),
  };
}

// Lo que la tarjeta necesita saber de una cadena para dibujarse sin pedir más.
function resumenDeCadena(almacen, raiz, yo) {
  const { eslabones, total, terminada, motivo } = almacen.estadoDeCadena(raiz, yo);
  // El último que se ve: de un huevo ajeno no se dice ni quién lo está escribiendo.
  const visibles = eslabones.filter((p) => almacen.visiblePara(p, yo));
  const ultimo = visibles.length ? visibles[visibles.length - 1] : raiz;
  const autorUltimo = almacen.buscarUsuario(ultimo.autor);
  return {
    total,
    maximo: CAD.MAXIMO,
    terminada,
    // Sólo quien empezó la cadena la puede cerrar antes de tiempo.
    puedoTerminar: !!yo && raiz.autor === yo.usuario && !terminada,
    ultimo: { usuario: autorUltimo ? autorUltimo.usuario : ultimo.autor },
    puedoSumar: !!yo && !motivo,
    motivo: yo ? motivo : null,
    // La última actividad: con esto la cadena sube en la plaza cada vez que alguien suma.
    movida: ultimo.creado,
  };
}

function textoDePregunta(cuenta, id) {
  const p = B.deCuenta(cuenta).preguntas.find((x) => x.id === id);
  return p ? p.texto : null;
}

function preguntaDelPio(almacen, pregunta) {
  if (pregunta.anonima || !pregunta.de) return { texto: pregunta.texto, anonima: !!pregunta.anonima, de: null };
  const quien = almacen.buscarUsuario(pregunta.de);
  return {
    texto: pregunta.texto,
    anonima: false,
    de: quien ? { usuario: quien.usuario, nombre: quien.nombre } : { usuario: pregunta.de, nombre: pregunta.de },
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
    // Sin "de" es una pregunta anónima del buzón.
    de: de
      ? { usuario: de.usuario, nombre: de.nombre, avatar: de.avatar || null }
      : (aviso.de ? { usuario: aviso.de, nombre: aviso.de } : null),
    pio: pio ? serializar(almacen, pio, yo) : null,
    pregunta: aviso.pregunta ? textoDePregunta(yo, aviso.pregunta) : undefined,
  };
}

function serializarMensaje(almacen, m) {
  const quien = almacen.buscarUsuario(m.autor);
  return {
    id: m.id,
    texto: m.texto,
    creado: m.creado,
    autor: quien
      ? { usuario: quien.usuario, nombre: quien.nombre, avatar: quien.avatar || null }
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
    avatar: cuenta.avatar || null,
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
    // La granja duerme: el horario y el tope son asunto de cada uno.
    descanso: propio ? D.deCuenta(cuenta) : undefined,
    piosHoy: propio
      ? D.piosDeHoy(almacen.datos.pios, cuenta.usuario, D.deCuenta(cuenta).zona || almacen.zonaDelSitio)
      : undefined,
    loSigo: !!yo && yo.siguiendo.includes(cuenta.usuario),
    // Si el buzón está abierto lo ve cualquiera; cuántas esperan, sólo quien lo tiene.
    buzon: {
      abierto: B.deCuenta(cuenta).abierto,
      anonimas: B.deCuenta(cuenta).anonimas,
      pendientes: propio ? B.deCuenta(cuenta).preguntas.length : undefined,
    },
    loSilencio: silenciado(yo, cuenta.usuario),
    bloqueadoHasta: almacen.bloqueoVigente(yo, cuenta.usuario),
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

function urlDeConfianza(valor) {
  try {
    const u = new URL(String(valor));
    return u.protocol === 'https:' && ORIGENES.test(u.hostname) ? u.href : null;
  } catch (err) {
    return null;
  }
}

// Lo que Spotify deja insertar. Se guarda sólo el tipo y el identificador, no
// una dirección: el reproductor se arma siempre contra open.spotify.com, así
// que no hay forma de colar otra página adentro del pío.
const SPOTIFY_RECURSOS = new Set(['track', 'album', 'playlist', 'episode', 'show', 'artist']);

function limpiarAdjunto(crudo) {
  if (!crudo) return null;
  if (crudo.tipo === 'spotify') {
    const recurso = String(crudo.recurso || '');
    const id = String(crudo.id || '');
    if (!SPOTIFY_RECURSOS.has(recurso) || !/^[A-Za-z0-9]{22}$/.test(id)) {
      throw new ErrorPio(400, 'Ese enlace de Spotify no se entiende.', 'spotify.malo');
    }
    return { tipo: 'spotify', recurso, id };
  }
  const mirar = urlDeConfianza;
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

// Quién sale en la foto y dónde. Las coordenadas van de 0 a 1 sobre la imagen
// entera, así la etiqueta cae en el mismo lugar se vea la foto del tamaño que
// se vea. Diez como mucho: una foto con más etiquetas que caras no es una foto.
const ETIQUETAS_POR_FOTO = 10;

function adjuntoConEtiquetas(almacen, crudo) {
  const limpio = limpiarAdjunto(crudo);
  if (!limpio || limpio.tipo === 'spotify') return limpio;
  const vistos = new Set();
  const etiquetas = [];
  for (const e of (Array.isArray(crudo.etiquetas) ? crudo.etiquetas : []).slice(0, 50)) {
    if (etiquetas.length >= ETIQUETAS_POR_FOTO) break;
    const cuenta = e && almacen.buscarUsuario(e.usuario);
    const x = Number(e && e.x);
    const y = Number(e && e.y);
    // Una cuenta que no existe no se etiqueta: sería un nombre flotando sobre
    // la foto que no lleva a ningún lado.
    if (!cuenta || vistos.has(cuenta.usuario) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    vistos.add(cuenta.usuario);
    const entre01 = (n) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
    etiquetas.push({ usuario: cuenta.usuario, x: entre01(x), y: entre01(y) });
  }
  if (etiquetas.length) limpio.etiquetas = etiquetas;
  return limpio;
}

// Las etiquetas se guardan con el nombre de ese momento y se muestran con el
// de ahora: buscarUsuario también encuentra por los nombres viejos. Una cuenta
// borrada simplemente deja de aparecer.
function adjuntoPublico(almacen, adjunto) {
  if (!adjunto) return null;
  if (!Array.isArray(adjunto.etiquetas)) return adjunto;
  const etiquetas = adjunto.etiquetas
    .map((e) => {
      const cuenta = almacen.buscarUsuario(e.usuario);
      return cuenta ? { usuario: cuenta.usuario, nombre: cuenta.nombre, x: e.x, y: e.y } : null;
    })
    .filter(Boolean);
  return Object.assign({}, adjunto, { etiquetas });
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
