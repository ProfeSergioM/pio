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
    if (respuesta.status === 401 && estado.yo) cerrarSesion(true);
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

// Enlaza #etiquetas y @menciones sobre el texto ya escapado.
function enriquecer(texto) {
  return escapar(texto)
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

$('.pestanas').addEventListener('click', (ev) => {
  const boton = ev.target.closest('.pestana');
  if (!boton) return;
  modoAcceso = boton.dataset.modo;
  document.querySelectorAll('.pestana').forEach((p) => p.classList.toggle('activa', p === boton));
  document.querySelectorAll('.solo-registro').forEach((c) => { c.hidden = modoAcceso !== 'registro'; });
  $('#forma-acceso [name=nombre]').required = modoAcceso === 'registro';
  $('#forma-acceso [name=clave]').autocomplete = modoAcceso === 'registro' ? 'new-password' : 'current-password';
  const enviar = $('#forma-acceso button[type=submit]');
  enviar.dataset.t = modoAcceso === 'registro' ? 'acceso.boton.crear' : 'acceso.boton.entrar';
  enviar.textContent = T(enviar.dataset.t);
  $('#error-acceso').hidden = true;
});

$('#forma-acceso').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const forma = new FormData(ev.target);
  const error = $('#error-acceso');
  error.hidden = true;

  const cuerpo = {
    usuario: forma.get('usuario'),
    clave: forma.get('clave'),
    nombre: forma.get('nombre') || forma.get('usuario'),
  };

  try {
    const datos = await api(modoAcceso === 'registro' ? '/registro' : '/sesion', { metodo: 'POST', cuerpo });
    estado.token = datos.token;
    estado.yo = datos.yo;
    localStorage.setItem('pio.token', datos.token);
    ev.target.reset();
    mostrarApp();
    avisar(T(modoAcceso === 'registro' ? 'toast.nidoCreado' : 'toast.bienvenida'));
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
  $('#atras').hidden = !['u', 'p', 'e'].includes(vista);

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
    ? `<button class="boton fantasma" data-salir>${escapar(T('perfil.salir'))}</button>`
    : `<button class="boton ${perfil.loSigo ? 'fantasma' : 'principal'}" data-seguir="${escapar(perfil.usuario)}">
         ${escapar(T(perfil.loSigo ? 'perfil.siguiendoYa' : 'perfil.seguir'))}
       </button>`;

  const tipo = solapa === 'megusta' ? 'megusta' : 'usuario';
  const datos = await api(`/pios?tipo=${tipo}&usuario=${encodeURIComponent(perfil.usuario)}`);

  $('#contenido').innerHTML = `
    <div class="perfil-caja">
      <div class="perfil-fila">
        ${avatar(perfil.usuario, 'grande')}
        ${botonRelacion}
      </div>
      <h3 class="perfil-nombre">${escapar(perfil.nombre)}</h3>
      <div class="perfil-usuario">@${escapar(perfil.usuario)}</div>
      ${perfil.bio ? `<p class="perfil-bio">${enriquecer(perfil.bio)}</p>` : ''}
      <div class="perfil-datos">
        <span><b>${perfil.siguiendo}</b> ${escapar(T('perfil.siguiendo'))}</span>
        <span><b>${perfil.seguidores}</b> ${escapar(T('perfil.seguidores'))}</span>
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
      ? `<div class="contexto">${escapar(T('pio.respuestaA'))}</div>`
      : '');

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
        <p class="texto">${enriquecer(pio.texto)}</p>
        <div class="acciones">
          <button class="accion" data-accion="responder" title="${escapar(T('accion.responder'))}">💬 <span>${pio.respuestas || ''}</span></button>
          <button class="accion repio ${pio.yoRepio ? 'activa' : ''}" data-accion="repio" title="${escapar(T('accion.repiar'))}">🔁 <span>${pio.repios || ''}</span></button>
          <button class="accion ${pio.yoMeGusta ? 'activa' : ''}" data-accion="megusta" title="${escapar(T('accion.megusta'))}">${pio.yoMeGusta ? '❤️' : '🤍'} <span>${pio.meGusta || ''}</span></button>
          ${pio.mio ? `<button class="accion borrar" data-accion="borrar" title="${escapar(T('accion.borrar'))}">🗑️</button>` : ''}
        </div>
      </div>
    </article>`;
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

  if (articulo && !ev.target.closest('a') && !articulo.classList.contains('destacado')) {
    location.hash = `#/p/${articulo.dataset.id}`;
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
  $('#enviar-pio').disabled = usados === 0 || restantes < 0;
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
    await api('/pios', {
      metodo: 'POST',
      cuerpo: { texto: areaTexto.value, respuestaA: estado.respondiendoA },
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

function mostrarApp() {
  $('#portada').hidden = true;
  $('#app').hidden = false;
  $('#yo-lateral').innerHTML = `
    <a class="fila-usuario" href="#/u/${escapar(estado.yo.usuario)}">
      ${avatar(estado.yo.usuario, 'chico')}
      <div class="crece">
        <b>${escapar(estado.yo.nombre)}</b><br><span class="chico">@${escapar(estado.yo.usuario)}</span>
      </div>
    </a>`;
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
