'use strict';

const LIMITE = 100;
const $ = (sel) => document.querySelector(sel);

const estado = {
  token: localStorage.getItem('pio.token') || null,
  yo: null,
  respondiendoA: null,
};

// --- idiomas --------------------------------------------------------------

const IDIOMA_BASE = 'es';

function idiomaInicial() {
  const guardado = localStorage.getItem('pio.idioma');
  if (guardado && window.IDIOMAS[guardado]) return guardado;
  return String(navigator.language || '').toLowerCase().startsWith('en') ? 'en' : IDIOMA_BASE;
}

let idioma = idiomaInicial();

function diccionario() {
  return window.IDIOMAS[idioma] || window.IDIOMAS[IDIOMA_BASE];
}

// Busca en el idioma elegido, cae al español y en último caso devuelve la
// clave. Es fea, pero deja ver qué falta en vez de dibujar un hueco en blanco.
function T(clave, datos) {
  const propio = diccionario().textos[clave];
  const valor = propio !== undefined ? propio : window.IDIOMAS[IDIOMA_BASE].textos[clave];
  if (valor === undefined) return clave;
  return typeof valor === 'function' ? valor(datos || {}) : valor;
}

// Los errores del servidor viajan con clave y datos. Si no la reconocemos, se
// muestra el texto en español que ya vino armado: peor es no decir nada.
// Algunos mensajes de la tabla de errores hacen falta antes de que haya
// ningún error del servidor, como cuando validamos acá mismo.
function TErrorClave(clave) {
  const propio = diccionario().errores[clave];
  const valor = propio !== undefined ? propio : window.IDIOMAS[IDIOMA_BASE].errores[clave];
  if (valor === undefined) return clave;
  return typeof valor === 'function' ? valor({}) : valor;
}

function TError(fallo) {
  if (!fallo) return T('error.generico');
  const valor = fallo.clave ? diccionario().errores[fallo.clave] : undefined;
  if (valor === undefined) return fallo.error || T('error.generico');
  return typeof valor === 'function' ? valor(fallo.datos || {}) : valor;
}

function traducir() {
  document.documentElement.lang = idioma;
  document.title = T('titulo');
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = T(el.dataset.t);
  for (const el of document.querySelectorAll('[data-t-html]')) el.innerHTML = T(el.dataset.tHtml);
  for (const el of document.querySelectorAll('[data-t-ph]')) el.placeholder = T(el.dataset.tPh);
  for (const el of document.querySelectorAll('[data-t-titulo]')) el.title = T(el.dataset.tTitulo);
  for (const el of document.querySelectorAll('[data-t-aria]')) {
    el.setAttribute('aria-label', T(el.dataset.tAria));
  }
  pintarIdiomas();
}

function pintarIdiomas() {
  const caja = $('#idiomas-portada');
  if (!caja) return;
  caja.innerHTML = Object.keys(window.IDIOMAS).map((cual) => {
    const activa = cual === idioma ? ' activa' : '';
    return `<button type="button" class="idioma${activa}" data-idioma="${cual}"
      title="${escapar(window.IDIOMAS[cual].nombre)}">${escapar(window.IDIOMAS[cual].etiqueta)}</button>`;
  }).join('');
}

function cambiarIdioma(cual) {
  idioma = window.IDIOMAS[cual] ? cual : IDIOMA_BASE;
  localStorage.setItem('pio.idioma', idioma);
  traducir();
  if (estado.yo) pintar();
  else prepararGoogle();
}

function alternarIdioma() {
  const cuales = Object.keys(window.IDIOMAS);
  cambiarIdioma(cuales[(cuales.indexOf(idioma) + 1) % cuales.length]);
}

// --- llamadas a la API ----------------------------------------------------

async function api(ruta, opciones = {}) {
  const cabeceras = { 'Content-Type': 'application/json' };
  if (estado.token) cabeceras.Authorization = `Bearer ${estado.token}`;

  const respuesta = await fetch(`/api${ruta}`, {
    method: opciones.metodo || 'GET',
    headers: cabeceras,
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
  });

  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    // Sólo el 401 que dice "acá falta sesión" es una sesión vencida. Los otros
    // son respuestas legítimas a algo que se pidió mal —la clave actual
    // equivocada, un código que no coincide— y echar a alguien por eso es
    // castigarlo por escribir mal.
    if (respuesta.status === 401 && datos.clave === 'sesion.falta' && estado.yo) {
      cerrarSesion(true);
    }
    throw new Error(TError(datos));
  }
  return datos;
}

// --- utilidades -----------------------------------------------------------

const largo = (t) => [...String(t || '')].length;

function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Los emojis del sitio, tal como los manda el servidor. Se piden una vez al
// arrancar; hasta que lleguen, un :pollito: se ve como :pollito:, que es
// mucho mejor que no ver el texto.
let emojisDelSitio = new Map();

// Convierte el texto en HTML: enlaces, :emojis:, #etiquetas y @menciones.
//
// Se recorre el texto crudo buscando esas piezas y se escapa cada una por su
// lado. Hacerlo sobre el texto ya escapado, como antes, rompía dos cosas: una
// dirección con # o @ adentro se partía en etiquetas y menciones, y un
// apóstrofo escapado como &#39; se volvía la etiqueta #39.
const PIEZAS = /(https?:\/\/[^\s<>"]+|www\.[a-z0-9-]+\.[^\s<>"]+)|:([a-z0-9_]{2,20}):|#([\p{L}\p{N}_]{1,50})|@([a-zA-Z0-9_]{3,15})/giu;

// La puntuación pegada al final casi nunca es parte de la dirección: "mira
// pio.cl." termina en punto, no en "cl.".
const COLA_DE_ENLACE = /[.,;:!?)\]}'"»”]$/;

// Se saca de a un carácter. Un paréntesis de cierre se queda si abre adentro
// de la dirección: es.wikipedia.org/wiki/Pan_(comida) lo necesita.
function sinCola(url) {
  let pieza = url;
  while (COLA_DE_ENLACE.test(pieza)) {
    const abre = (pieza.match(/\(/g) || []).length;
    const cierra = (pieza.match(/\)/g) || []).length;
    if (pieza.endsWith(')') && cierra <= abre) break;
    pieza = pieza.slice(0, -1);
  }
  return pieza;
}

// Lo que se ve del enlace: sin https://, sin www y, si es muy largo, cortado.
// La dirección entera sigue estando en el enlace.
function enlaceVisible(url) {
  const limpio = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
  const letras = [...limpio];
  return letras.length > 40 ? `${letras.slice(0, 38).join('')}…` : limpio;
}

function enriquecer(texto) {
  const crudo = String(texto == null ? '' : texto);
  let salida = '';
  let desde = 0;
  for (const m of crudo.matchAll(PIEZAS)) {
    let pieza = m[0];
    if (m[1]) pieza = sinCola(pieza);
    salida += escapar(crudo.slice(desde, m.index));
    desde = m.index + pieza.length;

    if (m[1]) {
      const href = /^www\./i.test(pieza) ? `https://${pieza}` : pieza;
      salida += `<a class="enlace" href="${escapar(href)}" target="_blank" rel="noopener noreferrer nofollow ugc" title="${escapar(href)}">${escapar(enlaceVisible(pieza))}</a>`;
    } else if (m[2]) {
      const src = emojisDelSitio.get(m[2].toLowerCase());
      salida += src
        ? `<img class="emoji" src="${escapar(src)}" alt=":${escapar(m[2])}:" title=":${escapar(m[2])}:">`
        : escapar(pieza);
    } else if (m[3]) {
      salida += `<a href="#/e/${encodeURIComponent(m[3].toLowerCase())}">${escapar(pieza)}</a>`;
    } else {
      salida += `<a href="#/u/${escapar(m[4].toLowerCase())}">${escapar(pieza)}</a>`;
    }
  }
  return salida + escapar(crudo.slice(desde));
}

function hace(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(ms).toLocaleDateString(diccionario().fechas, { day: 'numeric', month: 'short' });
}

// La inicial está siempre, y la foto la tapa cuando llega. Así, mientras
// carga o si nunca carga, se ve la inicial y no un círculo vacío, que parece
// un error.
function avatar(usuario, clase = '', url = null) {
  const inicial = escapar((usuario || '?')[0].toUpperCase());
  const foto = url ? `<img src="${escapar(url)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<div class="avatar ${clase}">${inicial}${foto}</div>`;
}

let temporizadorAviso = null;
function avisar(mensaje, duracion = 2600) {
  const caja = $('#aviso');
  // Una ventana abierta vive en una capa por encima de todo, con el fondo
  // borroso: un aviso afuera queda detrás, difuminado. Por eso se muda adentro
  // de la ventana mientras esté abierta, y vuelve a la página cuando no.
  const abierta = [...document.querySelectorAll('dialog[open]')].pop();
  const casa = abierta || document.body;
  if (caja.parentElement !== casa) casa.appendChild(caja);
  caja.textContent = mensaje;
  caja.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { caja.hidden = true; }, duracion);
}

// --- acceso ---------------------------------------------------------------

let modoAcceso = 'entrar';

function ponerModo(modo) {
  modoAcceso = modo;
  const esRegistro = modo === 'registro';
  const esRecuperar = modo === 'recuperar';
  const forma = $('#forma-acceso');

  // Recuperar no es una pestaña: se llega por el enlace de abajo, y mientras
  // dura no hay ninguna pestaña marcada.
  document.querySelectorAll('.pestana').forEach((p) => {
    p.classList.toggle('activa', !esRecuperar && p.dataset.modo === modo);
  });
  document.querySelectorAll('.solo-registro').forEach((c) => { c.hidden = !esRegistro; });
  document.querySelectorAll('.solo-recuperar').forEach((c) => { c.hidden = !esRecuperar; });

  forma.nombre.required = esRegistro;
  forma.clave.autocomplete = (esRegistro || esRecuperar) ? 'new-password' : 'current-password';

  const enviar = forma.querySelector('button[type=submit]');
  enviar.dataset.t = esRecuperar ? 'acceso.boton.recuperar'
    : (esRegistro ? 'acceso.boton.crear' : 'acceso.boton.entrar');
  enviar.textContent = T(enviar.dataset.t);

  const olvide = $('#olvide');
  olvide.dataset.t = esRecuperar ? 'acceso.volver' : 'acceso.olvide';
  olvide.textContent = T(olvide.dataset.t);

  $('#error-acceso').hidden = true;
}

$('.pestanas').addEventListener('click', (ev) => {
  const boton = ev.target.closest('.pestana');
  if (boton) ponerModo(boton.dataset.modo);
});

$('#olvide').addEventListener('click', () => {
  ponerModo(modoAcceso === 'recuperar' ? 'entrar' : 'recuperar');
});

