'use strict';

const crypto = require('crypto');

// Verificacion del ID token que devuelve el boton de Google, a mano y sin
// dependencias: Node ya trae todo lo necesario. El token es un JWT firmado
// con RS256; hay que comprobar la firma contra las claves publicas de Google
// y despues que las declaraciones de adentro hablen de nosotros.
const EMISORES = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLAVES_DE_GOOGLE = 'https://www.googleapis.com/oauth2/v3/certs';
const CACHE_MINIMO = 5 * 60 * 1000;

class ErrorGoogle extends Error {}

function deBase64url(texto) {
  return Buffer.from(String(texto).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

class Google {
  constructor(clienteId, opciones = {}) {
    this.clienteId = clienteId || null;
    this.origenClaves = opciones.claves || CLAVES_DE_GOOGLE;
    // Inyectable para poder probar la verificacion sin salir a internet.
    this.traer = opciones.traer || ((u) => fetch(u));
    this.cache = null;
  }

  get activo() {
    return !!this.clienteId;
  }

  async claves() {
    if (this.cache && this.cache.vence > Date.now()) return this.cache.claves;
    const respuesta = await this.traer(this.origenClaves);
    if (!respuesta.ok) throw new ErrorGoogle('No se pudieron leer las claves de Google.');
    const cuerpo = await respuesta.json();
    const claves = cuerpo.keys || [];
    // Google dice cuanto dura el juego de claves; se le hace caso, con piso.
    const control = (respuesta.headers && respuesta.headers.get('cache-control')) || '';
    const encontrado = /max-age=(\d+)/.exec(control);
    const dura = Math.max(encontrado ? Number(encontrado[1]) * 1000 : 0, CACHE_MINIMO);
    this.cache = { claves, vence: Date.now() + dura };
    return claves;
  }

  // Devuelve {sub, email, nombre} si el token es de Google y es para nosotros.
  // Cualquier otra cosa es un ErrorGoogle: nada se da por bueno por defecto.
  async verificar(credencial, ahora = Date.now()) {
    if (!this.activo) throw new ErrorGoogle('El acceso con Google no está configurado.');

    const partes = String(credencial || '').split('.');
    if (partes.length !== 3) throw new ErrorGoogle('Eso no tiene forma de token de Google.');
    const [cabecera64, cuerpo64, firma64] = partes;

    let cabecera;
    let cuerpo;
    try {
      cabecera = JSON.parse(deBase64url(cabecera64).toString('utf8'));
      cuerpo = JSON.parse(deBase64url(cuerpo64).toString('utf8'));
    } catch (err) {
      throw new ErrorGoogle('Ese token de Google no se puede leer.');
    }

    // El algoritmo lo fija el servidor, no el token: aceptar el que venga
    // adentro es como preguntarle al sobre si hay que revisar el sello.
    if (cabecera.alg !== 'RS256') throw new ErrorGoogle('Google firma con RS256 y eso no.');

    const jwk = (await this.claves()).find((k) => k.kid === cabecera.kid);
    if (!jwk) throw new ErrorGoogle('Google no reconoce la clave de ese token.');

    const llave = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const firmado = Buffer.from(`${cabecera64}.${cuerpo64}`, 'utf8');
    if (!crypto.verify('RSA-SHA256', firmado, llave, deBase64url(firma64))) {
      throw new ErrorGoogle('La firma de ese token no cierra.');
    }

    if (!EMISORES.has(cuerpo.iss)) throw new ErrorGoogle('Ese token no lo emitió Google.');
    if (cuerpo.aud !== this.clienteId) throw new ErrorGoogle('Ese token es para otra aplicación.');
    if (!(Number(cuerpo.exp) * 1000 > ahora)) throw new ErrorGoogle('Ese token de Google ya venció.');
    if (!cuerpo.sub) throw new ErrorGoogle('Ese token no dice de quién es.');
    if (cuerpo.email_verified === false) throw new ErrorGoogle('Google no verificó ese correo.');

    return {
      sub: String(cuerpo.sub),
      email: String(cuerpo.email || ''),
      nombre: String(cuerpo.name || ''),
    };
  }
}

module.exports = { Google, ErrorGoogle };
