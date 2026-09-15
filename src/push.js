'use strict';

const crypto = require('crypto');
const D = require('./descanso');

// Notificaciones en el teléfono, con el estándar de la web (Web Push) y sin
// dependencias.
//
// Cada navegador que acepta notificaciones entrega tres cosas: una dirección
// de su servicio de avisos (la de Google, la de Mozilla, la de Apple) y dos
// claves. Para mandarle algo hay que hacer dos cosas que el estándar exige:
//
//   1. Firmar el pedido con nuestras claves VAPID (RFC 8292), para que el
//      servicio sepa que es Pío quien manda.
//   2. Cifrar el contenido con las claves de ese navegador (RFC 8291), para
//      que el servicio lo lleve sin poder leerlo.
//
// Todo con el crypto que ya trae Node: curva P-256, HKDF y AES-GCM.

// A dónde se acepta mandar. La dirección la da el navegador, o sea que llega
// del cliente: sin esta lista, cualquiera podría hacer que el servidor le
// pegue a la dirección que quiera.
const SERVICIOS = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/;

// Suscripciones por cuenta: un teléfono, una computadora, el navegador del
// trabajo. Más que esto es basura que quedó de navegadores que ya no existen.
const SUSCRIPCIONES_POR_CUENTA = 5;

const b64 = (buffer) => Buffer.from(buffer).toString('base64url');
const desdeB64 = (texto) => Buffer.from(String(texto || ''), 'base64url');

// --- claves VAPID -----------------------------------------------------------------

// La pública, como la piden los navegadores: el punto sin comprimir, 65 bytes.
// La privada, como el número de 32 bytes. Es el mismo formato que usan las
// herramientas de siempre, así se pueden traer claves de otro lado.
function generarClaves() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publica = Buffer.concat([Buffer.from([4]), desdeB64(jwk.x), desdeB64(jwk.y)]);
  return { publica: b64(publica), privada: jwk.d };
}

function clavePrivada({ publica, privada }) {
  const punto = desdeB64(publica);
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: b64(punto.subarray(1, 33)), y: b64(punto.subarray(33, 65)), d: privada },
    format: 'jwk',
  });
}

function clavesValidas(claves) {
  try {
    if (!claves || desdeB64(claves.publica).length !== 65 || desdeB64(claves.privada).length !== 32) return false;
    clavePrivada(claves);
    return true;
  } catch (err) {
    return false;
  }
}

// El token que va en la cabecera: un JWT firmado con ES256 que dice para qué
// servicio es, hasta cuándo vale y a quién escribir si algo anda mal.
function tokenVapid(claves, endpoint, contacto, ahora = Date.now()) {
  const cabecera = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const cuerpo = b64(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(ahora / 1000) + 12 * 60 * 60,
    sub: contacto,
  }));
  const firma = crypto.sign('sha256', Buffer.from(`${cabecera}.${cuerpo}`), {
    key: clavePrivada(claves), dsaEncoding: 'ieee-p1363',
  });
  return `${cabecera}.${cuerpo}.${b64(firma)}`;
}

// --- cifrado (RFC 8291, aes128gcm) ------------------------------------------------