$('#forma-acceso').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const forma = new FormData(ev.target);
  const error = $('#error-acceso');
  error.hidden = true;

  const usuario = aUsuario(forma.get('usuario'));
  if (usuario.length < 3) {
    error.textContent = TErrorClave('usuario.corto');
    error.hidden = false;
    return;
  }

  const rutas = { registro: '/registro', entrar: '/sesion', recuperar: '/recuperar' };
  const cuerpo = modoAcceso === 'recuperar'
    ? { usuario, codigo: forma.get('codigo'), clave: forma.get('clave') }
    : { usuario, clave: forma.get('clave'), nombre: forma.get('nombre') || usuario };

  try {
    const datos = await api(rutas[modoAcceso], { metodo: 'POST', cuerpo });
    estado.token = datos.token;
    estado.yo = datos.yo;
    localStorage.setItem('pio.token', datos.token);
    ev.target.reset();
    ponerModo('entrar');
    mostrarApp();
    avisar(T(modoAcceso === 'registro' ? 'toast.nidoCreado' : 'toast.bienvenida'));
    // El alta y la recuperación entregan código; entrar, no.
    if (datos.recuperacion) mostrarCodigo(datos.recuperacion);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

function cerrarSesion(porExpiracion) {
  // Quien cierra la sesión deja de recibir las notificaciones de esa cuenta en
  // este navegador: el teléfono prestado no sigue avisando de lo ajeno.
  apagarNotificacionesDeEsteNavegador().catch(() => {});
  api('/sesion', { metodo: 'DELETE' }).catch(() => {});
  estado.token = null;
  estado.yo = null;
  estado.soyAdmin = false;
  localStorage.removeItem('pio.token');
  $('#app').hidden = true;
  $('#portada').hidden = false;
  prepararGoogle();
  if (porExpiracion) avisar(T('toast.vencio'));
}

// --- entrar con Google ----------------------------------------------------

function cargarScript(url) {
  return new Promise((listo, falla) => {
    const etiqueta = document.createElement('script');
    etiqueta.src = url;
    etiqueta.async = true;
    etiqueta.defer = true;
    etiqueta.onload = listo;
    etiqueta.onerror = () => falla(new Error(`No se pudo cargar ${url}`));
    document.head.appendChild(etiqueta);
  });
}

let googleCargado = false;

// El client id lo dice el servidor. Si no hay, ni siquiera se pide el script
// de Google: sin configurar, Pío no habla con nadie de afuera.
async function prepararGoogle() {
  try {
    const config = await api('/config');
    if (!config.google) {
      $('#con-google').hidden = true;
      return;
    }
    if (!googleCargado) {
      await cargarScript('https://accounts.google.com/gsi/client');
      googleCargado = true;
    }
    window.google.accounts.id.initialize({
      client_id: config.google,
      callback: entrarConGoogle,
    });
    const caja = $('#boton-google');
    caja.innerHTML = '';
    window.google.accounts.id.renderButton(caja, {
      theme: document.documentElement.dataset.tema === 'oscuro' ? 'filled_black' : 'outline',
      size: 'large',
      width: 300,
      text: 'continue_with',
      locale: idioma,
    });
    $('#con-google').hidden = false;
  } catch (err) {
    // Sin Google la portada anda igual; no vale romperla por esto.
    $('#con-google').hidden = true;
  }
}

async function entrarConGoogle(respuesta) {
  const error = $('#error-acceso');
  error.hidden = true;
  try {
    const datos = await api('/sesion/google', {
      metodo: 'POST',
      cuerpo: { credencial: respuesta.credential },
    });
    estado.token = datos.token;
    estado.yo = datos.yo;
    localStorage.setItem('pio.token', datos.token);
    mostrarApp();
    avisar(T('toast.bienvenida'));
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
}

// --- ruteo ----------------------------------------------------------------

function rutaActual() {
  const cruda = (location.hash || '#/nido').slice(2);
  const [camino, consulta] = cruda.split('?');
  const partes = camino.split('/').filter(Boolean);
  return { partes, params: new URLSearchParams(consulta || '') };
}

let turnoDePintar = 0;

async function pintar() {
  if (!estado.yo) return;
  const { partes, params } = rutaActual();
  const [vista, argumento] = partes;

  document.querySelectorAll('.nav').forEach((n) => {
    const destino = n.dataset.nav;
    n.classList.toggle('activa', destino === (vista || 'nido'));
  });
  $('#atras').hidden = !['u', 'p', 'e', 'c', 'pregunta'].includes(vista);

  // Al salir de un corral se vuelve a piar a la plaza; si no, uno se lleva el
  // corral puesto sin darse cuenta.
  // Al irse del corral se apaga el latido del chat y se vuelve a piar a la plaza.
  if (vista !== 'c') {
    corralActual = null;
    pararChat();
  }

  // Lo anterior se queda en pantalla hasta que lo nuevo está listo. El
  // "cargando" sólo aparece si la respuesta tarda: si llega rápido, vaciar la
  // vista primero es un parpadeo que no le sirve a nadie.
  //
  // Dos cuidados. Hay vistas que se arman en dos pasos —la cabecera primero,
  // la lista después—: si el aviso cayera entre medio, borraría la primera
  // parte y la segunda ya no tendría dónde ponerse, y la vista quedaba
  // "piando" para siempre. Por eso el aviso sólo sale si la vista todavía no
  // tocó nada. Y si mientras tanto se navegó a otro lado, el aviso de esta
  // navegación ya no es de nadie.
  const contenido = $('#contenido');
  const turno = ++turnoDePintar;
  let yaDibujo = false;
  const vigia = new MutationObserver(() => { yaDibujo = true; });
  vigia.observe(contenido, { childList: true });
  const avisoCargando = setTimeout(() => {
    if (yaDibujo || turno !== turnoDePintar) return;
    contenido.innerHTML = `<div class="cargando">${escapar(T('cargando'))}</div>`;
  }, 250);

  try {
    if (vista === 'plaza') await vistaLinea('plaza');
    else if (vista === 'buscar') await vistaBuscar(params.get('q') || '');
    else if (vista === 'yo') { location.hash = `#/u/${estado.yo.usuario}`; return; }
    else if (vista === 'u') await vistaPerfil(argumento, params.get('ver') || 'pios');
    else if (vista === 'p') await vistaHilo(argumento);
    else if (vista === 'e') await vistaEtiqueta(argumento);
    else if (vista === 'avisos') await vistaAvisos();
    else if (vista === 'admin') await vistaAdmin(params.get('ver'));
    else if (vista === 'pregunta') await vistaPregunta(argumento);
    else if (vista === 'corrales') await vistaCorrales();
    else if (vista === 'c') await vistaCorral(argumento, params.get('ver'));
    else await vistaLinea('nido');
  } catch (err) {
    contenido.innerHTML = `<div class="vacio"><span class="emoji">💥</span>${escapar(err.message)}</div>`;
  } finally {
    clearTimeout(avisoCargando);
    vigia.disconnect();
  }

  cargarTendencias();
  cargarSugerencias();
  cargarAvisos();
}

window.addEventListener('hashchange', pintar);
$('#atras').addEventListener('click', () => history.back());

// --- vistas ---------------------------------------------------------------

function cabecera(titulo, subtitulo, extra = '') {
  $('#cabecera-vista').innerHTML = `
    <div class="cabecera">
      <h2>${escapar(titulo)}</h2>
      ${subtitulo ? `<p>${escapar(subtitulo)}</p>` : ''}
      ${extra}
    </div>`;
}

// --- la pregunta del día ----------------------------------------------------

let preguntaDeHoy = null;

const textoPregunta = (p) => (idioma === 'en' ? p.en : p.es);

function cajaPregunta(p) {
  return `
    <section class="pregunta-dia">
      <span class="pregunta-etiqueta">${escapar(T('pregunta.etiqueta'))}</span>
      <p class="pregunta-texto">${escapar(textoPregunta(p))}</p>
      <div class="pregunta-pie">
        <a href="#/pregunta">${escapar(T('pregunta.respuestas', { n: p.respuestas }))}</a>
        <button class="boton principal chico" type="button" data-responder-pregunta>${escapar(T('pregunta.responder'))}</button>
      </div>
    </section>`;
}

async function vistaPregunta(fecha) {
  const { pregunta } = await api(`/pregunta${fecha ? `?fecha=${encodeURIComponent(fecha)}` : ''}`);
  if (pregunta.hoy) preguntaDeHoy = pregunta;
  cabecera(textoPregunta(pregunta), T(pregunta.hoy ? 'pregunta.subHoy' : 'pregunta.subOtro', {
    fecha: new Date(`${pregunta.fecha}T12:00:00`).toLocaleDateString(diccionario().fechas, { day: 'numeric', month: 'long' }),
  }), pregunta.hoy
    ? `<button class="boton principal" type="button" data-responder-pregunta>${escapar(T('pregunta.responder'))}</button>`
    : '');
  const datos = await api(`/pios?tipo=pregunta&fecha=${encodeURIComponent(pregunta.fecha)}`);
  // Adentro de la pregunta no hace falta que cada tarjeta diga que la respondió.
  $('#contenido').innerHTML = datos.pios.length
    ? datos.pios.map((p) => tarjetaPio(p, { enPregunta: true })).join('')
    : listaPios([], { emoji: '❓', texto: T('pregunta.vacio') });
}

// --- "estás al día" -----------------------------------------------------------

// Hasta dónde se leyó cada línea, en este navegador. No hace falta que viaje al
// servidor: si se pierde, lo peor que pasa es que no aparece la marca una vez.
const claveVisto = (tipo) => `pio.visto.${estado.yo ? estado.yo.usuario : ''}.${tipo}`;
function leerVisto(tipo) {
  try { return Number(localStorage.getItem(claveVisto(tipo))) || 0; } catch (err) { return 0; }
}
function guardarVisto(tipo, orden) {
  try { localStorage.setItem(claveVisto(tipo), String(orden)); } catch (err) { /* sin almacenamiento, sin marca */ }
}

function marcaAlDia(arriba) {
  return `<div class="al-dia">${escapar(T(arriba ? 'aldia.arriba' : 'aldia.medio'))}</div>`;
}

function pieLinea(hayMas, ultimoOrden) {
  return hayMas
    ? `<div class="pie-linea"><button class="boton fantasma" type="button" data-mas="${ultimoOrden}">${escapar(T('aldia.mas'))}</button></div>`
    : `<div class="pie-linea chico">${escapar(T('aldia.fin'))}</div>`;
}

// Pinta los píos poniendo la marca donde empieza lo que ya se había visto.
// Lo propio no cuenta como nuevo: acabar de piar y ver "hay novedades" encima
// del pío de uno sería mentirle.
function lineaConMarca(pios, visto) {
  if (!visto) return pios.map((p) => tarjetaPio(p)).join('');
  let corte = pios.findIndex((p) => p.orden <= visto);
  if (corte > 0 && pios.slice(0, corte).every((p) => p.mio)) corte = 0;
  return pios.map((p, i) => (i === corte ? marcaAlDia(i === 0) : '') + tarjetaPio(p)).join('');
}

async function vistaLinea(tipo) {
  cabecera(T(`${tipo}.titulo`), T(`${tipo}.sub`));
  const [datos, pregunta] = await Promise.all([
    api(`/pios?tipo=${tipo}`),
    tipo === 'plaza' ? api('/pregunta').then((r) => r.pregunta).catch(() => null) : null,
  ]);
  if (pregunta) preguntaDeHoy = pregunta;
  const vacio = tipo === 'nido'
    ? { emoji: '🪹', texto: T('nido.vacio') }
    : { emoji: '🌱', texto: T('plaza.vacio') };

  const visto = leerVisto(tipo);
  const pios = datos.pios;
  const cuerpo = pios.length
    ? lineaConMarca(pios, visto) + pieLinea(datos.hayMas, pios[pios.length - 1].orden)
    : listaPios(pios, vacio);
  $('#contenido').innerHTML = (pregunta ? cajaPregunta(pregunta) : '') + cuerpo;
  if (pios.length) guardarVisto(tipo, Math.max(visto, pios[0].orden));

  engancharMas(tipo);
}

// Más antiguos, a pedido. Nada de desplazamiento infinito: la línea termina, y
// seguir hacia atrás es una decisión, no un accidente del pulgar.
function engancharMas(tipo) {
  const boton = $('#contenido').querySelector('[data-mas]');
  if (!boton) return;
  boton.addEventListener('click', async () => {
    boton.disabled = true;
    try {
      const datos = await api(`/pios?tipo=${tipo}&antes=${encodeURIComponent(boton.dataset.mas)}`);
      const pie = boton.closest('.pie-linea');
      pie.insertAdjacentHTML('beforebegin', datos.pios.map((p) => tarjetaPio(p)).join(''));
      pie.outerHTML = datos.pios.length
        ? pieLinea(datos.hayMas, datos.pios[datos.pios.length - 1].orden)
        : pieLinea(false, 0);
      engancharMas(tipo);
    } catch (err) {
      boton.disabled = false;
      avisar(err.message);
    }
  });
}

async function vistaEtiqueta(etiqueta) {
  cabecera(`#${etiqueta}`, T('etiqueta.sub'));
  const datos = await api(`/pios?tipo=etiqueta&etiqueta=${encodeURIComponent(etiqueta)}`);
  $('#contenido').innerHTML = listaPios(datos.pios, { emoji: '🔎', texto: T('etiqueta.vacio') });
}

async function vistaBuscar(consulta) {
  cabecera(T('buscar.titulo'), '', `
    <input class="buscador" id="entrada-buscar" placeholder="${escapar(T('buscar.ph'))}"
           value="${escapar(consulta)}" autocomplete="off">`);

  const entrada = $('#entrada-buscar');
  entrada.focus();
  entrada.setSelectionRange(entrada.value.length, entrada.value.length);

  let temporizador = null;
  entrada.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      const q = entrada.value.trim();
      history.replaceState(null, '', `#/buscar?q=${encodeURIComponent(q)}`);
      resultadosBusqueda(q);
    }, 220);
  });

  await resultadosBusqueda(consulta);
}

async function resultadosBusqueda(consulta) {
  const contenido = $('#contenido');
  if (!consulta) {
    contenido.innerHTML = `<div class="vacio"><span class="emoji">🔍</span>${escapar(T('buscar.empezar'))}</div>`;
    return;
  }
  const datos = await api(`/buscar?q=${encodeURIComponent(consulta)}`);
  const personas = datos.usuarios.length
    ? `<div class="tarjeta" style="margin:12px 16px">
         <h2>${escapar(T('buscar.pollitos'))}</h2>
         ${datos.usuarios.map(filaUsuario).join('')}
       </div>`
    : '';
  contenido.innerHTML = personas + listaPios(datos.pios, { emoji: '🤷', texto: T('buscar.vacio') });
}

async function vistaPerfil(usuario, solapa) {
  const { perfil } = await api(`/usuarios/${encodeURIComponent(usuario)}`);
  cabecera(perfil.nombre, T('perfil.pios', { n: perfil.pios }));

  const botonRelacion = perfil.soyYo
    ? `<div class="perfil-botones">
         <button class="boton" data-editar>${escapar(T('perfil.editar'))}</button>
         <button class="boton" data-clave>${escapar(T('perfil.clave'))}</button>
         <button class="boton fantasma" data-salir>${escapar(T('perfil.salir'))}</button>
       </div>`
    : `<div class="perfil-botones">
         <button class="boton fantasma" data-bloquear="${escapar(perfil.usuario)}"
                 data-hasta="${perfil.bloqueadoHasta || ''}">
           ⛔ ${escapar(perfil.bloqueadoHasta ? T('bloqueo.hasta', { fecha: fechaBloqueo(perfil.bloqueadoHasta) }) : T('bloqueo.boton'))}
         </button>
         <button class="boton fantasma" data-silenciar="${escapar(perfil.usuario)}"
                 title="${escapar(T(perfil.loSilencio ? 'perfil.quitarSilencio' : 'perfil.silenciar'))}">
           ${perfil.loSilencio ? '🔇' : '🔈'} ${escapar(T(perfil.loSilencio ? 'perfil.silenciado' : 'perfil.silenciar'))}
         </button>
         <button class="boton ${perfil.loSigo ? 'fantasma' : 'principal'}" data-seguir="${escapar(perfil.usuario)}">
           ${escapar(T(perfil.loSigo ? 'perfil.siguiendoYa' : 'perfil.seguir'))}
         </button>
       </div>`;

  const tipo = solapa === 'megusta' ? 'megusta' : 'usuario';
  const datos = await api(`/pios?tipo=${tipo}&usuario=${encodeURIComponent(perfil.usuario)}`);

  $('#contenido').innerHTML = `
    <div class="perfil-caja">
      <div class="perfil-fila">
        ${avatar(perfil.usuario, 'grande', perfil.avatar)}
        ${botonRelacion}
      </div>
      <h3 class="perfil-nombre">${escapar(perfil.nombre)}${medallita(perfil.medalla)}</h3>
      <div class="perfil-usuario">@${escapar(perfil.usuario)}</div>
      ${perfil.bio ? `<p class="perfil-bio">${enriquecer(perfil.bio)}</p>` : ''}
      <div class="perfil-datos">
        <span><b>${perfil.siguiendo}</b> ${escapar(T('perfil.siguiendo'))}</span>
        <span><b data-seguidores-de="${escapar(perfil.usuario)}">${perfil.seguidores}</b> ${escapar(T('perfil.seguidores'))}</span>
        ${perfil.proxima ? `<span class="chico">${escapar(T('medalla.proxima', {
          faltan: perfil.proxima.faltan,
          nombre: T(`medalla.${perfil.proxima.clave}`),
        }))}</span>` : ''}
        <span>${escapar(T('perfil.desde', {
          fecha: new Date(perfil.creado).toLocaleDateString(diccionario().fechas),
        }))}</span>
      </div>
    </div>
    <div class="sub-pestanas">
      <button class="sub-pestana ${tipo === 'usuario' ? 'activa' : ''}" data-solapa="pios">${escapar(T('perfil.solapa.pios'))}</button>
      <button class="sub-pestana ${tipo === 'megusta' ? 'activa' : ''}" data-solapa="megusta">${escapar(T('perfil.solapa.megusta'))}</button>
    </div>
    ${listaPios(datos.pios, {
      emoji: '🥚',
      texto: T(tipo === 'megusta' ? 'perfil.vacio.megusta' : 'perfil.vacio.pios'),
    })}`;

  $('#contenido').querySelectorAll('[data-solapa]').forEach((boton) => {
    boton.addEventListener('click', () => {
      location.hash = `#/u/${perfil.usuario}?ver=${boton.dataset.solapa}`;
    });
  });
  const salir = $('#contenido').querySelector('[data-salir]');
  if (salir) salir.addEventListener('click', () => cerrarSesion(false));
  const editar = $('#contenido').querySelector('[data-editar]');
  if (editar) editar.addEventListener('click', abrirPerfil);
  const clave = $('#contenido').querySelector('[data-clave]');
  if (clave) clave.addEventListener('click', abrirClave);
}

// Qué ramas están plegadas, sólo mientras dura la vista. Guardarlo entre
// sesiones sería hacerle recordar al usuario decisiones que ya olvidó.
const plegadas = new Set();

function cuantasCuelgan(nodo) {
  return (nodo.ramas || []).reduce((suma, rama) => suma + 1 + cuantasCuelgan(rama), 0);
}

// Cada respuesta es un comentario compacto: avatar chico, nombre y hora en una
// línea, el texto debajo. De cada avatar baja una línea que se dobla hacia
// cada respuesta, así se ve de un vistazo quién le contesta a quién, sin
// contar sangrías. Tocar la línea pliega esa rama entera.
function comentario(nodo) {
  const hijos = nodo.ramas || [];
  const cerrada = plegadas.has(nodo.id);
  const abiertos = hijos.length && !cerrada;

  // Las ramas van afuera del <article>: adentro, cada clic para plegar
  // dispararía también las acciones del pío.
  return `
    <div class="comentario-rama">
      <article class="pio comentario ${abiertos ? 'con-hijos' : ''} ${nodo.huevo ? 'huevo' : ''} ${nodo.bloqueadoHasta ? 'borroso' : ''} ${nodo.id === hiloResaltado ? 'resaltado' : ''}" data-id="${nodo.id}" data-autor="${escapar(nodo.autor.usuario)}">
        ${avisoBloqueo(nodo)}
        ${cascaronDe(nodo)}
        <div class="com-cabeza">
          ${avatar(nodo.autor.usuario, 'mini', nodo.autor.avatar)}
          <a class="pio-nombre" href="#/u/${escapar(nodo.autor.usuario)}">${escapar(nodo.autor.nombre)}</a>
          <span class="pio-usuario">@${escapar(nodo.autor.usuario)}</span>
          <span class="pio-fecha">· ${hace(nodo.creado)}</span>
          ${cienJustos(nodo)}
          ${accionesDePio(nodo)}
        </div>
        <div class="com-cuerpo">
          ${nodo.texto ? `<p class="texto">${enriquecer(nodo.texto)}</p>` : ''}
          ${adjuntoDePio(nodo)}
        </div>
      </article>
      ${hijos.length && cerrada ? `
        <button type="button" class="com-desplegar" data-plegar="${escapar(nodo.id)}">
          ⊕ ${escapar(T('hilo.ocultas', { n: cuantasCuelgan(nodo) }))}
        </button>` : ''}
      ${abiertos ? `
        <div class="com-hijos">
          <button type="button" class="com-linea" data-plegar="${escapar(nodo.id)}"
                  title="${escapar(T('hilo.plegar'))}" aria-label="${escapar(T('hilo.plegar'))}"></button>
          ${hijos.map(comentario).join('')}
        </div>` : ''}
    </div>`;
}

let hiloEnPantalla = null;
let hiloAbierto = null;

function pintarCascada() {
  if (!hiloEnPantalla) return;
  const { despues, recortado, pio } = hiloEnPantalla;
  const cerrada = plegadas.has(pio.id);
  const total = despues.reduce((suma, nodo) => suma + 1 + cuantasCuelgan(nodo), 0);

  // Las respuestas directas también cuelgan de una línea: la que baja del
  // avatar del pío de arriba. Sin ella, un hilo de un solo nivel —el más
  // común— no mostraba ningún árbol.
  $('#cascada').innerHTML = !despues.length
    ? `<div class="vacio"><span class="emoji">💬</span>${escapar(T('hilo.vacio'))}</div>`
    : (cerrada
      ? `<button type="button" class="com-desplegar raiz" data-plegar="${escapar(pio.id)}">
           ⊕ ${escapar(T('hilo.ocultas', { n: total }))}
         </button>`
      : `<div class="com-hijos raiz">
           <button type="button" class="com-linea" data-plegar="${escapar(pio.id)}"
                   title="${escapar(T('hilo.plegar'))}" aria-label="${escapar(T('hilo.plegar'))}"></button>
           ${despues.map(comentario).join('')}
         </div>`
        + (recortado ? `<div class="plegado">${escapar(T('hilo.recortado'))}</div>` : ''));

  trazarRaiz();
  vigilarRaiz();
}

