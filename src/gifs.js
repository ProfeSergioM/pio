'use strict';

// Buscador de GIF sobre Giphy. La clave se queda de este lado, igual que con
// las imagenes: el cliente le pregunta a /api/gifs y nosotros a Giphy. Si el
// navegador llamara directo, la clave quedaria a la vista.

const BASE = 'https://api.giphy.com/v1/gifs';
const POR_PAGINA = 24;

// Por defecto solo "g", que es el material apto para todo publico. Subirlo es
// una decision del dueno del sitio, no algo que deba pasar por descuido.
const CLASIFICACION = 'g';

class ErrorGif extends Error {
  constructor(mensaje, clave) {
    super(mensaje);
    this.clave = clave;
  }
}

// Las URLs terminan en un <img src>: solo https y solo dominios de Giphy.
function urlDeGiphy(crudo) {
  try {
    const u = new URL(String(crudo));
    if (u.protocol !== 'https:') return null;
    return /(^|\.)giphy\.com$/.test(u.hostname) ? u.href : null;
  } catch (err) {
    return null;
  }
}

// De todo lo que manda Giphy por cada GIF, el cliente solo necesita esto.
function limpiar(bruto) {
  const imagenes = bruto && bruto.images;
  if (!imagenes) return null;
  const grande = imagenes.fixed_height || imagenes.original;
  const chica = imagenes.fixed_height_small || imagenes.preview_gif || grande;
  const url = urlDeGiphy(grande && grande.url);
  if (!url) return null;
  return {
    id: String(bruto.id || ''),
    titulo: String(bruto.title || '').trim(),
    url,
    miniatura: urlDeGiphy(chica && chica.url) || url,
    ancho: Number(grande.width) || null,
    alto: Number(grande.height) || null,
  };
}

function crearGifs(ajustes = {}, opciones = {}) {
  const clave = ajustes.giphyClave || null;
  const base = opciones.destino || BASE;
  const traer = opciones.traer || ((u) => fetch(u));
  const clasificacion = ajustes.giphyClasificacion || CLASIFICACION;

  async function pedir(camino, parametros) {
    if (!clave) throw new ErrorGif('Este Pío no tiene configurada la búsqueda de GIF.', 'gif.apagado');
    const consulta = new URLSearchParams(Object.assign({
      api_key: clave,
      rating: clasificacion,
    }, parametros));
    const respuesta = await traer(`${base}/${camino}?${consulta.toString()}`);
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !Array.isArray(cuerpo.data)) {
      throw new ErrorGif('El buscador de GIF no respondió bien.', 'gif.rechazado');
    }
    return cuerpo.data.map(limpiar).filter(Boolean);
  }

  return {
    get activo() { return !!clave; },

    // Sin texto se devuelven las tendencias: asi el buscador no arranca vacio.
    buscar(consulta, opcionesBusqueda = {}) {
      const texto = String(consulta == null ? '' : consulta).trim();
      const limite = Math.min(Math.max(Number(opcionesBusqueda.limite) || POR_PAGINA, 1), 50);
      if (!texto) return pedir('trending', { limit: limite });
      return pedir('search', { q: texto, limit: limite, lang: opcionesBusqueda.idioma || 'es' });
    },
  };
}

module.exports = { crearGifs, ErrorGif, urlDeGiphy, limpiar };
