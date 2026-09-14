'use strict';

const LIMITE = 100;
const $ = (sel) => document.querySelector(sel);

const estado = {
  token: localStorage.getItem('pio.token') || null,
  yo: null,
  respondiendoA: null,
};

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
    throw new Error(datos.error || 'Algo salió mal.');
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
  return new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short' });
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
  $('#forma-acceso button[type=submit]').textContent = modoAcceso === 'registro' ? 'Crear mi nido' : 'Entrar al nido';
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
    avisar(modoAcceso === 'registro' ? '¡Nido creado! 🐣' : '¡Bienvenido de vuelta! 🐤');
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
  if (porExpiracion) avisar('Tu sesión venció. Entrá de nuevo.');
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
  contenido.innerHTML = '<div class="cargando">Piando… 🐤</div>';

  try {
    if (vista === 'plaza') await vistaLinea('plaza', 'La plaza', 'Todo lo que pía el gallinero');
    else if (vista === 'buscar') await vistaBuscar(params.get('q') || '');
    else if (vista === 'yo') { location.hash = `#/u/${estado.yo.usuario}`; return; }
    else if (vista === 'u') await vistaPerfil(argumento, params.get('ver') || 'pios');
    else if (vista === 'p') await vistaHilo(argumento);
    else if (vista === 'e') await vistaEtiqueta(argumento);
    else await vistaLinea('nido', 'Tu nido', 'Vos y quienes seguís');
  } catch (err) {
    contenido.innerHTML = `<div class="vacio"><span class="emoji">💥</span>${escapar(err.message)}</div>`;
  }

  cargarTendencias();
  cargarSugerencias();
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

async function vistaLinea(tipo, titulo, subtitulo) {
  cabecera(titulo, subtitulo);
  const datos = await api(`/pios?tipo=${tipo}`);
  const vacio = tipo === 'nido'
    ? { emoji: '🪹', texto: 'Tu nido está calladito. Seguí a alguien en la Plaza o piá vos.' }
    : { emoji: '🌱', texto: 'Nadie pió todavía. Estrená la plaza.' };
  $('#contenido').innerHTML = listaPios(datos.pios, vacio);
}

async function vistaEtiqueta(etiqueta) {
  cabecera(`#${etiqueta}`, 'Píos con esta etiqueta');
  const datos = await api(`/pios?tipo=etiqueta&etiqueta=${encodeURIComponent(etiqueta)}`);
  $('#contenido').innerHTML = listaPios(datos.pios, { emoji: '🔎', texto: 'Nada con esa etiqueta… todavía.' });
}

async function vistaBuscar(consulta) {
  cabecera('Buscar', '', `
    <input class="buscador" id="entrada-buscar" placeholder="Buscá píos, etiquetas o pollitos"
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
    contenido.innerHTML = '<div class="vacio"><span class="emoji">🔍</span>Escribí algo y vemos qué aparece.</div>';
    return;
  }
  const datos = await api(`/buscar?q=${encodeURIComponent(consulta)}`);
  const personas = datos.usuarios.length
    ? `<div class="tarjeta" style="margin:12px 16px">
         <h2>Pollitos</h2>
         ${datos.usuarios.map(filaUsuario).join('')}
       </div>`
    : '';
  contenido.innerHTML = personas + listaPios(datos.pios, { emoji: '🤷', texto: 'Ningún pío coincide.' });
}

async function vistaPerfil(usuario, solapa) {
  const { perfil } = await api(`/usuarios/${encodeURIComponent(usuario)}`);
  cabecera(perfil.nombre, `${perfil.pios} píos`);

  const botonRelacion = perfil.soyYo
    ? `<button class="boton fantasma" data-salir>Cerrar sesión</button>`
    : `<button class="boton ${perfil.loSigo ? 'fantasma' : 'principal'}" data-seguir="${escapar(perfil.usuario)}">
         ${perfil.loSigo ? 'Siguiendo' : 'Seguir'}
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
        <span><b>${perfil.siguiendo}</b> siguiendo</span>
        <span><b>${perfil.seguidores}</b> seguidores</span>
        <span>en el gallinero desde ${new Date(perfil.creado).toLocaleDateString('es')}</span>
      </div>
    </div>
    <div class="sub-pestanas">
      <button class="sub-pestana ${tipo === 'usuario' ? 'activa' : ''}" data-solapa="pios">Píos</button>
      <button class="sub-pestana ${tipo === 'megusta' ? 'activa' : ''}" data-solapa="megusta">Me gusta</button>
    </div>
    ${listaPios(datos.pios, { emoji: '🥚', texto: tipo === 'megusta' ? 'Todavía no le gustó nada.' : 'Ni un pío por acá.' })}`;

  $('#contenido').querySelectorAll('[data-solapa]').forEach((boton) => {
    boton.addEventListener('click', () => {
      location.hash = `#/u/${perfil.usuario}?ver=${boton.dataset.solapa}`;
    });
  });
  const salir = $('#contenido').querySelector('[data-salir]');
  if (salir) salir.addEventListener('click', () => cerrarSesion(false));
}