// El pío de arriba tiene medidas distintas en cada tema —avatar más grande,
// ficha con márgenes—, así que el punto de donde baja la línea se mide en vez
// de adivinarlo.
function trazarRaiz() {
  const contenido = $('#contenido');
  const cascada = $('#cascada');
  const avatarRaiz = contenido.querySelector('.pio.destacado .avatar');
  const colgantes = cascada && cascada.querySelector('.com-hijos.raiz');
  let linea = contenido.querySelector('.linea-raiz');
  if (!avatarRaiz || !cascada) { if (linea) linea.remove(); return; }

  const base = contenido.getBoundingClientRect();
  const a = avatarRaiz.getBoundingClientRect();
  const centro = a.left + a.width / 2;
  cascada.style.setProperty('--raiz-x', `${Math.round(centro - cascada.getBoundingClientRect().left)}px`);

  if (!colgantes) { if (linea) linea.remove(); return; }
  if (!linea) {
    linea = document.createElement('div');
    linea.className = 'linea-raiz';
    contenido.appendChild(linea);
  }
  const arriba = a.bottom - base.top + 4;
  const abajo = colgantes.getBoundingClientRect().top - base.top;
  linea.style.left = `${Math.round(centro - base.left - 1)}px`;
  linea.style.top = `${Math.round(arriba)}px`;
  linea.style.height = `${Math.max(0, Math.round(abajo - arriba))}px`;
}

// Si la foto del pío termina de cargar o cambia el ancho de la ventana, el pío
// cambia de alto y la línea tiene que seguirlo.
let vigiaRaiz = null;
function vigilarRaiz() {
  if (vigiaRaiz) vigiaRaiz.disconnect();
  const destacado = $('#contenido').querySelector('.pio.destacado');
  if (!destacado || typeof ResizeObserver === 'undefined') return;
  vigiaRaiz = new ResizeObserver(() => trazarRaiz());
  vigiaRaiz.observe(destacado);
  vigiaRaiz.observe($('#contenido'));
}

// Los ids de los comentarios que hay que atravesar para llegar a `id`, o null
// si no está en el árbol.
function caminoHasta(nodos, id) {
  for (const nodo of nodos || []) {
    if (nodo.id === id) return [];
    const debajo = caminoHasta(nodo.ramas, id);
    if (debajo) return [nodo.id, ...debajo];
  }
  return null;
}

let hiloResaltado = null;
let ultimoDestacadoVisto = null;
// Si se tocó un comentario que ya está a la vista, no hay que llevar la
// pantalla hasta él: se quedaría saltando bajo el dedo.
// Guarda dónde estaba la pantalla, porque volver a dibujar la vista la vacía un
// instante y el navegador la sube.
let quedarseQuieto = null;

async function vistaHilo(id) {
  cabecera(T('hilo.titulo'), T('hilo.sub'));
  let datos = await api(`/pios/${encodeURIComponent(id)}/hilo`);
  let camino = null;

  // Una respuesta no se abre sola: se abre la conversación entera, desde el
  // pío que la empezó, con esa respuesta destacada. Leer una respuesta sin lo
  // que contesta es leer la mitad.
  if (datos.antes.length) {
    try {
      const completo = await api(`/pios/${encodeURIComponent(datos.antes[0].id)}/hilo`);
      camino = caminoHasta(completo.despues, id);
      if (camino) datos = completo;
    } catch { /* si el pío de arriba no se puede abrir, queda la vista de siempre */ }
  }

  hiloEnPantalla = datos;
  hiloResaltado = camino ? id : null;
  if (hiloAbierto !== datos.pio.id) plegadas.clear();
  hiloAbierto = datos.pio.id;
  // Lo plegado nunca esconde lo que se vino a ver.
  if (camino) { plegadas.delete(datos.pio.id); camino.forEach((c) => plegadas.delete(c)); }

  $('#contenido').innerHTML =
    datos.antes.map((p) => tarjetaPio(p)).join('')
    + tarjetaPio(datos.pio, { destacado: true })
    + '<div id="cascada"></div>';
  pintarCascada();

  // Se lleva la vista hasta la respuesta sólo al llegar: si se la llevara en
  // cada me gusta, la pantalla saltaría mientras uno lee otra cosa.
  if (comentarioQueEntra) {
    const nuevo = $('#cascada').querySelector(`.comentario[data-id="${CSS.escape(comentarioQueEntra)}"]`);
    comentarioQueEntra = null;
    if (nuevo) {
      nuevo.classList.add('recien');
      abrirDeAPoco(nuevo.closest('.comentario-rama'));
    }
  }

  const quieto = quedarseQuieto;
  quedarseQuieto = null;
  if (quieto !== null) window.scrollTo(0, quieto);
  else if (hiloResaltado && ultimoDestacadoVisto !== hiloResaltado) {
    const destino = $('#cascada').querySelector(`.comentario[data-id="${CSS.escape(hiloResaltado)}"]`);
    if (destino) destino.scrollIntoView({ block: 'center' });
  }
  ultimoDestacadoVisto = hiloResaltado;
}

// --- avisos ---------------------------------------------------------------

const TIPOS_DE_AVISO = ['mencion', 'respuesta', 'repio', 'megusta', 'seguir', 'foto'];

const EMOJI_AVISO = {
  mencion: '📣',
  respuesta: '💬',
  repio: '🔁',
  megusta: '❤️',
  seguir: '🐣',
  foto: '📸',
};

function queParece(tipo) {
  return T(TIPOS_DE_AVISO.includes(tipo) ? `aviso.${tipo}` : 'aviso.otro');
}

async function vistaAvisos() {
  cabecera(T('avisos.titulo'), T('avisos.sub'),
    `<button class="boton fantasma chico" id="boton-notificaciones" type="button" hidden></button>`);
  pintarBotonNotificaciones();
  const { notificaciones } = await api('/notificaciones');

  $('#contenido').innerHTML = notificaciones.length
    ? notificaciones.map(filaAviso).join('')
    : `<div class="vacio"><span class="emoji">🔕</span>${escapar(T('avisos.vacio'))}</div>`;

  // Entrar a la vista es haberlos leído; no hace falta un botón para eso.
  if (notificaciones.some((n) => !n.leida)) {
    try {
      await api('/notificaciones/leidas', { metodo: 'POST' });
      pintarInsignia(0);
    } catch { /* si falla, quedan sin leer y se reintenta la próxima */ }
  }
}

function filaAviso(aviso) {
  // Sin pío (o si lo borraron) el aviso lleva al perfil de quien lo provocó.
  const destino = aviso.pio ? `#/p/${aviso.pio.id}` : `#/u/${aviso.de.usuario}`;
  // Div y no <a>: el texto citado trae sus propios enlaces de #etiqueta y
  // @mención, y una ancla adentro de otra hace que el navegador parta la fila.
  return `
    <div class="aviso-fila ${aviso.leida ? '' : 'sin-leer'}" data-ir="${escapar(destino)}">
      <span class="aviso-icono">${EMOJI_AVISO[aviso.tipo] || '🐤'}</span>
      <div>
        <div class="aviso-linea">
          <b>${escapar(aviso.de.nombre)}</b>
          <span class="pio-usuario">@${escapar(aviso.de.usuario)}</span>
          <span class="pio-fecha">· ${hace(aviso.creado)}</span>
        </div>
        <div class="aviso-que">${escapar(queParece(aviso.tipo))}</div>
        ${aviso.pio ? `<p class="aviso-cita">${enriquecer(aviso.pio.texto)}</p>` : ''}
      </div>
    </div>`;
}

const TITULO_BASE = document.title;

function pintarInsignia(cuantos) {
  const insignia = $('#insignia');
  insignia.textContent = cuantos > 99 ? '99+' : String(cuantos);
  insignia.hidden = !cuantos;
  // También en la pestaña: con el sitio en segundo plano es lo único que se ve.
  document.title = cuantos ? `(${cuantos > 99 ? '99+' : cuantos}) ${TITULO_BASE}` : TITULO_BASE;
}

async function cargarAvisos() {
  if (!estado.yo) return;
  try {
    const { sinLeer } = await api('/notificaciones/cuenta');
    pintarInsignia(sinLeer);
  } catch { /* la insignia no rompe la vista */ }
}

// Los avisos llegan solos. Cada treinta segundos, y sólo con la pestaña a la
// vista: preguntar por una pestaña que nadie mira es gastar batería ajena.
// Al volver a ella se pregunta enseguida, que es cuando más importa.
const CADA_CUANTO_AVISOS = 30 * 1000;
setInterval(() => {
  if (document.visibilityState === 'visible') cargarAvisos();
}, CADA_CUANTO_AVISOS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') cargarAvisos();
});

// --- corrales -------------------------------------------------------------

// En qué corral se está piando. Lo fija la vista: si estás dentro de un
// corral, lo que escribas se queda ahí; si no, va a la plaza.
let corralActual = null;

function tarjetaCorral(corral) {
  return `
    <div class="sugerencia">
      <a class="crece" href="#/c/${escapar(corral.nombre)}">
        <b>${escapar(corral.titulo)}</b>
        <span>${escapar(corral.descripcion || T('corral.gente', { n: corral.suscritos }))}</span>
      </a>
      <span class="chico">${escapar(T('corral.pios', { n: corral.pios }))}</span>
      <button class="boton ${corral.estoy ? 'fantasma' : 'principal'}" data-corral="${escapar(corral.nombre)}">
        ${escapar(T(corral.estoy ? 'corral.salir' : 'corral.entrar'))}
      </button>
    </div>`;
}

async function vistaCorrales() {
  cabecera(T('corrales.titulo'), T('corrales.sub'),
    `<button class="boton principal" id="armar-corral">${escapar(T('corrales.crear'))}</button>`);
  const { corrales } = await api('/corrales');
  $('#contenido').innerHTML = corrales.length
    ? `<div class="tarjeta" style="margin:12px 16px">${corrales.map(tarjetaCorral).join('')}</div>`
    : `<div class="vacio"><span class="emoji">🚜</span>${escapar(T('corrales.vacio'))}</div>`;
  $('#armar-corral').addEventListener('click', abrirCorral);
}

// --- el chat de un corral -------------------------------------------------

// Mientras la pestaña está abierta se pregunta por lo nuevo cada pocos
// segundos. No hay nada más liviano sin dependencias, y para un corral de
// amigos alcanza de sobra.
let latidoChat = null;
let ultimoMensaje = 0;
const mostrados = new Set();

function pararChat() {
  if (latidoChat) clearInterval(latidoChat);
  latidoChat = null;
}

function burbuja(m, propia) {
  return `
    <div class="burbuja${propia ? ' mia' : ''}">
      ${propia ? '' : `<a class="quien" href="#/u/${escapar(m.autor.usuario)}">${escapar(m.autor.nombre)}</a>`}
      <p>${enriquecer(m.texto)}</p>
      <span class="cuando">${hace(m.creado)}</span>
    </div>`;
}

async function traerMensajes(corral, primeraVez) {
  const caja = $('#charla');
  // Si ya no está la caja es que se fue de la vista: el latido se apaga solo.
  if (!caja) { pararChat(); return; }
  try {
    // Sólo lo posterior a lo último que se vio: traer la conversación entera
    // cada cuatro segundos sería mandar lo mismo una y otra vez.
    const { mensajes } = await api(`/corrales/${encodeURIComponent(corral)}/chat`
      + (ultimoMensaje ? `?desde=${ultimoMensaje}` : ''));

    if (primeraVez && !mensajes.length) {
      caja.innerHTML = `<p class="chico centrado">${escapar(T('chat.vacio'))}</p>`;
      return;
    }
    if (!mensajes.length) return;
    // El "nadie dijo nada" se va con el primer mensaje, llegue cuando llegue.
    if (primeraVez || caja.querySelector('.chico.centrado')) caja.innerHTML = '';

    for (const m of mensajes) {
      ultimoMensaje = Math.max(ultimoMensaje, m.creado);
      // Al enviar se pregunta por lo nuevo, y el latido de cada cuatro
      // segundos también: si coinciden, las dos respuestas traen el mismo
      // mensaje. Lo que ya está en pantalla no se vuelve a poner.
      if (mostrados.has(m.id)) continue;
      mostrados.add(m.id);
      caja.insertAdjacentHTML('beforeend',
        burbuja(m, !!estado.yo && m.autor.usuario === estado.yo.usuario));
    }
    // Una charla que no baja sola obliga a perseguirla.
    caja.scrollTop = caja.scrollHeight;
  } catch (err) {
    /* un latido perdido no rompe nada: lo trae el siguiente */
  }
}

function pintarChat(corral, donde) {
  ultimoMensaje = 0;
  mostrados.clear();
  donde.innerHTML = `
    <div class="charla" id="charla"></div>
    ${corral.estoy
      ? `<form class="decir" id="forma-decir">
           <input id="que-decir" maxlength="300" autocomplete="off"
                  placeholder="${escapar(T('chat.ph'))}">
           <button class="boton principal" type="submit">${escapar(T('chat.enviar'))}</button>
         </form>`
      : `<p class="chico centrado decir">${escapar(T('chat.afuera'))}</p>`}`;

  traerMensajes(corral.nombre, true);
  pararChat();
  latidoChat = setInterval(() => traerMensajes(corral.nombre, false), 4000);

  const forma = $('#forma-decir');
  if (!forma) return;
  forma.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const campo = $('#que-decir');
    const texto = campo.value.trim();
    if (!texto) return;
    campo.value = '';
    try {
      await api(`/corrales/${encodeURIComponent(corral.nombre)}/chat`, {
        metodo: 'POST', cuerpo: { texto },
      });
      await traerMensajes(corral.nombre, false);
    } catch (err) {
      // Se devuelve lo escrito: perder el mensaje es peor que el error.
      campo.value = texto;
      avisar(err.message);
    }
  });
  $('#que-decir').focus();
}

async function vistaCorral(nombre, solapa) {
  const { corral } = await api(`/corrales/${encodeURIComponent(nombre)}`);
  corralActual = corral.nombre;
  cabecera(corral.titulo, corral.descripcion || T('corral.dueno', { usuario: corral.dueno }));

  const enChat = solapa === 'chat';
  $('#contenido').innerHTML = `
    <div class="perfil-caja">
      <div class="perfil-datos">
        <span><b data-suscritos-de="${escapar(corral.nombre)}">${corral.suscritos}</b> ${escapar(T('corral.gente', { n: corral.suscritos }).replace(/^\d+\s/, ''))}</span>
        <span>${escapar(T('corral.pios', { n: corral.pios }))}</span>
        <span>${escapar(T('corral.dueno', { usuario: corral.dueno }))}</span>
      </div>
      <div class="perfil-botones" style="margin-top:12px">
        <button class="boton ${corral.estoy ? 'fantasma' : 'principal'}" data-corral="${escapar(corral.nombre)}">
          ${escapar(T(corral.estoy ? 'corral.salir' : 'corral.entrar'))}
        </button>
      </div>
    </div>
    <div class="sub-pestanas">
      <button class="sub-pestana ${enChat ? '' : 'activa'}" data-solapa-corral="pios">${escapar(T('corral.solapa.pios'))}</button>
      <button class="sub-pestana ${enChat ? 'activa' : ''}" data-solapa-corral="chat">${escapar(T('corral.solapa.chat'))}</button>
    </div>
    <div id="abajo-corral"></div>`;

  const abajo = $('#abajo-corral');
  if (enChat) {
    pintarChat(corral, abajo);
  } else {
    pararChat();
    const datos = await api(`/pios?tipo=corral&corral=${encodeURIComponent(corral.nombre)}`);
    abajo.innerHTML = datos.pios.map((p) => tarjetaPio(p, { enCorral: true })).join('')
      || `<div class="vacio"><span class="emoji">🚜</span>${escapar(T('corral.vacio'))}</div>`;
  }

  for (const boton of $('#contenido').querySelectorAll('[data-solapa-corral]')) {
    boton.addEventListener('click', () => {
      const cual = boton.dataset.solapaCorral;
      location.hash = `#/c/${corral.nombre}${cual === 'chat' ? '?ver=chat' : ''}`;
    });
  }
}

