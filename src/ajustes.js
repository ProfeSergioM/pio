'use strict';

const fs = require('fs');
const path = require('path');

// Los secretos viven en datos/config.json, que ya esta fuera del control de
// versiones porque datos/ entero lo esta. Las variables de entorno le ganan al
// archivo, asi el despliegue no depende de subir un archivo con claves.
//
// Nada de esto es obligatorio: sin ninguna clave, Pio arranca igual y las
// funciones que la necesitan quedan apagadas y avisan.
function leerAjustes(directorio) {
  let guardado = {};
  try {
    guardado = JSON.parse(fs.readFileSync(path.join(directorio, 'config.json'), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const elegir = (variable, clave) => process.env[variable] || guardado[clave] || null;
  const numero = (variable, clave) => {
    const crudo = process.env[variable] || guardado[clave];
    const n = Number(crudo);
    return crudo && Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const nube = guardado.cloudinary || {};

  // Cloudinary muestra los tres datos juntos como
  // cloudinary://API_KEY:API_SECRET@CLOUD_NAME. Aceptarlo tal cual evita tres
  // copiados a mano, que es donde se cuelan los errores de dedo.
  const deLaUrlUnica = partirUrlCloudinary(process.env.CLOUDINARY_URL || nube.url || guardado.cloudinaryUrl);
  const deNube = (variable, clave) => process.env[variable]
    || nube[clave]
    || guardado['cloudinary' + clave[0].toUpperCase() + clave.slice(1)]
    || deLaUrlUnica[clave]
    || null;

  return {
    googleClienteId: elegir('PIO_GOOGLE_CLIENT_ID', 'googleClienteId'),
    imgbbClave: elegir('PIO_IMGBB_KEY', 'imgbbClave'),
    giphyClave: elegir('PIO_GIPHY_KEY', 'giphyClave'),
    // Cuál gana cuando hay más de uno configurado: 'imgbb' o 'cloudinary'.
    proveedor: elegir('PIO_IMAGENES_PROVEEDOR', 'proveedor'),
    cloudinary: {
      nube: deNube('PIO_CLOUDINARY_NUBE', 'nube'),
      clave: deNube('PIO_CLOUDINARY_CLAVE', 'clave'),
      secreto: deNube('PIO_CLOUDINARY_SECRETO', 'secreto'),
      carpeta: deNube('PIO_CLOUDINARY_CARPETA', 'carpeta'),
    },
    // Para trabajar sin ensuciar la base real: PIO_DEPOSITO=archivo
    deposito: elegir('PIO_DEPOSITO', 'deposito'),
    supabase: {
      url: elegir('SUPABASE_URL', 'supabaseUrl') || (guardado.supabase || {}).url || null,
      // La service_role, no la anon: nuestro servidor ya hace la autorización
      // y esta clave nunca sale de acá.
      clave: elegir('SUPABASE_SERVICE_KEY', 'supabaseClave') || (guardado.supabase || {}).clave || null,
    },
    // Cuántos proxies de confianza hay delante. En Render, Fly o cualquier
    // plataforma con balanceador, es 1. En tu máquina, 0.
    proxies: numero('PIO_PROXIES', 'proxies') || 0,
    // Cabecera de confianza con la IP del visitante, si la plataforma pone
    // una. En Render: cf-connecting-ip.
    ipCabecera: elegir('PIO_IP_CABECERA', 'ipCabecera'),
    // 'no' apaga el acortador; cualquier otra cosa lo deja encendido, porque
    // is.gd no pide credenciales.
    acortador: elegir('PIO_ACORTADOR', 'acortador'),
    altas: numero('PIO_ALTAS_POR_HORA', 'altas'),
    subidas: numero('PIO_SUBIDAS_POR_HORA', 'subidas'),
  };
}

// Devuelve {} si no hay nada que partir: asi el que llama no tiene que
// preguntar antes de leerle las propiedades.
function partirUrlCloudinary(crudo) {
  if (!crudo) return {};
  try {
    const u = new URL(String(crudo).trim());
    if (u.protocol !== 'cloudinary:') return {};
    return {
      nube: decodeURIComponent(u.hostname) || null,
      clave: decodeURIComponent(u.username) || null,
      secreto: decodeURIComponent(u.password) || null,
    };
  } catch (err) {
    return {};
  }
}

module.exports = { leerAjustes, partirUrlCloudinary };