function cifrar(texto, p256dh, auth, { efimera, sal } = {}) {
  const publicaDelNavegador = desdeB64(p256dh);
  const secretoDelNavegador = desdeB64(auth);

  // Un par de claves de un solo uso por mensaje: el navegador sólo puede
  // descifrar combinándolo con la suya.
  const ecdh = crypto.createECDH('prime256v1');
  if (efimera) ecdh.setPrivateKey(efimera);
  else ecdh.generateKeys();
  const publicaNuestra = ecdh.getPublicKey();
  const compartido = ecdh.computeSecret(publicaDelNavegador);

  const infoClave = Buffer.concat([Buffer.from('WebPush: info\0'), publicaDelNavegador, publicaNuestra]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', compartido, secretoDelNavegador, infoClave, 32));

  const salt = sal || crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  // Un solo bloque, marcado como el último con el byte 2.
  const cifrador = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const cifrado = Buffer.concat([cifrador.update(Buffer.concat([Buffer.from(texto), Buffer.from([2])])), cifrador.final(), cifrador.getAuthTag()]);

  const tamanoBloque = Buffer.alloc(4);
  tamanoBloque.writeUInt32BE(4096);
  return Buffer.concat([salt, tamanoBloque, Buffer.from([publicaNuestra.length]), publicaNuestra, cifrado]);
}

// --- suscripciones --------------------------------------------------------------

// Lo que manda el navegador, revisado. Devuelve null si algo no cierra.
function limpiarSuscripcion(crudo) {
  if (!crudo || typeof crudo !== 'object') return null;
  let url;
  try {
    url = new URL(String(crudo.endpoint || ''));
  } catch (err) {
    return null;
  }
  if (url.protocol !== 'https:' || !SERVICIOS.test(url.hostname)) return null;
  const claves = crudo.keys || {};
  const p256dh = desdeB64(claves.p256dh);
  const auth = desdeB64(claves.auth);
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
  return {
    endpoint: url.href,
    p256dh: b64(p256dh),
    auth: b64(auth),
    idioma: crudo.idioma === 'en' ? 'en' : 'es',
    creada: Date.now(),
  };
}

// --- qué dice cada aviso --------------------------------------------------------

const TEXTOS = {
  es: {
    mencion: (u) => `@${u} te mencionó`,
    respuesta: (u) => `@${u} te respondió`,
    repio: (u) => `@${u} repió tu pío`,
    megusta: (u) => `A @${u} le gustó tu pío`,
    seguir: (u) => `@${u} te empezó a seguir`,
    foto: (u) => `@${u} te etiquetó en una foto`,
    otro: (u) => `@${u} anduvo por aquí`,
    buzon: (u) => (u ? `📮 @${u} te dejó una pregunta` : '📮 Te dejaron una pregunta anónima'),
    buzonRespuesta: (u) => `📮 @${u} respondió tu pregunta`,
    cadena: (u) => `⛓️ @${u} sumó un eslabón a la cadena`,
  },
  en: {
    mencion: (u) => `@${u} mentioned you`,
    respuesta: (u) => `@${u} replied to you`,
    repio: (u) => `@${u} repió your pío`,
    megusta: (u) => `@${u} liked your pío`,
    seguir: (u) => `@${u} started following you`,
    foto: (u) => `@${u} tagged you in a photo`,
    otro: (u) => `@${u} was around`,
    buzon: (u) => (u ? `📮 @${u} left you a question` : '📮 You got an anonymous question'),
    buzonRespuesta: (u) => `📮 @${u} answered your question`,
    cadena: (u) => `⛓️ @${u} added a link to the chain`,
  },
};

function cargaDelAviso(aviso, de, pio, idioma, pregunta = null) {
  const textos = TEXTOS[idioma] || TEXTOS.es;
  const titulo = (textos[aviso.tipo] || textos.otro)(de ? de.usuario : aviso.de);
  return {
    titulo,
    cuerpo: pregunta ? pregunta.texto : (pio && pio.texto ? pio.texto : ''),
    url: pregunta ? '/#/buzon'
      : (pio && pio.eslabonDe ? `/#/cadena/${pio.eslabonDe}`
        : (pio ? `/#/p/${pio.id}` : `/#/u/${de ? de.usuario : aviso.de}`)),
    // Los me gusta y repíos de un mismo pío se reemplazan entre sí: diez
    // corazones no son diez notificaciones.
    tag: pio && (aviso.tipo === 'megusta' || aviso.tipo === 'repio') ? `${aviso.tipo}-${pio.id}` : `aviso-${aviso.id}`,
  };
}

// --- el que manda -----------------------------------------------------------------

function crearPush(almacen, opciones = {}) {
  const contacto = opciones.vapidContacto || 'mailto:pio@example.com';
  const demora = opciones.demoraPush == null ? 400 : Number(opciones.demoraPush);
  // Se puede cambiar por otro en las pruebas: nadie quiere que una prueba le
  // escriba a Google.
  const pedir = opciones.pedirPush || ((url, init) => fetch(url, Object.assign({ signal: AbortSignal.timeout(10000) }, init)));
  // El reloj del horario de silencio. Las pruebas lo fijan: si no, pasarían de
  // día y fallarían de noche.
  const ahora = opciones.relojPush || Date.now;

  // Primero las del despliegue; si no hay, las guardadas; si tampoco, se
  // arman unas y se guardan, así funciona sin configurar nada.
  let claves = null;
  async function lasClaves() {
    if (claves) return claves;
    const delDespliegue = { publica: opciones.vapidPublica, privada: opciones.vapidPrivada };
    if (clavesValidas(delDespliegue)) {
      claves = delDespliegue;
    } else if (clavesValidas(almacen.datos.vapid)) {
      claves = almacen.datos.vapid;
    } else {
      claves = generarClaves();
      await almacen.guardarVapid(claves);
    }
    return claves;
  }

  async function mandar(suscripcion, carga) {
    const par = await lasClaves();
    const cuerpo = cifrar(JSON.stringify(carga), suscripcion.p256dh, suscripcion.auth);
    const respuesta = await pedir(suscripcion.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${tokenVapid(par, suscripcion.endpoint, contacto)}, k=${par.publica}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body: cuerpo,
    });
    return respuesta.status;
  }

  async function entregar(idAviso) {
    const aviso = almacen.datos.notificaciones.find((n) => n.id === idAviso);
    // Si ya no está, se deshizo: el pío se borró antes de nacer, o se sacó el
    // me gusta. No se avisa lo que ya no pasó.
    if (!aviso || aviso.leida) return;
    const cuenta = almacen.buscarUsuario(aviso.para);
    const suscripciones = (cuenta && cuenta.suscripciones) || [];
    if (!suscripciones.length) return;

    const pio = aviso.pio ? almacen.buscarPio(aviso.pio) : null;
    if (pio && almacen.esHuevo(pio)) { programarEntrega(aviso, pio.nace - Date.now()); return; }
    if (aviso.pio && (!pio || almacen.explotado(pio))) return;
    // Una pregunta del buzón que ya se borró o se respondió no suena.
    const pregunta = aviso.pregunta
      ? ((cuenta.buzon && cuenta.buzon.preguntas) || []).find((p) => p.id === aviso.pregunta)
      : null;
    if (aviso.pregunta && !pregunta) return;
    if (almacen.bloqueoVigente(cuenta, aviso.de)) return;
    // La granja duerme: de noche el aviso queda en la campana y el teléfono no
    // suena. No se guarda para la mañana: a las siete nadie quiere diez avisos
    // de golpe, y la campana ya los tiene.
    if (D.durmiendo(D.deCuenta(cuenta), almacen.zonaDelSitio, ahora())) return;
    if ((cuenta.silenciados || []).includes(aviso.de) || (almacen.datos.ocultos || []).includes(aviso.de)) return;

    const de = almacen.buscarUsuario(aviso.de);
    const vencidas = [];
    await Promise.all(suscripciones.map(async (s) => {
      try {
        const estado = await mandar(s, cargaDelAviso(aviso, de, pio, s.idioma, pregunta));
        // 404 y 410: el navegador se dio de baja. Seguir mandándole es gastar.
        if (estado === 404 || estado === 410) vencidas.push(s.endpoint);
      } catch (err) {
        /* un servicio caído no frena a los demás; el aviso igual está en la campana */
      }
    }));
    if (vencidas.length) await almacen.quitarSuscripciones(vencidas).catch(() => {});
  }

  function programarEntrega(aviso, espera) {
    const reloj = setTimeout(() => { entregar(aviso.id).catch(() => {}); }, Math.max(0, espera) + demora);
    if (reloj.unref) reloj.unref();
  }

  return {
    clavePublica: async () => (await lasClaves()).publica,
    // Se llama cada vez que se anota un aviso. Si el pío todavía es huevo,
    // espera a que nazca.
    programar(aviso) {
      const pio = aviso.pio ? almacen.buscarPio(aviso.pio) : null;
      programarEntrega(aviso, pio && pio.nace ? pio.nace - Date.now() : 0);
    },
    entregar,
  };
}

module.exports = {
  crearPush, cifrar, tokenVapid, generarClaves, clavesValidas, limpiarSuscripcion, cargaDelAviso,
  SUSCRIPCIONES_POR_CUENTA, SERVICIOS,
};