function abrirCorral() {
  const forma = $('#forma-corral');
  forma.reset();
  $('#error-corral').hidden = true;
  $('#dialogo-corral').showModal();
}

$('#cerrar-corral').addEventListener('click', () => $('#dialogo-corral').close());

$('#forma-corral').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const forma = ev.target;
  const error = $('#error-corral');
  const enviar = forma.querySelector('button[type=submit]');
  if (enviar.disabled) return;
  enviar.disabled = true;
  error.hidden = true;
  try {
    // Sin nombre corto se arma con el título: pedir dos cosas para lo mismo es
    // pedirle al usuario que haga de traductor.
    const { corral } = await api('/corrales', {
      metodo: 'POST',
      cuerpo: {
        nombre: aUsuario(forma.nombre.value || forma.titulo.value),
        titulo: forma.titulo.value,
        descripcion: forma.descripcion.value,
      },
    });
    $('#dialogo-corral').close();
    avisar(T('corral.creado'));
    location.hash = `#/c/${corral.nombre}`;
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    enviar.disabled = false;
  }
});

// --- piezas de interfaz ---------------------------------------------------

function listaPios(pios, vacio) {
  if (!pios.length) {
    return `<div class="vacio"><span class="emoji">${vacio.emoji}</span>${escapar(vacio.texto)}</div>`;
  }
  return pios.map((p) => tarjetaPio(p)).join('');
}

// --- Spotify ----------------------------------------------------------------

// Un enlace de Spotify pegado en el texto se vuelve reproductor. Así no gasta
// caracteres: la dirección sola se come casi todo el pío.
const SPOTIFY = /https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{22})\S*/i;

// Una canción o un episodio caben en la versión chica; lo que tiene lista
// necesita la alta para mostrar algo más que la portada.
const altoSpotify = (recurso) => (recurso === 'track' || recurso === 'episode' ? 80 : 152);

function reproductorSpotify(a) {
  return `<iframe class="spotify" src="https://open.spotify.com/embed/${escapar(a.recurso)}/${escapar(a.id)}"
    height="${altoSpotify(a.recurso)}" loading="lazy" title="Spotify"
    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
}

function adjuntoDePio(pio) {
  const a = pio.adjunto;
  if (!a) return '';
  if (a.tipo === 'spotify') return `<div class="pio-spotify">${reproductorSpotify(a)}</div>`;
  const etiquetas = a.etiquetas || [];
  // Se muestran al tocar el botón, como en cualquier red: una foto tapada de
  // nombres de entrada deja de ser una foto.
  return `
    <div class="pio-imagen">
      <span class="marco">
        <a href="${escapar(a.url)}" target="_blank" rel="noopener noreferrer">
          <img src="${escapar(a.miniatura || a.url)}" alt="${escapar(a.texto || '')}" loading="lazy">
        </a>
        ${etiquetas.map((e) => `
          <a class="etiqueta-foto" href="#/u/${escapar(e.usuario)}"
             style="left:${e.x * 100}%;top:${e.y * 100}%">@${escapar(e.usuario)}</a>`).join('')}
        ${etiquetas.length ? `
          <button type="button" class="ver-etiquetas" data-ver-etiquetas
                  title="${escapar(T('foto.ver'))}">👤 ${etiquetas.length}</button>` : ''}
      </span>
    </div>`;
}

// Si el texto trae un enlace de Spotify y no hay otro adjunto, el enlace sale
// del texto y pasa a ser el adjunto. Uno solo por pío, como las imágenes.
function spotifyDelTexto() {
  if (adjunto) return false;
  const m = SPOTIFY.exec(areaTexto.value);
  if (!m) return false;
  adjunto = { tipo: 'spotify', recurso: m[1].toLowerCase(), id: m[2] };
  areaTexto.value = areaTexto.value.replace(m[0], '').replace(/[ \t]{2,}/g, ' ').trim();
  pintarAdjunto();
  return true;
}

function tarjetaPio(pio, opciones = {}) {
  // Dentro de la cascada, la sangría ya dice que es una respuesta: repetirlo en
  // cada rama es ruido, y lo que se pidió fue un sitio poco recargado.
  const contexto = pio.repiadoPor
    ? `<div class="contexto">${T('pio.repiadoPor', { usuario: escapar(pio.repiadoPor) })}</div>`
    : (pio.respuestaA && !opciones.enCascada
      ? `<div class="contexto"><a href="#/p/${escapar(pio.id)}">${escapar(T('pio.respuestaA', { usuario: pio.respuestaAUsuario }))}</a></div>`
      // Dentro del corral no hace falta decir en qué corral se está.
      : pio.pregunta && !opciones.enPregunta
        ? `<div class="contexto"><a href="#/pregunta/${escapar(pio.pregunta)}">${escapar(T('pio.pregunta'))}</a></div>`
        : (pio.corral && !opciones.enCorral
        ? `<div class="contexto"><a href="#/c/${escapar(pio.corral)}">${escapar(T('pio.enCorral', { corral: pio.corral }))}</a></div>`
        : ''));

  const cascaron = cascaronDe(pio);

  return `
    <article class="pio ${opciones.destacado ? 'destacado' : ''} ${pio.huevo ? 'huevo' : ''} ${pio.bloqueadoHasta ? 'borroso' : ''}" data-id="${pio.id}" data-autor="${escapar(pio.autor.usuario)}">
      ${avisoBloqueo(pio)}
      ${cascaron}
      ${contexto}
      ${avatar(pio.autor.usuario, '', pio.autor.avatar)}
      <div>
        <div class="pio-cabecera">
          <a class="pio-nombre" href="#/u/${escapar(pio.autor.usuario)}" data-parar>${escapar(pio.autor.nombre)}</a>
          <span class="pio-usuario">@${escapar(pio.autor.usuario)}</span>
          <span class="pio-fecha">· ${hace(pio.creado)}</span>
          ${cienJustos(pio)}
          ${accionesDePio(pio)}
        </div>
        ${pio.texto ? `<p class="texto">${enriquecer(pio.texto)}</p>` : ''}
        ${adjuntoDePio(pio)}
      </div>
    </article>`;
}

// --- bloqueo suave -------------------------------------------------------------

function fechaBloqueo(ms) {
  return new Date(ms).toLocaleString(diccionario().fechas, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// Encima del pío borroso: de quién es el bloqueo, hasta cuándo, y la opción de
// verlo igual. Bloquear es por tiempo, no para siempre, y a veces uno quiere
// leer justo ese pío.
function avisoBloqueo(pio) {
  if (!pio.bloqueadoHasta) return '';
  return `
    <div class="contexto bloqueo-aviso">
      <span>${escapar(T('bloqueo.aviso', { usuario: pio.autor.usuario, fecha: fechaBloqueo(pio.bloqueadoHasta) }))}</span>
      <button type="button" class="enlace-boton" data-ver-bloqueado>${escapar(T('bloqueo.ver'))}</button>
    </div>`;
}

let menuBloqueo = null;
function cerrarMenuBloqueo() {
  if (menuBloqueo) menuBloqueo.remove();
  menuBloqueo = null;
}
document.addEventListener('click', (ev) => {
  if (menuBloqueo && !menuBloqueo.contains(ev.target) && !ev.target.closest('[data-bloquear]')) cerrarMenuBloqueo();
});
window.addEventListener('hashchange', cerrarMenuBloqueo);

const PLAZOS_DE_BLOQUEO = [[60, 'bloqueo.hora'], [1440, 'bloqueo.dia'], [10080, 'bloqueo.semana'], [43200, 'bloqueo.mes']];

function abrirMenuBloqueo(boton) {
  cerrarMenuBloqueo();
  const usuario = boton.dataset.bloquear;
  const vigente = !!boton.dataset.hasta;
  menuBloqueo = document.createElement('div');
  menuBloqueo.className = 'menu-compartir menu-bloqueo';
  menuBloqueo.setAttribute('role', 'menu');
  menuBloqueo.innerHTML = `
    <p class="menu-titulo">${escapar(T(vigente ? 'bloqueo.cambiar' : 'bloqueo.cuanto'))}</p>
    ${PLAZOS_DE_BLOQUEO.map(([min, clave]) => `<button role="menuitem" type="button" data-plazo="${min}">${escapar(T(clave))}</button>`).join('')}
    ${vigente ? `<button role="menuitem" type="button" class="quitar-bloqueo" data-plazo="0">${escapar(T('bloqueo.quitar'))}</button>` : ''}
    <p class="menu-pie">${escapar(T('bloqueo.explica'))}</p>`;
  document.body.appendChild(menuBloqueo);

  const r = boton.getBoundingClientRect();
  const ancho = menuBloqueo.offsetWidth;
  const maximo = window.scrollX + document.documentElement.clientWidth - ancho - 8;
  menuBloqueo.style.top = `${window.scrollY + r.bottom + 4}px`;
  menuBloqueo.style.left = `${Math.max(8, Math.min(window.scrollX + r.left, maximo))}px`;

  menuBloqueo.addEventListener('click', async (ev) => {
    const opcion = ev.target.closest('[data-plazo]');
    if (!opcion) return;
    const minutos = Number(opcion.dataset.plazo);
    cerrarMenuBloqueo();
    try {
      const { perfil } = await api(`/usuarios/${encodeURIComponent(usuario)}/bloquear`, { metodo: 'POST', cuerpo: { minutos } });
      avisar(perfil.bloqueadoHasta
        ? T('bloqueo.puesto', { usuario: perfil.usuario, fecha: fechaBloqueo(perfil.bloqueadoHasta) })
        : T('bloqueo.quitado', { usuario: perfil.usuario }));
      pintarBloqueo(perfil);
    } catch (err) {
      avisar(err.message);
    }
  });
}

function cascaronDe(pio) {
  return pio.huevo
    ? `<div class="contexto huevo-aviso" data-nace="${Date.now() + pio.naceEn}">
         <span data-cuenta>${escapar(T('huevo.nace', { s: Math.ceil(pio.naceEn / 1000) }))}</span>
         <button class="enlace-boton" type="button" data-deshacer="${escapar(pio.id)}">${escapar(T('huevo.deshacer'))}</button>
       </div>`
    : '';
}

function cienJustos(pio) {
  return largo(pio.texto) === LIMITE
    ? `<span class="cien-justos" title="${escapar(T('pio.cienJustos'))}" aria-label="${escapar(T('pio.cienJustos'))}">💯</span>`
    : '';
}

// Un mismo pío puede estar dos veces en pantalla —el original y un repío—:
// se tocan todas sus copias.
const copiasDe = (id) => document.querySelectorAll(`.pio[data-id="${CSS.escape(id)}"]`);

function marcarAccion(id, tipo, encender) {
  for (const copia of copiasDe(id)) {
    const boton = copia.querySelector(`.acciones [data-accion="${tipo}"]`);
    if (!boton) continue;
    boton.classList.toggle('activa', encender);
    if (tipo === 'megusta' && boton.firstChild) boton.firstChild.textContent = encender ? '❤️ ' : '🤍 ';
  }
}

function pintarAccionesDe(pio) {
  for (const copia of copiasDe(pio.id)) {
    const acciones = copia.querySelector('.acciones');
    if (acciones) acciones.outerHTML = accionesDePio(pio);
  }
}

function accionesDePio(pio) {
  return `
        <div class="acciones">
          <button class="accion" data-accion="responder" title="${escapar(T('accion.responder'))}">💬 <span>${pio.respuestas || ''}</span></button>
          <button class="accion repio ${pio.yoRepio ? 'activa' : ''}" data-accion="repio" title="${escapar(T('accion.repiar'))}">🔁 <span>${pio.repios || ''}</span></button>
          <button class="accion ${pio.yoMeGusta ? 'activa' : ''}" data-accion="megusta" title="${escapar(T('accion.megusta'))}">${pio.yoMeGusta ? '❤️' : '🤍'} <span>${pio.meGusta ? pio.meGusta : ''}</span></button>
          <button class="accion" data-accion="compartir" title="${escapar(T('accion.compartir'))}"
                  data-autor="${escapar(pio.autor.usuario)}" data-texto="${escapar(pio.texto || '')}">📤</button>
          ${pio.mio
            ? `<button class="accion borrar" data-accion="borrar" title="${escapar(T('accion.borrar'))}">🗑️</button>`
            : (estado.soyAdmin
              ? `<button class="accion borrar como-admin" data-accion="borrar" data-como-admin title="${escapar(T('accion.borrarAdmin'))}">🗑️</button>`
              : '')}
        </div>`;
}

// --- compartir ------------------------------------------------------------

// Se comparte /p/<id> y no #/p/<id>: las redes arman la vista previa sin
// ejecutar nada y no ven lo que hay detrás del #. Ver src/compartir.js.
const enlaceDePio = (id) => `${location.origin}/p/${encodeURIComponent(id)}`;

let menuCompartir = null;

function cerrarCompartir() {
  if (menuCompartir) menuCompartir.remove();
  menuCompartir = null;
}

document.addEventListener('click', (ev) => {
  if (menuCompartir && !menuCompartir.contains(ev.target)) cerrarCompartir();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') cerrarCompartir();
});
window.addEventListener('hashchange', cerrarCompartir);

async function abrirCompartir(boton, id) {
  const url = enlaceDePio(id);
  const frase = T('compartir.frase', { texto: boton.dataset.texto || '', usuario: boton.dataset.autor });

  // En el teléfono, el menú del sistema ya sabe qué aplicaciones hay
  // instaladas: ofrecer una lista propia sería peor. En la computadora ese
  // menú suele ser pobre, así que ahí va la lista.
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: 'Pío', text: frase, url });
    } catch (err) {
      /* cerrar el menú del sistema no es un error */
    }
    return;
  }

  cerrarCompartir();
  const q = encodeURIComponent;
  const destinos = [
    ['X', `https://x.com/intent/post?text=${q(frase)}&url=${q(url)}`],
    ['WhatsApp', `https://wa.me/?text=${q(`${frase} ${url}`)}`],
    ['Telegram', `https://t.me/share/url?url=${q(url)}&text=${q(frase)}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${q(url)}`],
    ['Bluesky', `https://bsky.app/intent/compose?text=${q(`${frase} ${url}`)}`],
  ];

  menuCompartir = document.createElement('div');
  menuCompartir.className = 'menu-compartir';
  menuCompartir.setAttribute('role', 'menu');
  menuCompartir.innerHTML = destinos.map(([nombre, destino]) =>
    `<a role="menuitem" href="${escapar(destino)}" target="_blank" rel="noopener noreferrer">${escapar(nombre)}</a>`
  ).join('') + `<button role="menuitem" type="button" data-copiar>${escapar(T('compartir.copiar'))}</button>`;
  document.body.appendChild(menuCompartir);

  // Debajo del botón, pero sin salirse de la pantalla por la derecha.
  const r = boton.getBoundingClientRect();
  const ancho = menuCompartir.offsetWidth;
  const maximo = window.scrollX + document.documentElement.clientWidth - ancho - 8;
  menuCompartir.style.top = `${window.scrollY + r.bottom + 4}px`;
  menuCompartir.style.left = `${Math.max(8, Math.min(window.scrollX + r.left, maximo))}px`;

  menuCompartir.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-copiar]')) {
      try {
        await navigator.clipboard.writeText(url);
        avisar(T('compartir.copiado'));
      } catch (err) {
        // Sin permiso para el portapapeles, al menos se muestra el enlace.
        avisar(url);
      }
    }
    // Se cierra después: sacar el enlace en medio de su propio clic puede
    // dejar la pestaña nueva sin abrir.
    setTimeout(cerrarCompartir, 0);
  });
}

// Va sólo en el perfil. En cada pío sería el mismo adorno cien veces por
// pantalla, y lo que se pidió fue un sitio que no canse de leer.
function medallita(medalla) {
  if (!medalla) return '';
  const nombre = T(`medalla.${medalla.clave}`);
  const detalle = T('medalla.detalle', { nombre, desde: medalla.desde });
  return ` <span class="medalla" title="${escapar(detalle)}" aria-label="${escapar(detalle)}">${medalla.figura}</span>`;
}

function filaUsuario(perfil) {
  return `
    <div class="sugerencia">
      <a href="#/u/${escapar(perfil.usuario)}">${avatar(perfil.usuario, 'chico', perfil.avatar)}</a>
      <a class="crece" href="#/u/${escapar(perfil.usuario)}">
        <b>${escapar(perfil.nombre)}</b><span>@${escapar(perfil.usuario)}</span>
      </a>
      ${perfil.soyYo ? '' : `<button class="boton ${perfil.loSigo ? 'fantasma' : 'principal'}" data-seguir="${escapar(perfil.usuario)}">${escapar(T(perfil.loSigo ? 'perfil.siguiendoYa' : 'perfil.seguir'))}</button>`}
    </div>`;
}

