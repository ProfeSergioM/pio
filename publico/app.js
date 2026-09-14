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

// Enlaza #etiquetas y @menciones sobre el texto ya escapado, y cambia los
// :nombre: por su imagen.
function enriquecer(texto) {
  return escapar(texto)
    .replace(/:([a-z0-9_]{2,20}):/g, (entero, nombre) => {
      const src = emojisDelSitio.get(nombre);
      return src
        ? `<img class="emoji" src="${escapar(src)}" alt=":${escapar(nombre)}:" title=":${escapar(nombre)}:">`
        : entero;
    })
    .replace(/#([\p{L}\p{N}_]{1,50})/gu, (m, e) => `<a href="#/e/${encodeURIComponent(e.toLowerCase())}">${m}</a>`)
    .replace(/@([a-zA-Z0-9_]{3,15})/g, (m, u) => `<a href="#/u/${u.toLowerCase()}">${m}</a>`);
}

function hace(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(ms).toLocaleDateString(diccionario().fechas, { day: 'numeric', month: 'short' });
}

function avatar(usuario, clase = '') {
  return `<div class="avatar ${clase}">${escapar((usuario || '?')[0].toUpperCase())}</div>`;
}

let temporizadorAviso = null;
function avisar(mensaje) {
  const caja = $('#aviso');
  caja.textContent = mensaje;
  caja.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { caja.hidden = true; }, 2600);
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
  api('/sesion', { metodo: 'DELETE' }).catch(() => {});
  estado.token = null;
  estado.yo = null;
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

async function pintar() {
  if (!estado.yo) return;
  const { partes, params } = rutaActual();
  const [vista, argumento] = partes;

  document.querySelectorAll('.nav').forEach((n) => {
    const destino = n.dataset.nav;
    n.classList.toggle('activa', destino === (vista || 'nido'));
  });
  $('#atras').hidden = !['u', 'p', 'e', 'c'].includes(vista);

  // Al salir de un corral se vuelve a piar a la plaza; si no, uno se lleva el
  // corral puesto sin darse cuenta.
  // Al irse del corral se apaga el latido del chat y se vuelve a piar a la plaza.
  if (vista !== 'c') {
    corralActual = null;
    pararChat();
  }

  const contenido = $('#contenido');
  contenido.innerHTML = `<div class="cargando">${escapar(T('cargando'))}</div>`;

  try {
    if (vista === 'plaza') await vistaLinea('plaza');
    else if (vista === 'buscar') await vistaBuscar(params.get('q') || '');
    else if (vista === 'yo') { location.hash = `#/u/${estado.yo.usuario}`; return; }
    else if (vista === 'u') await vistaPerfil(argumento, params.get('ver') || 'pios');
    else if (vista === 'p') await vistaHilo(argumento);
    else if (vista === 'e') await vistaEtiqueta(argumento);
    else if (vista === 'avisos') await vistaAvisos();
    else if (vista === 'disenos') await vistaDisenos();
    else if (vista === 'admin') await vistaAdmin(params.get('ver'));
    else if (vista === 'corrales') await vistaCorrales();
    else if (vista === 'c') await vistaCorral(argumento, params.get('ver'));
    else await vistaLinea('nido');
  } catch (err) {
    contenido.innerHTML = `<div class="vacio"><span class="emoji">💥</span>${escapar(err.message)}</div>`;
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

async function vistaLinea(tipo) {
  cabecera(T(`${tipo}.titulo`), T(`${tipo}.sub`));
  const datos = await api(`/pios?tipo=${tipo}`);
  const vacio = tipo === 'nido'
    ? { emoji: '🪹', texto: T('nido.vacio') }
    : { emoji: '🌱', texto: T('plaza.vacio') };
  $('#contenido').innerHTML = listaPios(datos.pios, vacio);
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
        ${avatar(perfil.usuario, 'grande')}
        ${botonRelacion}
      </div>
      <h3 class="perfil-nombre">${escapar(perfil.nombre)}${medallita(perfil.medalla)}</h3>
      <div class="perfil-usuario">@${escapar(perfil.usuario)}</div>
      ${perfil.bio ? `<p class="perfil-bio">${enriquecer(perfil.bio)}</p>` : ''}
      <div class="perfil-datos">
        <span><b>${perfil.siguiendo}</b> ${escapar(T('perfil.siguiendo'))}</span>
        <span><b>${perfil.seguidores}</b> ${escapar(T('perfil.seguidores'))}</span>
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

function rama(nodo) {
  const tiene = !!(nodo.ramas && nodo.ramas.length);
  const cerrada = plegadas.has(nodo.id);
  const boton = tiene
    ? `<button class="plegar" data-plegar="${escapar(nodo.id)}"
         title="${escapar(T(cerrada ? 'hilo.desplegar' : 'hilo.plegar'))}">${cerrada ? '+' : '−'}</button>`
    : '<span class="plegar-hueco"></span>';

  // El botón va afuera del <article>, no adentro: si estuviera dentro, cada
  // clic para plegar dispararía también la navegación al pío.
  return `
    <div class="rama">
      <div class="rama-fila">${boton}<div class="rama-pio">${tarjetaPio(nodo, { enCascada: true })}</div></div>
      ${tiene && !cerrada ? `<div class="ramas">${nodo.ramas.map(rama).join('')}</div>` : ''}
      ${tiene && cerrada
        ? `<div class="plegado">${escapar(T('hilo.ocultas', { n: cuantasCuelgan(nodo) }))}</div>`
        : ''}
    </div>`;
}

let hiloEnPantalla = null;

function pintarCascada() {
  if (!hiloEnPantalla) return;
  const { despues, recortado } = hiloEnPantalla;
  $('#cascada').innerHTML = despues.length
    ? despues.map(rama).join('')
      + (recortado ? `<div class="plegado">${escapar(T('hilo.recortado'))}</div>` : '')
    : `<div class="vacio"><span class="emoji">💬</span>${escapar(T('hilo.vacio'))}</div>`;
}

async function vistaHilo(id) {
  cabecera(T('hilo.titulo'), T('hilo.sub'));
  const datos = await api(`/pios/${encodeURIComponent(id)}/hilo`);
  hiloEnPantalla = datos;
  plegadas.clear();
  $('#contenido').innerHTML =
    datos.antes.map((p) => tarjetaPio(p)).join('')
    + tarjetaPio(datos.pio, { destacado: true })
    + '<div id="cascada"></div>';
  pintarCascada();
}

// --- avisos ---------------------------------------------------------------

const TIPOS_DE_AVISO = ['mencion', 'respuesta', 'repio', 'megusta', 'seguir'];

const EMOJI_AVISO = {
  mencion: '📣',
  respuesta: '💬',
  repio: '🔁',
  megusta: '❤️',
  seguir: '🐣',
};

function queParece(tipo) {
  return T(TIPOS_DE_AVISO.includes(tipo) ? `aviso.${tipo}` : 'aviso.otro');
}

async function vistaAvisos() {
  cabecera(T('avisos.titulo'), T('avisos.sub'));
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

function pintarInsignia(cuantos) {
  const insignia = $('#insignia');
  insignia.textContent = cuantos > 99 ? '99+' : String(cuantos);
  insignia.hidden = !cuantos;
}

async function cargarAvisos() {
  try {
    const { sinLeer } = await api('/notificaciones');
    pintarInsignia(sinLeer);
  } catch { /* la insignia no rompe la vista */ }
}

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
    if (primeraVez) caja.innerHTML = '';

    for (const m of mensajes) {
      ultimoMensaje = Math.max(ultimoMensaje, m.creado);
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
        <span><b>${corral.suscritos}</b> ${escapar(T('corral.gente', { n: corral.suscritos }).replace(/^\d+\s/, ''))}</span>
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

function tarjetaPio(pio, opciones = {}) {
  // Dentro de la cascada, la sangría ya dice que es una respuesta: repetirlo en
  // cada rama es ruido, y lo que se pidió fue un sitio poco recargado.
  const contexto = pio.repiadoPor
    ? `<div class="contexto">${T('pio.repiadoPor', { usuario: escapar(pio.repiadoPor) })}</div>`
    : (pio.respuestaA && !opciones.enCascada
      ? `<div class="contexto"><a href="#/p/${escapar(pio.respuestaA)}">${escapar(T('pio.respuestaA', { usuario: pio.respuestaAUsuario }))}</a></div>`
      // Dentro del corral no hace falta decir en qué corral se está.
      : (pio.corral && !opciones.enCorral
        ? `<div class="contexto"><a href="#/c/${escapar(pio.corral)}">${escapar(T('pio.enCorral', { corral: pio.corral }))}</a></div>`
        : ''));

  return `
    <article class="pio ${opciones.destacado ? 'destacado' : ''}" data-id="${pio.id}">
      ${contexto}
      ${avatar(pio.autor.usuario)}
      <div>
        <div class="pio-cabecera">
          <a class="pio-nombre" href="#/u/${escapar(pio.autor.usuario)}" data-parar>${escapar(pio.autor.nombre)}</a>
          <span class="pio-usuario">@${escapar(pio.autor.usuario)}</span>
          <span class="pio-fecha">· ${hace(pio.creado)}</span>
        </div>
        ${pio.texto ? `<p class="texto">${enriquecer(pio.texto)}</p>` : ''}
        ${pio.adjunto ? `
          <a class="pio-imagen" href="${escapar(pio.adjunto.url)}" target="_blank" rel="noopener noreferrer">
            <img src="${escapar(pio.adjunto.miniatura || pio.adjunto.url)}"
                 alt="${escapar(pio.adjunto.texto || '')}" loading="lazy">
          </a>` : ''}
        <div class="acciones">
          <button class="accion" data-accion="responder" title="${escapar(T('accion.responder'))}">💬 <span>${pio.respuestas || ''}</span></button>
          <button class="accion repio ${pio.yoRepio ? 'activa' : ''}" data-accion="repio" title="${escapar(T('accion.repiar'))}">🔁 <span>${pio.repios || ''}</span></button>
          <button class="accion ${pio.yoMeGusta ? 'activa' : ''}" data-accion="megusta" title="${escapar(T('accion.megusta'))}">${pio.yoMeGusta ? '❤️' : '🤍'} <span>${pio.meGusta || ''}</span></button>
          <button class="accion" data-accion="compartir" title="${escapar(T('accion.compartir'))}"
                  data-autor="${escapar(pio.autor.usuario)}" data-texto="${escapar(pio.texto || '')}">📤</button>
          ${pio.mio ? `<button class="accion borrar" data-accion="borrar" title="${escapar(T('accion.borrar'))}">🗑️</button>` : ''}
        </div>
      </div>
    </article>`;
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
      <a href="#/u/${escapar(perfil.usuario)}">${avatar(perfil.usuario, 'chico')}</a>
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
      await pintar();
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

  const otroDiseno = ev.target.closest('[data-diseno]');
  if (otroDiseno) {
    ev.preventDefault();
    aplicarDiseno(otroDiseno.dataset.diseno);
    await pintar();
    return;
  }

  const otroIdioma = ev.target.closest('[data-idioma]');
  if (otroIdioma) {
    ev.preventDefault();
    cambiarIdioma(otroIdioma.dataset.idioma);
    return;
  }

  const silenciar = ev.target.closest('[data-silenciar]');
  if (silenciar) {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      const { perfil } = await api(`/usuarios/${encodeURIComponent(silenciar.dataset.silenciar)}/silenciar`, { metodo: 'POST' });
      avisar(T(perfil.loSilencio ? 'toast.silenciado' : 'toast.sinSilencio', { usuario: perfil.usuario }));
      await pintar();
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
      await pintar();
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
    try {
      if (accion.dataset.accion === 'megusta') await api(`/pios/${id}/megusta`, { metodo: 'POST' });
      else if (accion.dataset.accion === 'repio') await api(`/pios/${id}/repio`, { metodo: 'POST' });
      else if (accion.dataset.accion === 'responder') { abrirDialogo(id); return; }
      else if (accion.dataset.accion === 'borrar') {
        if (!confirm(T('confirmar.borrar'))) return;
        await api(`/pios/${id}`, { metodo: 'DELETE' });
        avisar(T('toast.borrado'));
      }
      await pintar();
    } catch (err) { avisar(err.message); }
    return;
  }

  const fila = ev.target.closest('[data-ir]');
  if (fila && !ev.target.closest('a')) {
    location.hash = fila.dataset.ir;
    return;
  }

  if (articulo && articulo.dataset.id && !ev.target.closest('a')
      && !articulo.classList.contains('destacado')) {
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
  caja.innerHTML = `
    <img src="${escapar(adjunto.miniatura || adjunto.url)}" alt="">
    <button type="button" class="icono quitar" data-quitar-adjunto
            title="${escapar(T('adjunto.quitar'))}">✕</button>
    <input class="alt" id="alt-adjunto" maxlength="100"
           placeholder="${escapar(T('adjunto.alt'))}" value="${escapar(adjunto.texto || '')}">`;
}

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

function abrirPerfil() {
  const forma = $('#forma-perfil');
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
    location.hash = `#/u/${yo.usuario}`;
    await pintar();
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

function abrirDialogo(respuestaA = null) {
  estado.respondiendoA = respuestaA;
  $('#dialogo-titulo').textContent = T(respuestaA ? 'dialogo.respuesta' : 'dialogo.nuevo');
  $('#dialogo-contexto').hidden = !respuestaA;
  $('#dialogo-contexto').textContent = respuestaA ? T('dialogo.contexto') : '';
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

areaTexto.addEventListener('input', actualizarMedidor);
areaTexto.addEventListener('keydown', (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') $('#forma-piar').requestSubmit();
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
    await api('/pios', {
      metodo: 'POST',
      cuerpo: {
        texto: areaTexto.value,
        respuestaA: estado.respondiendoA,
        corral: corralActual,
        adjunto: adjunto ? Object.assign({}, adjunto, { texto: alt ? alt.value : '' }) : null,
      },
    });
    dialogo.close();
    avisar(T(estado.respondiendoA ? 'toast.respuesta' : 'toast.pio'));
    await pintar();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

// --- columna derecha ------------------------------------------------------

async function cargarTendencias() {
  try {
    const { tendencias } = await api('/tendencias');
    $('#tendencias').innerHTML = tendencias.length
      ? tendencias.map((t) => `
          <a class="tendencia" href="#/e/${encodeURIComponent(t.etiqueta)}">
            <b>#${escapar(t.etiqueta)}</b><span>${escapar(T('tendencia.pios', { n: t.total }))}</span>
          </a>`).join('')
      : `<p class="chico">${escapar(T('tendencias.vacio'))}</p>`;
  } catch { /* la columna lateral no rompe la vista */ }
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

// --- diseños --------------------------------------------------------------

// Cada diseño es una hoja que se cuelga DESPUÉS de estilos.css y la sobrescribe
// por cascada. El DOM no cambia nunca: por eso las diez conviven y todas andan.
const DISENOS = [
  { slug: '', nombre: null, que: null },
  { slug: 'fichas', nombre: 'Fichas', que: 'Tarjetas flotando con mucho aire entre una y otra.' },
  { slug: 'revista', nombre: 'Revista', que: 'Titulares grandes y maquetación asimétrica.' },
  { slug: 'pixel', nombre: 'Pixel', que: 'Ocho bits: bordes escalonados y paleta corta.' },
];

function disenoActual() {
  const guardado = localStorage.getItem('pio.diseno') || '';
  return DISENOS.some((d) => d.slug === guardado) ? guardado : '';
}

function aplicarDiseno(slug) {
  const hoja = $('#hoja-diseno');
  const elegido = DISENOS.some((d) => d.slug === slug) ? slug : '';
  hoja.href = elegido ? `temas/${elegido}.css` : '';
  localStorage.setItem('pio.diseno', elegido);
  // El botón de Google se dibuja con el tema de su propio iframe.
  if (!$('#portada').hidden) prepararGoogle();
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
        u.oculto ? T('admin.ocultoSello') : '',
        u.porGoogle ? T('admin.porGoogle') : '',
        !u.tieneClave && !u.porGoogle ? T('admin.sinClave') : '',
      ].filter(Boolean);
      return `
        <div class="sugerencia">
          ${avatar(u.usuario, 'chico')}
          <a class="crece" href="#/u/${escapar(u.usuario)}">
            <b>${escapar(u.nombre)}</b>
            <span>@${escapar(u.usuario)} · ${escapar(T('admin.cuentas', { pios: u.pios, seguidores: u.seguidores }))}</span>
          </a>
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
        await panelPollitos(donde);
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
      () => panelPollitos(donde),
    ));
  }
}

async function panelPios(donde) {
  const { pios } = await api('/admin/pios');
  if (!pios.length) { donde.innerHTML = `<div class="vacio"><span class="emoji">🌱</span>${escapar(T('admin.vacio'))}</div>`; return; }
  donde.innerHTML = pios.map((p) => `
    <article class="pio quieto">
      ${avatar(p.autor.usuario)}
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
    </article>`).join('');

  for (const boton of donde.querySelectorAll('[data-borrar-pio]')) {
    boton.addEventListener('click', () => borrarDesdePanel(
      `/admin/pios/${encodeURIComponent(boton.dataset.borrarPio)}`,
      T('admin.seguro.pio'),
      () => panelPios(donde),
    ));
  }
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
      () => panelCorrales(donde),
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

async function vistaDisenos() {
  cabecera(T('disenos.titulo'), T('disenos.sub'));
  const actual = disenoActual();
  $('#contenido').innerHTML = `<div class="tarjeta" style="margin:12px 16px">${
    DISENOS.map((d) => {
      const nombre = d.nombre || T('disenos.base.nombre');
      const que = d.que || T('disenos.base.que');
      const puesto = d.slug === actual;
      return `
        <div class="sugerencia">
          <div class="crece">
            <b>${escapar(nombre)}</b><span>${escapar(que)}</span>
          </div>
          <button class="boton ${puesto ? 'fantasma' : 'principal'}" data-diseno="${escapar(d.slug)}"
                  ${puesto ? 'disabled' : ''}>${escapar(T(puesto ? 'disenos.enUso' : 'disenos.usar'))}</button>
        </div>`;
    }).join('')
  }</div>`;
}

function alternarTema() {
  aplicarTema(document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro');
  // El botón de Google viene con su propio tema; hay que volver a dibujarlo.
  if (!$('#portada').hidden) prepararGoogle();
}

// Uno vive en la barra de arriba (móvil) y el otro en el menú lateral.
$('#tema').addEventListener('click', alternarTema);
$('#tema-lateral').addEventListener('click', alternarTema);
$('#idioma').addEventListener('click', alternarIdioma);
$('#idioma-lateral').addEventListener('click', alternarIdioma);

aplicarTema(localStorage.getItem('pio.tema')
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'));

// --- arranque -------------------------------------------------------------

function pintarYoLateral() {
  $('#yo-lateral').innerHTML = `
    <a class="fila-usuario" href="#/u/${escapar(estado.yo.usuario)}">
      ${avatar(estado.yo.usuario, 'chico')}
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
    $('#nav-admin').hidden = !config.soyAdmin;
    $('#acortar-enlaces').hidden = !config.acortador;
    $('#poner-imagen').hidden = !config.imagenes;
    $('#poner-gif').hidden = !config.gifs;
  } catch (err) {
    /* si no se puede preguntar, quedan como estaban */
  }
}

function mostrarApp() {
  $('#portada').hidden = true;
  $('#app').hidden = false;
  cargarConfig();
  cargarEmojis();
  codigoSiFalta();
  pintarYoLateral();
  if (!location.hash) location.hash = '#/nido';
  else pintar();
}

(async function arrancar() {
  aplicarDiseno(disenoActual());
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
