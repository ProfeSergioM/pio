'use strict';

// Acortador de direcciones. Ninguno de los dos proveedores pide credenciales.
//
// Son dos a propósito: el dia que se escribio esto, is.gd estaba devolviendo
// "Error, database insert failed" con codigo 200 y tipo text/html, o sea ni
// siquiera el JSON de error que promete su documentacion. Un acortador que
// depende de un solo servicio gratuito se cae con el.
//
// Va del lado del servidor como todo lo demas, y aca por una razon extra:
// ninguno de los dos manda cabeceras de CORS, asi que desde el navegador no se
// les puede hablar directo aunque uno quisiera.

class ErrorEnlace extends Error {
  constructor(mensaje, clave) {
    super(mensaje);
    this.clave = clave;
  }
}

// Solo http y https. Un "javascript:" acortado seria una trampa con aspecto
// inofensivo, que es justamente para lo que sirve un acortador; y un dominio
// sin punto no es un dominio.
function urlAcortable(crudo) {
  try {
    const u = new URL(String(crudo == null ? '' : crudo).trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.href;
  } catch (err) {
    return null;
  }
}

// Lo que vuelve termina pegado en un pio y despues es un enlace en la pagina:
// solo https, y solo el dominio del proveedor al que se le pregunto.
function urlDelProveedor(crudo, dominio) {
  try {
    const u = new URL(String(crudo).trim());
    return u.protocol === 'https:' && dominio.test(u.hostname) ? u.href : null;
  } catch (err) {
    return null;
  }
}

const PROVEEDORES = [
  {
    nombre: 'is.gd',
    dominio: /(^|\.)is\.gd$/,
    donde: 'https://is.gd/create.php',
    pedido: (donde, larga) => `${donde}?format=json&url=${encodeURIComponent(larga)}`,
    // Promete JSON pero a veces manda texto suelto; se lee el crudo y se
    // intenta entender, en vez de confiar en el tipo de contenido.
    leer: (texto) => {
      try {
        const cuerpo = JSON.parse(texto);
        return cuerpo && cuerpo.shorturl ? String(cuerpo.shorturl) : null;
      } catch (err) {
        return null;
      }
    },
  },
  {
    nombre: 'tinyurl',
    dominio: /(^|\.)tinyurl\.com$/,
    donde: 'https://tinyurl.com/api-create.php',
    pedido: (donde, larga) => `${donde}?url=${encodeURIComponent(larga)}`,
    // Devuelve la direccion pelada, sin envoltorio.
    leer: (texto) => {
      const limpio = String(texto).trim();
      return /^https:\/\//.test(limpio) ? limpio : null;
    },
  },
];

function crearAcortador(ajustes = {}, opciones = {}) {
  const traer = opciones.traer || ((u) => fetch(u));

  // Se puede pedir uno en particular; si no, se prueban en orden.
  const cuales = ajustes.acortadorProveedor
    ? PROVEEDORES.filter((p) => p.nombre === ajustes.acortadorProveedor)
    : PROVEEDORES;

  return {
    get activo() {
      return ajustes.acortador !== 'no' && cuales.length > 0;
    },

    get proveedores() {
      return cuales.map((p) => p.nombre);
    },

    async acortar(crudo) {
      const larga = urlAcortable(crudo);
      if (!larga) throw new ErrorEnlace('Eso no es una dirección que se pueda acortar.', 'enlace.malo');

      let ultimo = null;
      for (const proveedor of cuales) {
        try {
          const donde = (opciones.donde && opciones.donde[proveedor.nombre]) || proveedor.donde;
          const respuesta = await traer(proveedor.pedido(donde, larga));
          const texto = await respuesta.text();
          const dicha = respuesta.ok ? proveedor.leer(texto) : null;
          const corta = dicha ? urlDelProveedor(dicha, proveedor.dominio) : null;
          if (corta) return { larga, corta, proveedor: proveedor.nombre };
          // Una respuesta con otro dominio no es un servicio caído: es un
          // servicio diciendo algo que no vamos a usar. Igual se sigue.
          ultimo = dicha
            ? new ErrorEnlace('El acortador devolvió una dirección que no es de fiar.', 'enlace.raro')
            : new ErrorEnlace('El acortador no la aceptó.', 'enlace.rechazado');
        } catch (err) {
          ultimo = new ErrorEnlace('No se pudo hablar con el acortador.', 'enlace.rechazado');
        }
      }
      throw ultimo || new ErrorEnlace('El acortador no la aceptó.', 'enlace.rechazado');
    },
  };
}

module.exports = { crearAcortador, ErrorEnlace, urlAcortable, urlDelProveedor, PROVEEDORES };