// --- interacción sobre los píos -------------------------------------------

document.body.addEventListener('click', async (ev) => {
  const alCorral = ev.target.closest('[data-corral]');
  if (alCorral) {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      const { corral } = await api(`/corrales/${encodeURIComponent(alCorral.dataset.corral)}/seguir`, { metodo: 'POST' });
      avisar(T(corral.estoy ? 'corral.adentro' : 'corral.salir'));
      pintarCorralSeguido(corral);
    } catch (err) { avisar(err.message); }
    return;
  }

  const elegido = ev.target.closest('[data-gif]');
  if (elegido) {
    ev.preventDefault();
    const g = gifsEnPantalla[Number(elegido.dataset.gif)];
    if (g) {
      adjunto = { url: g.url, miniatura: g.miniatura, ancho: g.ancho, alto: g.alto, texto: g.titulo };
      pintarAdjunto();
      actualizarMedidor();
    }
    $('#tablero-gif').hidden = true;
    return;
  }

  if (ev.target.closest('[data-quitar-adjunto]')) {
    ev.preventDefault();
    adjunto = null;
    pintarAdjunto();
    actualizarMedidor();
    return;
  }

  const pliegue = ev.target.closest('[data-plegar]');
  if (pliegue) {
    ev.preventDefault();
    ev.stopPropagation();
    const id = pliegue.dataset.plegar;
    if (plegadas.has(id)) plegadas.delete(id);
    else plegadas.add(id);
    pintarCascada();
    return;
  }

  const otroIdioma = ev.target.closest('[data-idioma]');
  if (otroIdioma) {
    ev.preventDefault();
    cambiarIdioma(otroIdioma.dataset.idioma);
    return;
  }

  if (ev.target.closest('[data-responder-pregunta]') && preguntaDeHoy) {
    ev.preventDefault();
    abrirDialogo(null, preguntaDeHoy);
    return;
  }

  const verEtiquetas = ev.target.closest('[data-ver-etiquetas]');
  if (verEtiquetas) {
    ev.preventDefault();
    ev.stopPropagation();
    verEtiquetas.closest('.marco').classList.toggle('con-etiquetas');
    return;
  }

  const bloquear = ev.target.closest('[data-bloquear]');
  if (bloquear) {
    ev.preventDefault();
    ev.stopPropagation();
    if (menuBloqueo) cerrarMenuBloqueo();
    else abrirMenuBloqueo(bloquear);
    return;
  }

  // "Ver igual": se aclara sólo ese pío, sólo mientras está en pantalla.
  const verBloqueado = ev.target.closest('[data-ver-bloqueado]');
  if (verBloqueado) {
    ev.preventDefault();
    ev.stopPropagation();
    const articulo = verBloqueado.closest('.pio');
    articulo.classList.remove('borroso');
    verBloqueado.closest('.bloqueo-aviso').remove();
    return;
  }

  const silenciar = ev.target.closest('[data-silenciar]');
  if (silenciar) {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      const { perfil } = await api(`/usuarios/${encodeURIComponent(silenciar.dataset.silenciar)}/silenciar`, { metodo: 'POST' });
      avisar(T(perfil.loSilencio ? 'toast.silenciado' : 'toast.sinSilencio', { usuario: perfil.usuario }));
      pintarSilencio(perfil);
    } catch (err) { avisar(err.message); }
    return;
  }

  const seguir = ev.target.closest('[data-seguir]');
  if (seguir) {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      const { perfil } = await api(`/usuarios/${encodeURIComponent(seguir.dataset.seguir)}/seguir`, { metodo: 'POST' });
      avisar(T(perfil.loSigo ? 'toast.sigue' : 'toast.noSigue', { usuario: perfil.usuario }));
      pintarSeguir(perfil);
    } catch (err) { avisar(err.message); }
    return;
  }

  const accion = ev.target.closest('[data-accion]');
  const articulo = ev.target.closest('.pio');
  if (accion && articulo) {
    ev.preventDefault();
    ev.stopPropagation();
    const id = articulo.dataset.id;
    if (accion.dataset.accion === 'compartir') { abrirCompartir(accion, id); return; }

    // Me gusta y repío no vuelven a dibujar la vista: cambia el botón y nada
    // más. Se marca al instante y después se acomoda con lo que dice el
    // servidor; si falla, vuelve a como estaba.
    if (accion.dataset.accion === 'megusta' || accion.dataset.accion === 'repio') {
      const tipo = accion.dataset.accion;
      const encender = !accion.classList.contains('activa');
      marcarAccion(id, tipo, encender);
      try {
        const { pio } = await api(`/pios/${encodeURIComponent(id)}/${tipo}`, { metodo: 'POST' });
        pintarAccionesDe(pio);
      } catch (err) {
        marcarAccion(id, tipo, !encender);
        avisar(err.message);
      }
      return;
    }

    try {
      if (accion.dataset.accion === 'responder') { abrirDialogo(id); return; }
      else if (accion.dataset.accion === 'borrar') {
        const comoAdmin = 'comoAdmin' in accion.dataset;
        if (!confirm(T(comoAdmin ? 'admin.seguro.pio' : 'confirmar.borrar'))) return;
        await api(comoAdmin ? `/admin/pios/${encodeURIComponent(id)}` : `/pios/${id}`, { metodo: 'DELETE' });
        avisar(T('toast.borrado'));
        // Si se borró el pío que se estaba mirando, no queda nada que mirar.
        if (location.hash.startsWith(`#/p/${id}`)) { history.back(); return; }
        await sacarPio(id);
      }
    } catch (err) { avisar(err.message); }
    return;
  }

  const fila = ev.target.closest('[data-ir]');
  if (fila && !ev.target.closest('a')) {
    location.hash = fila.dataset.ir;
    return;
  }

  if (articulo && articulo.dataset.id && articulo.classList.contains('comentario')
      && !ev.target.closest('a, button')) {
    if (articulo.classList.contains('resaltado')) return;
    quedarseQuieto = window.scrollY;
    location.hash = `#/p/${articulo.dataset.id}`;
    return;
  }

  if (articulo && articulo.dataset.id && !ev.target.closest('a')
      && !articulo.classList.contains('destacado') && !articulo.classList.contains('comentario')) {
    location.hash = `#/p/${articulo.dataset.id}`;
  }
});

// --- código de recuperación y clave ---------------------------------------

// Se muestra una sola vez, al crearse la cuenta o al recuperarla. De ahí en
// más el servidor sólo tiene su hash y nadie lo puede volver a ver.
function mostrarCodigo(codigo, clave) {
  $('#codigo-texto').textContent = codigo;
  const explica = $('#dialogo-codigo [data-t="codigo.explica"]');
  if (explica) explica.textContent = T(clave || 'codigo.explica');
  $('#dialogo-codigo').showModal();
}

// Las cuentas creadas antes de que existieran los códigos no tienen ninguno.
// Nadie hace lo que no sabe que tiene que hacer, así que se le da al entrar en
// vez de esperar a que lo busque en el perfil.
async function codigoSiFalta() {
  if (!estado.yo || estado.yo.tieneClave !== true || estado.yo.tieneCodigo !== false) return;
  try {
    const { recuperacion } = await api('/yo/codigo', { metodo: 'POST' });
    estado.yo.tieneCodigo = true;
    mostrarCodigo(recuperacion, 'codigo.viejo');
  } catch (err) {
    /* si falla, queda el botón del perfil */
  }
}

$('#cerrar-codigo').addEventListener('click', () => $('#dialogo-codigo').close());

$('#copiar-codigo').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#codigo-texto').textContent);
    avisar(T('codigo.copiado'));
  } catch (err) {
    // Sin permiso de portapapeles queda seleccionable a mano, que para eso
    // el recuadro tiene user-select: all.
  }
});

function abrirClave() {
  const forma = $('#forma-clave');
  forma.reset();
  // Una cuenta de Google todavía no tiene clave: no hay actual que pedirle.
  $('#campo-actual').hidden = estado.yo.tieneClave === false;
  $('#error-clave').hidden = true;
  $('#dialogo-clave').showModal();
}

$('#cerrar-clave').addEventListener('click', () => $('#dialogo-clave').close());

$('#forma-clave').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const forma = ev.target;
  const error = $('#error-clave');
  const enviar = forma.querySelector('button[type=submit]');
  if (enviar.disabled) return;
  enviar.disabled = true;
  error.hidden = true;
  try {
    const datos = await api('/yo/clave', {
      metodo: 'POST',
      cuerpo: { actual: forma.actual.value, nueva: forma.nueva.value },
    });
    $('#dialogo-clave').close();
    estado.yo.tieneClave = true;
    estado.yo.tieneCodigo = true;
    avisar(T('clave.lista'));
    if (datos.recuperacion) mostrarCodigo(datos.recuperacion);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    enviar.disabled = false;
  }
});