async function vistaHilo(id) {
  cabecera('Pío', 'El hilo completo');
  const datos = await api(`/pios/${encodeURIComponent(id)}/hilo`);
  $('#contenido').innerHTML =
    datos.antes.map((p) => tarjetaPio(p)).join('') +
    tarjetaPio(datos.pio, { destacado: true }) +
    (datos.despues.length
      ? datos.despues.map((p) => tarjetaPio(p)).join('')
      : '<div class="vacio"><span class="emoji">💬</span>Sin respuestas. Contestá vos.</div>');
}

// --- piezas de interfaz ---------------------------------------------------

function listaPios(pios, vacio) {
  if (!pios.length) {
    return `<div class="vacio"><span class="emoji">${vacio.emoji}</span>${escapar(vacio.texto)}</div>`;
  }
  return pios.map((p) => tarjetaPio(p)).join('');
}

function tarjetaPio(pio, opciones = {}) {
  const contexto = pio.repiadoPor
    ? `<div class="contexto">🔁 repiado por @${escapar(pio.repiadoPor)}</div>`
    : (pio.respuestaA ? '<div class="contexto">💬 en respuesta a un pío</div>' : '');

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
          <button class="accion" data-accion="responder" title="Responder">💬 <span>${pio.respuestas || ''}</span></button>
          <button class="accion repio ${pio.yoRepio ? 'activa' : ''}" data-accion="repio" title="Repiar">🔁 <span>${pio.repios || ''}</span></button>
          <button class="accion ${pio.yoMeGusta ? 'activa' : ''}" data-accion="megusta" title="Me gusta">${pio.yoMeGusta ? '❤️' : '🤍'} <span>${pio.meGusta || ''}</span></button>
          ${pio.mio ? '<button class="accion borrar" data-accion="borrar" title="Borrar">🗑️</button>' : ''}
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
      ${perfil.soyYo ? '' : `<button class="boton ${perfil.loSigo ? 'fantasma' : 'principal'}" data-seguir="${escapar(perfil.usuario)}">${perfil.loSigo ? 'Siguiendo' : 'Seguir'}</button>`}
    </div>`;
}

// --- interacción sobre los píos -------------------------------------------

document.body.addEventListener('click', async (ev) => {
  const seguir = ev.target.closest('[data-seguir]');
  if (seguir) {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      const { perfil } = await api(`/usuarios/${encodeURIComponent(seguir.dataset.seguir)}/seguir`, { metodo: 'POST' });
      avisar(perfil.loSigo ? `Ahora seguís a @${perfil.usuario}` : `Dejaste de seguir a @${perfil.usuario}`);
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
        if (!confirm('¿Borrar este pío para siempre?')) return;
        await api(`/pios/${id}`, { metodo: 'DELETE' });
        avisar('Pío borrado.');
      }
      await pintar();
    } catch (err) { avisar(err.message); }
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
  $('#dialogo-titulo').textContent = respuestaA ? 'Tu respuesta' : 'Nuevo pío';
  $('#dialogo-contexto').hidden = !respuestaA;
  $('#dialogo-contexto').textContent = respuestaA ? 'Respondiendo a un pío del gallinero' : '';
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
    avisar(estado.respondiendoA ? 'Respuesta enviada 🐤' : '¡Pío! 🐤');
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
            <b>#${escapar(t.etiqueta)}</b><span>${t.total} pío${t.total === 1 ? '' : 's'}</span>
          </a>`).join('')
      : '<p class="chico">Todavía nadie usó etiquetas. Probá con #pio.</p>';
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
      $('#sugerencias').innerHTML = '<p class="chico">Cuando haya más pollitos, aparecen acá.</p>';
      return;
    }
    const perfiles = await Promise.all(
      lista.map((a) => api(`/usuarios/${encodeURIComponent(a.usuario)}`).then((d) => d.perfil))
    );
    $('#sugerencias').innerHTML = perfiles.filter((p) => !p.loSigo && !p.soyYo).map(filaUsuario).join('')
      || '<p class="chico">Ya seguís a todo el gallinero. 🐔</p>';
    void usuarios;
  } catch { /* idem */ }
}

// --- tema -----------------------------------------------------------------

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  localStorage.setItem('pio.tema', tema);
}

function alternarTema() {
  aplicarTema(document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro');
}

// Uno vive en la barra de arriba (móvil) y el otro en el menú lateral.
$('#tema').addEventListener('click', alternarTema);
$('#tema-lateral').addEventListener('click', alternarTema);

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
})();
