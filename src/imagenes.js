'use strict';

const crypto = require('crypto');

// Subida de imagenes. El destino es intercambiable: hoy ImgBB o Cloudinary,
// manana el que haga falta, cambiando una linea de configuracion.
//
// Lo que NO es intercambiable es de que lado vive la clave. El navegador manda
// la imagen a nuestro servidor y el servidor habla con el proveedor. Si el
// cliente llamara directo, la clave estaria a la vista de cualquiera que abra
// el inspector.
//
// La validacion (tamano, firma real del archivo) pasa una sola vez, antes de
// elegir destino: no se le confia al proveedor lo que podemos comprobar aca.

const TOPE_POR_DEFECTO = 5 * 1024 * 1024;

// Se mira la firma real del archivo, no el tipo que dice el cliente. Un
// "data:image/png" delante de un ejecutable sigue siendo un ejecutable.
const FIRMAS = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],
];

class ErrorImagen extends Error {
  constructor(mensaje, clave) {
    super(mensaje);
    this.clave = clave;
  }
}

function tipoReal(bytes) {
  if (bytes.length >= 12
    && bytes.slice(0, 4).toString('ascii') === 'RIFF'
    && bytes.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  for (const [tipo, firma] of FIRMAS) {
    if (bytes.length >= firma.length && firma.every((b, i) => bytes[i] === b)) return tipo;
  }
  return null;
}

// Lo que devuelve el proveedor termina en un <img src>, asi que no se acepta
// cualquier cosa: solo https y solo los dominios de ese proveedor. Si algun dia
// la respuesta viene manipulada, no se convierte en una URL ejecutable dentro
// de la pagina.
function saneador(dominios) {
  return function urlSegura(crudo) {
    try {
      const u = new URL(String(crudo));
      if (u.protocol !== 'https:') return null;
      return dominios.test(u.hostname) ? u.href : null;
    } catch (err) {
      return null;
    }
  };
}

const urlDeImgbb = saneador(/(^|\.)ibb\.co$|(^|\.)imgbb\.com$/);
const urlDeCloudinary = saneador(/(^|\.)cloudinary\.com$/);

// --- ImgBB ----------------------------------------------------------------

function subidorImgbb(ajustes, enviar) {
  const destino = ajustes.destino || 'https://api.imgbb.com/1/upload';
  return {
    nombre: 'imgbb',
    async subir(bytes, tipo) {
      const respuesta = await enviar(`${destino}?key=${encodeURIComponent(ajustes.clave)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ image: bytes.toString('base64') }).toString(),
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok || !cuerpo.success || !cuerpo.data) {
        throw new ErrorImagen(mensajeDe(cuerpo), 'imagen.rechazada');
      }
      const url = urlDeImgbb(cuerpo.data.url);
      if (!url) throw new ErrorImagen('El servicio devolvió una dirección que no es de fiar.', 'imagen.rara');
      return {
        url,
        miniatura: urlDeImgbb(cuerpo.data.thumb && cuerpo.data.thumb.url) || url,
        ancho: Number(cuerpo.data.width) || null,
        alto: Number(cuerpo.data.height) || null,
        tipo,
      };
    },
  };
}

// --- Cloudinary -----------------------------------------------------------

// Subida firmada: el secreto no sale del servidor y la firma es un SHA-1 de
// los parametros ordenados. Node ya trae todo lo necesario.
function firmar(parametros, secreto) {
  const cadena = Object.keys(parametros).sort()
    .map((k) => `${k}=${parametros[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(cadena + secreto).digest('hex');
}

function subidorCloudinary(ajustes, enviar, ahora) {
  const base = ajustes.destino || 'https://api.cloudinary.com/v1_1';
  return {
    nombre: 'cloudinary',
    async subir(bytes, tipo) {
      const marca = Math.floor((ahora ? ahora() : Date.now()) / 1000);
      const aFirmar = { timestamp: marca };
      if (ajustes.carpeta) aFirmar.folder = ajustes.carpeta;

      const forma = new URLSearchParams(Object.assign({}, aFirmar, {
        file: `data:${tipo};base64,${bytes.toString('base64')}`,
        api_key: ajustes.clave,
        signature: firmar(aFirmar, ajustes.secreto),
      }));

      const respuesta = await enviar(`${base}/${encodeURIComponent(ajustes.nube)}/image/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: forma.toString(),
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok || !cuerpo.secure_url) {
        throw new ErrorImagen(mensajeDe(cuerpo), 'imagen.rechazada');
      }
      const url = urlDeCloudinary(cuerpo.secure_url);
      if (!url) throw new ErrorImagen('El servicio devolvió una dirección que no es de fiar.', 'imagen.rara');
      // Cloudinary arma la miniatura cambiando la URL, sin pedir nada mas.
      return {
        url,
        miniatura: url.replace('/image/upload/', '/image/upload/c_fill,w_320,h_320,q_auto/'),
        ancho: Number(cuerpo.width) || null,
        alto: Number(cuerpo.height) || null,
        tipo,
      };
    },
  };
}

function mensajeDe(cuerpo) {
  const dicho = (cuerpo && cuerpo.error && (cuerpo.error.message || cuerpo.error))
    || (cuerpo && cuerpo.status_txt);
  return dicho ? `El servicio de imágenes la rechazó: ${dicho}` : 'El servicio de imágenes no la aceptó.';
}

// --- lo que ve el resto del programa --------------------------------------

function crearSubidor(ajustes = {}, opciones = {}) {
  const enviar = opciones.enviar || ((u, o) => fetch(u, o));
  const tope = opciones.tope || TOPE_POR_DEFECTO;

  const nube = ajustes.cloudinary;
  const hayCloudinary = !!(nube && nube.nube && nube.clave && nube.secreto);
  const hayImgbb = !!ajustes.imgbbClave;

  // Si estan los dos, manda lo que diga la configuracion; si no dice nada,
  // Cloudinary, que da miniaturas sin trabajo extra.
  let elegido = null;
  const pedido = ajustes.proveedor;
  if (pedido === 'imgbb' && hayImgbb) elegido = 'imgbb';
  else if (pedido === 'cloudinary' && hayCloudinary) elegido = 'cloudinary';
  else if (hayCloudinary) elegido = 'cloudinary';
  else if (hayImgbb) elegido = 'imgbb';

  const destino = elegido === 'cloudinary'
    ? subidorCloudinary(Object.assign({}, nube, { destino: opciones.destinoCloudinary }), enviar, opciones.ahora)
    : (elegido === 'imgbb'
      ? subidorImgbb({ clave: ajustes.imgbbClave, destino: opciones.destinoImgbb }, enviar)
      : null);

  return {
    get activo() { return !!destino; },
    get nombre() { return destino ? destino.nombre : null; },

    async subir(crudo) {
      if (!destino) {
        throw new ErrorImagen('Este Pío no tiene configurada la subida de imágenes.', 'imagen.apagada');
      }

      const base64 = String(crudo == null ? '' : crudo).replace(/^data:[^;,]*;base64,/, '').trim();
      if (!base64) throw new ErrorImagen('No llegó ninguna imagen.', 'imagen.vacia');

      const bytes = Buffer.from(base64, 'base64');
      if (!bytes.length) throw new ErrorImagen('Esa imagen no se puede leer.', 'imagen.ilegible');
      if (bytes.length > tope) throw new ErrorImagen('Esa imagen pesa demasiado.', 'imagen.pesada');

      const tipo = tipoReal(bytes);
      if (!tipo) throw new ErrorImagen('Eso no es una imagen.', 'imagen.tipo');

      const subida = await destino.subir(bytes, tipo);
      return Object.assign({ bytes: bytes.length, proveedor: destino.nombre }, subida);
    },
  };
}

module.exports = {
  crearSubidor,
  ErrorImagen,
  tipoReal,
  firmar,
  urlDeImgbb,
  urlDeCloudinary,
};