$('#pedir-codigo').addEventListener('click', async () => {
  const error = $('#error-clave');
  error.hidden = true;
  try {
    const { recuperacion } = await api('/yo/codigo', { metodo: 'POST' });
    $('#dialogo-clave').close();
    avisar(T('codigo.nuevo'));
    mostrarCodigo(recuperacion);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

// --- nombres de usuario ---------------------------------------------------

// El servidor sólo acepta [a-z0-9_] de 3 a 15. En vez de rechazar lo que
// escribe la gente, se arregla mientras escribe: "Sergio Pérez" se vuelve
// "sergio_perez" sola. Antes esto era un pattern del HTML, y un valor que no
// encajaba frenaba el formulario ENTERO con un globito del navegador fácil de
// no ver: no se guardaba el usuario, ni el nombre, ni la bio.
function aUsuario(crudo) {
  return String(crudo == null ? '' : crudo)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // fuera los acentos
    .toLowerCase()
    .replace(/[\s.-]+/g, '_')                          // espacios y guiones
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^_+/, '')
    .slice(0, 15)
    .replace(/_+$/, '');
}

for (const campo of document.querySelectorAll('[data-usuario]')) {
  campo.addEventListener('input', () => {
    const arreglado = aUsuario(campo.value);
    if (arreglado === campo.value) return;
    // Se conserva dónde estaba el cursor, contando lo que se cayó por el camino.
    const donde = campo.selectionStart - (campo.value.length - arreglado.length);
    campo.value = arreglado;
    try { campo.setSelectionRange(donde, donde); } catch (err) { /* da igual */ }
  });
}

// --- acortar direcciones --------------------------------------------------

// Se deja fuera el < > " ' para no tragarse el HTML de alrededor si alguna vez
// esto corre sobre texto ya marcado.
const RE_ENLACE = /https?:\/\/[^\s<>"']+/g;

function enlacesDe(texto) {
  const hallados = (String(texto).match(RE_ENLACE) || [])
    // La puntuación del final de la frase no es parte de la dirección.
    .map((u) => u.replace(/[.,;:!?)\]]+$/, ''))
    .filter((u) => {
      try {
        // Acortar lo que ya está corto sería alargar la cadena de saltos.
        return !/(^|\.)is\.gd$/.test(new URL(u).hostname);
      } catch (err) {
        return false;
      }
    });
  return [...new Set(hallados)];
}

async function acortarEnlaces() {
  const boton = $('#acortar-enlaces');
  if (boton.disabled) return;

  const largas = enlacesDe(areaTexto.value);
  if (!largas.length) {
    avisar(T('enlace.ninguna'));
    return;
  }

  const error = $('#error-pio');
  error.hidden = true;
  boton.disabled = true;
  avisar(T('enlace.acortando'));

  let texto = areaTexto.value;
  let hechas = 0;
  try {
    for (const larga of largas) {
      const { corta } = await api('/acortar', { metodo: 'POST', cuerpo: { url: larga } });
      texto = texto.split(larga).join(corta);
      hechas += 1;
    }
    areaTexto.value = texto;
    actualizarMedidor();
    avisar(T('enlace.listo', { n: hechas }));
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    // Lo que ya se acortó no se pierde porque una de las siguientes falle.
    if (hechas) {
      areaTexto.value = texto;
      actualizarMedidor();
    }
  } finally {
    boton.disabled = false;
  }
}

$('#acortar-enlaces').addEventListener('click', acortarEnlaces);

// --- adjuntos -------------------------------------------------------------

// Lo que va colgado del pío que se está escribiendo. Uno solo: un pío de cien
// caracteres con una galería adentro deja de ser un pío.
let adjunto = null;
let gifsEnPantalla = [];

function pintarAdjunto() {
  const caja = $('#adjunto-vista');
  if (!adjunto) {
    caja.hidden = true;
    caja.innerHTML = '';
    return;
  }
  caja.hidden = false;
  if (adjunto.tipo === 'spotify') {
    caja.innerHTML = `
      ${reproductorSpotify(adjunto)}
      <button type="button" class="icono quitar" data-quitar-adjunto
              title="${escapar(T('adjunto.quitar'))}">✕</button>`;
    return;
  }
  const etiquetas = adjunto.etiquetas || [];
  caja.innerHTML = `
    <span class="marco con-etiquetas">
      <img src="${escapar(adjunto.miniatura || adjunto.url)}" alt="" data-etiquetar-foto>
      ${etiquetas.map((e, i) => `
        <span class="etiqueta-foto" style="left:${e.x * 100}%;top:${e.y * 100}%">
          @${escapar(e.usuario)}
          <button type="button" data-quitar-etiqueta="${i}" title="${escapar(T('adjunto.quitar'))}">✕</button>
        </span>`).join('')}
      <button type="button" class="icono quitar" data-quitar-adjunto
              title="${escapar(T('adjunto.quitar'))}">✕</button>
    </span>
    <p class="chico pista-etiquetar">${escapar(T(etiquetas.length >= ETIQUETAS_MAXIMAS ? 'foto.llena' : 'foto.pista'))}</p>
    <input class="alt" id="alt-adjunto" maxlength="100"
           placeholder="${escapar(T('adjunto.alt'))}" value="${escapar(adjunto.texto || '')}">`;
}

// --- etiquetar en la foto -----------------------------------------------------

const ETIQUETAS_MAXIMAS = 10;

// Antes de volver a dibujar se guarda lo escrito en el texto alternativo: si
// no, poner una etiqueta borraría la descripción de la foto.
function redibujarAdjunto() {
  const alt = $('#alt-adjunto');
  if (alt && adjunto) adjunto.texto = alt.value;
  pintarAdjunto();
}

$('#adjunto-vista').addEventListener('click', (ev) => {
  const quitar = ev.target.closest('[data-quitar-etiqueta]');
  if (quitar) {
    ev.preventDefault();
    adjunto.etiquetas.splice(Number(quitar.dataset.quitarEtiqueta), 1);
    redibujarAdjunto();
    return;
  }

  const foto = ev.target.closest('[data-etiquetar-foto]');
  if (!foto || !adjunto || adjunto.tipo === 'spotify') return;
  if ((adjunto.etiquetas || []).length >= ETIQUETAS_MAXIMAS) return;

  const r = foto.getBoundingClientRect();
  const x = (ev.clientX - r.left) / r.width;
  const y = (ev.clientY - r.top) / r.height;
  const marco = foto.closest('.marco');
  const viejo = marco.querySelector('.etiquetar');
  if (viejo) viejo.remove();

  marco.insertAdjacentHTML('beforeend', `
    <span class="etiquetar" style="left:${x * 100}%;top:${y * 100}%">
      <input type="text" autocomplete="off" maxlength="16" placeholder="${escapar(T('foto.quien'))}">
    </span>`);
  const campo = marco.querySelector('.etiquetar input');
  campo.focus();

  const cerrar = () => { const e = marco.querySelector('.etiquetar'); if (e) e.remove(); };
  campo.addEventListener('keydown', async (tecla) => {
    if (tecla.key === 'Escape') { tecla.preventDefault(); tecla.stopPropagation(); cerrar(); return; }
    // Enter dentro del diálogo publicaría el pío.
    if (tecla.key !== 'Enter') return;
    tecla.preventDefault();
    const usuario = aUsuario(campo.value.replace(/^@/, ''));
    if (!usuario) { cerrar(); return; }
    try {
      const { perfil } = await api(`/usuarios/${encodeURIComponent(usuario)}`);
      adjunto.etiquetas = (adjunto.etiquetas || []).filter((e) => e.usuario !== perfil.usuario);
      adjunto.etiquetas.push({ usuario: perfil.usuario, x, y });
      redibujarAdjunto();
    } catch (err) {
      campo.value = '';
      campo.placeholder = T('foto.noexiste');
    }
  });
  campo.addEventListener('blur', () => setTimeout(cerrar, 150));
});

function leerComoBase64(archivo) {
  return new Promise((listo, falla) => {
    const lector = new FileReader();
    lector.onload = () => listo(String(lector.result));
    lector.onerror = () => falla(new Error(T('error.generico')));
    lector.readAsDataURL(archivo);
  });
}

$('#poner-imagen').addEventListener('click', () => $('#archivo-imagen').click());

$('#archivo-imagen').addEventListener('change', async (ev) => {
  const archivo = ev.target.files && ev.target.files[0];
  // Se limpia enseguida: si no, elegir dos veces el mismo archivo no dispara
  // nada la segunda vez.
  ev.target.value = '';
  if (!archivo) return;

  const error = $('#error-pio');
  error.hidden = true;
  // Se corta acá antes de subir cinco megas para que el servidor los rechace.
  if (archivo.size > 5 * 1024 * 1024) {
    error.textContent = T('adjunto.pesada');
    error.hidden = false;
    return;
  }

  avisar(T('adjunto.subiendo'));
  try {
    const { imagen } = await api('/imagenes', {
      metodo: 'POST',
      cuerpo: { imagen: await leerComoBase64(archivo) },
    });
    adjunto = imagen;
    pintarAdjunto();
    actualizarMedidor();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

let temporizadorGif = null;

$('#poner-gif').addEventListener('click', async () => {
  const tablero = $('#tablero-gif');
  tablero.hidden = !tablero.hidden;
  if (tablero.hidden) return;
  $('#gif-consulta').focus();
  await buscarGifs('');
});

$('#gif-consulta').addEventListener('input', () => {
  clearTimeout(temporizadorGif);
  temporizadorGif = setTimeout(() => buscarGifs($('#gif-consulta').value.trim()), 300);
});

async function buscarGifs(consulta) {
  const caja = $('#gif-resultados');
  caja.innerHTML = `<p class="chico">${escapar(T('cargando'))}</p>`;
  try {
    const { gifs } = await api(`/gifs?q=${encodeURIComponent(consulta)}`);
    gifsEnPantalla = gifs;
    caja.innerHTML = gifs.length
      ? gifs.map((g, i) => `
          <button type="button" class="gif" data-gif="${i}">
            <img src="${escapar(g.miniatura)}" alt="${escapar(g.titulo)}">
          </button>`).join('')
      : `<p class="chico">${escapar(T('gif.vacio'))}</p>`;
  } catch (err) {
    caja.innerHTML = `<p class="chico">${escapar(err.message)}</p>`;
  }
}

// --- editar el perfil -----------------------------------------------------

// undefined: no se tocó la foto. null: se quitó. Texto: la nueva.
let avatarPendiente;

function pintarAvatarVista() {
  const url = avatarPendiente === undefined ? estado.yo.avatar : avatarPendiente;
  $('#avatar-vista').innerHTML = avatar(estado.yo.usuario, 'grande', url);
  $('#quitar-avatar').hidden = !url;
}

$('#cambiar-avatar').addEventListener('click', () => $('#archivo-avatar').click());
$('#quitar-avatar').addEventListener('click', () => {
  avatarPendiente = null;
  pintarAvatarVista();
});

$('#archivo-avatar').addEventListener('change', async (ev) => {
  const archivo = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!archivo) return;
  const error = $('#error-perfil');
  error.hidden = true;
  if (archivo.size > 5 * 1024 * 1024) {
    error.textContent = T('adjunto.pesada');
    error.hidden = false;
    return;
  }
  const boton = $('#cambiar-avatar');
  boton.disabled = true;
  boton.textContent = T('adjunto.subiendo');
  try {
    const { imagen } = await api('/imagenes', {
      metodo: 'POST',
      cuerpo: { imagen: await leerComoBase64(archivo) },
    });
    // La miniatura alcanza de sobra para un círculo de setenta píxeles.
    avatarPendiente = imagen.miniatura || imagen.url;
    pintarAvatarVista();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    boton.disabled = false;
    boton.textContent = T('perfil.cambiarFoto');
  }
});

function abrirPerfil() {
  const forma = $('#forma-perfil');
  avatarPendiente = undefined;
  pintarAvatarVista();
  forma.usuario.value = estado.yo.usuario;
  forma.nombre.value = estado.yo.nombre;
  forma.bio.value = estado.yo.bio || '';

  // El servidor dice si se puede; acá sólo se obedece.
  const puede = estado.yo.puedeCambiarUsuario !== false;
  forma.usuario.disabled = !puede;
  $('#aviso-usuario').textContent = T(puede ? 'perfil.usuarioEspera' : 'perfil.usuarioTrabado');

  $('#error-perfil').hidden = true;
  $('#dialogo-perfil').showModal();
}

$('#cerrar-perfil').addEventListener('click', () => $('#dialogo-perfil').close());

$('#forma-perfil').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const forma = ev.target;
  const error = $('#error-perfil');
  const enviar = forma.querySelector('button[type=submit]');
  if (enviar.disabled) return;
  enviar.disabled = true;
  error.hidden = true;

  const cuerpo = { nombre: forma.nombre.value, bio: forma.bio.value };
  if (avatarPendiente !== undefined) cuerpo.avatar = avatarPendiente;
  // El usuario sólo viaja si de verdad cambió: mandarlo igual gastaría el
  // cambio de los treinta días sin que nadie lo haya pedido.
  if (!forma.usuario.disabled) {
    const pedido = aUsuario(forma.usuario.value);
    if (pedido !== estado.yo.usuario) {
      if (pedido.length < 3) {
        error.textContent = TErrorClave('usuario.corto');
        error.hidden = false;
        enviar.disabled = false;
        return;
      }
      cuerpo.usuario = pedido;
    }
  }

  try {
    const { yo } = await api('/yo', { metodo: 'PATCH', cuerpo });
    estado.yo = yo;
    $('#dialogo-perfil').close();
    avisar(T('perfil.guardado'));
    pintarYoLateral();
    // Si ya se estaba en el perfil propio, se vuelve a armar sólo esa vista;
    // si cambió el nombre, la dirección cambia y la navegación hace el resto.
    const destino = `#/u/${yo.usuario}`;
    if (location.hash.split('?')[0] === destino) await vistaPerfil(yo.usuario, rutaActual().params.get('ver') || 'pios');
    else location.hash = destino;
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    enviar.disabled = false;
  }
});

// --- diálogo de piar ------------------------------------------------------

const dialogo = $('#dialogo-piar');
const areaTexto = $('#texto-pio');

function abrirDialogo(respuestaA = null, pregunta = null) {
  cerrarMenciones();
  estado.respondiendoA = respuestaA;
  estado.pregunta = respuestaA ? null : pregunta;
  $('#dialogo-titulo').textContent = T(respuestaA ? 'dialogo.respuesta' : (estado.pregunta ? 'dialogo.pregunta' : 'dialogo.nuevo'));
  $('#dialogo-contexto').hidden = !respuestaA && !estado.pregunta;
  $('#dialogo-contexto').textContent = respuestaA
    ? T('dialogo.contexto')
    : (estado.pregunta ? textoPregunta(estado.pregunta) : '');
  areaTexto.value = '';
  adjunto = null;
  pintarAdjunto();
  $('#tablero-gif').hidden = true;
  $('#error-pio').hidden = true;
  actualizarMedidor();
  dialogo.showModal();
  areaTexto.focus();
}

function actualizarMedidor() {
  const usados = largo(areaTexto.value);
  const restantes = LIMITE - usados;
  const medidor = $('#medidor');
  const circunferencia = 2 * Math.PI * 15.5;

  $('#restantes').textContent = restantes <= 20 ? restantes : usados;
  $('.anillo-frente').style.strokeDashoffset =
    String(circunferencia * (1 - Math.min(usados / LIMITE, 1)));

  medidor.classList.toggle('aviso', restantes <= 20 && restantes >= 0);
  medidor.classList.toggle('pasado', restantes < 0);
  // Con una imagen colgada, un pío sin texto sigue siendo un pío.
  $('#enviar-pio').disabled = (usados === 0 && !adjunto) || restantes < 0;
}

areaTexto.addEventListener('input', () => {
  if (spotifyDelTexto()) avisar(T('spotify.puesto'));
  actualizarMedidor();
});

$('#poner-spotify').addEventListener('click', () => {
  avisar(T('spotify.como'));
  areaTexto.focus();
});
areaTexto.addEventListener('keydown', (ev) => {
  if (manejarTeclaMencion(ev)) return;
  if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') $('#forma-piar').requestSubmit();
});

// --- etiquetar a otro pollito --------------------------------------------------

// Al escribir @ y algunas letras aparecen las cuentas que coinciden; se elige
// con el dedo, con las flechas o con Enter, y queda @usuario en el texto. La
// mención es la de siempre: avisa a quien se nombra.
const cajaMenciones = $('#menciones');
let sugeridas = [];
let elegida = 0;
let pedidoMencion = 0;
let esperaMencion = null;

// La @ que se está escribiendo justo antes del cursor, si hay una.
function mencionEnCurso() {
  const antes = areaTexto.value.slice(0, areaTexto.selectionStart);
  const m = /(^|[^\w@])@([a-zA-Z0-9_]{0,15})$/.exec(antes);
  return m ? { desde: antes.length - m[2].length - 1, texto: m[2] } : null;
}

function cerrarMenciones() {
  cajaMenciones.hidden = true;
  cajaMenciones.innerHTML = '';
  sugeridas = [];
}

function pintarMenciones(vacia) {
  cajaMenciones.hidden = false;
  if (!sugeridas.length) {
    cajaMenciones.innerHTML = `<p class="chico">${escapar(T(vacia ? 'mencion.escribe' : 'mencion.nadie'))}</p>`;
    return;
  }
  cajaMenciones.innerHTML = sugeridas.map((u, i) => `
    <button type="button" class="mencion-opcion ${i === elegida ? 'elegida' : ''}" data-mencionar="${escapar(u.usuario)}">
      ${avatar(u.usuario, 'mini', u.avatar)}
      <b>${escapar(u.nombre)}</b><span>@${escapar(u.usuario)}</span>
    </button>`).join('');
}

function buscarMenciones() {
  const enCurso = mencionEnCurso();
  if (!enCurso) { cerrarMenciones(); return; }
  clearTimeout(esperaMencion);
  if (!enCurso.texto) { sugeridas = []; pintarMenciones(true); return; }
  // Sin preguntar por cada letra, y sin pintar una respuesta vieja encima de
  // una nueva si llegan desordenadas.
  esperaMencion = setTimeout(async () => {
    const yo = ++pedidoMencion;
    try {
      const { usuarios } = await api(`/buscar?q=${encodeURIComponent(enCurso.texto)}`);
      if (yo !== pedidoMencion || !mencionEnCurso()) return;
      sugeridas = usuarios.filter((u) => !u.soyYo).slice(0, 5);
      elegida = 0;
      pintarMenciones(false);
    } catch { cerrarMenciones(); }
  }, 150);
}

function mencionar(usuario) {
  const enCurso = mencionEnCurso();
  if (!enCurso) return;
  const antes = areaTexto.value.slice(0, enCurso.desde);
  const despues = areaTexto.value.slice(areaTexto.selectionStart).replace(/^\S*/, '');
  const puesto = `@${usuario} `;
  areaTexto.value = antes + puesto + despues.replace(/^ /, '');
  const cursor = antes.length + puesto.length;
  areaTexto.setSelectionRange(cursor, cursor);
  cerrarMenciones();
  areaTexto.focus();
  actualizarMedidor();
}

function manejarTeclaMencion(ev) {
  if (cajaMenciones.hidden || !sugeridas.length) {
    if (ev.key === 'Escape' && !cajaMenciones.hidden) { ev.preventDefault(); ev.stopPropagation(); cerrarMenciones(); return true; }
    return false;
  }
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    elegida = (elegida + (ev.key === 'ArrowDown' ? 1 : -1) + sugeridas.length) % sugeridas.length;
    pintarMenciones(false);
    return true;
  }
  if ((ev.key === 'Enter' && !ev.ctrlKey && !ev.metaKey) || ev.key === 'Tab') {
    ev.preventDefault();
    mencionar(sugeridas[elegida].usuario);
    return true;
  }
  if (ev.key === 'Escape') {
    // Cierra la lista, no el diálogo entero.
    ev.preventDefault();
    ev.stopPropagation();
    cerrarMenciones();
    return true;
  }
  return false;
}

areaTexto.addEventListener('input', buscarMenciones);
areaTexto.addEventListener('click', buscarMenciones);
cajaMenciones.addEventListener('mousedown', (ev) => {
  // mousedown y no click: con click, el textarea pierde el foco primero y la
  // lista se cierra antes de que llegue el toque.
  const opcion = ev.target.closest('[data-mencionar]');
  if (!opcion) return;
  ev.preventDefault();
  mencionar(opcion.dataset.mencionar);
});
areaTexto.addEventListener('blur', () => setTimeout(() => {
  if (document.activeElement !== areaTexto) cerrarMenciones();
}, 150));

// El botón @ pone la arroba donde está el cursor y abre la lista.
$('#poner-mencion').addEventListener('click', () => {
  const inicio = areaTexto.selectionStart ?? areaTexto.value.length;
  const antes = areaTexto.value.slice(0, inicio);
  const hueco = antes && !/\s$/.test(antes) ? ' ' : '';
  areaTexto.value = antes + hueco + '@' + areaTexto.value.slice(inicio);
  const cursor = antes.length + hueco.length + 1;
  areaTexto.focus();
  areaTexto.setSelectionRange(cursor, cursor);
  actualizarMedidor();
  buscarMenciones();
});

$('#cerrar-dialogo').addEventListener('click', () => dialogo.close());
$('#piar-lateral').addEventListener('click', () => abrirDialogo());
$('#piar-flotante').addEventListener('click', () => abrirDialogo());

