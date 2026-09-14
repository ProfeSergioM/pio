'use strict';

// Batería de pruebas de Pío. Levanta un servidor real en un puerto libre,
// con datos en una carpeta temporal, y le pega por HTTP como lo haría el cliente.
//   node pruebas/todos.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { crearServidor } = require('../servidor');
const M = require('../src/modelo');
const L = require('../src/limite');

let pasadas = 0;
const fallas = [];

function probar(nombre, condicion, detalle) {
  if (condicion) {
    pasadas += 1;
    console.log(`  ok   ${nombre}`);
  } else {
    fallas.push(nombre);
    console.log(`  FALLA ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
}

function grupo(titulo) {
  console.log(`\n${titulo}`);
}

async function main() {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-pruebas-'));
  const servidor = crearServidor({ datos: carpeta });
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  async function pedir(ruta, { metodo = 'GET', cuerpo, token } = {}) {
    const respuesta = await fetch(`${base}/api${ruta}`, {
      method: metodo,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        token ? { Authorization: `Bearer ${token}` } : {}
      ),
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    return { estado: respuesta.status, datos: await respuesta.json().catch(() => ({})) };
  }

  // --- modelo puro --------------------------------------------------------

  grupo('Modelo: el límite de 100');
  probar('100 caracteres pasan', M.validarPio('a'.repeat(100)) === null);
  probar('101 caracteres no pasan', M.validarPio('a'.repeat(101)) !== null);
  probar('el error dice por cuánto te pasaste', M.validarPio('a'.repeat(103)).datos.sobra === 3);
  probar('y la clave del error es estable', M.validarPio('a'.repeat(103)).clave === 'pio.largo');
  probar('el español sigue siendo el respaldo del servidor',
    /por 3/.test(M.mensaje(M.validarPio('a'.repeat(103)))));
  probar('una clave desconocida no rompe el armado', typeof M.mensaje({ clave: 'no.existe' }) === 'string');
  probar('un emoji cuenta como 1 carácter', M.largo('🐤') === 1, `contó ${M.largo('🐤')}`);
  probar('100 emojis entran justo', M.validarPio('🐤'.repeat(100)) === null);
  probar('101 emojis no entran', M.validarPio('🐤'.repeat(101)) !== null);
  probar('un pío vacío no vale', M.validarPio('   ') !== null);
  probar('usuario con mayúsculas se normaliza', M.normalizarUsuario('@PinZon') === 'pinzon');
  probar('usuario de 2 letras se rechaza', M.validarUsuario('ab') !== null);
  probar('usuario con guion se rechaza', M.validarUsuario('po-llito') !== null);
  probar('etiquetas se extraen sin repetir', JSON.stringify(M.etiquetas('#Pio #pio #granja')) === '["pio","granja"]');
  probar('menciones se extraen en minúscula', JSON.stringify(M.menciones('hola @Pinzon')) === '["pinzon"]');

  // --- cuentas ------------------------------------------------------------

  grupo('Cuentas');
  const alta = await pedir('/registro', {
    metodo: 'POST',
    cuerpo: { usuario: 'Pinzon', nombre: 'Pinzon Uno', clave: 'semillas' },
  });
  probar('registro devuelve 201 y token', alta.estado === 201 && !!alta.datos.token, `estado ${alta.estado}`);
  probar('el usuario queda en minúsculas', alta.datos.yo.usuario === 'pinzon');
  const tokenA = alta.datos.token;

  const repetido = await pedir('/registro', {
    metodo: 'POST',
    cuerpo: { usuario: 'pinzon', nombre: 'Otro', clave: 'semillas' },
  });
  probar('usuario repetido devuelve 409', repetido.estado === 409, `estado ${repetido.estado}`);

  const claveCorta = await pedir('/registro', {
    metodo: 'POST',
    cuerpo: { usuario: 'gallina', nombre: 'Gallina', clave: '123' },
  });
  probar('clave corta se rechaza', claveCorta.estado === 400);

  const malLogin = await pedir('/sesion', { metodo: 'POST', cuerpo: { usuario: 'pinzon', clave: 'mala' } });
  probar('clave equivocada devuelve 401', malLogin.estado === 401);

  const login = await pedir('/sesion', { metodo: 'POST', cuerpo: { usuario: '@Pinzon', clave: 'semillas' } });
  probar('se puede entrar con @ y mayúsculas', login.estado === 200 && !!login.datos.token);

  const alta2 = await pedir('/registro', {
    metodo: 'POST',
    cuerpo: { usuario: 'calandria', nombre: 'Calandria', clave: 'semillas' },
  });
  const tokenB = alta2.datos.token;

  const sinToken = await pedir('/pios', { metodo: 'POST', cuerpo: { texto: 'hola' } });
  probar('publicar sin sesión devuelve 401', sinToken.estado === 401);

  // --- publicar -----------------------------------------------------------

  grupo('Píos');
  const largo = await pedir('/pios', { metodo: 'POST', token: tokenA, cuerpo: { texto: 'a'.repeat(101) } });
  probar('el servidor rechaza 101 caracteres', largo.estado === 400, `estado ${largo.estado}`);

  const uno = await pedir('/pios', {
    metodo: 'POST',
    token: tokenA,
    cuerpo: { texto: 'Primer pío del gallinero #pio' },
  });
  probar('publicar devuelve 201', uno.estado === 201, `estado ${uno.estado}`);
  probar('el pío arranca sin me gusta', uno.datos.pio.meGusta === 0);
  const pioA = uno.datos.pio.id;

  await pedir('/pios', { metodo: 'POST', token: tokenB, cuerpo: { texto: 'Yo también pío #pio #granja' } });

  const plaza = await pedir('/pios?tipo=plaza');
  probar('la plaza muestra los dos píos', plaza.datos.pios.length === 2, `vio ${plaza.datos.pios.length}`);
  probar('la plaza ordena del más nuevo al más viejo',
    plaza.datos.pios[0].creado >= plaza.datos.pios[1].creado);

  // --- nido y seguir ------------------------------------------------------

  grupo('Nido y seguidores');
  const nidoSolo = await pedir('/pios?tipo=nido', { token: tokenA });
  probar('el nido propio solo trae lo propio', nidoSolo.datos.pios.length === 1);

  await pedir('/usuarios/calandria/seguir', { metodo: 'POST', token: tokenA });
  const nidoConCalandria = await pedir('/pios?tipo=nido', { token: tokenA });
  probar('al seguir aparecen sus píos en el nido', nidoConCalandria.datos.pios.length === 2);

  const perfilCalandria = await pedir('/usuarios/calandria', { token: tokenA });
  probar('el perfil informa que la sigo', perfilCalandria.datos.perfil.loSigo === true);
  probar('el perfil cuenta un seguidor', perfilCalandria.datos.perfil.seguidores === 1);

  const autoSeguir = await pedir('/usuarios/pinzon/seguir', { metodo: 'POST', token: tokenA });
  probar('no te podés seguir a vos mismo', autoSeguir.estado === 400);

  await pedir('/usuarios/calandria/seguir', { metodo: 'POST', token: tokenA });
  const nidoSinCalandria = await pedir('/pios?tipo=nido', { token: tokenA });
  probar('dejar de seguir saca sus píos del nido', nidoSinCalandria.datos.pios.length === 1);
  await pedir('/usuarios/calandria/seguir', { metodo: 'POST', token: tokenA });

  // --- me gusta y repío ---------------------------------------------------

  grupo('Me gusta y repíos');
  const gusto = await pedir(`/pios/${pioA}/megusta`, { metodo: 'POST', token: tokenB });
  probar('me gusta suma 1', gusto.datos.pio.meGusta === 1 && gusto.datos.pio.yoMeGusta === true);
  const noGusto = await pedir(`/pios/${pioA}/megusta`, { metodo: 'POST', token: tokenB });
  probar('volver a tocar lo saca', noGusto.datos.pio.meGusta === 0 && noGusto.datos.pio.yoMeGusta === false);
  await pedir(`/pios/${pioA}/megusta`, { metodo: 'POST', token: tokenB });

  const meGustaDeB = await pedir('/pios?tipo=megusta&usuario=calandria', { token: tokenB });
  probar('la solapa "me gusta" lista lo marcado', meGustaDeB.datos.pios.length === 1);

  const repioPropio = await pedir(`/pios/${pioA}/repio`, { metodo: 'POST', token: tokenA });
  probar('repiar lo propio se rechaza', repioPropio.estado === 400);

  const repio = await pedir(`/pios/${pioA}/repio`, { metodo: 'POST', token: tokenB });
  probar('repiar ajeno suma 1', repio.datos.pio.repios === 1 && repio.datos.pio.yoRepio === true);

  const alta3 = await pedir('/registro', {
    metodo: 'POST',
    cuerpo: { usuario: 'zorzal', nombre: 'Zorzal', clave: 'semillas' },
  });
  const tokenC = alta3.datos.token;
  await pedir('/usuarios/calandria/seguir', { metodo: 'POST', token: tokenC });
  const nidoZorzal = await pedir('/pios?tipo=nido', { token: tokenC });
  const repiado = nidoZorzal.datos.pios.find((p) => p.repiadoPor === 'calandria');
  probar('el repío llega al nido de quien sigue a la repiadora', !!repiado);
  probar('el repío conserva al autor original', repiado && repiado.autor.usuario === 'pinzon');

  // --- respuestas e hilos -------------------------------------------------

  grupo('Respuestas');
  const respuesta = await pedir('/pios', {
    metodo: 'POST',
    token: tokenB,
    cuerpo: { texto: 'Qué lindo pío', respuestaA: pioA },
  });
  probar('responder devuelve 201', respuesta.estado === 201);

  const hilo = await pedir(`/pios/${pioA}/hilo`, { token: tokenA });
  probar('el hilo trae la respuesta', hilo.datos.despues.length === 1);
  probar('el pío raíz cuenta 1 respuesta', hilo.datos.pio.respuestas === 1);
  probar('el hilo de la respuesta trae el pío anterior',
    (await pedir(`/pios/${respuesta.datos.pio.id}/hilo`)).datos.antes.length === 1);

  const plazaConRespuesta = await pedir('/pios?tipo=plaza');
  probar('las respuestas no ensucian la plaza', plazaConRespuesta.datos.pios.length === 2,
    `vio ${plazaConRespuesta.datos.pios.length}`);

  const respuestaFantasma = await pedir('/pios', {
    metodo: 'POST',
    token: tokenB,
    cuerpo: { texto: 'a un pío que no existe', respuestaA: 'pzzz' },
  });
  probar('responder a un pío inexistente devuelve 404', respuestaFantasma.estado === 404);

  // --- borrar -------------------------------------------------------------

  grupo('Borrar');
  const borrarAjeno = await pedir(`/pios/${pioA}`, { metodo: 'DELETE', token: tokenB });
  probar('no podés borrar un pío ajeno', borrarAjeno.estado === 403);

  const propio = await pedir('/pios', { metodo: 'POST', token: tokenC, cuerpo: { texto: 'me arrepiento' } });
  const borrado = await pedir(`/pios/${propio.datos.pio.id}`, { metodo: 'DELETE', token: tokenC });
  probar('borrar el propio funciona', borrado.estado === 200);
  const trasBorrar = await pedir(`/pios/${propio.datos.pio.id}/hilo`);
  probar('el pío borrado ya no está', trasBorrar.estado === 404);

  // --- avisos -------------------------------------------------------------

  grupo('Avisos');
  const avisosA = await pedir('/notificaciones', { token: tokenA });
  const tipos = avisosA.datos.notificaciones.map((n) => n.tipo);
  probar('el me gusta ajeno avisa', tipos.includes('megusta'), tipos.join());
  probar('el repío ajeno avisa', tipos.includes('repio'), tipos.join());
  probar('la respuesta avisa', tipos.includes('respuesta'), tipos.join());
  probar('recién llegados, todos sin leer', avisosA.datos.sinLeer === tipos.length);

  const avisosB = await pedir('/notificaciones', { token: tokenB });
  probar('seguir le avisa a quien es seguido',
    avisosB.datos.notificaciones.some((n) => n.tipo === 'seguir' && n.de.usuario === 'zorzal'));

  const conMencion = await pedir('/pios', {
    metodo: 'POST',
    token: tokenC,
    cuerpo: { texto: 'Mirá esto @pinzon, te va a gustar' },
  });
  const trasMencion = await pedir('/notificaciones', { token: tokenA });
  const mencion = trasMencion.datos.notificaciones.find((n) => n.tipo === 'mencion');
  probar('la mención le avisa al mencionado', !!mencion && mencion.de.usuario === 'zorzal');
  probar('el aviso trae el pío adentro', !!mencion && mencion.pio.id === conMencion.datos.pio.id);
  probar('el más nuevo va primero', trasMencion.datos.notificaciones[0].id === (mencion || {}).id);

  const antesDeHablarSolo = (await pedir('/notificaciones', { token: tokenC })).datos.notificaciones.length;
  await pedir('/pios', { metodo: 'POST', token: tokenC, cuerpo: { texto: 'hablando solo @zorzal' } });
  const hablandoSolo = await pedir('/notificaciones', { token: tokenC });
  probar('mencionarse a uno mismo no avisa',
    hablandoSolo.datos.notificaciones.length === antesDeHablarSolo);

  const antesDeDoble = (await pedir('/notificaciones', { token: tokenA })).datos.notificaciones.length;
  await pedir('/pios', {
    metodo: 'POST',
    token: tokenB,
    cuerpo: { texto: '@pinzon te contesto acá', respuestaA: pioA },
  });
  const trasDoble = await pedir('/notificaciones', { token: tokenA });
  probar('responder y mencionar a la vez avisa una sola vez',
    trasDoble.datos.notificaciones.length === antesDeDoble + 1,
    `sumó ${trasDoble.datos.notificaciones.length - antesDeDoble}`);
  probar('y el que queda es el de respuesta', trasDoble.datos.notificaciones[0].tipo === 'respuesta');

  const gustosAntes = trasDoble.datos.notificaciones.filter((n) => n.tipo === 'megusta').length;
  await pedir(`/pios/${pioA}/megusta`, { metodo: 'POST', token: tokenB });
  const gustosDespues = (await pedir('/notificaciones', { token: tokenA }))
    .datos.notificaciones.filter((n) => n.tipo === 'megusta').length;
  probar('sacar el me gusta se lleva el aviso', gustosDespues === gustosAntes - 1,
    `${gustosAntes} -> ${gustosDespues}`);

  const borrable = await pedir('/pios', {
    metodo: 'POST',
    token: tokenC,
    cuerpo: { texto: 'esto lo borro enseguida @pinzon' },
  });
  const conBorrable = (await pedir('/notificaciones', { token: tokenA })).datos.notificaciones.length;
  await pedir(`/pios/${borrable.datos.pio.id}`, { metodo: 'DELETE', token: tokenC });
  const sinBorrable = (await pedir('/notificaciones', { token: tokenA })).datos.notificaciones.length;
  probar('borrar el pío se lleva sus avisos', sinBorrable === conBorrable - 1,
    `${conBorrable} -> ${sinBorrable}`);

  const marcado = await pedir('/notificaciones/leidas', { metodo: 'POST', token: tokenA });
  probar('marcar leídos deja el contador en cero', marcado.datos.sinLeer === 0);
  const yaLeidos = await pedir('/notificaciones', { token: tokenA });
  probar('los avisos siguen ahí, pero leídos',
    yaLeidos.datos.sinLeer === 0 && yaLeidos.datos.notificaciones.every((n) => n.leida));

  probar('los avisos piden sesión', (await pedir('/notificaciones')).estado === 401);

  // --- descubrir ----------------------------------------------------------

  grupo('Buscar y tendencias');
  const busqueda = await pedir('/buscar?q=gallinero');
  probar('la búsqueda encuentra por texto', busqueda.datos.pios.length === 1);
  const busquedaGente = await pedir('/buscar?q=cal');
  probar('la búsqueda encuentra pollitos', busquedaGente.datos.usuarios.some((u) => u.usuario === 'calandria'));

  const tendencias = await pedir('/tendencias');
  probar('#pio lidera las tendencias', tendencias.datos.tendencias[0].etiqueta === 'pio'
    && tendencias.datos.tendencias[0].total === 2,
    JSON.stringify(tendencias.datos.tendencias[0]));

  const rutaRara = await pedir('/gallinas');
  probar('una ruta desconocida devuelve 404', rutaRara.estado === 404);

  // --- persistencia -------------------------------------------------------

  grupo('Persistencia');
  // Se mide antes y se compara despues: clavar un numero a mano hace que
  // cualquier prueba nueva de mas arriba rompa esta, que no tiene la culpa.
  const plazaAntes = (await pedir('/pios?tipo=plaza')).datos.pios.length;
  const avisosAntes = (await pedir('/notificaciones', { token: tokenA })).datos.notificaciones.length;
  await new Promise((listo) => servidor.close(listo));
  const revivido = crearServidor({ datos: carpeta });
  await new Promise((listo) => revivido.listen(0, '127.0.0.1', listo));
  const base2 = `http://127.0.0.1:${revivido.address().port}`;

  const plazaTrasReinicio = await fetch(`${base2}/api/pios?tipo=plaza`).then((r) => r.json());
  probar('los píos sobreviven al reinicio',
    plazaAntes > 0 && plazaTrasReinicio.pios.length === plazaAntes,
    `antes ${plazaAntes}, después ${plazaTrasReinicio.pios.length}`);

  const avisosTrasReinicio = await fetch(`${base2}/api/notificaciones`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  }).then((r) => r.json());
  probar('los avisos sobreviven al reinicio',
    avisosAntes > 0 && avisosTrasReinicio.notificaciones.length === avisosAntes,
    `antes ${avisosAntes}, después ${avisosTrasReinicio.notificaciones.length}`);

  const sesionViva = await fetch(`${base2}/api/yo`, { headers: { Authorization: `Bearer ${tokenA}` } });
  probar('la sesión sobrevive al reinicio', sesionViva.status === 200);

  const portada = await fetch(`${base2}/`);
  probar('la portada se sirve', portada.status === 200
    && (await portada.text()).includes('Pío'));

  const escapeRuta = await fetch(`${base2}/../servidor.js`);
  probar('no se puede salir de publico/', !(await escapeRuta.text()).includes('crearServidor'));

  await new Promise((listo) => revivido.close(listo));
  fs.rmSync(carpeta, { recursive: true, force: true });

  // --- altas masivas ------------------------------------------------------

  grupo('Altas masivas');

  const limitador = new L.Limite({ cuantos: 2, ventana: 1000 });
  probar('con el cupo libre deja pasar', limitador.esperaDe('a', 0) === 0);
  limitador.anotar('a', 0);
  limitador.anotar('a', 100);
  probar('llegado al tope hace esperar', limitador.esperaDe('a', 200) > 0);
  probar('pasada la ventana vuelve a dejar', limitador.esperaDe('a', 1200) === 0);
  probar('cada clave lleva su propia cuenta', limitador.esperaDe('b', 200) === 0);
  probar('el IPv4 mapeado se normaliza',
    L.deDonde({ socket: { remoteAddress: '::ffff:127.0.0.1' } }) === '127.0.0.1');
  probar('no se confía en X-Forwarded-For, que lo escribe cualquiera',
    L.deDonde({
      socket: { remoteAddress: '10.0.0.9' },
      headers: { 'x-forwarded-for': '1.2.3.4' },
    }) === '10.0.0.9');

  // Detrás de un proxy hay que leer la cabecera, pero contando saltos: cada
  // proxy agrega al final a quien le habló, así que lo que el cliente haya
  // inventado queda a la izquierda y no se mira nunca.
  const traves = (xff, proxies) => L.deDonde({
    socket: { remoteAddress: '10.0.0.9' },
    headers: { 'x-forwarded-for': xff },
  }, proxies);

  probar('con un proxy delante, se lee la cabecera', traves('1.2.3.4', 1) === '1.2.3.4');
  probar('mentir en la cabecera no corre el cubo',
    traves('9.9.9.9, 1.2.3.4', 1) === '1.2.3.4', traves('9.9.9.9, 1.2.3.4', 1));
  probar('inventar una lista larga tampoco',
    traves('a, b, c, 1.2.3.4', 1) === '1.2.3.4');
  probar('con dos proxies se cuenta uno más atrás',
    traves('1.2.3.4, 10.0.0.1', 2) === '1.2.3.4');
  probar('sin cabecera se vuelve al socket', traves('', 1) === '10.0.0.9');
  probar('el IPv4 mapeado también se normaliza acá',
    traves('::ffff:1.2.3.4', 1) === '1.2.3.4');
  probar('con cero proxies la cabecera se sigue ignorando',
    traves('1.2.3.4', 0) === '10.0.0.9');

  const carpetaTope = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-tope-'));
  const conTope = crearServidor({
    datos: carpetaTope,
    api: { altas: 2, ventanaAltas: 60 * 1000 },
  });
  await new Promise((listo) => conTope.listen(0, '127.0.0.1', listo));
  const baseTope = `http://127.0.0.1:${conTope.address().port}`;

  const registrar = (base, cuerpo) => fetch(`${base}/api/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

  probar('la primera cuenta entra',
    (await registrar(baseTope, { usuario: 'uno', nombre: 'Uno', clave: 'semillas' })).status === 201);
  probar('la segunda también',
    (await registrar(baseTope, { usuario: 'dos', nombre: 'Dos', clave: 'semillas' })).status === 201);

  const tercera = await registrar(baseTope, { usuario: 'tres', nombre: 'Tres', clave: 'semillas' });
  probar('la tercera choca con el límite', tercera.status === 429, `estado ${tercera.status}`);
  probar('el 429 dice cuándo reintentar', /minuto/.test((await tercera.json()).error || ''));

  const entrarTope = await fetch(`${baseTope}/api/sesion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'uno', clave: 'semillas' }),
  });
  probar('el límite no le pega a quien ya tiene cuenta', entrarTope.status === 200);

  await new Promise((listo) => conTope.close(listo));
  fs.rmSync(carpetaTope, { recursive: true, force: true });

  const carpetaCupo = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-cupo-'));
  const conCupo = crearServidor({
    datos: carpetaCupo,
    api: { altas: 1, ventanaAltas: 60 * 1000 },
  });
  await new Promise((listo) => conCupo.listen(0, '127.0.0.1', listo));
  const baseCupo = `http://127.0.0.1:${conCupo.address().port}`;

  const corta = await registrar(baseCupo, { usuario: 'x', nombre: 'X', clave: 'semillas' });
  probar('un alta inválida se rechaza', corta.status === 400, `estado ${corta.status}`);
  const despues = await registrar(baseCupo, { usuario: 'valido', nombre: 'Válido', clave: 'semillas' });
  probar('el intento fallido no gastó cupo', despues.status === 201, `estado ${despues.status}`);

  await new Promise((listo) => conCupo.close(listo));
  fs.rmSync(carpetaCupo, { recursive: true, force: true });

  // --- nombres reservados -------------------------------------------------

  grupo('Nombres reservados');
  const R = require('../src/reservados');
  probar('pio está reservado', R.esReservado('pio'));
  probar('admin está reservado', R.esReservado('admin'));
  probar('pollito está reservado', R.esReservado('pollito'));
  probar('la comparación no distingue mayúsculas', R.esReservado('AdMiN'));
  probar('un nombre común no está reservado', !R.esReservado('pinzon'));
  probar('el modelo rechaza un reservado',
    (M.validarUsuario('admin') || {}).clave === 'usuario.reservado');
  probar('y deja pasar uno libre', M.validarUsuario('pinzon') === null);
  probar('ningún reservado viola la propia regla de usuario',
    [...R.RESERVADOS].every((u) => /^[a-z0-9_]{3,15}$/.test(u)),
    [...R.RESERVADOS].filter((u) => !/^[a-z0-9_]{3,15}$/.test(u)).join());

  const carpetaRes = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-reservados-'));
  const conRes = crearServidor({ datos: carpetaRes });
  await new Promise((listo) => conRes.listen(0, '127.0.0.1', listo));
  const baseRes = `http://127.0.0.1:${conRes.address().port}`;

  const pedirAlta = (usuario) => fetch(`${baseRes}/api/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, nombre: 'Alguien', clave: 'semillas' }),
  });

  probar('registrarse como admin se rechaza', (await pedirAlta('admin')).status === 400);
  probar('registrarse como pio se rechaza', (await pedirAlta('pio')).status === 400);
  probar('un nombre libre sí entra', (await pedirAlta('jilguero')).status === 201);

  await new Promise((listo) => conRes.close(listo));
  fs.rmSync(carpetaRes, { recursive: true, force: true });
  // --- entrar con Google --------------------------------------------------

  // Sin credenciales de verdad: se genera un par RSA propio y se le inyecta
  // al verificador un lector de claves falso. Asi se ejercita la verificacion
  // de firma completa, que es justo la parte que no puede fallar.
  grupo('Entrar con Google');

  const par = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = par.publicKey.export({ format: 'jwk' });
  Object.assign(jwk, { kid: 'clave-de-prueba', alg: 'RS256', use: 'sig' });

  const CLIENTE = '1234567890-abcdef.apps.googleusercontent.com';
  const lectorFalso = async () => ({
    ok: true,
    json: async () => ({ keys: [jwk] }),
    headers: { get: () => 'max-age=3600' },
  });

  const aB64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  function firmar(carga, opciones = {}) {
    const cabecera = aB64({ alg: opciones.alg || 'RS256', kid: opciones.kid || 'clave-de-prueba', typ: 'JWT' });
    const cuerpoB64 = aB64(carga);
    const firma = crypto.sign('RSA-SHA256', Buffer.from(`${cabecera}.${cuerpoB64}`), par.privateKey);
    return `${cabecera}.${cuerpoB64}.${firma.toString('base64url')}`;
  }
  const tokenCon = (extra = {}, opciones = {}) => firmar(Object.assign({
    iss: 'https://accounts.google.com',
    aud: CLIENTE,
    sub: '100000000000000000001',
    email: 'pinzon.dorado@gmail.com',
    email_verified: true,
    name: 'Pinzon Dorado',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }, extra), opciones);

  const { Google } = require('../src/google');
  const verificador = new Google(CLIENTE, { traer: lectorFalso });
  const rechaza = async (token, porque) => {
    try { await verificador.verificar(token); return false; } catch (err) { void porque; return true; }
  };

  const bueno = await verificador.verificar(tokenCon());
  probar('un token legítimo se acepta', bueno.sub === '100000000000000000001');
  probar('y trae el correo y el nombre',
    bueno.email === 'pinzon.dorado@gmail.com' && bueno.nombre === 'Pinzon Dorado');

  probar('un token para otra aplicación se rechaza', await rechaza(tokenCon({ aud: 'otra-app' })));
  probar('un emisor que no es Google se rechaza', await rechaza(tokenCon({ iss: 'https://malo.example' })));
  probar('un token vencido se rechaza',
    await rechaza(tokenCon({ exp: Math.floor(Date.now() / 1000) - 10 })));
  probar('un correo sin verificar se rechaza', await rechaza(tokenCon({ email_verified: false })));
  probar('una clave desconocida se rechaza', await rechaza(tokenCon({}, { kid: 'otra' })));
  probar('el algoritmo lo manda el servidor, no el token',
    await rechaza(tokenCon({}, { alg: 'HS256' })));
  probar('cualquier cosa que no sea un token se rechaza', await rechaza('esto.no.es'));

  const manoseado = tokenCon().split('.');
  manoseado[1] = aB64({ iss: 'https://accounts.google.com', aud: CLIENTE, sub: 'intruso',
    email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600 });
  probar('cambiarle el contenido rompe la firma', await rechaza(manoseado.join('.')));

  const apagado = new Google(null, { traer: lectorFalso });
  probar('sin client id no verifica nada', await (async () => {
    try { await apagado.verificar(tokenCon()); return false; } catch { return true; }
  })());

  // --- y ahora por HTTP ---

  const carpetaG = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-google-'));
  const conGoogle = crearServidor({
    datos: carpetaG,
    api: { googleClienteId: CLIENTE, google: { traer: lectorFalso } },
  });
  await new Promise((listo) => conGoogle.listen(0, '127.0.0.1', listo));
  const baseG = `http://127.0.0.1:${conGoogle.address().port}`;

  const conGoogleEntrar = (credencial) => fetch(`${baseG}/api/sesion/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credencial }),
  });

  const config = await fetch(`${baseG}/api/config`).then((r) => r.json());
  probar('la config publica el client id', config.google === CLIENTE);

  const primera = await conGoogleEntrar(tokenCon());
  const datosPrimera = await primera.json();
  probar('la primera vez crea la cuenta', primera.status === 201, `estado ${primera.status}`);
  probar('el usuario sale del correo', datosPrimera.yo.usuario === 'pinzondorado',
    datosPrimera.yo.usuario);
  probar('y se queda con el nombre de Google', datosPrimera.yo.nombre === 'Pinzon Dorado');

  const segunda = await conGoogleEntrar(tokenCon());
  const datosSegunda = await segunda.json();
  probar('la segunda vez entra, no duplica', segunda.status === 200 &&
    datosSegunda.yo.usuario === 'pinzondorado', `estado ${segunda.status}`);

  const porClave = await fetch(`${baseG}/api/sesion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'pinzondorado', clave: '' }),
  });
  probar('a una cuenta de Google no se entra con clave', porClave.status === 401,
    `estado ${porClave.status}`);

  const otroConMismoNombre = await conGoogleEntrar(
    tokenCon({ sub: '200000000000000000002', email: 'pinzon.dorado@otrocorreo.com', name: 'Otro Dorado' })
  );
  const datosOtro = await otroConMismoNombre.json();
  probar('si el usuario está tomado, se numera', datosOtro.yo.usuario === 'pinzondorado2',
    datosOtro.yo.usuario);

  probar('un token inválido no entra', (await conGoogleEntrar('no.es.token')).status === 401);

  await new Promise((listo) => conGoogle.close(listo));
  fs.rmSync(carpetaG, { recursive: true, force: true });

  const carpetaPelada = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-pelado-'));
  const pelado = crearServidor({ datos: carpetaPelada });
  await new Promise((listo) => pelado.listen(0, '127.0.0.1', listo));
  const basePelado = `http://127.0.0.1:${pelado.address().port}`;

  const sinGoogle = await fetch(`${basePelado}/api/config`).then((r) => r.json());
  probar('sin configurar, la config lo dice', sinGoogle.google === null);
  const intento = await fetch(`${basePelado}/api/sesion/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credencial: 'lo.que.sea' }),
  });
  probar('y entrar con Google devuelve 501', intento.status === 501, `estado ${intento.status}`);

  await new Promise((listo) => pelado.close(listo));
  fs.rmSync(carpetaPelada, { recursive: true, force: true });

  // --- imagenes -----------------------------------------------------------

  // Con un enviador falso: se ejercita todo el camino propio (validacion,
  // firma real del archivo, saneado de la URL) sin subir nada a ningun lado.
  grupo('Imágenes');
  const IMG = require('../src/imagenes');
  const { crearSubidor, tipoReal } = IMG;

  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  probar('reconoce un PNG por su firma', tipoReal(Buffer.from(PNG, 'base64')) === 'image/png');
  probar('reconoce un GIF por su firma', tipoReal(Buffer.from(GIF, 'base64')) === 'image/gif');
  probar('no se cree el tipo que dice el cliente',
    tipoReal(Buffer.from('MZ esto es un ejecutable', 'utf8')) === null);

  probar('la URL de ImgBB pasa', !!IMG.urlDeImgbb('https://i.ibb.co/abc/x.png'));
  probar('otro dominio no pasa', IMG.urlDeImgbb('https://malo.example/x.png') === null);
  probar('http no pasa', IMG.urlDeImgbb('http://i.ibb.co/abc/x.png') === null);
  probar('javascript: no pasa', IMG.urlDeImgbb('javascript:alert(1)') === null);

  const respuestaFalsa = (data) => async () => ({
    ok: true,
    json: async () => ({ success: true, data }),
  });

  const subidor = crearSubidor({ imgbbClave: 'clave-de-prueba' }, {
    enviar: respuestaFalsa({
      url: 'https://i.ibb.co/abc/x.png',
      thumb: { url: 'https://i.ibb.co/abc/chico.png' },
      width: 1,
      height: 1,
    }),
  });

  const subida = await subidor.subir(`data:image/png;base64,${PNG}`);
  probar('una imagen válida sube', subida.url === 'https://i.ibb.co/abc/x.png');
  probar('y vuelve con su miniatura y su tipo',
    subida.miniatura.includes('chico') && subida.tipo === 'image/png');

  const rechazaImagen = async (que) => {
    try { await subidor.subir(que); return false; } catch (err) { return !!err.clave; }
  };
  probar('lo que no es imagen se rechaza', await rechazaImagen(Buffer.from('hola').toString('base64')));
  probar('vacío se rechaza', await rechazaImagen(''));

  const apretado = crearSubidor({ imgbbClave: 'clave-de-prueba' },
    { tope: 10, enviar: respuestaFalsa({ url: 'https://i.ibb.co/a.png' }) });
  let pesada = false;
  try { await apretado.subir(PNG); } catch (err) { pesada = err.clave === 'imagen.pesada'; }
  probar('una imagen pesada se rechaza antes de salir', pesada);

  const sinClave = crearSubidor({});
  let apagada = false;
  try { await sinClave.subir(PNG); } catch (err) { apagada = err.clave === 'imagen.apagada'; }
  probar('sin clave no sube nada', apagada);

  const mentirosa = crearSubidor({ imgbbClave: 'clave-de-prueba' }, {
    enviar: respuestaFalsa({ url: 'https://malo.example/x.png' }),
  });
  let rara = false;
  try { await mentirosa.subir(PNG); } catch (err) { rara = err.clave === 'imagen.rara'; }
  probar('una URL de otro dominio en la respuesta se rechaza', rara);

  // --- y por HTTP ---

  const carpetaImg = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-img-'));
  const conImg = crearServidor({
    datos: carpetaImg,
    api: {
      imgbbClave: 'clave-de-prueba',
      imagenes: { enviar: respuestaFalsa({ url: 'https://i.ibb.co/abc/x.png', width: 1, height: 1 }) },
    },
  });
  await new Promise((listo) => conImg.listen(0, '127.0.0.1', listo));
  const baseImg = `http://127.0.0.1:${conImg.address().port}`;

  const altaImg = await fetch(`${baseImg}/api/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'jilguero', nombre: 'Jilguero', clave: 'semillas' }),
  }).then((r) => r.json());

  const subir = (imagen, token) => fetch(`${baseImg}/api/imagenes`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' },
      token ? { Authorization: `Bearer ${token}` } : {}),
    body: JSON.stringify({ imagen }),
  });

  probar('subir sin sesión devuelve 401', (await subir(PNG)).status === 401);
  const subidaHttp = await subir(PNG, altaImg.token);
  probar('con sesión, sube y devuelve 201', subidaHttp.status === 201, `estado ${subidaHttp.status}`);
  probar('y responde con la dirección de la imagen',
    (await subidaHttp.json()).imagen.url === 'https://i.ibb.co/abc/x.png');

  const configImg = await fetch(`${baseImg}/api/config`).then((r) => r.json());
  probar('la config avisa que las imágenes están encendidas', configImg.imagenes === true);
  probar('y dice con qué proveedor', configImg.proveedorImagenes === 'imgbb');

  await new Promise((listo) => conImg.close(listo));
  fs.rmSync(carpetaImg, { recursive: true, force: true });
  // --- cloudinary ---------------------------------------------------------

  grupo('Cloudinary');

  const esperado = crypto.createHash('sha1').update('a=1&b=2secreto').digest('hex');
  probar('la firma ordena los parámetros y le pega el secreto',
    IMG.firmar({ b: 2, a: 1 }, 'secreto') === esperado);

  const nubeFalsa = (data) => async () => ({ ok: true, json: async () => data });
  const AJUSTES_NUBE = { cloudinary: { nube: 'mi-nube', clave: '123', secreto: 'abc' } };

  const porNube = crearSubidor(AJUSTES_NUBE, {
    enviar: nubeFalsa({ secure_url: 'https://res.cloudinary.com/mi-nube/image/upload/v1/x.png', width: 4, height: 4 }),
    ahora: () => 1700000000000,
  });
  probar('con credenciales de nube, elige Cloudinary', porNube.nombre === 'cloudinary');

  const enNube = await porNube.subir(PNG);
  probar('sube y devuelve la URL segura', enNube.url.includes('res.cloudinary.com'));
  probar('arma la miniatura transformando la URL', enNube.miniatura.includes('c_fill,w_320'));
  probar('y dice de qué proveedor vino', enNube.proveedor === 'cloudinary');

  probar('otro dominio no pasa el saneado', IMG.urlDeCloudinary('https://malo.example/x.png') === null);

  const dosProveedores = crearSubidor(
    Object.assign({ imgbbClave: 'k', proveedor: 'imgbb' }, AJUSTES_NUBE),
    { enviar: nubeFalsa({}) });
  probar('la configuración decide cuál gana', dosProveedores.nombre === 'imgbb');

  const soloNube = crearSubidor(AJUSTES_NUBE, { enviar: nubeFalsa({}) });
  probar('sin preferencia, gana Cloudinary', soloNube.nombre === 'cloudinary');

  // --- gifs ---------------------------------------------------------------

  const { partirUrlCloudinary } = require('../src/ajustes');
  const partida = partirUrlCloudinary('cloudinary://123456789:abcDEF_secreto@mi-nube');
  probar('el CLOUDINARY_URL se parte en sus tres datos',
    partida.nube === 'mi-nube' && partida.clave === '123456789' && partida.secreto === 'abcDEF_secreto');
  probar('una URL de otro esquema se ignora',
    Object.keys(partirUrlCloudinary('https://res.cloudinary.com/x')).length === 0);
  probar('y sin URL no rompe nada', Object.keys(partirUrlCloudinary(null)).length === 0);

  grupo('GIF');
  const GIFS = require('../src/gifs');

  probar('una URL de Giphy pasa', !!GIFS.urlDeGiphy('https://media.giphy.com/media/x/giphy.gif'));
  probar('otro dominio no pasa', GIFS.urlDeGiphy('https://malo.example/x.gif') === null);
  probar('http no pasa', GIFS.urlDeGiphy('http://media.giphy.com/x.gif') === null);

  const unGif = (id) => ({
    id,
    title: `gif ${id}`,
    images: {
      fixed_height: { url: `https://media.giphy.com/media/${id}/giphy.gif`, width: '200', height: '150' },
      fixed_height_small: { url: `https://media.giphy.com/media/${id}/chico.gif` },
    },
  });

  let ultimaUrl = null;
  const giphyFalso = async (u) => {
    ultimaUrl = u;
    return { ok: true, json: async () => ({ data: [unGif('a'), unGif('b')] }) };
  };

  const buscador = GIFS.crearGifs({ giphyClave: 'clave-de-prueba' }, { traer: giphyFalso });
  probar('con clave, el buscador está activo', buscador.activo === true);

  const hallados = await buscador.buscar('pollito');
  probar('devuelve los GIF limpios', hallados.length === 2 && hallados[0].id === 'a');
  probar('con su miniatura aparte', hallados[0].miniatura.includes('chico'));
  probar('busca en el endpoint de búsqueda', ultimaUrl.includes('/search?'));
  probar('y nunca pide material que no sea apto', ultimaUrl.includes('rating=g'));

  await buscador.buscar('');
  probar('sin texto muestra tendencias', ultimaUrl.includes('/trending?'));

  const sinGiphy = GIFS.crearGifs({});
  probar('sin clave queda apagado', sinGiphy.activo === false);
  let gifApagado = false;
  try { await sinGiphy.buscar('x'); } catch (err) { gifApagado = err.clave === 'gif.apagado'; }
  probar('y buscar sin clave falla claro', gifApagado);

  const carpetaGif = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-gif-'));
  const conGif = crearServidor({
    datos: carpetaGif,
    api: { giphyClave: 'clave-de-prueba', gifs: { traer: giphyFalso } },
  });
  await new Promise((listo) => conGif.listen(0, '127.0.0.1', listo));
  const baseGif = `http://127.0.0.1:${conGif.address().port}`;

  probar('buscar GIF sin sesión devuelve 401',
    (await fetch(`${baseGif}/api/gifs?q=pollito`)).status === 401);

  const altaGif = await fetch(`${baseGif}/api/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'jilguero', nombre: 'Jilguero', clave: 'semillas' }),
  }).then((r) => r.json());

  const conSesion = await fetch(`${baseGif}/api/gifs?q=pollito`, {
    headers: { Authorization: `Bearer ${altaGif.token}` },
  });
  probar('con sesión, devuelve resultados', conSesion.status === 200);
  probar('y son los GIF limpios', (await conSesion.json()).gifs.length === 2);

  await new Promise((listo) => conGif.close(listo));
  fs.rmSync(carpetaGif, { recursive: true, force: true });
  // --- respuestas en cascada ----------------------------------------------

  grupo('Cascada');

  const carpetaCas = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-cascada-'));
  const conCas = crearServidor({ datos: carpetaCas });
  await new Promise((listo) => conCas.listen(0, '127.0.0.1', listo));
  const baseCas = `http://127.0.0.1:${conCas.address().port}`;

  const pedirCas = async (ruta, o = {}) => {
    const r = await fetch(`${baseCas}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };

  const tokenCas = (await pedirCas('/registro', {
    metodo: 'POST',
    cuerpo: { usuario: 'jilguero', nombre: 'Jilguero', clave: 'semillas' },
  })).datos.token;

  const piar = async (texto, respuestaA) =>
    (await pedirCas('/pios', { metodo: 'POST', token: tokenCas, cuerpo: { texto, respuestaA } })).datos.pio.id;

  const raiz = await piar('La raíz de todo el hilo');
  const r1 = await piar('Primera respuesta', raiz);
  const r2 = await piar('Respuesta a la respuesta', r1);
  const r3 = await piar('Y más hondo todavía', r2);
  const otra = await piar('Otra rama desde la raíz', raiz);

  const hiloCas = (await pedirCas(`/pios/${raiz}/hilo`, { token: tokenCas })).datos;

  probar('la raíz tiene dos ramas propias', hiloCas.despues.length === 2,
    `vio ${hiloCas.despues.length}`);
  probar('las hermanas van de más vieja a más nueva',
    hiloCas.despues[0].id === r1 && hiloCas.despues[1].id === otra);
  probar('la respuesta anida su propia respuesta',
    hiloCas.despues[0].ramas.length === 1 && hiloCas.despues[0].ramas[0].id === r2);
  probar('y esa anida la siguiente',
    hiloCas.despues[0].ramas[0].ramas[0].id === r3);
  probar('cada rama sabe a qué hondura está',
    hiloCas.despues[0].hondo === 1 && hiloCas.despues[0].ramas[0].hondo === 2
    && hiloCas.despues[0].ramas[0].ramas[0].hondo === 3);
  probar('el hilo cuenta todas sus respuestas, no sólo las directas',
    hiloCas.respuestasTotales === 4, `contó ${hiloCas.respuestasTotales}`);
  probar('una rama sin hijos llega vacía, no indefinida',
    Array.isArray(hiloCas.despues[1].ramas) && hiloCas.despues[1].ramas.length === 0);

  // Una cadena más honda que el tope: se corta, no se cuelga ni crece sola.
  let cadena = await piar('Arranque de la cadena larga');
  for (let i = 0; i < 12; i += 1) cadena = await piar(`Eslabón ${i}`, cadena);
  const larga = (await pedirCas('/pios?tipo=plaza')).datos;
  void larga;

  const hondo = (nodo, n) => (nodo.ramas && nodo.ramas.length ? hondo(nodo.ramas[0], n + 1) : n);
  const hiloLargo = (await pedirCas(`/pios/${raiz}/hilo`)).datos;
  void hiloLargo;

  const arranque = (await pedirCas('/pios?tipo=plaza')).datos.pios.find((p) => p.texto.includes('cadena larga'));
  const hiloHondo = (await pedirCas(`/pios/${arranque.id}/hilo`)).datos;
  probar('la cascada se corta en la hondura máxima', hondo(hiloHondo.despues[0], 1) === 8,
    `llegó a ${hondo(hiloHondo.despues[0], 1)}`);

  probar('el hilo de una hoja trae toda su ascendencia',
    (await pedirCas(`/pios/${r3}/hilo`)).datos.antes.length === 3);

  // Un ciclo a mano en el JSON: antes esto colgaba el servidor para siempre.
  conCas.almacen.buscarPio(raiz).respuestaA = r1;
  const conCiclo = await pedirCas(`/pios/${raiz}/hilo`);
  probar('un ciclo entre píos no cuelga el servidor', conCiclo.estado === 200);
  conCas.almacen.buscarPio(raiz).respuestaA = null;

  await new Promise((listo) => conCas.close(listo));
  fs.rmSync(carpetaCas, { recursive: true, force: true });
  // --- adjuntos -----------------------------------------------------------

  grupo('Adjuntos');
  const { limpiarAdjunto } = require('../src/api');

  const CLOUD = 'https://res.cloudinary.com/nube/image/upload/v1/x.png';
  const GIPHY = 'https://media.giphy.com/media/abc/giphy.gif';

  probar('una imagen de Cloudinary pasa', limpiarAdjunto({ url: CLOUD }).url === CLOUD);
  probar('un GIF de Giphy pasa', limpiarAdjunto({ url: GIPHY }).url === GIPHY);
  probar('sin adjunto devuelve null', limpiarAdjunto(null) === null);

  const rebota = (que) => {
    try { limpiarAdjunto(que); return false; } catch (err) { return err.clave === 'adjunto.origen'; }
  };
  probar('otro dominio se rechaza', rebota({ url: 'https://malo.example/x.png' }));
  probar('http se rechaza', rebota({ url: 'http://res.cloudinary.com/n/x.png' }));
  probar('javascript: se rechaza', rebota({ url: 'javascript:alert(1)' }));
  probar('sin url se rechaza', rebota({ texto: 'sólo texto' }));

  const conMedidas = limpiarAdjunto({ url: CLOUD, ancho: '640.7', alto: -3, miniatura: 'https://malo.example/m.png' });
  probar('las medidas se redondean', conMedidas.ancho === 641);
  probar('una medida imposible queda en nada', conMedidas.alto === null);
  probar('una miniatura de otro dominio cae en la imagen entera', conMedidas.miniatura === CLOUD);

  const largoAlt = limpiarAdjunto({ url: CLOUD, texto: 'a'.repeat(200) });
  probar('el texto alternativo se recorta a cien', M.largo(largoAlt.texto) === 100);

  // --- y por HTTP ---

  const carpetaAdj = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-adj-'));
  const conAdj = crearServidor({ datos: carpetaAdj });
  await new Promise((listo) => conAdj.listen(0, '127.0.0.1', listo));
  const baseAdj = `http://127.0.0.1:${conAdj.address().port}`;

  const pedirAdj = async (ruta, o = {}) => {
    const r = await fetch(`${baseAdj}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };

  const tokenAdj = (await pedirAdj('/registro', {
    metodo: 'POST',
    cuerpo: { usuario: 'jilguero', nombre: 'Jilguero', clave: 'semillas' },
  })).datos.token;

  const soloImagen = await pedirAdj('/pios', {
    metodo: 'POST', token: tokenAdj, cuerpo: { texto: '', adjunto: { url: CLOUD } },
  });
  probar('un pío de sólo imagen se publica', soloImagen.estado === 201, `estado ${soloImagen.estado}`);
  probar('y el adjunto vuelve en el pío', soloImagen.datos.pio.adjunto.url === CLOUD);

  const nadaDeNada = await pedirAdj('/pios', { metodo: 'POST', token: tokenAdj, cuerpo: { texto: '  ' } });
  probar('sin texto y sin imagen sigue sin ser un pío', nadaDeNada.estado === 400);

  const conImagenYLargo = await pedirAdj('/pios', {
    metodo: 'POST',
    token: tokenAdj,
    cuerpo: { texto: 'a'.repeat(101), adjunto: { url: CLOUD } },
  });
  probar('la imagen no compra permiso para pasarse de cien', conImagenYLargo.estado === 400,
    `estado ${conImagenYLargo.estado}`);

  const inventada = await pedirAdj('/pios', {
    metodo: 'POST',
    token: tokenAdj,
    cuerpo: { texto: 'mirá esto', adjunto: { url: 'https://malo.example/x.png' } },
  });
  probar('una URL inventada por el cliente se rechaza', inventada.estado === 400
    && inventada.datos.clave === 'adjunto.origen');

  const sinNada = await pedirAdj('/pios', { metodo: 'POST', token: tokenAdj, cuerpo: { texto: 'pío pelado' } });
  probar('un pío sin adjunto lo trae en null', sinNada.datos.pio.adjunto === null);

  await new Promise((listo) => conAdj.close(listo));
  fs.rmSync(carpetaAdj, { recursive: true, force: true });
  // --- depositos ----------------------------------------------------------

  grupo('Depósitos');
  const DEP = require('../src/deposito');

  const carpetaDep = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-dep-'));
  const enArchivo = new DEP.DepositoArchivo(carpetaDep);
  probar('sin archivo, el depósito arranca vacío', (await enArchivo.cargar()).pios.length === 0);

  const estado = DEP.vacio();
  estado.pios.push({ id: 'p1', autor: 'jilguero', texto: 'hola' });
  estado.secuencia = 9;
  await enArchivo.guardar(estado, []);
  const releido = await enArchivo.cargar();
  probar('lo guardado vuelve igual', releido.pios[0].texto === 'hola' && releido.secuencia === 9);
  fs.rmSync(carpetaDep, { recursive: true, force: true });

  // El de Supabase, con un enviador falso que anota lo que le piden.
  const pedidos = [];
  const supFalso = async (url, opciones) => {
    pedidos.push({ url, metodo: opciones.method, cuerpo: opciones.body ? JSON.parse(opciones.body) : null });
    if (/pio_usuarios\?select/.test(url)) return { ok: true, status: 200, json: async () => ([{ datos: { usuario: 'jilguero' } }]) };
    if (/pio_pios\?select/.test(url)) return { ok: true, status: 200, json: async () => ([{ datos: { id: 'p1', autor: 'jilguero' } }]) };
    if (/pio_sesiones\?select/.test(url)) return { ok: true, status: 200, json: async () => ([{ token: 'tk', usuario: 'jilguero', creada: 5 }]) };
    if (/pio_avisos\?select/.test(url)) return { ok: true, status: 200, json: async () => ([{ datos: { id: 'n1', para: 'jilguero' } }]) };
    if (/pio_meta\?select/.test(url)) return { ok: true, status: 200, json: async () => ([{ clave: 'secuencia', valor: 12 }]) };
    return { ok: true, status: 204, json: async () => null };
  };

  const depNube = new DEP.DepositoSupabase({ url: 'https://x.supabase.co/', clave: 'k' }, { enviar: supFalso });
  const cargado = await depNube.cargar();
  probar('la carga arma el estado desde las cinco tablas',
    cargado.usuarios.length === 1 && cargado.pios.length === 1
    && cargado.notificaciones.length === 1 && cargado.secuencia === 12);
  probar('las sesiones vuelven a su forma de objeto',
    cargado.sesiones.tk && cargado.sesiones.tk.usuario === 'jilguero');
  probar('la barra de más en la URL no duplica', pedidos.every((p) => !p.url.includes('//rest')));

  pedidos.length = 0;
  await depNube.guardar(null, [
    { tabla: 'pio_pios', clave: 'p1', valor: { id: 'p1', autor: 'jilguero', creado: 1, respuestaA: null } },
    { tabla: 'pio_pios', clave: 'p2', valor: { id: 'p2', autor: 'calandria', creado: 2, respuestaA: 'p1' } },
    { tabla: 'pio_avisos', clave: 'n1', valor: { id: 'n1', para: 'jilguero', creado: 3 } },
  ]);
  probar('las altas de una misma tabla van en un solo pedido', pedidos.length === 2, `hizo ${pedidos.length}`);
  const dePios = pedidos.find((p) => p.url.includes('pio_pios'));
  probar('y llevan las dos filas juntas', dePios.cuerpo.length === 2);
  probar('la columna de respuesta sale del campo del objeto', dePios.cuerpo[1].respuesta_a === 'p1');
  probar('el objeto entero viaja en datos', dePios.cuerpo[0].datos.autor === 'jilguero');

  pedidos.length = 0;
  await depNube.guardar(null, [
    { tabla: 'pio_meta', clave: 'secuencia', valor: { clave: 'secuencia', valor: 1 } },
    { tabla: 'pio_meta', clave: 'secuencia', valor: { clave: 'secuencia', valor: 2 } },
  ]);
  probar('tocar dos veces la misma fila manda una sola', pedidos[0].cuerpo.length === 1);
  probar('y se queda con el último valor', pedidos[0].cuerpo[0].valor === 2);

  pedidos.length = 0;
  await depNube.guardar(null, [{ tabla: 'pio_pios', clave: 'p9', valor: null }]);
  probar('un valor nulo se traduce en borrado', pedidos[0].metodo === 'DELETE');
  probar('y apunta a su llave', pedidos[0].url.includes('id=in.'));

  const roto = new DEP.DepositoSupabase(
    { url: 'https://x.supabase.co', clave: 'k' },
    { enviar: async () => ({ ok: false, status: 401, text: async () => 'clave inválida' }) });
  let fallo = '';
  try { await roto.cargar(); } catch (err) { fallo = err.message; }
  probar('un error de Supabase llega con su código y su texto',
    fallo.includes('401') && fallo.includes('inválida'), fallo);

  probar('sin credenciales se elige el archivo',
    DEP.crearDeposito('/tmp/x', {}).nombre === 'archivo');
  probar('con credenciales se elige Supabase',
    DEP.crearDeposito('/tmp/x', { supabase: { url: 'u', clave: 'k' } }).nombre === 'supabase');
  probar('pedir archivo a mano le gana a las credenciales',
    DEP.crearDeposito('/tmp/x', { deposito: 'archivo', supabase: { url: 'u', clave: 'k' } }).nombre === 'archivo');
  // --- resumen ------------------------------------------------------------

  console.log(`\n${'─'.repeat(46)}`);
  if (fallas.length) {
    console.log(`${pasadas} bien, ${fallas.length} mal:`);
    for (const f of fallas) console.log(`  · ${f}`);
    process.exit(1);
  }
  console.log(`🐤 ${pasadas} pruebas, todas en verde.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
