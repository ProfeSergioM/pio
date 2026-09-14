'use strict';

// Acortador de direcciones sobre is.gd, que no pide clave ninguna.
//
// Va del lado del servidor como todo lo demas, y aca por una razon extra:
// is.gd no manda cabeceras de CORS, asi que desde el navegador no se le puede
// hablar directo aunque uno quisiera.

const DESTINO = 'https://is.gd/create.php';

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
// solo https y solo is.gd.
function urlDeIsgd(crudo) {
  try {
    const u = new URL(String(crudo));
    return u.protocol === 'https:' && /(^|\.)is\.gd$/.test(u.hostname) ? u.href : null;
  } catch (err) {
    return null;
  }
}

function crearAcortador(ajustes = {}, opciones = {}) {
  const destino = opciones.destino || DESTINO;
  const traer = opciones.traer || ((u) => fetch(u));

  return {
    // No necesita credenciales, asi que solo se apaga si alguien lo pide.
    get activo() {
      return ajustes.acortador !== 'no';
    },

    async acortar(crudo) {
      const url = urlAcortable(crudo);
      if (!url) throw new ErrorEnlace('Eso no es una dirección que se pueda acortar.', 'enlace.malo');

      const respuesta = await traer(`${destino}?format=json&url=${encodeURIComponent(url)}`);
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok || cuerpo.errormessage || !cuerpo.shorturl) {
        throw new ErrorEnlace(
          cuerpo.errormessage ? String(cuerpo.errormessage) : 'El acortador no respondió bien.',
          'enlace.rechazado',
        );
      }

      const corta = urlDeIsgd(cuerpo.shorturl);
      if (!corta) throw new ErrorEnlace('El acortador devolvió una dirección que no es de fiar.', 'enlace.raro');
      return { larga: url, corta };
    },
  };
}

module.exports = { crearAcortador, ErrorEnlace, urlAcortable, urlDeIsgd };