$('#forma-piar').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const error = $('#error-pio');
  error.hidden = true;
  try {
    const alt = $('#alt-adjunto');
    const borrador = {
      texto: areaTexto.value,
      respuestaA: estado.respondiendoA,
      corral: estado.pregunta ? null : corralActual,
      pregunta: estado.pregunta || null,
      adjunto: adjunto ? Object.assign({}, adjunto, { texto: alt ? alt.value : '' }) : null,
    };
    const { pio } = await api('/pios', {
      metodo: 'POST', cuerpo: Object.assign({}, borrador, { pregunta: !!borrador.pregunta }),
    });
    dialogo.close();
    if (pio.huevo) {
      borradores.set(pio.id, borrador);
      mostrarHuevo(pio);
    } else {
      avisar(T(borrador.respuestaA ? 'toast.respuesta' : 'toast.pio'));
    }
    await mostrarPioNuevo(pio);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

// --- actualizar sólo lo que cambió ---------------------------------------------

// Cada acción devuelve lo que quedó —el perfil, el corral— y con eso se
// retocan sus botones y cifras donde sea que estén en pantalla: en la
// cabecera del perfil, en "a quién seguir", en una búsqueda. El resto de la
// vista no se toca.
const conDato = (atributo, valor) => document.querySelectorAll(`[${atributo}="${CSS.escape(valor)}"]`);

function pintarSeguir(perfil) {
  for (const boton of conDato('data-seguir', perfil.usuario)) {
    boton.classList.toggle('fantasma', perfil.loSigo);
    boton.classList.toggle('principal', !perfil.loSigo);
    boton.textContent = T(perfil.loSigo ? 'perfil.siguiendoYa' : 'perfil.seguir');
  }
  for (const cifra of conDato('data-seguidores-de', perfil.usuario)) cifra.textContent = perfil.seguidores;
}

function pintarSilencio(perfil) {
  for (const boton of conDato('data-silenciar', perfil.usuario)) {
    boton.title = T(perfil.loSilencio ? 'perfil.quitarSilencio' : 'perfil.silenciar');
    boton.textContent = `${perfil.loSilencio ? '🔇' : '🔈'} ${T(perfil.loSilencio ? 'perfil.silenciado' : 'perfil.silenciar')}`;
  }
}

function pintarBloqueo(perfil) {
  const hasta = perfil.bloqueadoHasta;
  for (const boton of conDato('data-bloquear', perfil.usuario)) {
    boton.dataset.hasta = hasta || '';
    boton.textContent = `⛔ ${hasta ? T('bloqueo.hasta', { fecha: fechaBloqueo(hasta) }) : T('bloqueo.boton')}`;
  }
  // Sus píos a la vista se nublan o se aclaran ahí mismo.
  for (const pio of conDato('data-autor', perfil.usuario)) {
    const viejo = pio.querySelector(':scope > .bloqueo-aviso');
    if (viejo) viejo.remove();
    pio.classList.toggle('borroso', !!hasta);
    if (hasta) pio.insertAdjacentHTML('afterbegin', avisoBloqueo({ autor: { usuario: perfil.usuario }, bloqueadoHasta: hasta }));
  }
}

function pintarCorralSeguido(corral) {
  for (const boton of conDato('data-corral', corral.nombre)) {
    boton.classList.toggle('fantasma', corral.estoy);
    boton.classList.toggle('principal', !corral.estoy);
    boton.textContent = T(corral.estoy ? 'corral.salir' : 'corral.entrar');
  }
  for (const cifra of conDato('data-suscritos-de', corral.nombre)) cifra.textContent = corral.suscritos;
  // En el chat, entrar o salir cambia si se puede escribir: se rearma sólo
  // esa parte.
  const { partes, params } = rutaActual();
  if (partes[0] === 'c' && partes[1] === corral.nombre && params.get('ver') === 'chat' && $('#abajo-corral')) {
    pintarChat(corral, $('#abajo-corral'));
  }
}

// --- entrar y salir con suavidad ------------------------------------------------

const sinMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// El bloque crece desde alto cero hasta su alto real, y lo de abajo se corre
// solo, porque el navegador lo acomoda en cada paso. Se anima una envoltura
// sin relleno: la tarjeta tiene padding, y con alto cero igual se vería.
function abrirDeAPoco(envoltura) {
  if (sinMovimiento()) return;
  const alto = envoltura.offsetHeight;
  Object.assign(envoltura.style, { height: '0px', opacity: '0', overflow: 'hidden' });
  envoltura.getBoundingClientRect();
  envoltura.style.transition = 'height .38s cubic-bezier(.2, .8, .2, 1), opacity .45s ease';
  Object.assign(envoltura.style, { height: `${alto}px`, opacity: '1' });
  const listo = (ev) => {
    if (ev.target !== envoltura || ev.propertyName !== 'height') return;
    envoltura.removeEventListener('transitionend', listo);
    envoltura.removeAttribute('style');
  };
  envoltura.addEventListener('transitionend', listo);
  // Red por si la transición no corre —pestaña en segundo plano, ahorro de
  // energía—: el bloque nunca queda aplastado en alto cero.
  setTimeout(() => envoltura.removeAttribute('style'), 700);
}

function cerrarDeAPoco(elemento) {
  return new Promise((listo) => {
    if (sinMovimiento()) { elemento.remove(); listo(); return; }
    Object.assign(elemento.style, { height: `${elemento.offsetHeight}px`, overflow: 'hidden' });
    elemento.getBoundingClientRect();
    elemento.style.transition = 'height .3s ease, opacity .25s ease';
    Object.assign(elemento.style, { height: '0px', opacity: '0' });
    setTimeout(() => { elemento.remove(); listo(); }, 320);
  });
}

// Dónde va a parar un pío recién publicado, según la vista en la que se está.
// Si no tiene lugar acá —por ejemplo, se pió desde un perfil ajeno—, no se
// muestra: aparece donde corresponde cuando se vaya ahí.
function lugarParaPioNuevo(pio) {
  const { partes, params } = rutaActual();
  const vista = partes[0] || 'nido';
  const argumento = partes[1];
  if (vista === 'nido') return { caja: $('#contenido') };
  if (vista === 'plaza' && !pio.corral) return { caja: $('#contenido') };
  if (vista === 'c' && pio.corral === argumento && params.get('ver') !== 'chat' && $('#abajo-corral')) {
    return { caja: $('#abajo-corral'), opciones: { enCorral: true } };
  }
  if (vista === 'u' && argumento === estado.yo.usuario && (params.get('ver') || 'pios') === 'pios') {
    return { caja: $('#contenido') };
  }
  if (vista === 'pregunta' && pio.pregunta) return { caja: $('#contenido'), opciones: { enPregunta: true } };
  return null;
}

let comentarioQueEntra = null;

async function mostrarPioNuevo(pio) {
  const { partes } = rutaActual();

  // En un hilo, la respuesta tiene que caer en su lugar del árbol: se vuelve a
  // armar el árbol sin tocar la pantalla y la respuesta nueva crece ahí.
  if (partes[0] === 'p') {
    comentarioQueEntra = pio.id;
    quedarseQuieto = window.scrollY;
    await vistaHilo(partes[1]);
    return;
  }

  const lugar = lugarParaPioNuevo(pio);
  if (!lugar) return;
  const vacio = lugar.caja.querySelector(':scope > .vacio');
  if (vacio) vacio.remove();
  // Arriba de todo lo que es lista, incluida la marca de "estás al día": lo
  // propio nunca es novedad.
  const primero = lugar.caja.querySelector(':scope > .pio, :scope > .al-dia, :scope > .pie-linea');
  const envoltura = document.createElement('div');
  envoltura.className = 'entrada';
  envoltura.innerHTML = tarjetaPio(pio, lugar.opciones || {});
  envoltura.firstElementChild.classList.add('recien');
  lugar.caja.insertBefore(envoltura, primero);
  abrirDeAPoco(envoltura);
}

async function sacarPio(id) {
  const { partes } = rutaActual();
  if (partes[0] === 'p') {
    quedarseQuieto = window.scrollY;
    await vistaHilo(partes[1]);
    return;
  }
  const copias = [...copiasDe(id)];
  await Promise.all(copias.map((copia) => cerrarDeAPoco(copia.closest('.entrada') || copia)));
}

// --- el huevo -------------------------------------------------------------

// Lo que se escribió, por si hay que devolverlo al deshacer. Sólo vive en esta
// pestaña: una vez que el pío nace ya no sirve para nada.
const borradores = new Map();
let barraHuevo = null;

function mostrarHuevo(pio) {
  if (barraHuevo) barraHuevo.remove();
  barraHuevo = document.createElement('div');
  barraHuevo.className = 'huevo-barra';
  barraHuevo.setAttribute('role', 'status');
  barraHuevo.dataset.nace = String(Date.now() + pio.naceEn);
  barraHuevo.dataset.respuesta = pio.respuestaA ? '1' : '';
  barraHuevo.innerHTML = `
    <span data-cuenta></span>
    <button class="enlace-boton" type="button" data-deshacer="${escapar(pio.id)}">${escapar(T('huevo.deshacer'))}</button>`;
  document.body.appendChild(barraHuevo);
  latirHuevos();
}

// Un solo reloj para todos los huevos en pantalla: la barra y las tarjetas.
function latirHuevos() {
  const ahora = Date.now();
  for (const el of document.querySelectorAll('[data-nace]')) {
    const faltan = Math.ceil((Number(el.dataset.nace) - ahora) / 1000);
    const cuenta = el.querySelector('[data-cuenta]');
    if (faltan > 0) {
      const clave = el === barraHuevo ? (el.dataset.respuesta ? 'huevo.barraRespuesta' : 'huevo.barra') : 'huevo.nace';
      if (cuenta) cuenta.textContent = T(clave, { s: faltan });
      continue;
    }
    if (el === barraHuevo) {
      // Nació: se dice un momento y la barra se va sola.
      el.removeAttribute('data-nace');
      el.innerHTML = `<span>${escapar(T('huevo.nacio'))}</span>`;
      setTimeout(() => { if (barraHuevo === el) { el.remove(); barraHuevo = null; } }, 1600);
    } else {
      const articulo = el.closest('.pio');
      if (articulo) articulo.classList.remove('huevo');
      el.remove();
    }
  }
}
setInterval(latirHuevos, 500);

async function deshacerHuevo(id) {
  const borrador = borradores.get(id);
  try {
    await api(`/pios/${encodeURIComponent(id)}`, { metodo: 'DELETE' });
  } catch (err) {
    avisar(err.message);
    return;
  }
  borradores.delete(id);
  if (barraHuevo) { barraHuevo.remove(); barraHuevo = null; }
  await sacarPio(id);

  // Vuelve al borrador tal como estaba: deshacer es para corregir, y
  // corregir sin el texto sería escribirlo de nuevo.
  if (borrador) {
    abrirDialogo(borrador.respuestaA, borrador.pregunta);
    areaTexto.value = borrador.texto;
    adjunto = borrador.adjunto;
    pintarAdjunto();
    actualizarMedidor();
  }
  avisar(T('huevo.deshecho'));
}

document.addEventListener('click', (ev) => {
  const boton = ev.target.closest('[data-deshacer]');
  if (!boton) return;
  ev.preventDefault();
  ev.stopPropagation();
  deshacerHuevo(boton.dataset.deshacer);
}, true);

// --- columna derecha ------------------------------------------------------

// Las tendencias corren de derecha a izquierda, como la franja de un
// noticiero. La tanda va dos veces seguida y la pista se corre justo media
// vuelta: cuando termina, la segunda tanda está donde empezó la primera y el
// salto no se ve. La velocidad depende del largo, para que se lea igual con
// dos etiquetas que con ocho.
let ultimasTendencias = '';

async function cargarTendencias() {
  try {
    const { tendencias } = await api('/tendencias');
    const firma = JSON.stringify(tendencias);
    // Si no cambió nada no se toca: rearmarla reiniciaría la cinta a la mitad
    // de una lectura, cada vez que se cambia de vista.
    if (firma === ultimasTendencias) return;
    ultimasTendencias = firma;
    const pista = $('#tendencias');
    if (!tendencias.length) {
      pista.classList.remove('corre');
      pista.innerHTML = `<span class="tendencia vacia">${escapar(T('tendencias.vacio'))}</span>`;
      return;
    }
    const tanda = tendencias.map((t) => `
      <a class="tendencia" href="#/e/${encodeURIComponent(t.etiqueta)}">
        <b>#${escapar(t.etiqueta)}</b> <span>${escapar(T('tendencia.pios', { n: t.total }))}</span>
      </a>`).join('<span class="cinta-punto" aria-hidden="true">·</span>');
    pista.innerHTML = `<div class="cinta-tanda">${tanda}</div><div class="cinta-tanda" aria-hidden="true">${tanda}</div>`;
    const ancho = pista.firstElementChild.scrollWidth;
    pista.style.setProperty('--duracion', `${Math.max(12, Math.round(ancho / 45))}s`);
    pista.classList.add('corre');
  } catch { /* la cinta no rompe la vista */ }
}

// El alto de la barra de arriba cambia —en el teléfono tiene dos filas—, y la
// cabecera de cada vista se pega justo debajo: se mide en vez de adivinarlo.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(([entrada]) => {
    document.documentElement.style.setProperty('--alto-barra', `${Math.round(entrada.target.getBoundingClientRect().height)}px`);
  }).observe($('#barra'));
}

async function cargarSugerencias() {
  try {
    const { usuarios } = await api('/buscar?q=');
    const { pios } = await api('/pios?tipo=plaza');
    const candidatos = new Map();
    for (const p of pios) {
      if (p.autor.usuario === estado.yo.usuario) continue;
      candidatos.set(p.autor.usuario, p.autor);
    }
    const lista = [...candidatos.values()].slice(0, 5);
    if (!lista.length) {
      $('#sugerencias').innerHTML = `<p class="chico">${escapar(T('sugerencias.vacio'))}</p>`;
      return;
    }
    const perfiles = await Promise.all(
      lista.map((a) => api(`/usuarios/${encodeURIComponent(a.usuario)}`).then((d) => d.perfil))
    );
    $('#sugerencias').innerHTML = perfiles.filter((p) => !p.loSigo && !p.soyYo).map(filaUsuario).join('')
      || `<p class="chico">${escapar(T('sugerencias.todos'))}</p>`;
    void usuarios;
  } catch { /* idem */ }
}

// --- tema -----------------------------------------------------------------

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  localStorage.setItem('pio.tema', tema);
}

// --- el panel de administración -------------------------------------------

// Todo lo que se hace acá es irreversible, así que todo pasa por una
// pregunta. El `confirm` del navegador es feo, pero es lo único que frena de
// verdad, y frenar es justo lo que se quiere acá.
async function borrarDesdePanel(ruta, pregunta, despues) {
  if (!window.confirm(pregunta)) return;
  try {
    await api(ruta, { metodo: 'DELETE' });
    avisar(T('admin.borrado'));
    await despues();
  } catch (err) {
    avisar(err.message);
  }
}

async function panelResumen(donde) {
  const { resumen } = await api('/admin/resumen');
  const numeros = [
    ['admin.n.usuarios', resumen.usuarios],
    ['admin.n.pios', resumen.pios],
    ['admin.n.corrales', resumen.corrales],
    ['admin.n.mensajes', resumen.mensajes],
    ['admin.n.avisos', resumen.avisos],
    ['admin.n.sesiones', resumen.sesiones],
  ];
  donde.innerHTML = `
    <div class="numeros">
      ${numeros.map(([clave, cuanto]) => `
        <div class="numero"><b>${cuanto}</b><span>${escapar(T(clave))}</span></div>`).join('')}
    </div>
    <p class="chico centrado" style="padding: 0 16px 16px">
      ${escapar(T('admin.deposito'))} <b>${escapar(resumen.deposito)}</b>
    </p>`;
}

async function panelPollitos(donde) {
  const { usuarios } = await api('/admin/usuarios');
  donde.innerHTML = `<div class="tarjeta" style="margin: 12px 16px">${
    usuarios.map((u) => {
      const sellos = [
        u.manda ? T('admin.manda') : '',
        u.porGoogle ? T('admin.porGoogle') : '',
        !u.tieneClave && !u.porGoogle ? T('admin.sinClave') : '',
      ].filter(Boolean);
      return `
        <div class="sugerencia">
          ${avatar(u.usuario, 'chico', u.avatar)}
          <a class="crece" href="#/u/${escapar(u.usuario)}">
            <b>${escapar(u.nombre)}</b>
            <span>@${escapar(u.usuario)} · ${escapar(T('admin.cuentas', { pios: u.pios, seguidores: u.seguidores }))}</span>
          </a>
          ${u.oculto ? `<span class="sello" data-sello-oculto>${escapar(T('admin.ocultoSello'))}</span>` : ''}
          ${sellos.map((s) => `<span class="sello">${escapar(s)}</span>`).join('')}
          <button class="boton fantasma chico" data-ocultar="${escapar(u.usuario)}"
                  title="${escapar(T('admin.ocultarQue'))}">${escapar(T(u.oculto ? 'admin.mostrar' : 'admin.ocultar'))}</button>
          ${u.manda ? '' : `<button class="boton peligro chico" data-borrar-pollito="${escapar(u.usuario)}">${escapar(T('admin.borrar'))}</button>`}
        </div>`;
    }).join('')
  }</div>`;

  for (const boton of donde.querySelectorAll('[data-ocultar]')) {
    const quien = boton.dataset.ocultar;
    boton.addEventListener('click', async () => {
      try {
        const { oculto } = await api(`/admin/ocultos/${encodeURIComponent(quien)}`, { metodo: 'POST' });
        avisar(T(oculto ? 'admin.ocultado' : 'admin.mostrado', { usuario: quien }));
        boton.textContent = T(oculto ? 'admin.mostrar' : 'admin.ocultar');
        const fila = boton.closest('.sugerencia');
        const sello = fila.querySelector('[data-sello-oculto]');
        if (oculto && !sello) {
          fila.querySelector('.crece').insertAdjacentHTML('afterend', `<span class="sello" data-sello-oculto>${escapar(T('admin.ocultoSello'))}</span>`);
        } else if (!oculto && sello) {
          sello.remove();
        }
      } catch (err) {
        avisar(err.message);
      }
    });
  }

  for (const boton of donde.querySelectorAll('[data-borrar-pollito]')) {
    const quien = boton.dataset.borrarPollito;
    boton.addEventListener('click', () => borrarDesdePanel(
      `/admin/usuarios/${encodeURIComponent(quien)}`,
      T('admin.seguro.pollito', { usuario: quien }),
      () => cerrarDeAPoco(boton.closest('.sugerencia')),
    ));
  }
}

function filaPioPanel(p) {
  return `
    <article class="pio quieto">
      ${avatar(p.autor.usuario, '', p.autor.avatar)}
      <div>
        <div class="pio-cabecera">
          <a class="pio-nombre" href="#/u/${escapar(p.autor.usuario)}">${escapar(p.autor.nombre)}</a>
          <span class="pio-usuario">@${escapar(p.autor.usuario)}</span>
          <span class="pio-fecha">· ${hace(p.creado)}</span>
        </div>
        ${p.texto ? `<p class="texto">${enriquecer(p.texto)}</p>` : ''}
        <div class="perfil-botones" style="margin-top: 8px">
          <a class="boton fantasma chico" href="#/p/${escapar(p.id)}">${escapar(T('admin.ver'))}</a>
          <button class="boton peligro chico" data-borrar-pio="${escapar(p.id)}">${escapar(T('admin.borrar'))}</button>
        </div>
      </div>
    </article>`;
}

async function panelPios(donde, busqueda = '') {
  donde.innerHTML = `
    <div class="buscador-panel">
      <input type="search" id="buscar-panel" autocomplete="off"
             placeholder="${escapar(T('admin.buscarPh'))}" value="${escapar(busqueda)}">
      <span class="chico" id="total-panel"></span>
    </div>
    <div id="lista-panel"><div class="cargando">${escapar(T('cargando'))}</div></div>`;

  const campo = $('#buscar-panel');
  const lista = $('#lista-panel');
  let pedido = 0;

  // Se agregan de a cincuenta. `antes` es la fecha del último que se mostró.
  async function traer(antes) {
    const yo = ++pedido;
    const q = campo.value.trim();
    const datos = await api(`/admin/pios?q=${encodeURIComponent(q)}${antes ? `&antes=${antes}` : ''}`);
    // Si mientras tanto se escribió otra cosa, esta respuesta ya no importa.
    if (yo !== pedido) return;
    if (!antes) {
      $('#total-panel').textContent = T('admin.totalPios', { n: datos.total });
      lista.innerHTML = datos.pios.length
        ? ''
        : `<div class="vacio"><span class="emoji">🔍</span>${escapar(T('admin.vacio'))}</div>`;
    }
    const viejoBoton = lista.querySelector('[data-mas-panel]');
    if (viejoBoton) viejoBoton.parentElement.remove();
    lista.insertAdjacentHTML('beforeend', datos.pios.map(filaPioPanel).join(''));
    if (datos.hayMas) {
      const ultimo = datos.pios[datos.pios.length - 1].creado;
      lista.insertAdjacentHTML('beforeend', `<div class="pie-linea"><button class="boton fantasma" type="button" data-mas-panel="${ultimo}">${escapar(T('aldia.mas'))}</button></div>`);
    }
  }

  lista.addEventListener('click', (ev) => {
    const mas = ev.target.closest('[data-mas-panel]');
    if (mas) { mas.disabled = true; traer(Number(mas.dataset.masPanel)).catch((err) => avisar(err.message)); return; }
    const borrar = ev.target.closest('[data-borrar-pio]');
    if (borrar) {
      borrarDesdePanel(
        `/admin/pios/${encodeURIComponent(borrar.dataset.borrarPio)}`,
        T('admin.seguro.pio'),
        async () => { borrar.closest('.pio').remove(); },
      );
    }
  });

  // Se busca mientras se escribe, pero sin preguntar por cada letra.
  let espera = null;
  campo.addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(() => traer(0).catch((err) => avisar(err.message)), 250);
  });

  await traer(0);
  if (busqueda) campo.focus();
}

async function panelCorrales(donde) {
  const { corrales } = await api('/corrales');
  if (!corrales.length) { donde.innerHTML = `<div class="vacio"><span class="emoji">🚜</span>${escapar(T('admin.vacio'))}</div>`; return; }
  donde.innerHTML = `<div class="tarjeta" style="margin: 12px 16px">${
    corrales.map((c) => `
      <div class="sugerencia">
        <a class="crece" href="#/c/${escapar(c.nombre)}">
          <b>${escapar(c.titulo)}</b>
          <span>${escapar(c.nombre)} · ${escapar(T('admin.corralCuentas', { pios: c.pios, suscritos: c.suscritos }))}</span>
        </a>
        <button class="boton peligro chico" data-borrar-corral="${escapar(c.nombre)}">${escapar(T('admin.borrar'))}</button>
      </div>`).join('')
  }</div>`;

  for (const boton of donde.querySelectorAll('[data-borrar-corral]')) {
    const cual = boton.dataset.borrarCorral;
    boton.addEventListener('click', () => borrarDesdePanel(
      `/admin/corrales/${encodeURIComponent(cual)}`,
      T('admin.seguro.corral', { corral: cual }),
      () => cerrarDeAPoco(boton.closest('.sugerencia')),
    ));
  }
}

// El valor de un emoji es un carácter o una dirección. Se decide por lo que
// hay escrito y no con un selector: un campo menos que entender.
function filaEmoji(emoji) {
  const valor = emoji && emoji.url ? emoji.url : ((emoji && emoji.caracter) || '');
  return `
    <div class="fila-emoji">
      <input class="emoji-nombre" maxlength="20" placeholder="${escapar(T('admin.emojis.nombre'))}"
             value="${escapar((emoji && emoji.nombre) || '')}">
      <input class="emoji-valor" placeholder="${escapar(T('admin.emojis.valor'))}" value="${escapar(valor)}">
      <button class="boton fantasma chico" data-quitar-emoji type="button"
              title="${escapar(T('admin.emojis.quitar'))}">✕</button>
    </div>`;
}

async function panelEmojis(donde) {
  const { emojis, defecto } = await api('/admin/emojis');
  const lista = emojis.length ? emojis : defecto;
  donde.innerHTML = `
    <div class="tarjeta" style="margin: 12px 16px">
      <p class="chico">${escapar(T('admin.emojis.como'))}</p>
      ${emojis.length ? '' : `<p class="chico">${escapar(T('admin.emojis.defecto'))}</p>`}
      <div id="filas-emoji">${lista.map(filaEmoji).join('')}</div>
      <div class="perfil-botones" style="margin-top: 12px">
        <button class="boton fantasma" id="mas-emoji" type="button">${escapar(T('admin.emojis.agregar'))}</button>
        <button class="boton principal" id="guardar-emojis" type="button">${escapar(T('admin.emojis.guardar'))}</button>
      </div>
    </div>`;

  const filas = $('#filas-emoji');
  // Una sola escucha para todas las filas: las que se agreguen después ya
  // quedan atendidas sin volver a enganchar nada.
  filas.addEventListener('click', (ev) => {
    const boton = ev.target.closest('[data-quitar-emoji]');
    if (boton) boton.parentElement.remove();
  });
  $('#mas-emoji').addEventListener('click', () => {
    filas.insertAdjacentHTML('beforeend', filaEmoji(null));
    filas.lastElementChild.querySelector('.emoji-nombre').focus();
  });

  $('#guardar-emojis').addEventListener('click', async () => {
    const puestos = [];
    for (const fila of filas.querySelectorAll('.fila-emoji')) {
      const nombre = fila.querySelector('.emoji-nombre').value.trim().toLowerCase();
      const valor = fila.querySelector('.emoji-valor').value.trim();
      if (!nombre || !valor) continue;
      puestos.push(/^https:\/\//i.test(valor) ? { nombre, url: valor } : { nombre, caracter: valor });
    }
    try {
      const { enUso } = await api('/admin/emojis', { metodo: 'PUT', cuerpo: { emojis: puestos } });
      // El sitio entero los usa al escribir un pío: hay que refrescar el mapa
      // acá mismo, si no se siguen viendo los viejos hasta recargar.
      emojisDelSitio = new Map(enUso.map((e) => [e.nombre, e.src]));
      avisar(T('admin.emojis.guardados', { n: enUso.length }));
      await panelEmojis(donde);
    } catch (err) {
      avisar(err.message);
    }
  });
}

const SOLAPAS_PANEL = [
  ['resumen', panelResumen],
  ['pollitos', panelPollitos],
  ['pios', panelPios],
  ['corrales', panelCorrales],
  ['emojis', panelEmojis],
];

async function vistaAdmin(solapa) {
  cabecera(T('admin.titulo'), T('admin.sub'));
  const cual = SOLAPAS_PANEL.some(([n]) => n === solapa) ? solapa : 'resumen';
  $('#contenido').innerHTML = `
    <div class="sub-pestanas muchas">
      ${SOLAPAS_PANEL.map(([nombre]) => `
        <button class="sub-pestana ${nombre === cual ? 'activa' : ''}" data-solapa-panel="${nombre}">${escapar(T(`admin.solapa.${nombre}`))}</button>`).join('')}
    </div>
    <div id="panel"><div class="cargando">${escapar(T('cargando'))}</div></div>`;

  for (const boton of $('#contenido').querySelectorAll('[data-solapa-panel]')) {
    boton.addEventListener('click', () => {
      location.hash = `#/admin?ver=${boton.dataset.solapaPanel}`;
    });
  }

  const dibujar = SOLAPAS_PANEL.find(([nombre]) => nombre === cual)[1];
  await dibujar($('#panel'));
}

function alternarTema() {
  aplicarTema(document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro');
  // El botón de Google viene con su propio tema; hay que volver a dibujarlo.
  if (!$('#portada').hidden) prepararGoogle();
}

// Los dos viven en la barra de arriba.
$('#tema').addEventListener('click', alternarTema);
$('#idioma').addEventListener('click', alternarIdioma);

aplicarTema(localStorage.getItem('pio.tema')
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'));

// --- arranque -------------------------------------------------------------

function pintarYoLateral() {
  $('#yo-lateral').innerHTML = `
    <a class="fila-usuario" href="#/u/${escapar(estado.yo.usuario)}">
      ${avatar(estado.yo.usuario, 'chico', estado.yo.avatar)}
      <div class="crece">
        <b>${escapar(estado.yo.nombre)}</b><br><span class="chico">@${escapar(estado.yo.usuario)}</span>
      </div>
    </a>`;
}

// Qué hay encendido en este Pío. Se pregunta una vez y decide qué botones
// tienen sentido: mostrar uno que va a fallar seguro es peor que no mostrarlo.
async function cargarEmojis() {
  try {
    const { emojis } = await api('/emojis');
    emojisDelSitio = new Map(emojis.map((e) => [e.nombre, e.src]));
  } catch (err) {
    /* sin emojis el sitio anda igual, sólo se ven los :nombre: en crudo */
  }
}

async function cargarConfig() {
  try {
    const config = await api('/config');
    estado.soyAdmin = !!config.soyAdmin;
    $('#nav-admin').hidden = !config.soyAdmin;
    $('#acortar-enlaces').hidden = !config.acortador;
    $('#poner-imagen').hidden = !config.imagenes;
    // Sin servicio de imágenes no hay de dónde sacar la foto.
    $('#cambiar-avatar').hidden = !config.imagenes;
    $('#poner-gif').hidden = !config.gifs;
  } catch (err) {
    /* si no se puede preguntar, quedan como estaban */
  }
}

async function mostrarApp() {
  $('#portada').hidden = true;
  $('#app').hidden = false;
  await cargarConfig();
  sincronizarNotificaciones();
  cargarEmojis();
  codigoSiFalta();
  pintarYoLateral();
  if (!location.hash) location.hash = '#/nido';
  else pintar();
}

// --- como app ---------------------------------------------------------------------

// El trabajador que deja instalar Pío y abrirlo sin red. Se registra después
// de cargar, para no competir con lo que se ve primero.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sin trabajador, el sitio anda igual */ });
  });
}

const yaInstalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const esIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Chrome y Edge avisan cuando Pío se puede instalar: se guarda ese aviso y se
// muestra el botón. Sin ese aviso no se ofrece nada, porque el botón no haría
// nada. El iPhone no avisa nunca, pero ahí se instala a mano desde Compartir:
// el botón explica cómo.
let pedidoDeInstalar = null;

function mostrarBotonesInstalar(mostrar) {
  $('#instalar-barra').hidden = !mostrar;
}

window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  pedidoDeInstalar = ev;
  mostrarBotonesInstalar(true);
});

window.addEventListener('appinstalled', () => {
  pedidoDeInstalar = null;
  mostrarBotonesInstalar(false);
  avisar(T('instalar.listo'));
});

if (esIphone() && !yaInstalada()) mostrarBotonesInstalar(true);

async function instalar() {
  if (pedidoDeInstalar) {
    pedidoDeInstalar.prompt();
    const { outcome } = await pedidoDeInstalar.userChoice;
    pedidoDeInstalar = null;
    if (outcome === 'accepted') mostrarBotonesInstalar(false);
    return;
  }
  if (esIphone()) avisar(T('instalar.iphone'), 7000);
}

$('#instalar-barra').addEventListener('click', instalar);

// --- notificaciones al teléfono --------------------------------------------------

const hayNotificaciones = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function claveComoBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function suscripcionActual() {
  if (!hayNotificaciones()) return null;
  const registro = await navigator.serviceWorker.ready;
  return registro.pushManager.getSubscription();
}

// Dice lo que se puede hacer en este navegador: activarlas, desactivarlas, o
// por qué no se puede.
async function pintarBotonNotificaciones() {
  const boton = $('#boton-notificaciones');
  if (!boton) return;
  let clave = null;
  if (!hayNotificaciones()) {
    // En el iPhone sólo funcionan con Pío instalado en la pantalla de inicio.
    clave = esIphone() && !yaInstalada() ? 'notif.iphone' : null;
  } else if (Notification.permission === 'denied') {
    clave = 'notif.bloqueadas';
  } else {
    const suscrita = await suscripcionActual().catch(() => null);
    clave = suscrita && Notification.permission === 'granted' ? 'notif.apagar' : 'notif.activar';
  }
  boton.hidden = !clave;
  if (clave) {
    boton.textContent = T(clave);
    boton.dataset.estado = clave;
  }
}

async function activarNotificaciones() {
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') { avisar(T('notif.sinPermiso')); return; }
  const registro = await navigator.serviceWorker.ready;
  const { clave } = await api('/push/clave');
  const suscripcion = await registro.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: claveComoBytes(clave),
  });
  await api('/push/suscribir', { metodo: 'POST', cuerpo: Object.assign(suscripcion.toJSON(), { idioma }) });
  avisar(T('notif.activadas'));
}

async function apagarNotificacionesDeEsteNavegador() {
  const suscripcion = await suscripcionActual();
  if (!suscripcion) return;
  if (estado.token) await api('/push/desuscribir', { metodo: 'POST', cuerpo: { endpoint: suscripcion.endpoint } }).catch(() => {});
  await suscripcion.unsubscribe();
}

// Al abrir la app: si este navegador ya tenía notificaciones, se le vuelve a
// contar al servidor —por si se cambió de cuenta o de idioma—, y si Pío
// cambió sus claves, se suscribe de nuevo con las nuevas.
async function sincronizarNotificaciones() {
  try {
    if (!hayNotificaciones() || Notification.permission !== 'granted') return;
    let suscripcion = await suscripcionActual();
    if (!suscripcion) return;
    const { clave } = await api('/push/clave');
    const actual = suscripcion.options && suscripcion.options.applicationServerKey;
    const nueva = claveComoBytes(clave);
    if (actual && !new Uint8Array(actual).every((b, i) => b === nueva[i])) {
      await suscripcion.unsubscribe();
      const registro = await navigator.serviceWorker.ready;
      suscripcion = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: nueva });
    }
    await api('/push/suscribir', { metodo: 'POST', cuerpo: Object.assign(suscripcion.toJSON(), { idioma }) });
  } catch (err) {
    /* si no se puede, queda la campana, que es lo de siempre */
  }
}

document.addEventListener('click', async (ev) => {
  const boton = ev.target.closest('#boton-notificaciones');
  if (!boton) return;
  boton.disabled = true;
  try {
    if (boton.dataset.estado === 'notif.activar') await activarNotificaciones();
    else if (boton.dataset.estado === 'notif.apagar') { await apagarNotificacionesDeEsteNavegador(); avisar(T('notif.apagadas')); }
    else if (boton.dataset.estado === 'notif.iphone') avisar(T('instalar.iphone'), 7000);
    else if (boton.dataset.estado === 'notif.bloqueadas') avisar(T('notif.comoDesbloquear'), 7000);
  } catch (err) {
    avisar(err.message || T('error.generico'));
  } finally {
    boton.disabled = false;
    pintarBotonNotificaciones();
  }
});

// Sin conexión se dice arriba, y no con un error por cada cosa que falle.
function pintarConexion() {
  $('#sin-conexion').hidden = navigator.onLine;
}
window.addEventListener('offline', pintarConexion);
window.addEventListener('online', () => {
  pintarConexion();
  avisar(T('red.volvio'));
  if (estado.yo) cargarAvisos();
});
pintarConexion();

(async function arrancar() {
  traducir();
  if (estado.token) {
    try {
      const { yo } = await api('/yo');
      estado.yo = yo;
      mostrarApp();
      return;
    } catch {
      localStorage.removeItem('pio.token');
      estado.token = null;
    }
  }
  $('#portada').hidden = false;
  prepararGoogle();
})();
