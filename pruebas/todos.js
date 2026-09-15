'use strict';

// Batería de pruebas de Pío. Levanta un servidor real en un puerto libre,
// con datos en una carpeta temporal, y le pega por HTTP como lo haría el cliente.
//   node pruebas/todos.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
// Sin incubación: casi todas las pruebas publican y leen enseguida. Las del
// huevo la encienden a mano.
process.env.PIO_INCUBACION_SEGUNDOS = '0';
const { crearServidor } = require('../servidor');
const LAT = require('../src/latido');
const FRASES = require('../src/frases');
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
  probar('no te puedes seguir a ti mismo', autoSeguir.estado === 400);

  await pedir('/usuarios/calandria/seguir', { metodo: 'POST', token: tokenA });
  const nidoSinCalandria = await pedir('/pios?tipo=nido', { token: tokenA });
  probar('dejar de seguir saca sus píos del nido', nidoSinCalandria.datos.pios.length === 1);
  await pedir('/usuarios/calandria/seguir', { metodo: 'POST', token: tokenA });

  // --- me gusta y repío ---------------------------------------------------

  grupo('Me gusta y repíos');
  const gusto = await pedir(`/pios/${pioA}/megusta`, { metodo: 'POST', token: tokenB });
  // El número sólo lo ve quien escribió el pío; quien da el me gusta sabe que lo dio.
  probar('me gusta queda marcado', gusto.datos.pio.yoMeGusta === true);
  probar('quien da me gusta no ve el marcador', gusto.datos.pio.meGusta === null);
  probar('quien escribió el pío sí',
    (await pedir(`/pios/${pioA}/hilo`, { token: tokenA })).datos.pio.meGusta === 1);
  probar('y sin sesión tampoco se ve', (await pedir(`/pios/${pioA}/hilo`)).datos.pio.meGusta === null);
  const noGusto = await pedir(`/pios/${pioA}/megusta`, { metodo: 'POST', token: tokenB });
  probar('volver a tocar lo saca', noGusto.datos.pio.yoMeGusta === false
    && (await pedir(`/pios/${pioA}/hilo`, { token: tokenA })).datos.pio.meGusta === 0);
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
  // Una conversación escondida en el hilo es una conversación que nadie encuentra.
  probar('las respuestas también se ven en la plaza', plazaConRespuesta.datos.pios.length === 3,
    `vio ${plazaConRespuesta.datos.pios.length}`);
  const laRespuesta = plazaConRespuesta.datos.pios.find((p) => p.respuestaA === pioA);
  probar('y dicen a quién le contestan', !!laRespuesta && !!laRespuesta.respuestaAUsuario,
    JSON.stringify(laRespuesta && laRespuesta.respuestaAUsuario));

  const respuestaFantasma = await pedir('/pios', {
    metodo: 'POST',
    token: tokenB,
    cuerpo: { texto: 'a un pío que no existe', respuestaA: 'pzzz' },
  });
  probar('responder a un pío inexistente devuelve 404', respuestaFantasma.estado === 404);

  // --- borrar -------------------------------------------------------------

  grupo('Borrar');
  const borrarAjeno = await pedir(`/pios/${pioA}`, { metodo: 'DELETE', token: tokenB });
  probar('no puedes borrar un pío ajeno', borrarAjeno.estado === 403);

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

  // Lo que de verdad manda Render: el visitante, el borde de Cloudflare y el
  // balanceador interno, que rota en cada petición. Con un solo salto se
  // tomaba ese último y cada alta estrenaba cubo. Son tres.
  const COMO_RENDER = '181.172.77.97, 172.68.174.95, 10.28.241.110';
  probar('tres saltos dan con el visitante real',
    traves(COMO_RENDER, 3) === '181.172.77.97');
  probar('un solo salto agarraba el balanceador, que rota',
    traves(COMO_RENDER, 1) === '10.28.241.110');
  probar('y mentir delante de esos tres sigue sin servir',
    traves('9.9.9.9, ' + COMO_RENDER, 3) === '181.172.77.97');

  // Una cabecera que la plataforma sobrescribe siempre es más firme que
  // contar saltos, porque no depende de cuántos proxies haya.
  const porCabecera = (cabeceras, conf) => L.deDonde({
    socket: { remoteAddress: '10.0.0.9' },
    headers: cabeceras,
  }, conf);

  probar('la cabecera de confianza gana sobre el conteo de saltos',
    porCabecera(
      { 'cf-connecting-ip': '181.172.77.97', 'x-forwarded-for': '9.9.9.9' },
      { proxies: 1, cabecera: 'cf-connecting-ip' },
    ) === '181.172.77.97');

  probar('si esa cabecera no viene, se vuelve al conteo de saltos',
    porCabecera(
      { 'x-forwarded-for': COMO_RENDER },
      { proxies: 3, cabecera: 'cf-connecting-ip' },
    ) === '181.172.77.97');

  probar('sin configurarla, esa cabecera no se mira aunque venga',
    porCabecera(
      { 'cf-connecting-ip': '1.2.3.4' },
      { proxies: 0 },
    ) === '10.0.0.9');

  probar('un número suelto sigue significando saltos, como antes',
    L.deDonde({ socket: { remoteAddress: '10.0.0.9' }, headers: { 'x-forwarded-for': '1.2.3.4' } }, 1)
    === '1.2.3.4');

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
    cuerpo: { texto: 'mira esto', adjunto: { url: 'https://malo.example/x.png' } },
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

  // Mover una fila de una llave a otra NO puede ser un alta más una baja:
  // entre las dos habría dos filas vivas con el mismo sub de Google, y el
  // índice único rechaza el lote entero. Esto rompía el cambio de nombre de
  // usuario en producción, y no se veía acá porque el depósito de archivo no
  // tiene restricciones.
  pedidos.length = 0;
  await depNube.guardar(null, [{
    tabla: 'pio_usuarios',
    clave: 'nuevo',
    desde: 'viejo',
    valor: { usuario: 'nuevo', creado: 1, google: 'sub-1' },
  }]);
  probar('un renombre se manda en un solo pedido', pedidos.length === 1, String(pedidos.length));
  probar('y es una modificación, no un alta', pedidos[0].metodo === 'PATCH', pedidos[0].metodo);
  probar('sobre la fila que ya existía', pedidos[0].url.includes('usuario=eq.viejo'), pedidos[0].url);
  probar('con los datos nuevos adentro', pedidos[0].cuerpo.usuario === 'nuevo');
  probar('nunca hay dos filas con el mismo google',
    !pedidos.some((p) => p.metodo === 'POST'));

  // Un renombre que no renombra nada es un alta común.
  pedidos.length = 0;
  await depNube.guardar(null, [{
    tabla: 'pio_usuarios', clave: 'igual', desde: 'igual',
    valor: { usuario: 'igual', creado: 1 },
  }]);
  probar('pedir el mismo nombre no dispara un renombre', pedidos[0].metodo === 'POST');

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
  // --- cambiar de nombre --------------------------------------------------

  grupo('Cambiar de nombre');

  const carpetaRen = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-ren-'));
  const conRen = crearServidor({ datos: carpetaRen });
  await new Promise((listo) => conRen.listen(0, '127.0.0.1', listo));
  const baseRen = `http://127.0.0.1:${conRen.address().port}`;

  const pedirRen = async (ruta, o = {}) => {
    const r = await fetch(`${baseRen}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  const nace = async (usuario) => (await pedirRen('/registro', {
    metodo: 'POST', cuerpo: { usuario, nombre: usuario, clave: 'cascarita' },
  })).datos.token;

  const tokenViejo = await nace('pollitodorado');
  const tokenOtro = await nace('calandria');

  const mio = (await pedirRen('/pios', {
    metodo: 'POST', token: tokenViejo, cuerpo: { texto: 'Un pío escrito con el nombre viejo' },
  })).datos.pio.id;
  await pedirRen(`/pios/${mio}/megusta`, { metodo: 'POST', token: tokenOtro });
  await pedirRen(`/pios/${mio}/repio`, { metodo: 'POST', token: tokenOtro });
  await pedirRen('/usuarios/pollitodorado/seguir', { metodo: 'POST', token: tokenOtro });

  const cambio = await pedirRen('/yo', {
    metodo: 'PATCH', token: tokenViejo, cuerpo: { usuario: 'jilguero' },
  });
  probar('cambiar el nombre funciona', cambio.estado === 200, `estado ${cambio.estado}`);
  probar('y el perfil ya responde con el nuevo', cambio.datos.yo.usuario === 'jilguero');

  probar('la sesión sigue viva con el nombre nuevo',
    (await pedirRen('/yo', { token: tokenViejo })).datos.yo.usuario === 'jilguero');

  const suyos = (await pedirRen(`/pios?tipo=usuario&usuario=jilguero`, { token: tokenViejo })).datos.pios;
  probar('los píos viejos vienen con él', suyos.length === 1 && suyos[0].id === mio);
  probar('el me gusta no se perdió', suyos[0].meGusta === 1);
  probar('el repío tampoco', suyos[0].repios === 1);

  const deQuienLoSigue = (await pedirRen('/usuarios/jilguero', { token: tokenOtro })).datos.perfil;
  probar('quien lo seguía lo sigue siguiendo', deQuienLoSigue.loSigo === true);
  probar('y le cuenta el seguidor', deQuienLoSigue.seguidores === 1);

  // El nombre viejo: reservado, y además sigue llevando a la persona.
  const porElViejo = await pedirRen('/usuarios/pollitodorado');
  probar('el nombre viejo sigue llevando al perfil', porElViejo.estado === 200
    && porElViejo.datos.perfil.usuario === 'jilguero');

  const intruso = await pedirRen('/registro', {
    metodo: 'POST', cuerpo: { usuario: 'pollitodorado', nombre: 'Intruso', clave: 'cascarita' },
  });
  probar('nadie puede quedarse con el nombre que dejó', intruso.estado === 409,
    `estado ${intruso.estado}`);

  // La espera entre cambios.
  const muySeguido = await pedirRen('/yo', {
    metodo: 'PATCH', token: tokenViejo, cuerpo: { usuario: 'zorzal' },
  });
  probar('cambiar dos veces seguidas se frena', muySeguido.estado === 429
    && muySeguido.datos.clave === 'usuario.reciente', `estado ${muySeguido.estado}`);
  probar('y dice en cuántos días se podrá', muySeguido.datos.datos.dias > 0);

  const ocupado = await pedirRen('/yo', {
    metodo: 'PATCH', token: tokenOtro, cuerpo: { usuario: 'jilguero' },
  });
  probar('no se puede tomar el nombre de otro', ocupado.estado === 409);

  const reservado = await pedirRen('/yo', {
    metodo: 'PATCH', token: tokenOtro, cuerpo: { usuario: 'admin' },
  });
  probar('ni uno de los reservados del sitio', reservado.estado === 400
    && reservado.datos.clave === 'usuario.reservado');

  const mismo = await pedirRen('/yo', {
    metodo: 'PATCH', token: tokenOtro, cuerpo: { usuario: 'calandria', bio: 'sin cambiar el nombre' },
  });
  probar('pedir el mismo nombre no gasta el cambio', mismo.estado === 200
    && mismo.datos.yo.bio === 'sin cambiar el nombre', `estado ${mismo.estado}`);

  probar('el perfil propio dice si se puede cambiar',
    (await pedirRen('/yo', { token: tokenOtro })).datos.yo.puedeCambiarUsuario === true);
  probar('y el de quien acaba de cambiarlo dice que no',
    (await pedirRen('/yo', { token: tokenViejo })).datos.yo.puedeCambiarUsuario === false);

  // Si algo del perfil no pasa la validación, NADA se aplica. Antes se
  // guardaba campo por campo y el usuario quedaba cambiado junto al error.
  const tokenAtomo = await nace('ruisenor');

  const conNombreVacio = await pedirRen('/yo', {
    metodo: 'PATCH', token: tokenAtomo, cuerpo: { usuario: 'petirrojo', nombre: '', bio: 'algo' },
  });
  const trasFallar = (await pedirRen('/yo', { token: tokenAtomo })).datos.yo;
  probar('un campo malo tumba el cambio entero', conNombreVacio.estado === 400);
  probar('y el usuario no se movió', trasFallar.usuario === 'ruisenor', trasFallar.usuario);
  probar('ni la bio', trasFallar.bio === '', JSON.stringify(trasFallar.bio));

  const conBioLarga = await pedirRen('/yo', {
    metodo: 'PATCH', token: tokenAtomo, cuerpo: { usuario: 'petirrojo', bio: 'x'.repeat(200) },
  });
  probar('una bio pasada tampoco deja el usuario cambiado',
    conBioLarga.estado === 400
    && (await pedirRen('/yo', { token: tokenAtomo })).datos.yo.usuario === 'ruisenor');

  const todoJunto = await pedirRen('/yo', {
    metodo: 'PATCH',
    token: tokenAtomo,
    cuerpo: { usuario: 'petirrojo', nombre: 'Petirrojo', bio: 'todo de una' },
  });
  probar('y con todo bien, cambia todo de una sola vez',
    todoJunto.estado === 200
    && todoJunto.datos.yo.usuario === 'petirrojo'
    && todoJunto.datos.yo.nombre === 'Petirrojo'
    && todoJunto.datos.yo.bio === 'todo de una');

  await new Promise((listo) => conRen.close(listo));
  fs.rmSync(carpetaRen, { recursive: true, force: true });
  // --- acortar direcciones ------------------------------------------------

  grupo('Acortador');
  const ENL = require('../src/enlaces');

  probar('una dirección normal se puede acortar',
    ENL.urlAcortable('https://ejemplo.com/una/ruta') === 'https://ejemplo.com/una/ruta');
  probar('http también', !!ENL.urlAcortable('http://ejemplo.com'));
  // Un acortador que acepte javascript: es una máquina de disfrazar trampas.
  probar('javascript: no', ENL.urlAcortable('javascript:alert(1)') === null);
  probar('data: tampoco', ENL.urlAcortable('data:text/html,<b>x') === null);
  probar('un dominio sin punto no es dominio', ENL.urlAcortable('http://localhost/x') === null);
  probar('cualquier texto suelto tampoco', ENL.urlAcortable('mira esto') === null);

  const ISGD = /(^|\.)is\.gd$/;
  probar('la respuesta debe venir del proveedor al que se preguntó',
    !!ENL.urlDelProveedor('https://is.gd/abc123', ISGD));
  probar('otro dominio en la respuesta se rechaza',
    ENL.urlDelProveedor('https://malo.example/x', ISGD) === null);
  probar('http en la respuesta se rechaza',
    ENL.urlDelProveedor('http://is.gd/abc', ISGD) === null);

  // El acortador lee el cuerpo crudo: is.gd promete JSON y a veces manda
  // texto suelto, así que no se confía en el tipo de contenido.
  const diceCrudo = (texto, ok = true) => async () => ({
    ok, status: ok ? 200 : 500, text: async () => texto,
  });

  const cortador = ENL.crearAcortador({}, {
    traer: diceCrudo(JSON.stringify({ shorturl: 'https://is.gd/abc123' })),
  });
  probar('sin credenciales igual está encendido', cortador.activo === true);
  probar('prueba is.gd primero y tinyurl después',
    cortador.proveedores.join() === 'is.gd,tinyurl');

  const corto = await cortador.acortar('https://ejemplo.com/una/ruta/larguisima');
  probar('acorta y devuelve las dos', corto.corta === 'https://is.gd/abc123'
    && corto.larga === 'https://ejemplo.com/una/ruta/larguisima');
  probar('y dice quién la acortó', corto.proveedor === 'is.gd');

  const falla = async (quien, que) => {
    try { await quien.acortar(que); return null; } catch (err) { return err.clave; }
  };
  probar('una dirección imposible se rechaza antes de salir',
    (await falla(cortador, 'javascript:alert(1)')) === 'enlace.malo');

  // Lo que de verdad pasó el día que se escribió esto: is.gd contestando 200
  // con texto plano de error en vez del JSON que promete.
  let cuantosPedidos = 0;
  const isgdCaido = ENL.crearAcortador({}, {
    traer: async (url) => {
      cuantosPedidos += 1;
      if (url.includes('is.gd')) return { ok: true, status: 200, text: async () => 'Error, database insert failed' };
      return { ok: true, status: 200, text: async () => 'https://tinyurl.com/249k9k58' };
    },
  });
  const rescatado = await isgdCaido.acortar('https://ejemplo.com/x');
  probar('si el primero se cae, lo salva el segundo',
    rescatado.corta === 'https://tinyurl.com/249k9k58' && rescatado.proveedor === 'tinyurl');
  probar('y se probaron los dos, en orden', cuantosPedidos === 2);

  const todosCaidos = ENL.crearAcortador({}, { traer: diceCrudo('vaya lío', false) });
  probar('si se caen los dos, se dice', (await falla(todosCaidos, 'https://ejemplo.com')) === 'enlace.rechazado');

  const mentiroso = ENL.crearAcortador({}, {
    traer: diceCrudo(JSON.stringify({ shorturl: 'https://malo.example/x' })),
  });
  probar('una respuesta con otro dominio no se usa',
    (await falla(mentiroso, 'https://ejemplo.com')) !== null);

  const sinAcortador = ENL.crearAcortador({ acortador: 'no' });
  probar('se puede apagar a mano', sinAcortador.activo === false);

  const soloUno = ENL.crearAcortador({ acortadorProveedor: 'tinyurl' });
  probar('y se puede pedir uno solo', soloUno.proveedores.join() === 'tinyurl');

  // --- y por HTTP ---

  const carpetaEnl = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-enl-'));
  const conEnl = crearServidor({
    datos: carpetaEnl,
    api: { enlaces: { traer: diceCrudo(JSON.stringify({ shorturl: 'https://is.gd/abc123' })) } },
  });
  await new Promise((listo) => conEnl.listen(0, '127.0.0.1', listo));
  const baseEnl = `http://127.0.0.1:${conEnl.address().port}`;

  const pedirCorto = (url, token) => fetch(`${baseEnl}/api/acortar`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' },
      token ? { Authorization: `Bearer ${token}` } : {}),
    body: JSON.stringify({ url }),
  });

  probar('acortar sin sesión devuelve 401',
    (await pedirCorto('https://ejemplo.com')).status === 401);

  const altaEnl = await fetch(`${baseEnl}/api/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'jilguero', nombre: 'Jilguero', clave: 'semillas' }),
  }).then((r) => r.json());

  const conSesionEnl = await pedirCorto('https://ejemplo.com/larga', altaEnl.token);
  probar('con sesión, acorta', conSesionEnl.status === 200);
  probar('y devuelve la corta', (await conSesionEnl.json()).corta === 'https://is.gd/abc123');

  const configEnl = await fetch(`${baseEnl}/api/config`).then((r) => r.json());
  probar('la config avisa que está encendido', configEnl.acortador === true);

  await new Promise((listo) => conEnl.close(listo));
  fs.rmSync(carpetaEnl, { recursive: true, force: true });
  // --- emojis del sitio ---------------------------------------------------

  grupo('Emojis');
  const EMO = require('../src/emojis');

  const defecto = EMO.porDefecto();
  probar('vienen cinco de fábrica', defecto.length === 5, String(defecto.length));
  probar('el primero es el pollito', defecto[0].nombre === 'pollito');
  probar('cada uno trae con qué dibujarse', defecto.every((e) => e.src.startsWith('data:image/svg')));
  // Doscientos bytes cada uno: no hace falta archivo ni servicio para esto.
  probar('y pesan poco', defecto.every((e) => e.src.length < 400));

  const colados = EMO.servibles([
    { nombre: 'MAL NOMBRE', caracter: 'x' },
    { nombre: 'a', caracter: 'x' },
    { nombre: 'con-guion', caracter: 'x' },
    { nombre: 'sinnada' },
    { nombre: 'inseguro', url: 'http://ejemplo.com/x.png' },
    { nombre: 'bueno', caracter: '🐤' },
    { nombre: 'bueno', caracter: '🥚' },
    { nombre: 'remoto', url: 'https://res.cloudinary.com/n/x.png' },
  ]);
  probar('lo que no sirve se descarta en silencio',
    colados.map((e) => e.nombre).join() === 'bueno,remoto', colados.map((e) => e.nombre).join());
  // Un emoji repetido tapando a otro sería un cambio invisible de significado.
  probar('el repetido no pisa al primero', colados[0].src.includes('%F0%9F%90%A4'));
  probar('una imagen remota tiene que ser https', colados[1].src.startsWith('https://'));

  // --- y por HTTP ---

  const carpetaEmo = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-emo-'));
  const conEmo = crearServidor({ datos: carpetaEmo });
  await new Promise((listo) => conEmo.listen(0, '127.0.0.1', listo));
  const baseEmo = `http://127.0.0.1:${conEmo.address().port}`;

  const sinSesion = await fetch(`${baseEmo}/api/emojis`).then((r) => r.json());
  probar('se piden sin sesión', sinSesion.emojis.length === 5);

  // Lo que guarde el panel de administración le gana a los de fábrica.
  await conEmo.almacen.listo;
  conEmo.almacen.datos.emojis = [{ nombre: 'propio', caracter: '🦜' }];
  const conPropios = await fetch(`${baseEmo}/api/emojis`).then((r) => r.json());
  probar('lo guardado reemplaza a los de fábrica',
    conPropios.emojis.length === 1 && conPropios.emojis[0].nombre === 'propio');

  conEmo.almacen.datos.emojis = [];
  const devuelta = await fetch(`${baseEmo}/api/emojis`).then((r) => r.json());
  probar('y vaciarlo devuelve los de fábrica', devuelta.emojis.length === 5);

  await new Promise((listo) => conEmo.close(listo));
  fs.rmSync(carpetaEmo, { recursive: true, force: true });
  // --- medallitas ---------------------------------------------------------

  grupo('Medallitas');
  const MED = require('../src/medallas');

  probar('sin seguidores no hay medalla', MED.medallaDe(0) === null);
  probar('con nueve tampoco', MED.medallaDe(9) === null);
  probar('con diez, la primera', MED.medallaDe(10).clave === 'huevo');
  probar('justo antes del salto sigue la anterior', MED.medallaDe(24).clave === 'huevo');
  probar('y justo en el salto cambia', MED.medallaDe(25).clave === 'cascaron');
  // La más alta alcanzada, no una hilera que crece.
  probar('se queda con la más alta', MED.medallaDe(9999).clave === 'aguila');
  probar('la última no tiene techo', MED.medallaDe(999999).clave === 'pavoreal');

  probar('un número imposible no da medalla', MED.medallaDe(-5) === null);
  probar('ni una cosa que no es número', MED.medallaDe('muchos') === null);

  probar('dice cuánto falta para la próxima', MED.faltanPara(9).faltan === 1);
  probar('y cuál es', MED.faltanPara(9).clave === 'huevo');
  probar('en la última ya no falta nada', MED.faltanPara(10000) === null);

  probar('son los nueve escalones pedidos',
    MED.ESCALONES.map((e) => e.desde).join() === '10,25,50,100,200,500,1000,5000,10000');
  probar('y van siempre para arriba',
    MED.ESCALONES.every((e, i) => i === 0 || e.desde > MED.ESCALONES[i - 1].desde));

  // --- y por HTTP ---

  const carpetaMed = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-med-'));
  // Cupo alto: hacen falta once altas seguidas y el limite normal son cinco.
  const conMed = crearServidor({ datos: carpetaMed, api: { altas: 100 } });
  await new Promise((listo) => conMed.listen(0, '127.0.0.1', listo));
  const baseMed = `http://127.0.0.1:${conMed.address().port}`;

  const nacerMed = async (usuario) => (await fetch(`${baseMed}/api/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, nombre: usuario, clave: 'semillas' }),
  }).then((r) => r.json())).token;

  const conocido = await nacerMed('jilguero');

  const verPerfil = (usuario, token) => fetch(`${baseMed}/api/usuarios/${usuario}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then((r) => r.json());

  probar('recién nacido no tiene medalla', (await verPerfil('jilguero')).perfil.medalla === null);

  // Diez seguidores de verdad, no un número puesto a mano.
  for (let i = 0; i < 10; i += 1) {
    const suyo = await nacerMed(`seguidor${i}`);
    await fetch(`${baseMed}/api/usuarios/jilguero/seguir`, {
      method: 'POST', headers: { Authorization: `Bearer ${suyo}` },
    });
  }

  const conDiez = await verPerfil('jilguero');
  probar('con diez seguidores aparece la primera',
    conDiez.perfil.medalla && conDiez.perfil.medalla.clave === 'huevo',
    JSON.stringify(conDiez.perfil.medalla));
  probar('y viene con su figura', conDiez.perfil.medalla.figura === '🥚');

  // Cuánto falta es cosa de uno; al de al lado no le importa.
  probar('lo que falta sólo se ve en el perfil propio',
    (await verPerfil('jilguero', conocido)).perfil.proxima.clave === 'cascaron');
  probar('y no en el de otro', (await verPerfil('jilguero')).perfil.proxima === undefined);

  await new Promise((listo) => conMed.close(listo));
  fs.rmSync(carpetaMed, { recursive: true, force: true });
  // --- claves y recuperación ----------------------------------------------

  grupo('Claves');
  const REC = require('../src/recuperacion');

  const unCodigo = REC.generar();
  probar('el código tiene la forma esperada', /^PIO(-[23456789A-HJKMNP-Z]{5}){3}$/.test(unCodigo), unCodigo);
  probar('no lleva letras que se copien mal', !/[01ILO]/.test(unCodigo.replace('PIO', '')));
  const otros = new Set();
  for (let i = 0; i < 200; i += 1) otros.add(REC.generar());
  probar('no se repite', otros.size === 200);

  const guardado = REC.guardable(unCodigo);
  probar('se guarda hasheado, no en claro',
    !JSON.stringify(guardado).includes(unCodigo.replace(/-/g, '')));
  probar('el bueno coincide', REC.coincide(unCodigo, guardado));
  // Se copia de un papel: hay que aceptarlo escrito como salga.
  probar('en minúsculas también', REC.coincide(unCodigo.toLowerCase(), guardado));
  probar('sin guiones también', REC.coincide(unCodigo.replace(/-/g, ''), guardado));
  probar('con espacios de más también', REC.coincide('  ' + unCodigo + ' ', guardado));
  probar('otro código no coincide', !REC.coincide(REC.generar(), guardado));
  probar('ni uno recortado', !REC.coincide('PIO-ABCDE', guardado));
  probar('ni nada', !REC.coincide('', guardado));

  // --- y por HTTP ---

  const carpetaCla = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-clave-'));
  const conCla = crearServidor({ datos: carpetaCla, api: { altas: 100, intentos: 500 } });
  await new Promise((listo) => conCla.listen(0, '127.0.0.1', listo));
  const baseCla = `http://127.0.0.1:${conCla.address().port}`;

  const pedirCla = async (ruta, o = {}) => {
    const r = await fetch(`${baseCla}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };

  const altaCla = await pedirCla('/registro', {
    metodo: 'POST', cuerpo: { usuario: 'jilguero', nombre: 'Jilguero', clave: 'cascarita' },
  });
  probar('el alta entrega un código de recuperación', !!altaCla.datos.recuperacion, altaCla.datos.recuperacion);
  const codigoUno = altaCla.datos.recuperacion;
  let token = altaCla.datos.token;

  probar('el código no vuelve a aparecer en el perfil',
    !JSON.stringify((await pedirCla('/yo', { token })).datos).includes(codigoUno.slice(4, 9)));

  // --- cambiar la clave sabiendo la actual ---

  const otraSesion = (await pedirCla('/sesion', {
    metodo: 'POST', cuerpo: { usuario: 'jilguero', clave: 'cascarita' },
  })).datos.token;

  const malActual = await pedirCla('/yo/clave', {
    metodo: 'POST', token, cuerpo: { actual: 'no es esa', nueva: 'granito123' },
  });
  probar('con la clave actual equivocada no cambia', malActual.estado === 401
    && malActual.datos.clave === 'clave.actualmala');

  // El cliente cierra la sesión cuando ve un 401, pero SÓLO el de sesión
  // faltante. Si los demás no se distinguieran, equivocarse al escribir la
  // clave actual echaría a la gente de su cuenta.
  const faltaSesion = await pedirCla('/yo');
  probar('el 401 de sesión faltante se llama sesion.falta',
    faltaSesion.estado === 401 && faltaSesion.datos.clave === 'sesion.falta');
  probar('y el de la clave actual se llama distinto',
    malActual.datos.clave !== faltaSesion.datos.clave);

  const claveMala = await pedirCla('/sesion', {
    metodo: 'POST', cuerpo: { usuario: 'jilguero', clave: 'no es esa' },
  });
  probar('entrar con la clave mal tampoco se confunde con sesión vencida',
    claveMala.estado === 401 && claveMala.datos.clave === 'acceso.malo');

  probar('la sesión sigue viva después de un 401 que no era de sesión',
    (await pedirCla('/yo', { token })).estado === 200);

  const cortaNueva = await pedirCla('/yo/clave', {
    metodo: 'POST', token, cuerpo: { actual: 'cascarita', nueva: 'abc' },
  });
  probar('una clave nueva corta se rechaza', cortaNueva.estado === 400);

  const cambiada = await pedirCla('/yo/clave', {
    metodo: 'POST', token, cuerpo: { actual: 'cascarita', nueva: 'granito123' },
  });
  probar('con la actual correcta, cambia', cambiada.estado === 200);
  probar('la clave vieja ya no entra',
    (await pedirCla('/sesion', { metodo: 'POST', cuerpo: { usuario: 'jilguero', clave: 'cascarita' } })).estado === 401);
  probar('y la nueva sí',
    (await pedirCla('/sesion', { metodo: 'POST', cuerpo: { usuario: 'jilguero', clave: 'granito123' } })).estado === 200);

  probar('la sesión que hizo el cambio sigue viva',
    (await pedirCla('/yo', { token })).estado === 200);
  // Cambiar la clave y dejar las otras sesiones abiertas sería dejar adentro
  // justamente a quien uno quiere sacar.
  probar('las otras sesiones se cierran',
    (await pedirCla('/yo', { token: otraSesion })).estado === 401);

  // --- recuperar con el código ---

  const usuarioQueNoEsta = await pedirCla('/recuperar', {
    metodo: 'POST', cuerpo: { usuario: 'nadie_de_nadie', codigo: codigoUno, clave: 'otraclave1' },
  });
  const codigoEquivocado = await pedirCla('/recuperar', {
    metodo: 'POST', cuerpo: { usuario: 'jilguero', codigo: REC.generar(), clave: 'otraclave1' },
  });
  // El mismo error para los dos: distinguirlos regalaría la lista de cuentas.
  probar('usuario inexistente y código malo dan lo mismo',
    usuarioQueNoEsta.estado === codigoEquivocado.estado
    && usuarioQueNoEsta.datos.error === codigoEquivocado.datos.error,
    `${usuarioQueNoEsta.estado} vs ${codigoEquivocado.estado}`);

  const recuperada = await pedirCla('/recuperar', {
    metodo: 'POST', cuerpo: { usuario: 'jilguero', codigo: codigoUno.toLowerCase(), clave: 'plumita456' },
  });
  probar('el código recupera la cuenta', recuperada.estado === 200, JSON.stringify(recuperada.datos).slice(0, 80));
  probar('y deja entrar con la clave nueva',
    (await pedirCla('/sesion', { metodo: 'POST', cuerpo: { usuario: 'jilguero', clave: 'plumita456' } })).estado === 200);
  probar('entrega un código nuevo', !!recuperada.datos.recuperacion
    && recuperada.datos.recuperacion !== codigoUno);
  // Una llave de repuesto ya usada no debería seguir abriendo.
  probar('el código viejo ya no sirve',
    (await pedirCla('/recuperar', { metodo: 'POST', cuerpo: { usuario: 'jilguero', codigo: codigoUno, clave: 'yotra789' } })).estado === 401);
  probar('recuperar cierra todas las sesiones',
    (await pedirCla('/yo', { token })).estado === 401);

  // --- tope de intentos ---

  // Servidor aparte, con el tope bajito: acá lo que se prueba es el freno.
  const carpetaInt = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-int-'));
  const conInt = crearServidor({ datos: carpetaInt, api: { intentos: 3 } });
  await new Promise((listo) => conInt.listen(0, '127.0.0.1', listo));
  const baseInt = `http://127.0.0.1:${conInt.address().port}`;

  const intentar = () => fetch(`${baseInt}/api/recuperar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'quiensea', codigo: REC.generar(), clave: 'loquesea1' }),
  });

  const estados = [];
  for (let i = 0; i < 5; i += 1) estados.push((await intentar()).status);
  // Adivinar quince letras al azar es inviable, pero sólo si hay un tope.
  probar('adivinar el código a fuerza de intentos se frena',
    estados.slice(0, 3).every((e) => e === 401) && estados.slice(3).every((e) => e === 429),
    estados.join());

  await new Promise((listo) => conInt.close(listo));
  fs.rmSync(carpetaInt, { recursive: true, force: true });

  await new Promise((listo) => conCla.close(listo));
  fs.rmSync(carpetaCla, { recursive: true, force: true });
  // --- vencimiento de sesiones --------------------------------------------

  grupo('Sesiones que vencen');

  const carpetaSes = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-ses-'));
  const conSes = crearServidor({ datos: carpetaSes });
  await new Promise((listo) => conSes.listen(0, '127.0.0.1', listo));
  const baseSes = `http://127.0.0.1:${conSes.address().port}`;
  await conSes.almacen.listo;

  const yoCon = (token) => fetch(`${baseSes}/api/yo`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.status);

  const naceSes = await fetch(`${baseSes}/api/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'jilguero', nombre: 'Jilguero', clave: 'semillas' }),
  }).then((r) => r.json());

  probar('una sesión recién abierta sirve', (await yoCon(naceSes.token)) === 200);

  // Se la envejece a mano: esperar dos meses en una prueba no es opción.
  const DOS_MESES = 60 * 24 * 60 * 60 * 1000;
  conSes.almacen.datos.sesiones[naceSes.token].creada = Date.now() - DOS_MESES - 1000;

  probar('pasados dos meses ya no sirve', (await yoCon(naceSes.token)) === 401);
  probar('y el 401 es de sesión, para que el cliente sepa echarte',
    (await fetch(`${baseSes}/api/yo`, { headers: { Authorization: `Bearer ${naceSes.token}` } })
      .then((r) => r.json())).clave === 'sesion.falta');

  // La barrida la saca de la base, no sólo la ignora.
  const barridas = await conSes.almacen.barrerSesiones(true);
  probar('la barrida se lleva las vencidas', barridas === 1, String(barridas));
  probar('y ya no está guardada', !conSes.almacen.datos.sesiones[naceSes.token]);

  const fresca = await fetch(`${baseSes}/api/sesion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'jilguero', clave: 'semillas' }),
  }).then((r) => r.json());
  probar('una sesión nueva sobrevive a la barrida',
    (await conSes.almacen.barrerSesiones(true)) === 0
    && (await yoCon(fresca.token)) === 200);

  // Recorrer todas las sesiones en cada petición sería trabajo tirado.
  conSes.almacen.datos.sesiones[fresca.token].creada = Date.now() - DOS_MESES - 1000;
  probar('sin forzar, no barre más de una vez por hora',
    (await conSes.almacen.barrerSesiones()) === 0);
  probar('pero forzada, sí', (await conSes.almacen.barrerSesiones(true)) === 1);

  await new Promise((listo) => conSes.close(listo));
  fs.rmSync(carpetaSes, { recursive: true, force: true });
  // --- corrales -----------------------------------------------------------

  grupo('Corrales');
  const COR = require('../src/corrales');

  probar('un nombre con espacios se arregla solo', COR.aNombre('Cosas de Cocina') === 'cosas_de_cocina');
  probar('y los acentos también', COR.aNombre('Fútbol Ñoño') === 'futbol_nono');
  probar('general está reservado', (COR.validarNombre('general') || {}).clave === 'corral.reservado');
  probar('y corral también', (COR.validarNombre('corral') || {}).clave === 'corral.reservado');
  probar('uno de dos letras no alcanza', (COR.validarNombre('ab') || {}).clave === 'corral.forma');
  probar('uno normal pasa', COR.validarNombre('cocina') === null);
  probar('sin título no vale', (COR.validarTitulo('') || {}).clave === 'corral.sintitulo');
  probar('un título largo tampoco', (COR.validarTitulo('x'.repeat(50)) || {}).clave === 'corral.titulolargo');

  // --- y por HTTP ---

  const carpetaCor = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-cor-'));
  const conCor = crearServidor({ datos: carpetaCor, api: { altas: 100 } });
  await new Promise((listo) => conCor.listen(0, '127.0.0.1', listo));
  const baseCor = `http://127.0.0.1:${conCor.address().port}`;

  const pedirCor = async (ruta, o = {}) => {
    const r = await fetch(`${baseCor}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  const naceCor = async (usuario) => (await pedirCor('/registro', {
    metodo: 'POST', cuerpo: { usuario, nombre: usuario, clave: 'semillas' },
  })).datos.token;

  const duenoT = await naceCor('jilguero');
  const visitaT = await naceCor('calandria');

  const creado = await pedirCor('/corrales', {
    metodo: 'POST', token: duenoT,
    cuerpo: { nombre: 'Cosas de Cocina', titulo: 'Cocina', descripcion: 'Recetas y desastres' },
  });
  probar('se crea un corral', creado.estado === 201, JSON.stringify(creado.datos).slice(0, 80));
  probar('con el nombre ya saneado', creado.datos.corral.nombre === 'cosas_de_cocina');
  // Nadie arma un corral para no mirarlo.
  probar('quien lo crea queda adentro', creado.datos.corral.estoy === true);
  probar('y es suyo', creado.datos.corral.esMio === true);

  const corralRepetido = await pedirCor('/corrales', {
    metodo: 'POST', token: visitaT, cuerpo: { nombre: 'cosas_de_cocina', titulo: 'Otro' },
  });
  probar('no se puede repetir el nombre', corralRepetido.estado === 409);

  const sinSesionCor = await pedirCor('/corrales', {
    metodo: 'POST', cuerpo: { nombre: 'libre', titulo: 'Libre' },
  });
  probar('crear pide sesión', sinSesionCor.estado === 401);

  // --- píos dentro y fuera ---

  await pedirCor('/pios', { metodo: 'POST', token: duenoT, cuerpo: { texto: 'Un pío de la plaza' } });
  const enCorral = await pedirCor('/pios', {
    metodo: 'POST', token: duenoT,
    cuerpo: { texto: 'Un pío de cocina', corral: 'cosas_de_cocina' },
  });
  probar('se pía dentro de un corral', enCorral.estado === 201
    && enCorral.datos.pio.corral === 'cosas_de_cocina');

  const aInventado = await pedirCor('/pios', {
    metodo: 'POST', token: duenoT, cuerpo: { texto: 'a la nada', corral: 'no_existe_esto' },
  });
  probar('un corral inventado se rechaza', aInventado.estado === 404);

  // La plaza es el tema general: lo del corral no la ensucia.
  const plazaCor = await pedirCor('/pios?tipo=plaza');
  probar('la plaza muestra sólo lo de afuera', plazaCor.datos.pios.length === 1
    && plazaCor.datos.pios[0].texto.includes('plaza'), String(plazaCor.datos.pios.length));

  const feedCorral = await pedirCor('/pios?tipo=corral&corral=cosas_de_cocina');
  probar('y el corral muestra lo suyo', feedCorral.datos.pios.length === 1
    && feedCorral.datos.pios[0].texto.includes('cocina'));

  // Media conversación en un corral y media en la plaza sería ilegible.
  const respuestaCor = await pedirCor('/pios', {
    metodo: 'POST', token: visitaT,
    cuerpo: { texto: 'contesto sin decir dónde', respuestaA: enCorral.datos.pio.id },
  });
  probar('una respuesta hereda el corral del pío que contesta',
    respuestaCor.datos.pio.corral === 'cosas_de_cocina');

  // --- suscribirse ---

  const nidoAntes = await pedirCor('/pios?tipo=nido', { token: visitaT });
  probar('sin suscribirse, el corral no llega al nido', nidoAntes.datos.pios.length === 0,
    String(nidoAntes.datos.pios.length));

  const entrada = await pedirCor('/corrales/cosas_de_cocina/seguir', { metodo: 'POST', token: visitaT });
  probar('suscribirse funciona', entrada.datos.corral.estoy === true);
  probar('y se cuentan los suscritos', entrada.datos.corral.suscritos === 2);

  const nidoDespues = await pedirCor('/pios?tipo=nido', { token: visitaT });
  // El pío y su respuesta: las respuestas también llegan a las líneas.
  probar('ahora sí llega al nido', nidoDespues.datos.pios.length === 2,
    String(nidoDespues.datos.pios.length));

  const salida = await pedirCor('/corrales/cosas_de_cocina/seguir', { metodo: 'POST', token: visitaT });
  probar('y se puede salir', salida.datos.corral.estoy === false);
  probar('con lo que el nido vuelve a quedar vacío',
    (await pedirCor('/pios?tipo=nido', { token: visitaT })).datos.pios.length === 0);

  const lista = await pedirCor('/corrales');
  probar('se listan los corrales', lista.datos.corrales.length === 1);
  probar('con cuántos píos tiene', lista.datos.corrales[0].pios === 2);

  probar('un corral que no existe da 404',
    (await pedirCor('/corrales/no_existe_esto')).estado === 404);

  await new Promise((listo) => conCor.close(listo));
  fs.rmSync(carpetaCor, { recursive: true, force: true });
  // --- chat de los corrales -----------------------------------------------

  grupo('Chat');
  const MSG = require('../src/mensajes');

  // El chat no lleva el límite de cien: los cien son del pío, que es público
  // y queda. Una conversación es otra cosa.
  probar('el límite del chat es más ancho que el del pío', MSG.LIMITE === 300);
  probar('un mensaje vacío no vale', (MSG.validar('   ') || {}).clave === 'mensaje.vacio');
  probar('uno de cien pasa sin problema', MSG.validar('x'.repeat(100)) === null);
  probar('uno de trescientos también', MSG.validar('x'.repeat(300)) === null);
  probar('uno de trescientos uno no', (MSG.validar('x'.repeat(301)) || {}).clave === 'mensaje.largo');
  probar('y dice por cuánto se pasó', MSG.validar('x'.repeat(305)).datos.sobra === 5);

  // --- y por HTTP ---

  const carpetaCha = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-chat-'));
  const conCha = crearServidor({ datos: carpetaCha, api: { altas: 100 } });
  await new Promise((listo) => conCha.listen(0, '127.0.0.1', listo));
  const baseCha = `http://127.0.0.1:${conCha.address().port}`;

  const pedirCha = async (ruta, o = {}) => {
    const r = await fetch(`${baseCha}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  const naceCha = async (usuario) => (await pedirCha('/registro', {
    metodo: 'POST', cuerpo: { usuario, nombre: usuario, clave: 'semillas' },
  })).datos.token;

  const adentroT = await naceCha('jilguero');
  const afueraT = await naceCha('calandria');
  await pedirCha('/corrales', {
    metodo: 'POST', token: adentroT, cuerpo: { nombre: 'cocina', titulo: 'Cocina' },
  });

  const dicho = await pedirCha('/corrales/cocina/chat', {
    metodo: 'POST', token: adentroT, cuerpo: { texto: 'Hola, ¿alguien por acá?' },
  });
  probar('quien está adentro puede escribir', dicho.estado === 201, JSON.stringify(dicho.datos).slice(0, 70));
  probar('y el mensaje vuelve con su autor', dicho.datos.mensaje.autor.usuario === 'jilguero');

  // Entrar al corral tiene que significar algo.
  const desdeAfuera = await pedirCha('/corrales/cocina/chat', {
    metodo: 'POST', token: afueraT, cuerpo: { texto: 'me cuelo' },
  });
  probar('quien está afuera no puede escribir', desdeAfuera.estado === 403
    && desdeAfuera.datos.clave === 'mensaje.afuera', String(desdeAfuera.estado));

  probar('escribir sin sesión tampoco',
    (await pedirCha('/corrales/cocina/chat', { metodo: 'POST', cuerpo: { texto: 'hola' } })).estado === 401);

  // Pero el corral es público: leer lo puede cualquiera.
  const leido = await pedirCha('/corrales/cocina/chat');
  probar('leer no pide sesión', leido.estado === 200 && leido.datos.mensajes.length === 1);

  await pedirCha('/corrales/cocina/seguir', { metodo: 'POST', token: afueraT });
  const yaAdentro = await pedirCha('/corrales/cocina/chat', {
    metodo: 'POST', token: afueraT, cuerpo: { texto: 'ahora sí' },
  });
  probar('entrando al corral ya puede', yaAdentro.estado === 201);

  // El chat pregunta cada pocos segundos: traer todo de nuevo cada vez sería
  // mandar la misma conversación una y otra vez.
  const todos = await pedirCha('/corrales/cocina/chat');
  probar('se leen los dos', todos.datos.mensajes.length === 2);
  const primero = todos.datos.mensajes[0];
  const nuevos = await pedirCha(`/corrales/cocina/chat?desde=${primero.creado}`);
  probar('con desde, sólo llegan los posteriores', nuevos.datos.mensajes.length === 1
    && nuevos.datos.mensajes[0].texto === 'ahora sí', String(nuevos.datos.mensajes.length));
  probar('y del más viejo al más nuevo',
    todos.datos.mensajes[0].creado <= todos.datos.mensajes[1].creado);

  const largoCha = await pedirCha('/corrales/cocina/chat', {
    metodo: 'POST', token: adentroT, cuerpo: { texto: 'x'.repeat(301) },
  });
  probar('un mensaje pasado de largo se rechaza', largoCha.estado === 400);

  // Cada corral tiene su conversación.
  await pedirCha('/corrales', {
    metodo: 'POST', token: adentroT, cuerpo: { nombre: 'musica', titulo: 'Música' },
  });
  await pedirCha('/corrales/musica/chat', {
    metodo: 'POST', token: adentroT, cuerpo: { texto: 'otro corral, otra charla' },
  });
  probar('los corrales no se mezclan',
    (await pedirCha('/corrales/cocina/chat')).datos.mensajes.length === 2
    && (await pedirCha('/corrales/musica/chat')).datos.mensajes.length === 1);

  probar('el chat de un corral inexistente da 404',
    (await pedirCha('/corrales/no_existe/chat')).estado === 404);

  await new Promise((listo) => conCha.close(listo));
  fs.rmSync(carpetaCha, { recursive: true, force: true });
  // --- panel de administración --------------------------------------------

  grupo('Administración');

  const carpetaAdm = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-adm-'));
  const conAdm = crearServidor({
    datos: carpetaAdm,
    api: { altas: 100, admins: ['jefa'] },
  });
  await new Promise((listo) => conAdm.listen(0, '127.0.0.1', listo));
  const baseAdm = `http://127.0.0.1:${conAdm.address().port}`;

  const pedirAdm = async (ruta, o = {}) => {
    const r = await fetch(`${baseAdm}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  const naceAdm = async (usuario) => (await pedirAdm('/registro', {
    metodo: 'POST', cuerpo: { usuario, nombre: usuario, clave: 'semillas' },
  })).datos.token;

  const jefaT = await naceAdm('jefa');
  const pollitoT = await naceAdm('calandria');

  // Quien manda se define en la configuración del despliegue, no en la base.
  probar('la config le dice a quien manda que manda',
    (await pedirAdm('/config', { token: jefaT })).datos.soyAdmin === true);
  probar('y al resto que no',
    (await pedirAdm('/config', { token: pollitoT })).datos.soyAdmin === false);
  probar('sin sesión, tampoco',
    (await pedirAdm('/config')).datos.soyAdmin === false);

  probar('el panel rechaza a quien no manda',
    (await pedirAdm('/admin/resumen', { token: pollitoT })).estado === 403);
  probar('y a quien no tiene sesión',
    (await pedirAdm('/admin/resumen')).estado === 401);

  const resumen = await pedirAdm('/admin/resumen', { token: jefaT });
  probar('el resumen cuenta lo que hay', resumen.estado === 200
    && resumen.datos.resumen.usuarios === 2, JSON.stringify(resumen.datos.resumen || {}));
  probar('y dice dónde está guardado', resumen.datos.resumen.deposito === 'archivo');

  const listaAdm = await pedirAdm('/admin/usuarios', { token: jefaT });
  probar('se listan los usuarios', listaAdm.datos.usuarios.length === 2);
  probar('marcando a quien manda',
    listaAdm.datos.usuarios.find((u) => u.usuario === 'jefa').manda === true);

  // --- emojis ---

  const emojisAntes = await pedirAdm('/admin/emojis', { token: jefaT });
  probar('sin nada guardado, los de fábrica', emojisAntes.datos.emojis.length === 0
    && emojisAntes.datos.enUso.length === 5);

  const puestos = await pedirAdm('/admin/emojis', {
    metodo: 'PUT', token: jefaT,
    cuerpo: { emojis: [{ nombre: 'jefa', caracter: '👑' }, { nombre: 'NO VALE', caracter: 'x' }] },
  });
  probar('se guardan los emojis propios', puestos.estado === 200
    && puestos.datos.enUso.length === 1 && puestos.datos.enUso[0].nombre === 'jefa');
  probar('y el que no servía no llega al sitio',
    !puestos.datos.enUso.some((e) => e.nombre === 'no vale'));
  probar('el sitio ya los sirve',
    (await pedirAdm('/emojis')).datos.emojis[0].nombre === 'jefa');

  await pedirAdm('/admin/emojis', { metodo: 'PUT', token: jefaT, cuerpo: { emojis: [] } });
  probar('vaciarlos devuelve los de fábrica',
    (await pedirAdm('/emojis')).datos.emojis.length === 5);

  // --- borrar ---

  // Borrar a quien administra sería la forma más rápida de quedarse sin nadie
  // que administre el sitio.
  probar('a quien manda no se lo borra desde el panel',
    (await pedirAdm('/admin/usuarios/jefa', { metodo: 'DELETE', token: jefaT })).estado === 403);

  const suPio = (await pedirAdm('/pios', {
    metodo: 'POST', token: pollitoT, cuerpo: { texto: 'algo que se va a ir conmigo' },
  })).datos.pio.id;
  await pedirAdm(`/pios/${suPio}/megusta`, { metodo: 'POST', token: jefaT });

  const borradoAdm = await pedirAdm('/admin/usuarios/calandria', { metodo: 'DELETE', token: jefaT });
  probar('se borra una cuenta', borradoAdm.estado === 200);
  probar('y se lleva sus píos',
    (await pedirAdm('/pios?tipo=plaza')).datos.pios.length === 0);
  probar('y sus avisos', conAdm.almacen.datos.notificaciones.length === 0);
  probar('y sus sesiones', (await pedirAdm('/yo', { token: pollitoT })).estado === 401);
  probar('y ya no existe', (await pedirAdm('/usuarios/calandria')).estado === 404);

  // --- corrales ---

  await pedirAdm('/corrales', {
    metodo: 'POST', token: jefaT, cuerpo: { nombre: 'sobras', titulo: 'Sobras' },
  });
  const pioEnCorral = (await pedirAdm('/pios', {
    metodo: 'POST', token: jefaT, cuerpo: { texto: 'adentro del corral', corral: 'sobras' },
  })).datos.pio.id;

  // Lo que no se ve no se modera: la plaza deja afuera lo de los corrales.
  probar('el panel ve también lo que se dijo adentro de un corral',
    (await pedirAdm('/admin/pios', { token: jefaT })).datos.pios.some((p) => p.id === pioEnCorral));
  probar('y la plaza no',
    !(await pedirAdm('/pios?tipo=plaza')).datos.pios.some((p) => p.id === pioEnCorral));
  const buscaTexto = await pedirAdm('/admin/pios?q=CORRAL', { token: jefaT });
  probar('el panel busca en el texto, sin importar mayúsculas',
    buscaTexto.datos.pios.length === 1 && buscaTexto.datos.pios[0].id === pioEnCorral && buscaTexto.datos.total === 1);
  probar('y por autor con @', (await pedirAdm('/admin/pios?q=@jefa', { token: jefaT })).datos.pios.every((p) => p.autor.usuario === 'jefa'));
  probar('lo que no coincide no aparece', (await pedirAdm('/admin/pios?q=zzzz', { token: jefaT })).datos.pios.length === 0);
  // Más de cincuenta: se pagina.
  for (let i = 0; i < 55; i += 1) conAdm.almacen.datos.pios.push({ id: `pmuchos${i}`, autor: 'jefa', texto: `relleno ${i}`, creado: 1000 + i, meGusta: [], repios: [], etiquetas: [], menciones: [] });
  const paginaUno = await pedirAdm('/admin/pios?q=relleno', { token: jefaT });
  probar('de a cincuenta', paginaUno.datos.pios.length === 50 && paginaUno.datos.hayMas === true && paginaUno.datos.total === 55);
  const paginaDos = await pedirAdm(`/admin/pios?q=relleno&antes=${paginaUno.datos.pios[49].creado}`, { token: jefaT });
  probar('y la página siguiente trae el resto', paginaDos.datos.pios.length === 5 && paginaDos.datos.hayMas === false);
  conAdm.almacen.datos.pios = conAdm.almacen.datos.pios.filter((p) => !p.id.startsWith('pmuchos'));
  probar('la lista de píos del panel también es del corral de los que mandan',
    (await pedirAdm('/admin/pios')).estado === 401);

  await pedirAdm('/admin/corrales/sobras', { metodo: 'DELETE', token: jefaT });
  probar('se borra un corral', (await pedirAdm('/corrales/sobras')).estado === 404);
  // Que se evapore lo que la gente escribió sería peor que el desorden.
  probar('pero sus píos no se evaporan: quedan en la plaza',
    (await pedirAdm('/pios?tipo=plaza')).datos.pios.some((p) => p.id === pioEnCorral));

  await new Promise((listo) => conAdm.close(listo));
  fs.rmSync(carpetaAdm, { recursive: true, force: true });
  // --- el latido -----------------------------------------------------------

  grupo('Latido');

  const carpetaLat = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-lat-'));
  const conLat = crearServidor({
    datos: carpetaLat,
    api: { altas: 100, latidoClave: 'abrite_sesamo', piobotUsuario: 'Pajarito' },
  });
  await new Promise((listo) => conLat.listen(0, '127.0.0.1', listo));
  const baseLat = `http://127.0.0.1:${conLat.address().port}`;

  const golpear = async (clave) => {
    const r = await fetch(`${baseLat}/api/latido`, {
      headers: clave ? { Authorization: `Bearer ${clave}` } : {},
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };

  // Una puerta que despierta el servicio y publica es justo la que no
  // conviene dejar abierta.
  probar('sin clave, la puerta no se abre', (await golpear()).estado === 401);
  probar('con la clave equivocada, tampoco', (await golpear('otra')).estado === 401);

  const golpe1 = await golpear('abrite_sesamo');
  probar('con la clave, contesta', golpe1.estado === 200 && golpe1.datos.despierto === true,
    JSON.stringify(golpe1.datos));
  // El primer momento se sortea igual que los demás: si el bot piara en el
  // latido siguiente a cada reinicio, el ritmo delataría cada despliegue.
  probar('pero no pía apenas arranca', golpe1.datos.pio === null);
  probar('y dice cuánto falta', golpe1.datos.faltan > 0);

  // Cuando llega el momento y no hay cuenta del bot, el sitio sigue
  // despierto: eso no es culpa del que golpea.
  conLat.almacen.datos.usuarios = conLat.almacen.datos.usuarios.filter((u) => false);
  const sinCuenta = await LAT.crearLatido(conLat.almacen, {
    latidoClave: 'x', piobotUsuario: 'piobot',
  }).golpear(Date.now() + 60 * 60 * 1000);
  probar('sin la cuenta del bot no se cae nada',
    sinCuenta.despierto === true && sinCuenta.falta === 'piobot');

  // Y con la cuenta, pía.
  const latido = LAT.crearLatido(conLat.almacen, {
    latidoClave: 'x', piobotUsuario: 'Pajarito',
  });
  await fetch(`${baseLat}/api/registro`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'pajarito', nombre: 'Pajarito', clave: 'semillas' }),
  });
  const piado = await latido.golpear(Date.now() + 60 * 60 * 1000);
  probar('cuando llega el momento, pía', !!piado.pio, JSON.stringify(piado));
  probar('y el pío es del bot',
    conLat.almacen.buscarPio(piado.pio).autor === 'pajarito');
  // El intervalo no es el del cron: golpear de nuevo enseguida no pía.
  probar('dos golpes seguidos no son dos píos',
    (await latido.golpear()).pio === null);

  // El pío del bot es un pío como cualquier otro: entra en los cien.
  probar('lo que arma el bot entra en los cien',
    Array.from({ length: 200 }).every(() => [...FRASES.armarPio()].length <= 100));
  probar('y no queda vacío',
    Array.from({ length: 50 }).every(() => FRASES.armarPio().trim().length > 0));

  await new Promise((listo) => conLat.close(listo));
  fs.rmSync(carpetaLat, { recursive: true, force: true });

  // Sin clave configurada, la puerta directamente no existe.
  const carpetaSin = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-sinlat-'));
  const conSin = crearServidor({ datos: carpetaSin, api: { altas: 100 } });
  await new Promise((listo) => conSin.listen(0, '127.0.0.1', listo));
  const sinPuerta = await fetch(`http://127.0.0.1:${conSin.address().port}/api/latido`, {
    headers: { Authorization: 'Bearer loquesea' },
  });
  probar('sin clave configurada no hay puerta', sinPuerta.status === 404);
  await new Promise((listo) => conSin.close(listo));
  fs.rmSync(carpetaSin, { recursive: true, force: true });
  // --- silenciar ------------------------------------------------------------

  grupo('Silenciar');

  const carpetaSil = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-sil-'));
  const conSil = crearServidor({ datos: carpetaSil, api: { altas: 100 } });
  await new Promise((listo) => conSil.listen(0, '127.0.0.1', listo));
  const baseSil = `http://127.0.0.1:${conSil.address().port}`;
  const pedirSil = async (ruta, o = {}) => {
    const r = await fetch(`${baseSil}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  const naceSil = async (usuario) => (await pedirSil('/registro', {
    metodo: 'POST', cuerpo: { usuario, nombre: usuario, clave: 'semillas' },
  })).datos.token;

  const lectoraT = await naceSil('lectora');
  const ruidosoT = await naceSil('ruidoso');
  const otroSilT = await naceSil('tranquilo');
  await pedirSil('/usuarios/ruidoso/seguir', { metodo: 'POST', token: lectoraT });
  await pedirSil('/pios', { metodo: 'POST', token: ruidosoT, cuerpo: { texto: 'bla bla ruido #eco' } });
  await pedirSil('/pios', { metodo: 'POST', token: otroSilT, cuerpo: { texto: 'algo tranquilo #eco' } });

  const autoresDe = async (ruta, token) => (await pedirSil(ruta, { token })).datos.pios.map((p) => p.autor.usuario);

  probar('antes de silenciar se ve en la plaza', (await autoresDe('/pios?tipo=plaza', lectoraT)).includes('ruidoso'));

  const sil = await pedirSil('/usuarios/ruidoso/silenciar', { metodo: 'POST', token: lectoraT });
  probar('se silencia una cuenta', sil.estado === 200 && sil.datos.perfil.loSilencio === true);
  probar('no se muestra en la plaza', !(await autoresDe('/pios?tipo=plaza', lectoraT)).includes('ruidoso'));
  probar('ni en el nido, aunque la siga', !(await autoresDe('/pios?tipo=nido', lectoraT)).includes('ruidoso'));
  probar('ni en una etiqueta', !(await autoresDe('/pios?tipo=etiqueta&etiqueta=eco', lectoraT)).includes('ruidoso'));
  probar('ni en la búsqueda', !(await pedirSil('/buscar?q=ruido', { token: lectoraT })).datos.pios.length);
  probar('lo demás se sigue viendo', (await autoresDe('/pios?tipo=plaza', lectoraT)).includes('tranquilo'));

  // Silenciar es de quien silencia: el resto del mundo no cambia.
  probar('los demás lo siguen viendo', (await autoresDe('/pios?tipo=plaza', otroSilT)).includes('ruidoso'));
  probar('y sin sesión también', (await autoresDe('/pios?tipo=plaza')).includes('ruidoso'));

  // Sus píos siguen llegando: sólo no se muestran.
  probar('sus píos siguen llegando', conSil.almacen.datos.pios.some((p) => p.autor === 'ruidoso'));
  probar('y puede seguir piando', (await pedirSil('/pios', { metodo: 'POST', token: ruidosoT, cuerpo: { texto: 'sigo' } })).estado === 201);

  // Si alguien entra a mirar su perfil a propósito, lo encuentra.
  probar('en su propio perfil sí se ve', (await autoresDe('/pios?tipo=usuario&usuario=ruidoso', lectoraT)).includes('ruidoso'));

  // Y no se entera: no hay aviso.
  probar('a quien se silencia no le llega aviso',
    !(await pedirSil('/notificaciones', { token: ruidosoT })).datos.notificaciones.some((n) => n.tipo === 'silenciar'));
  await pedirSil('/usuarios/lectora/seguir', { metodo: 'POST', token: ruidosoT });
  probar('y sus avisos tampoco se muestran',
    !(await pedirSil('/notificaciones', { token: lectoraT })).datos.notificaciones.some((n) => n.de && n.de.usuario === 'ruidoso'));

  probar('la cuenta liviana dice lo mismo que la lista',
    (await pedirSil('/notificaciones/cuenta', { token: lectoraT })).datos.sinLeer
      === (await pedirSil('/notificaciones', { token: lectoraT })).datos.sinLeer);
  probar('y pide sesión', (await pedirSil('/notificaciones/cuenta')).estado === 401);
  probar('ni se cuentan en la insignia',
    (await pedirSil('/notificaciones', { token: lectoraT })).datos.sinLeer === 0);
  probar('no se puede silenciar a sí mismo',
    (await pedirSil('/usuarios/lectora/silenciar', { metodo: 'POST', token: lectoraT })).estado === 400);
  probar('silenciar pide sesión',
    (await pedirSil('/usuarios/ruidoso/silenciar', { metodo: 'POST' })).estado === 401);

  const quitar = await pedirSil('/usuarios/ruidoso/silenciar', { metodo: 'POST', token: lectoraT });
  probar('se quita el silencio', quitar.datos.perfil.loSilencio === false);
  probar('y vuelve a verse', (await autoresDe('/pios?tipo=plaza', lectoraT)).includes('ruidoso'));

  await new Promise((listo) => conSil.close(listo));
  fs.rmSync(carpetaSil, { recursive: true, force: true });
  // --- ocultar para todos -------------------------------------------------

  grupo('Ocultar para todos');

  const carpetaOcu = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-ocu-'));
  const conOcu = crearServidor({ datos: carpetaOcu, api: { altas: 100, admins: ['jefa'] } });
  await new Promise((listo) => conOcu.listen(0, '127.0.0.1', listo));
  const baseOcu = `http://127.0.0.1:${conOcu.address().port}`;
  const pedirOcu = async (ruta, o = {}) => {
    const r = await fetch(`${baseOcu}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  const naceOcu = async (usuario) => (await pedirOcu('/registro', {
    metodo: 'POST', cuerpo: { usuario, nombre: usuario, clave: 'semillas' },
  })).datos.token;

  const jefaOcuT = await naceOcu('jefa');
  const botOcuT = await naceOcu('pajarito');
  const genteT = await naceOcu('vecina');
  await pedirOcu('/usuarios/pajarito/seguir', { metodo: 'POST', token: genteT });
  await pedirOcu('/pios', { metodo: 'POST', token: botOcuT, cuerpo: { texto: 'pio automatico #robot' } });
  await pedirOcu('/pios', { metodo: 'POST', token: genteT, cuerpo: { texto: 'pio de persona #humano' } });
  const autoresOcu = async (ruta, token) => (await pedirOcu(ruta, { token })).datos.pios.map((p) => p.autor.usuario);

  probar('ocultar es del corral de los que mandan',
    (await pedirOcu('/admin/ocultos/pajarito', { metodo: 'POST', token: genteT })).estado === 403);

  const ocu = await pedirOcu('/admin/ocultos/pajarito', { metodo: 'POST', token: jefaOcuT });
  probar('el panel oculta una cuenta', ocu.estado === 200 && ocu.datos.oculto === true);
  probar('no se muestra en la plaza de nadie', !(await autoresOcu('/pios?tipo=plaza', genteT)).includes('pajarito'));
  probar('ni sin sesión', !(await autoresOcu('/pios?tipo=plaza')).includes('pajarito'));
  probar('ni en el nido de quien la sigue', !(await autoresOcu('/pios?tipo=nido', genteT)).includes('pajarito'));
  probar('ni en la búsqueda', !(await pedirOcu('/buscar?q=automatico')).datos.pios.length);
  probar('ni empuja tendencias',
    !(await pedirOcu('/tendencias')).datos.tendencias.some((x) => x.etiqueta === 'robot'));
  probar('lo de los demás sí', (await autoresOcu('/pios?tipo=plaza')).includes('vecina'));

  probar('pero puede seguir piando', (await pedirOcu('/pios', { metodo: 'POST', token: botOcuT, cuerpo: { texto: 'sigo' } })).estado === 201);
  probar('y sus píos se guardan', conOcu.almacen.datos.pios.filter((p) => p.autor === 'pajarito').length === 2);
  probar('en su perfil se ve', (await autoresOcu('/pios?tipo=usuario&usuario=pajarito')).includes('pajarito'));
  probar('y el panel sí los ve', (await pedirOcu('/admin/pios', { token: jefaOcuT })).datos.pios.some((p) => p.autor.usuario === 'pajarito'));
  probar('el panel la marca como oculta',
    (await pedirOcu('/admin/usuarios', { token: jefaOcuT })).datos.usuarios.find((u) => u.usuario === 'pajarito').oculto === true);

  // Persiste: otro servidor sobre la misma carpeta arranca con la cuenta oculta.
  const conOcu2 = crearServidor({ datos: carpetaOcu, api: { altas: 100 } });
  await conOcu2.almacen.listo;
  probar('sobrevive a un reinicio', conOcu2.almacen.datos.ocultos.includes('pajarito'));

  const mos = await pedirOcu('/admin/ocultos/pajarito', { metodo: 'POST', token: jefaOcuT });
  probar('se vuelve a mostrar', mos.datos.oculto === false
    && (await autoresOcu('/pios?tipo=plaza')).includes('pajarito'));

  await new Promise((listo) => conOcu.close(listo));
  fs.rmSync(carpetaOcu, { recursive: true, force: true });
  // --- compartir -----------------------------------------------------------

  grupo('Compartir');

  const carpetaCom = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-com-'));
  const conCom = crearServidor({ datos: carpetaCom, api: { altas: 100 } });
  await new Promise((listo) => conCom.listen(0, '127.0.0.1', listo));
  const baseCom = `http://127.0.0.1:${conCom.address().port}`;
  const regCom = await (await fetch(`${baseCom}/api/registro`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'cantora', nombre: 'La Cantora', clave: 'semillas' }),
  })).json();
  const pioCom = (await (await fetch(`${baseCom}/api/pios`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${regCom.token}` },
    body: JSON.stringify({ texto: 'Hola <script>alert(1)</script> & "comillas"' }),
  })).json()).pio;

  const paginaCom = await fetch(`${baseCom}/p/${pioCom.id}`, { redirect: 'manual' });
  const htmlCom = await paginaCom.text();
  probar('cada pío tiene su dirección para compartir', paginaCom.status === 200);
  probar('con el título para la vista previa', htmlCom.includes('<meta property="og:title" content="La Cantora (@cantora) en Pío">'));
  probar('y el texto del pío', htmlCom.includes('og:description'));
  // El texto lo escribe cualquiera y termina adentro de una página nuestra.
  probar('el texto va escapado', !htmlCom.includes('<script>alert') && htmlCom.includes('&lt;script&gt;'));
  probar('y lleva a la persona a la vista de verdad', htmlCom.includes(`/#/p/${pioCom.id}`));

  // Sin imagen propia, la de Pío, con dirección completa: las redes no aceptan otra.
  probar('sin imagen propia lleva la de Pío', htmlCom.includes(`<meta property="og:image" content="${baseCom}/compartir.png">`));
  probar('y es de las grandes', htmlCom.includes('summary_large_image'));
  const detras = await (await fetch(`${baseCom}/p/${pioCom.id}`, { headers: { 'x-forwarded-proto': 'https' } })).text();
  probar('detrás del balanceador la dirección es https', detras.includes('content="https://127.0.0.1:'));

  const png = await fetch(`${baseCom}/compartir.png`);
  const bytes = Buffer.from(await png.arrayBuffer());
  probar('la imagen de Pío se sirve', png.status === 200 && png.headers.get('content-type') === 'image/png');
  probar('es un PNG de verdad', bytes.subarray(1, 4).toString('ascii') === 'PNG');
  probar('de 1200 por 630, lo que piden las redes', bytes.readUInt32BE(16) === 1200 && bytes.readUInt32BE(20) === 630);
  probar('y liviana', bytes.length < 60 * 1024, `${bytes.length} bytes`);
  const perdido = await fetch(`${baseCom}/p/pnoexiste`, { redirect: 'manual' });
  probar('un pío que no está lleva a la portada', perdido.status === 302 && perdido.headers.get('location') === '/');
  probar('una dirección rara no es un pío',
    (await fetch(`${baseCom}/p/..%2Fdatos`, { redirect: 'manual' })).status !== 302);

  await new Promise((listo) => conCom.close(listo));
  fs.rmSync(carpetaCom, { recursive: true, force: true });
  // --- el huevo ------------------------------------------------------------

  grupo('El huevo');

  const carpetaHue = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-hue-'));
  const conHue = crearServidor({ datos: carpetaHue, api: { altas: 100, incubacion: 15000 } });
  await new Promise((listo) => conHue.listen(0, '127.0.0.1', listo));
  const baseHue = `http://127.0.0.1:${conHue.address().port}`;
  const pedirHue = async (ruta, o = {}) => {
    const r = await fetch(`${baseHue}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  const naceHue = async (usuario) => (await pedirHue('/registro', {
    metodo: 'POST', cuerpo: { usuario, nombre: usuario, clave: 'semillas' },
  })).datos.token;

  const gallinaT = await naceHue('ponedora');
  const vecinoT = await naceHue('vecino');
  const nacer = (id) => { conHue.almacen.buscarPio(id).nace = Date.now() - 1; };

  const puesto = await pedirHue('/pios', {
    metodo: 'POST', token: gallinaT, cuerpo: { texto: 'recién puesto @vecino #granja' },
  });
  const huevoId = puesto.datos.pio.id;
  probar('un pío nuevo nace como huevo', puesto.datos.pio.huevo === true);
  probar('y dice cuánto le falta', puesto.datos.pio.naceEn > 14000 && puesto.datos.pio.naceEn <= 15000,
    String(puesto.datos.pio.naceEn));

  const idsHue = async (ruta, token) => (await pedirHue(ruta, { token })).datos.pios.map((p) => p.id);
  probar('quien lo puso lo ve en la plaza', (await idsHue('/pios?tipo=plaza', gallinaT)).includes(huevoId));
  probar('los demás todavía no', !(await idsHue('/pios?tipo=plaza', vecinoT)).includes(huevoId));
  probar('ni sin sesión', !(await idsHue('/pios?tipo=plaza')).includes(huevoId));
  probar('ni en su perfil', !(await idsHue('/pios?tipo=usuario&usuario=ponedora', vecinoT)).includes(huevoId));
  probar('ni en la búsqueda', !(await pedirHue('/buscar?q=puesto', { token: vecinoT })).datos.pios.length);
  probar('ni en tendencias', !(await pedirHue('/tendencias')).datos.tendencias.some((x) => x.etiqueta === 'granja'));
  probar('ni se abre su hilo', (await pedirHue(`/pios/${huevoId}/hilo`, { token: vecinoT })).estado === 404);
  probar('ni se le puede dar me gusta',
    (await pedirHue(`/pios/${huevoId}/megusta`, { metodo: 'POST', token: vecinoT })).estado === 404);
  // Avisar de algo que quien recibe el aviso no puede ver sería un aviso roto.
  const avisosHue = await pedirHue('/notificaciones', { token: vecinoT });
  probar('la mención espera a que nazca', avisosHue.datos.notificaciones.length === 0
    && avisosHue.datos.sinLeer === 0, JSON.stringify(avisosHue.datos.sinLeer));

  // Las respuestas a un huevo propio tampoco se cuentan para los demás.
  const respHue = await pedirHue('/pios', {
    metodo: 'POST', token: gallinaT, cuerpo: { texto: 'me contesto', respuestaA: huevoId },
  });
  nacer(huevoId);
  probar('una respuesta que es huevo no se cuenta para los demás',
    (await pedirHue(`/pios/${huevoId}/hilo`, { token: vecinoT })).datos.pio.respuestas === 0);
  probar('para quien la puso, sí',
    (await pedirHue(`/pios/${huevoId}/hilo`, { token: gallinaT })).datos.pio.respuestas === 1);
  nacer(respHue.datos.pio.id);

  probar('al nacer, lo ve todo el mundo', (await idsHue('/pios?tipo=plaza')).includes(huevoId));
  probar('ya no es huevo', (await pedirHue(`/pios/${huevoId}/hilo`)).datos.pio.huevo === false);
  probar('y la mención llega', (await pedirHue('/notificaciones', { token: vecinoT })).datos.sinLeer === 1);

  // Deshacer es borrar antes de que nazca: nadie se entera de nada.
  const arrepentido = (await pedirHue('/pios', {
    metodo: 'POST', token: gallinaT, cuerpo: { texto: 'mejor no @vecino' },
  })).datos.pio.id;
  const deshecho = await pedirHue(`/pios/${arrepentido}`, { metodo: 'DELETE', token: gallinaT });
  probar('un huevo se puede deshacer', deshecho.estado === 200);
  probar('y del arrepentido no queda aviso', (await pedirHue('/notificaciones', { token: vecinoT })).datos.sinLeer === 1);
  probar('ni rastro', !conHue.almacen.buscarPio(arrepentido));

  // Los píos de antes del huevo nacieron hace rato.
  probar('un pío sin fecha de nacimiento no es huevo',
    conHue.almacen.esHuevo({ id: 'viejo', creado: 1 }) === false);

  await new Promise((listo) => conHue.close(listo));
  fs.rmSync(carpetaHue, { recursive: true, force: true });

  // --- el pío bomba --------------------------------------------------------

  grupo('El pío bomba');
  const { MECHA } = require('../src/almacen');

  const carpetaBom = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-bom-'));
  let conBom = crearServidor({ datos: carpetaBom, api: { altas: 100 } });
  await new Promise((listo) => conBom.listen(0, '127.0.0.1', listo));
  let baseBom = `http://127.0.0.1:${conBom.address().port}`;
  const pedirBom = async (ruta, o = {}) => {
    const r = await fetch(`${baseBom}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  const naceBom = async (usuario) => (await pedirBom('/registro', {
    metodo: 'POST', cuerpo: { usuario, nombre: usuario, clave: 'semillas' },
  })).datos.token;
  const piarBom = async (token, cuerpo) => (await pedirBom('/pios', { metodo: 'POST', token, cuerpo })).datos.pio;
  const idsBom = async (ruta, token) => (await pedirBom(ruta, { token })).datos.pios.map((p) => p.id);

  const artificieraT = await naceBom('artificiera');
  const testigoT = await naceBom('testigo');

  const bomba = await piarBom(artificieraT, { texto: 'esto se autodestruye @testigo #kaboom', bomba: true });
  probar('un pío puede ser bomba', bomba.bomba === true);
  probar('y dice cuánto le queda: veinticuatro horas',
    bomba.explotaEn > MECHA - 5000 && bomba.explotaEn <= MECHA, String(bomba.explotaEn));
  const comun = await piarBom(artificieraT, { texto: 'esto se queda' });
  probar('un pío común no es bomba', comun.bomba === false && comun.explotaEn === 0);
  probar('sólo un true de verdad arma la bomba',
    (await piarBom(artificieraT, { texto: 'casi', bomba: 'si' })).bomba === false);

  // La conversación explota entera: nadie queda citando lo que se quiso borrar.
  const respuestaBom = await piarBom(testigoT, { texto: 'lo vi', respuestaA: bomba.id });
  probar('lo que contesta a una bomba es bomba, aunque no lo pida', respuestaBom.bomba === true);
  probar('y explota a la misma hora',
    conBom.almacen.buscarPio(respuestaBom.id).explota === conBom.almacen.buscarPio(bomba.id).explota);
  const nietaBom = await piarBom(artificieraT, { texto: 'shh', respuestaA: respuestaBom.id });
  probar('la respuesta de la respuesta también', nietaBom.bomba === true);
  // Un respiro, para que no explote en el mismo milisegundo que la primera.
  await new Promise((listo) => setTimeout(listo, 5));
  const bombaEnComun = await piarBom(testigoT, { texto: 'y yo me voy', respuestaA: comun.id, bomba: true });
  probar('una bomba puede contestar a un pío común', bombaEnComun.bomba === true);
  probar('sin arrastrarlo', (await pedirBom(`/pios/${comun.id}/hilo`)).datos.pio.bomba === false);

  await pedirBom(`/pios/${bomba.id}/repio`, { metodo: 'POST', token: testigoT });
  probar('mientras dura, se ve como cualquier pío', (await idsBom('/pios?tipo=plaza')).includes(bomba.id));
  probar('la mención llega', (await pedirBom('/notificaciones', { token: testigoT })).datos.notificaciones
    .some((n) => n.tipo === 'mencion' && n.pio.id === bomba.id));
  probar('se puede repiar', (await idsBom('/pios?tipo=usuario&usuario=testigo')).includes(bomba.id));
  probar('y entra en tendencias', (await pedirBom('/tendencias')).datos.tendencias.some((x) => x.etiqueta === 'kaboom'));

  // Detonar sólo recorre los píos cuando llega la hora de la próxima explosión.
  const explota = conBom.almacen.buscarPio(bomba.id).explota;
  probar('antes de hora no explota nada', (await conBom.almacen.detonar(explota - 1)) === 0);
  probar('a la hora explota la bomba con su conversación', (await conBom.almacen.detonar(explota)) === 3);
  probar('y la próxima es la que queda', conBom.almacen.proximaExplosion === conBom.almacen.buscarPio(bombaEnComun.id).explota);

  probar('ya no está en la plaza', !(await idsBom('/pios?tipo=plaza')).includes(bomba.id));
  probar('ni se abre su hilo', (await pedirBom(`/pios/${bomba.id}/hilo`)).estado === 404);
  probar('ni sus respuestas', (await pedirBom(`/pios/${respuestaBom.id}/hilo`)).estado === 404);
  probar('ni en el perfil de quien la repió', !(await idsBom('/pios?tipo=usuario&usuario=testigo')).includes(bomba.id));
  probar('ni en la búsqueda', !(await pedirBom('/buscar?q=autodestruye')).datos.pios.length);
  probar('ni en tendencias', !(await pedirBom('/tendencias')).datos.tendencias.some((x) => x.etiqueta === 'kaboom'));
  // A la artificiera sólo le queda el aviso de la bomba que contestó a su pío común.
  const avisosArtificiera = (await pedirBom('/notificaciones', { token: artificieraT })).datos.notificaciones;
  probar('sus avisos se fueron con ella',
    (await pedirBom('/notificaciones', { token: testigoT })).datos.notificaciones.length === 0
    && avisosArtificiera.length === 1 && avisosArtificiera[0].pio.id === bombaEnComun.id,
    JSON.stringify(avisosArtificiera.map((n) => n.tipo)));
  const compartidaBom = await fetch(`${baseBom}/p/${bomba.id}`, { redirect: 'manual' });
  probar('la dirección para compartir lleva a la portada', compartidaBom.status === 302);
  probar('el pío común sigue ahí', (await idsBom('/pios?tipo=plaza')).includes(comun.id));

  // Entre que explota y que pasa la barrida, no la ve nadie igual.
  const rezagada = await piarBom(artificieraT, { texto: 'rezagada', bomba: true });
  conBom.almacen.buscarPio(rezagada.id).explota = Date.now() - 1;
  conBom.almacen.proximaExplosion = Date.now() + 60000;
  probar('una bomba vencida no se ve aunque siga en memoria',
    !(await idsBom('/pios?tipo=plaza', artificieraT)).includes(rezagada.id) && !!conBom.almacen.buscarPio(rezagada.id));
  probar('ni se comparte', (await fetch(`${baseBom}/p/${rezagada.id}`, { redirect: 'manual' })).status === 302);
  conBom.almacen.proximaExplosion = 0;
  await pedirBom('/pios?tipo=plaza');
  probar('y la barrida siguiente se la lleva', !conBom.almacen.buscarPio(rezagada.id));

  // La mecha se guarda con el pío: un reinicio no la apaga.
  const duradera = await piarBom(artificieraT, { texto: 'sobrevivo al reinicio', bomba: true });
  // Y una que explota con el sitio apagado: se guarda ya vencida.
  const aOscuras = await piarBom(artificieraT, { texto: 'exploto a oscuras', bomba: true });
  conBom.almacen.buscarPio(aOscuras.id).explota = Date.now() - 1;
  await conBom.almacen.guardar([]);
  await new Promise((listo) => conBom.close(listo));
  conBom = crearServidor({ datos: carpetaBom, api: { altas: 100 } });
  await new Promise((listo) => conBom.listen(0, '127.0.0.1', listo));
  baseBom = `http://127.0.0.1:${conBom.address().port}`;
  const trasReinicio = (await pedirBom(`/pios/${duradera.id}/hilo`)).datos.pio;
  probar('una bomba sigue siendo bomba después de un reinicio', trasReinicio && trasReinicio.bomba === true);
  probar('y lo que explotó con el sitio apagado se barre al primer pedido', !conBom.almacen.buscarPio(aOscuras.id));

  probar('la mecha se ajusta', crearServidor({ datos: carpetaBom, api: { mecha: 5000 } }).almacen.mecha === 5000);
  probar('una mecha de cero vuelve a las veinticuatro horas',
    crearServidor({ datos: carpetaBom, api: { mecha: 0 } }).almacen.mecha === MECHA);

  // --- escrito a mano --------------------------------------------------------

  grupo('Escrito a mano');

  const manoT = await naceBom('caligrafa');
  const aMano = await piarBom(manoT, { texto: 'tecleado letra por letra', aMano: true });
  probar('un pío puede venir escrito a mano', aMano.aMano === true);
  probar('sin decirlo, no lo es', (await piarBom(manoT, { texto: 'pegado de otro lado' })).aMano === false);
  probar('sólo un true de verdad pone el sello',
    (await piarBom(manoT, { texto: 'dudoso', aMano: 'sí' })).aMano === false);
  // Una imagen sola no tiene nada escrito.
  const imagenSinTexto = await conBom.almacen.publicar(conBom.almacen.buscarUsuario('caligrafa'), '', null,
    { tipo: 'imagen', url: 'https://i.ibb.co/x/y.png' }, null, { aMano: true });
  probar('sin texto no hay sello', !imagenSinTexto.aMano);
  const respuestaMano = await piarBom(manoT, { texto: 'y la respuesta también', respuestaA: aMano.id, aMano: true });
  probar('una respuesta también puede serlo', respuestaMano.aMano === true);

  const plazaMano = await idsBom('/pios?tipo=plaza&mano=1');
  probar('la plaza se filtra a lo escrito a mano',
    plazaMano.includes(aMano.id) && plazaMano.includes(respuestaMano.id) && plazaMano.length === 2, JSON.stringify(plazaMano));
  probar('sin el filtro está todo', (await idsBom('/pios?tipo=plaza')).length > plazaMano.length);
  probar('el filtro sirve en cualquier línea',
    (await idsBom('/pios?tipo=usuario&usuario=caligrafa&mano=1')).length === 2);
  probar('el sello se guarda', conBom.almacen.buscarPio(aMano.id).aMano === true);

  // --- la granja duerme ------------------------------------------------------

  grupo('La granja duerme');
  const D = require('../src/descanso');

  const deFabrica = D.deCuenta({});
  probar('el silencio viene encendido de once a siete', deFabrica.silencio && deFabrica.desde === 23 && deFabrica.hasta === 7);
  probar('y sin tope de píos', deFabrica.tope === 0);
  // Septiembre de 2026: Santiago en UTC-3.
  const aLas = (h) => Date.UTC(2026, 8, 15, (h + 3) % 24, 30);
  const noche = { silencio: true, desde: 23, hasta: 7, zona: 'America/Santiago' };
  probar('a las 23:30 se duerme', D.durmiendo(noche, null, aLas(23)));
  probar('a las 3:30 también', D.durmiendo(noche, null, aLas(3)));
  probar('a las 7:30 ya no', !D.durmiendo(noche, null, aLas(7)));
  probar('a las 22:30 todavía no', !D.durmiendo(noche, null, aLas(22)));
  const siesta = Object.assign({}, noche, { desde: 14, hasta: 16 });
  probar('un horario que no cruza la medianoche también sirve',
    D.durmiendo(siesta, null, aLas(15)) && !D.durmiendo(siesta, null, aLas(16)) && !D.durmiendo(siesta, null, aLas(3)));
  probar('apagado no duerme nunca', !D.durmiendo(Object.assign({}, noche, { silencio: false }), null, aLas(3)));
  probar('sin zona propia, se cuenta en la del sitio',
    D.durmiendo(Object.assign({}, noche, { zona: null }), 'America/Santiago', aLas(3)));

  const perfilDescanso = async (token) => (await pedirBom('/yo', { token })).datos.yo;
  probar('el perfil propio trae el descanso', (await perfilDescanso(manoT)).descanso.silencio === true);
  probar('y cuántos píos van hoy', (await perfilDescanso(manoT)).piosHoy === 5, String((await perfilDescanso(manoT)).piosHoy));
  probar('el perfil ajeno no', (await pedirBom('/usuarios/caligrafa', { token: artificieraT })).datos.perfil.descanso === undefined);

  const ajustar = (descanso) => pedirBom('/yo', { metodo: 'PATCH', token: manoT, cuerpo: { descanso } });
  const ajustado = await ajustar({ desde: 22, hasta: 6, tope: 5, zona: 'Europe/Madrid' });
  probar('el horario, la zona y el tope se cambian', ajustado.estado === 200
    && ajustado.datos.yo.descanso.desde === 22 && ajustado.datos.yo.descanso.tope === 5
    && ajustado.datos.yo.descanso.zona === 'Europe/Madrid');
  probar('cambiar una parte no toca el resto', (await ajustar({ silencio: false })).datos.yo.descanso.desde === 22);
  probar('una hora fuera de rango no', (await ajustar({ desde: 24 })).datos.clave === 'descanso.hora');
  probar('ni con decimales', (await ajustar({ hasta: 6.5 })).estado === 400);
  probar('empezar y terminar a la misma hora no', (await ajustar({ desde: 6 })).datos.clave === 'descanso.igual');
  probar('una zona inventada no', (await ajustar({ zona: 'Marte/Olympus' })).datos.clave === 'descanso.zona');
  probar('un tope que no se ofrece no', (await ajustar({ tope: 7 })).datos.clave === 'descanso.tope');
  probar('lo rechazado no deja nada a medias', (await perfilDescanso(manoT)).descanso.tope === 5);
  // El día de cada uno: un pío de ayer a la noche no cuenta para hoy.
  const hoyD = Date.UTC(2026, 8, 15, 15, 0);
  const piosD = [
    { autor: 'x', creado: Date.UTC(2026, 8, 15, 4, 0) }, // 01:00 del 15 en Santiago
    { autor: 'x', creado: Date.UTC(2026, 8, 15, 2, 0) }, // 23:00 del 14 en Santiago
    { autor: 'otro', creado: hoyD },
  ];
  probar('los píos de hoy se cuentan en el día de quien pía',
    D.piosDeHoy(piosD, 'x', 'America/Santiago', hoyD) === 1 && D.piosDeHoy(piosD, 'x', 'UTC', hoyD) === 2);

  await new Promise((listo) => conBom.close(listo));
  fs.rmSync(carpetaBom, { recursive: true, force: true });

  // --- la pregunta del día -------------------------------------------------

  grupo('La pregunta del día');
  const PR = require('../src/preguntas');

  probar('hay cuarenta preguntas', PR.PREGUNTAS.length === 40);
  probar('todas entran en un pío', PR.PREGUNTAS.every(([es, en]) => [...es].length <= 100 && [...en].length <= 100));
  const cuarentaDias = new Set(Array.from({ length: 40 }, (_, i) =>
    PR.preguntaDe(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)).es));
  probar('en cuarenta días pasan las cuarenta, sin repetir', cuarentaDias.size === 40);
  probar('el mismo día da la misma pregunta', PR.preguntaDe('2026-09-14').es === PR.preguntaDe('2026-09-14').es);
  probar('una fecha inventada no tiene pregunta', PR.preguntaDe('2026-02-30') === null && PR.preguntaDe('ayer') === null);
  // Render corre en UTC: a las 22 de Chile ya es mañana allá.
  const nocheChile = Date.UTC(2026, 8, 15, 2, 0);
  probar('el día es el de donde vive el sitio, no el del servidor',
    PR.hoy('America/Santiago', nocheChile) === '2026-09-14' && PR.hoy('UTC', nocheChile) === '2026-09-15');
  probar('una zona mal escrita no rompe nada', PR.hoy('Marte/Olympus', nocheChile) === '2026-09-15');

  const carpetaPre = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-pre-'));
  const conPre = crearServidor({ datos: carpetaPre, api: { altas: 100 } });
  await new Promise((listo) => conPre.listen(0, '127.0.0.1', listo));
  const basePre = `http://127.0.0.1:${conPre.address().port}`;
  const pedirPre = async (ruta, o = {}) => {
    const r = await fetch(`${basePre}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  const curiosaT = (await pedirPre('/registro', {
    metodo: 'POST', cuerpo: { usuario: 'curiosa', nombre: 'Curiosa', clave: 'semillas' },
  })).datos.token;

  const deHoy = await pedirPre('/pregunta');
  probar('la API da la pregunta de hoy', deHoy.estado === 200 && deHoy.datos.pregunta.hoy === true
    && !!deHoy.datos.pregunta.es && !!deHoy.datos.pregunta.en);
  probar('arranca sin respuestas', deHoy.datos.pregunta.respuestas === 0);
  const fechaHoy = deHoy.datos.pregunta.fecha;

  const respondida = await pedirPre('/pios', {
    metodo: 'POST', token: curiosaT, cuerpo: { texto: 'Pan con palta', pregunta: true },
  });
  probar('se responde con un pío', respondida.estado === 201 && respondida.datos.pio.pregunta === fechaHoy);
  probar('y se cuenta', (await pedirPre('/pregunta')).datos.pregunta.respuestas === 1);
  probar('la respuesta está en la plaza',
    (await pedirPre('/pios?tipo=plaza')).datos.pios.some((p) => p.id === respondida.datos.pio.id));
  probar('y en la lista de la pregunta',
    (await pedirPre(`/pios?tipo=pregunta&fecha=${fechaHoy}`)).datos.pios.length === 1);

  // La fecha la decide el servidor.
  const trampa = await pedirPre('/pios', {
    metodo: 'POST', token: curiosaT, cuerpo: { texto: 'contesto la de otro día', pregunta: '2020-01-01' },
  });
  probar('el cliente no elige de qué día es la pregunta', trampa.datos.pio.pregunta === fechaHoy);

  const otroPio = (await pedirPre('/pios', { metodo: 'POST', token: curiosaT, cuerpo: { texto: 'algo' } })).datos.pio.id;
  const contestando = await pedirPre('/pios', {
    metodo: 'POST', token: curiosaT, cuerpo: { texto: 'a otro pío', respuestaA: otroPio, pregunta: true },
  });
  probar('una respuesta a otro pío no cuenta como respuesta a la pregunta', contestando.datos.pio.pregunta === null);

  probar('las de mañana no se adelantan', (await pedirPre('/pregunta?fecha=2999-01-01')).estado === 404);
  probar('las de días pasados sí se pueden ver', (await pedirPre('/pregunta?fecha=2026-01-01')).datos.pregunta.hoy === false);
  probar('una fecha rara da 404', (await pedirPre('/pregunta?fecha=cualquiera')).estado === 404);

  await new Promise((listo) => conPre.close(listo));
  fs.rmSync(carpetaPre, { recursive: true, force: true });

  // --- la foto de perfil ---------------------------------------------------

  grupo('Foto de perfil');

  const carpetaAva = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-ava-'));
  const conAva = crearServidor({ datos: carpetaAva, api: { altas: 100 } });
  await new Promise((listo) => conAva.listen(0, '127.0.0.1', listo));
  const baseAva = `http://127.0.0.1:${conAva.address().port}`;
  const pedirAva = async (ruta, o = {}) => {
    const r = await fetch(`${baseAva}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  const retratoT = (await pedirAva('/registro', {
    metodo: 'POST', cuerpo: { usuario: 'retratada', nombre: 'Retratada', clave: 'semillas' },
  })).datos.token;

  probar('sin foto, avatar vacío', (await pedirAva('/yo', { token: retratoT })).datos.yo.avatar === null);

  const foto = 'https://res.cloudinary.com/demo/image/upload/c_thumb,w_200/pio/cara.jpg';
  const puesta = await pedirAva('/yo', { metodo: 'PATCH', token: retratoT, cuerpo: { avatar: foto } });
  probar('se pone una foto', puesta.estado === 200 && puesta.datos.yo.avatar === foto);
  probar('sale en el perfil público', (await pedirAva('/usuarios/retratada')).datos.perfil.avatar === foto);

  await pedirAva('/pios', { metodo: 'POST', token: retratoT, cuerpo: { texto: 'con cara nueva' } });
  probar('y en cada pío', (await pedirAva('/pios?tipo=plaza')).datos.pios[0].autor.avatar === foto);

  // Termina en un <img> de todas las páginas: sólo de los servicios de imágenes.
  const ajena = await pedirAva('/yo', {
    metodo: 'PATCH', token: retratoT, cuerpo: { avatar: 'https://malo.example/cara.png' },
  });
  probar('una foto de cualquier sitio se rechaza', ajena.estado === 400 && ajena.datos.clave === 'adjunto.origen');
  const sinHttps = await pedirAva('/yo', {
    metodo: 'PATCH', token: retratoT, cuerpo: { avatar: 'http://res.cloudinary.com/demo/cara.jpg' },
  });
  probar('sin https tampoco', sinHttps.estado === 400);
  probar('y lo rechazado no cambia nada', (await pedirAva('/yo', { token: retratoT })).datos.yo.avatar === foto);
  const truco = await pedirAva('/yo', {
    metodo: 'PATCH', token: retratoT, cuerpo: { avatar: 'javascript:alert(1)' },
  });
  probar('ni direcciones que no son de imagen', truco.estado === 400);

  const nombreSolo = await pedirAva('/yo', { metodo: 'PATCH', token: retratoT, cuerpo: { nombre: 'Otra' } });
  probar('cambiar el nombre no toca la foto', nombreSolo.datos.yo.avatar === foto);

  const quitada = await pedirAva('/yo', { metodo: 'PATCH', token: retratoT, cuerpo: { avatar: null } });
  probar('se quita la foto', quitada.estado === 200 && quitada.datos.yo.avatar === null);

  await new Promise((listo) => conAva.close(listo));
  fs.rmSync(carpetaAva, { recursive: true, force: true });

  // --- spotify --------------------------------------------------------------

  grupo('Spotify');

  const carpetaSpo = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-spo-'));
  const conSpo = crearServidor({ datos: carpetaSpo, api: { altas: 100 } });
  await new Promise((listo) => conSpo.listen(0, '127.0.0.1', listo));
  const baseSpo = `http://127.0.0.1:${conSpo.address().port}`;
  const piarSpo = async (token, cuerpo) => {
    const r = await fetch(`${baseSpo}/api/pios`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(cuerpo),
    });
    return { estado: r.status, datos: await r.json() };
  };
  const melomanaT = (await (await fetch(`${baseSpo}/api/registro`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'melomana', nombre: 'Melómana', clave: 'semillas' }),
  })).json()).token;

  const cancion = await piarSpo(melomanaT, {
    texto: 'Para empezar el día', adjunto: { tipo: 'spotify', recurso: 'track', id: '4cOdK2wGLETKBW3PvgPWqT' },
  });
  probar('un pío lleva una canción de Spotify', cancion.estado === 201
    && cancion.datos.pio.adjunto.tipo === 'spotify' && cancion.datos.pio.adjunto.id === '4cOdK2wGLETKBW3PvgPWqT');
  probar('se guarda sólo el tipo y el identificador',
    JSON.stringify(Object.keys(cancion.datos.pio.adjunto).sort()) === JSON.stringify(['id', 'recurso', 'tipo']));
  probar('sin texto también vale, como con una imagen',
    (await piarSpo(melomanaT, { texto: '', adjunto: { tipo: 'spotify', recurso: 'album', id: '1DFixLWuPkv3KT3TnV35m3' } })).estado === 201);
  probar('un tipo que no es de Spotify se rechaza',
    (await piarSpo(melomanaT, { texto: 'x', adjunto: { tipo: 'spotify', recurso: 'pagina', id: '4cOdK2wGLETKBW3PvgPWqT' } })).estado === 400);
  // El identificador termina dentro de la dirección del reproductor.
  probar('un identificador raro se rechaza',
    (await piarSpo(melomanaT, { texto: 'x', adjunto: { tipo: 'spotify', recurso: 'track', id: '../../evil.com/xxxxxxxx' } })).estado === 400);
  probar('y una imagen sin tipo sigue siendo imagen',
    (await piarSpo(melomanaT, { texto: 'x', adjunto: { url: 'https://malo.example/a.png' } })).datos.clave === 'adjunto.origen');

  await new Promise((listo) => conSpo.close(listo));
  fs.rmSync(carpetaSpo, { recursive: true, force: true });

  // --- etiquetas en fotos ---------------------------------------------------

  grupo('Etiquetas en fotos');

  const carpetaEti = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-eti-'));
  const conEti = crearServidor({ datos: carpetaEti, api: { altas: 100 } });
  await new Promise((listo) => conEti.listen(0, '127.0.0.1', listo));
  const baseEti = `http://127.0.0.1:${conEti.address().port}`;
  const pedirEti = async (ruta, o = {}) => {
    const r = await fetch(`${baseEti}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  const naceEti = async (usuario) => (await pedirEti('/registro', {
    metodo: 'POST', cuerpo: { usuario, nombre: usuario, clave: 'semillas' },
  })).datos.token;
  const fotografaT = await naceEti('fotografa');
  const amigaT = await naceEti('amiga');
  await naceEti('primo');
  const fotoEti = 'https://res.cloudinary.com/demo/image/upload/pio/asado.jpg';

  const conGente = await pedirEti('/pios', {
    metodo: 'POST', token: fotografaT,
    cuerpo: {
      texto: 'El asado del domingo',
      adjunto: {
        url: fotoEti,
        etiquetas: [
          { usuario: 'amiga', x: 0.3, y: 0.4 },
          { usuario: '@Primo', x: 1.7, y: -2 },
          { usuario: 'nadie_asi', x: 0.5, y: 0.5 },
          { usuario: 'amiga', x: 0.9, y: 0.9 },
          { usuario: 'fotografa', x: 'mucho', y: 0.1 },
        ],
      },
    },
  });
  const etiq = conGente.datos.pio.adjunto.etiquetas;
  probar('una foto lleva etiquetas', conGente.estado === 201 && etiq.length === 2, JSON.stringify(etiq));
  probar('con su lugar sobre la foto', etiq[0].usuario === 'amiga' && etiq[0].x === 0.3 && etiq[0].y === 0.4);
  probar('las coordenadas se quedan dentro de la foto', etiq[1].usuario === 'primo' && etiq[1].x === 1 && etiq[1].y === 0);
  probar('una cuenta que no existe no se etiqueta', !etiq.some((e) => e.usuario === 'nadie_asi'));
  probar('la misma persona, una sola vez', etiq.filter((e) => e.usuario === 'amiga').length === 1);
  probar('sin coordenadas no hay etiqueta', !etiq.some((e) => e.usuario === 'fotografa'));

  const avisoFoto = (await pedirEti('/notificaciones', { token: amigaT })).datos.notificaciones;
  probar('a quien etiquetaron le llega el aviso', avisoFoto.length === 1 && avisoFoto[0].tipo === 'foto');

  const mencionYFoto = await pedirEti('/pios', {
    metodo: 'POST', token: fotografaT,
    cuerpo: { texto: 'mira @amiga', adjunto: { url: fotoEti, etiquetas: [{ usuario: 'amiga', x: 0.5, y: 0.5 }] } },
  });
  probar('mencionada y etiquetada es un solo aviso',
    (await pedirEti('/notificaciones', { token: amigaT })).datos.notificaciones
      .filter((n) => n.pio && n.pio.id === mencionYFoto.datos.pio.id).length === 1);

  const muchas = Array.from({ length: 15 }, (_, i) => ({ usuario: `relleno${i}`, x: 0.1, y: 0.1 }));
  for (let i = 0; i < 15; i += 1) await naceEti(`relleno${i}`);
  const llena = await pedirEti('/pios', {
    metodo: 'POST', token: fotografaT, cuerpo: { texto: 'mucha gente', adjunto: { url: fotoEti, etiquetas: muchas } },
  });
  probar('diez etiquetas como mucho', llena.datos.pio.adjunto.etiquetas.length === 10);

  const spotifyConEtiquetas = await pedirEti('/pios', {
    metodo: 'POST', token: fotografaT,
    cuerpo: { texto: 'x', adjunto: { tipo: 'spotify', recurso: 'track', id: '4cOdK2wGLETKBW3PvgPWqT', etiquetas: [{ usuario: 'amiga', x: 0, y: 0 }] } },
  });
  probar('una canción no lleva etiquetas', !spotifyConEtiquetas.datos.pio.adjunto.etiquetas);

  // Se guardan con el nombre de entonces y se muestran con el de ahora.
  await pedirEti('/yo', { metodo: 'PATCH', token: amigaT, cuerpo: { usuario: 'amiga_nueva' } });
  const trasRenombre = (await pedirEti(`/pios/${conGente.datos.pio.id}/hilo`)).datos.pio.adjunto.etiquetas;
  probar('si la etiquetada cambia de nombre, la etiqueta la sigue', trasRenombre.some((e) => e.usuario === 'amiga_nueva'));

  await new Promise((listo) => conEti.close(listo));
  fs.rmSync(carpetaEti, { recursive: true, force: true });

  // --- bloqueo suave --------------------------------------------------------

  grupo('Bloqueo suave');

  const carpetaBlo = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-blo-'));
  const conBlo = crearServidor({ datos: carpetaBlo, api: { altas: 100 } });
  await new Promise((listo) => conBlo.listen(0, '127.0.0.1', listo));
  const baseBlo = `http://127.0.0.1:${conBlo.address().port}`;
  const pedirBlo = async (ruta, o = {}) => {
    const r = await fetch(`${baseBlo}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  const naceBlo = async (usuario) => (await pedirBlo('/registro', {
    metodo: 'POST', cuerpo: { usuario, nombre: usuario, clave: 'semillas' },
  })).datos.token;
  const tranquilaT = await naceBlo('tranquila');
  const molestoT = await naceBlo('molesto');
  const terceraT = await naceBlo('tercera');
  await pedirBlo('/pios', { metodo: 'POST', token: molestoT, cuerpo: { texto: 'algo que no quiero leer' } });

  const bloqueoPuesto = await pedirBlo('/usuarios/molesto/bloquear', { metodo: 'POST', token: tranquilaT, cuerpo: { minutos: 1440 } });
  const hastaBlo = bloqueoPuesto.datos.perfil && bloqueoPuesto.datos.perfil.bloqueadoHasta;
  probar('se bloquea por un día', bloqueoPuesto.estado === 200
    && Math.abs(hastaBlo - (Date.now() + 24 * 60 * 60 * 1000)) < 5000, JSON.stringify(bloqueoPuesto.datos));

  const plazaBlo = (await pedirBlo('/pios?tipo=plaza', { token: tranquilaT })).datos.pios;
  // Es un bloqueo suave: los píos siguen ahí, pero marcados para verse borrosos.
  probar('sus píos se siguen viendo', plazaBlo.some((p) => p.autor.usuario === 'molesto'));
  probar('pero marcados para salir borrosos', plazaBlo.find((p) => p.autor.usuario === 'molesto').bloqueadoHasta === hastaBlo);
  probar('para los demás no cambia nada',
    (await pedirBlo('/pios?tipo=plaza', { token: terceraT })).datos.pios.every((p) => !p.bloqueadoHasta));

  await pedirBlo('/pios', { metodo: 'POST', token: molestoT, cuerpo: { texto: 'hola @tranquila' } });
  const avisosBlo = await pedirBlo('/notificaciones', { token: tranquilaT });
  probar('sus avisos no llegan mientras dura', avisosBlo.datos.notificaciones.length === 0 && avisosBlo.datos.sinLeer === 0);
  probar('ni en la cuenta liviana', (await pedirBlo('/notificaciones/cuenta', { token: tranquilaT })).datos.sinLeer === 0);
  probar('y quien fue bloqueado no se entera',
    (await pedirBlo('/notificaciones', { token: molestoT })).datos.notificaciones.length === 0);

  probar('un plazo inventado se rechaza',
    (await pedirBlo('/usuarios/molesto/bloquear', { metodo: 'POST', token: tranquilaT, cuerpo: { minutos: 999999 } })).estado === 400);
  probar('no se puede bloquear a sí misma',
    (await pedirBlo('/usuarios/tranquila/bloquear', { metodo: 'POST', token: tranquilaT, cuerpo: { minutos: 60 } })).estado === 400);
  probar('bloquear pide sesión',
    (await pedirBlo('/usuarios/molesto/bloquear', { metodo: 'POST', cuerpo: { minutos: 60 } })).estado === 401);

  // Vence solo: se adelanta el reloj de la cuenta.
  conBlo.almacen.buscarUsuario('tranquila').bloqueados.molesto = Date.now() - 1;
  probar('al vencer, los píos se ven normales',
    (await pedirBlo('/pios?tipo=plaza', { token: tranquilaT })).datos.pios.every((p) => !p.bloqueadoHasta));
  probar('y los avisos vuelven', (await pedirBlo('/notificaciones', { token: tranquilaT })).datos.sinLeer === 1);

  await pedirBlo('/usuarios/molesto/bloquear', { metodo: 'POST', token: tranquilaT, cuerpo: { minutos: 60 } });
  const bloqueoQuitado = await pedirBlo('/usuarios/molesto/bloquear', { metodo: 'POST', token: tranquilaT, cuerpo: { minutos: 0 } });
  probar('se desbloquea antes de tiempo', bloqueoQuitado.datos.perfil.bloqueadoHasta === null);
  probar('y los vencidos se barren', Object.keys(conBlo.almacen.buscarUsuario('tranquila').bloqueados).length === 0);

  await pedirBlo('/usuarios/molesto/bloquear', { metodo: 'POST', token: tranquilaT, cuerpo: { minutos: 10080 } });
  await pedirBlo('/yo', { metodo: 'PATCH', token: molestoT, cuerpo: { usuario: 'molesto_nuevo' } });
  probar('cambiarse el nombre no saca del bloqueo',
    !!conBlo.almacen.bloqueoVigente(conBlo.almacen.buscarUsuario('tranquila'), 'molesto_nuevo'));

  await new Promise((listo) => conBlo.close(listo));
  fs.rmSync(carpetaBlo, { recursive: true, force: true });

  // --- como app ---------------------------------------------------------------

  grupo('Como app');

  const carpetaApp = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-app-'));
  const conApp = crearServidor({ datos: carpetaApp, api: { altas: 100 } });
  await new Promise((listo) => conApp.listen(0, '127.0.0.1', listo));
  const baseApp = `http://127.0.0.1:${conApp.address().port}`;

  const manifiesto = await fetch(`${baseApp}/manifest.webmanifest`);
  const datosManifiesto = await manifiesto.json();
  probar('el manifiesto se sirve con su tipo', manifiesto.headers.get('content-type').startsWith('application/manifest+json'));
  probar('abre como app, sin barra del navegador', datosManifiesto.display === 'standalone' && datosManifiesto.start_url.startsWith('/'));
  // Lo que Chrome exige para ofrecer instalarla.
  probar('trae íconos de 192 y 512', ['192x192', '512x512'].every((t) => datosManifiesto.icons.some((i) => i.sizes === t)));
  probar('y uno enmascarable para Android', datosManifiesto.icons.some((i) => i.purpose === 'maskable'));

  for (const i of datosManifiesto.icons) {
    const r = await fetch(`${baseApp}${i.src}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    const [ancho, alto] = i.sizes.split('x').map(Number);
    probar(`el ícono ${i.src} existe y mide ${i.sizes}`, r.status === 200 && r.headers.get('content-type') === 'image/png'
      && bytes.readUInt32BE(16) === ancho && bytes.readUInt32BE(20) === alto);
  }
  const apple = Buffer.from(await (await fetch(`${baseApp}/iconos/apple-180.png`)).arrayBuffer());
  probar('el del iPhone mide 180', apple.readUInt32BE(16) === 180);
  // Si no, un ícono inventado devolvería la página entera con 200.
  probar('un ícono que no existe da 404', (await fetch(`${baseApp}/iconos/nada.png`)).status === 404);

  const trabajador = await fetch(`${baseApp}/sw.js`);
  const codigoSw = await trabajador.text();
  probar('el trabajador se sirve como JavaScript', trabajador.headers.get('content-type').startsWith('text/javascript'));
  probar('y nunca guarda la API', codigoSw.includes("startsWith('/api/')"));
  // Todo lo que guarda para abrir sin red tiene que existir de verdad: si uno
  // falla, la instalación del trabajador falla entera.
  const cascara = JSON.parse(codigoSw.match(/const CASCARA = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  let cascaraSana = true;
  for (const ruta of cascara) {
    const r = await fetch(`${baseApp}${ruta}`);
    const tipo = r.headers.get('content-type') || '';
    const esperado = ruta === '/' ? 'text/html' : ruta.endsWith('.css') ? 'text/css' : ruta.endsWith('.js') ? 'text/javascript'
      : ruta.endsWith('.png') ? 'image/png' : ruta.endsWith('.svg') ? 'image/svg+xml' : 'application/manifest+json';
    if (r.status !== 200 || !tipo.startsWith(esperado)) { cascaraSana = false; console.log('     falta:', ruta, r.status, tipo); }
  }
  probar('todo lo que guarda para abrir sin red existe', cascaraSana);

  const logo = await fetch(`${baseApp}/logo.svg`);
  const logoTexto = await logo.text();
  probar('el logo se sirve como SVG', logo.headers.get('content-type').startsWith('image/svg+xml') && logoTexto.startsWith('<svg'));
  // Un solo dibujo para todo: el SVG y los PNG salen de src/logo.js.
  probar('trae el cuadrado, la cáscara quebrada y la cabeza inclinada', logoTexto.includes('rx="22"')
    && /<path d="M22 61 (L[\d.]+ [\d.]+ ){8}A28 30/.test(logoTexto) && logoTexto.includes('rotate(-20 50 46)'));
  const icono512 = Buffer.from(await (await fetch(`${baseApp}/iconos/pio-512.png`)).arrayBuffer());
  const zlibPrueba = require('zlib');
  const crudo512 = zlibPrueba.inflateSync(icono512.subarray(41, icono512.length - 12));
  const pixel = (x, y) => [...crudo512.subarray(y * (512 * 3 + 1) + 1 + x * 3, y * (512 * 3 + 1) + 1 + x * 3 + 3)];
  probar('el ícono de la app es naranja hasta el borde', JSON.stringify(pixel(0, 0)) === JSON.stringify([240, 124, 31]));
  probar('y tiene la cáscara crema abajo al centro', JSON.stringify(pixel(256, 420)) === JSON.stringify([255, 244, 209]));
  const pagina = await (await fetch(`${baseApp}/`)).text();
  probar('la página enlaza el manifiesto', pagina.includes('rel="manifest"'));
  probar('y el ícono del iPhone', pagina.includes('rel="apple-touch-icon"'));
  probar('la pestaña usa el logo', pagina.includes('rel="icon" type="image/svg+xml" href="/logo.svg"'));

  await new Promise((listo) => conApp.close(listo));
  fs.rmSync(carpetaApp, { recursive: true, force: true });

  // --- notificaciones al teléfono -------------------------------------------

  grupo('Notificaciones');
  const PUSH = require('../src/push');
  const b64u = (s) => Buffer.from(s, 'base64url');

  // El ejemplo del estándar (RFC 8291, apéndice A): con esas claves y esa sal,
  // el mensaje cifrado tiene que salir idéntico, byte por byte.
  const delRfc = PUSH.cifrar('When I grow up, I want to be a watermelon',
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'BTBZMqHH6r4Tts7J_aSIgg',
    { efimera: b64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), sal: b64u('DGv6ra1nlYgDCS1FRnbzlw') });
  probar('el cifrado coincide con el ejemplo del estándar', delRfc.toString('base64url')
    === 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');

  const clavesPrueba = PUSH.generarClaves();
  probar('las claves VAPID salen en el formato de siempre', PUSH.clavesValidas(clavesPrueba)
    && b64u(clavesPrueba.publica).length === 65 && b64u(clavesPrueba.privada).length === 32);

  const jwt = PUSH.tokenVapid(clavesPrueba, 'https://fcm.googleapis.com/fcm/send/xyz', 'mailto:a@b.c');
  const [jCab, jCuerpo, jFirma] = jwt.split('.');
  const punto = b64u(clavesPrueba.publica);
  const publicaJwk = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: punto.subarray(1, 33).toString('base64url'), y: punto.subarray(33).toString('base64url') }, format: 'jwk' });
  probar('el token VAPID está bien firmado', crypto.verify('sha256', Buffer.from(`${jCab}.${jCuerpo}`), { key: publicaJwk, dsaEncoding: 'ieee-p1363' }, b64u(jFirma)));
  const reclamos = JSON.parse(b64u(jCuerpo).toString());
  probar('y dice para qué servicio es y hasta cuándo vale', reclamos.aud === 'https://fcm.googleapis.com'
    && reclamos.exp > Date.now() / 1000 && reclamos.exp <= Date.now() / 1000 + 24 * 3600 && reclamos.sub === 'mailto:a@b.c');

  // Un navegador de mentira: sus claves y cómo descifra lo que le llega.
  const navegadorFalso = () => {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = crypto.randomBytes(16);
    return {
      ecdh, auth,
      suscripcion: (sufijo) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${sufijo}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } }),
      descifrar(cuerpo) {
        const sal = cuerpo.subarray(0, 16);
        const largoClave = cuerpo[20];
        const suya = cuerpo.subarray(21, 21 + largoClave);
        const cifrado = cuerpo.subarray(21 + largoClave);
        const compartido = ecdh.computeSecret(suya);
        const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), suya]);
        const ikm = Buffer.from(crypto.hkdfSync('sha256', compartido, auth, info, 32));
        const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, sal, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
        const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, sal, Buffer.from('Content-Encoding: nonce\0'), 12));
        const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
        d.setAuthTag(cifrado.subarray(-16));
        const plano = Buffer.concat([d.update(cifrado.subarray(0, -16)), d.final()]);
        return JSON.parse(plano.subarray(0, plano.lastIndexOf(2)).toString());
      },
    };
  };

  // El servidor sólo le escribe a los servicios de avisos conocidos.
  const nav0 = navegadorFalso();
  probar('una suscripción de Google se acepta', !!PUSH.limpiarSuscripcion(nav0.suscripcion('a')));
  probar('a una dirección cualquiera no se le manda nada',
    PUSH.limpiarSuscripcion(Object.assign(nav0.suscripcion('a'), { endpoint: 'https://mi-servidor.example/robar' })) === null);
  probar('ni a una red interna', PUSH.limpiarSuscripcion(Object.assign(nav0.suscripcion('a'), { endpoint: 'https://169.254.169.254/latest' })) === null);
  probar('ni sin https', PUSH.limpiarSuscripcion(Object.assign(nav0.suscripcion('a'), { endpoint: 'http://fcm.googleapis.com/fcm/send/a' })) === null);
  probar('ni con claves de otro largo',
    PUSH.limpiarSuscripcion({ endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys: { p256dh: 'AAAA', auth: 'BBBB' } }) === null);

  // --- con un servicio de avisos de mentira ---

  const enviados = [];
  let respuestaDelServicio = 201;
  const carpetaPush = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-push-'));
  // Mediodía en Santiago: lejos del horario de silencio de fábrica.
  const MEDIODIA = Date.UTC(2026, 8, 15, 16, 0);
  let relojPush = MEDIODIA;
  const armarServidorPush = (extra = {}) => crearServidor({
    datos: carpetaPush,
    api: Object.assign({
      altas: 100, demoraPush: 20, vapidContacto: 'mailto:prueba@pio.test', relojPush: () => relojPush,
      pedirPush: async (url, init) => { enviados.push({ url, init }); return { status: respuestaDelServicio }; },
    }, extra),
  });
  let conPush = armarServidorPush();
  await new Promise((listo) => conPush.listen(0, '127.0.0.1', listo));
  let basePush = `http://127.0.0.1:${conPush.address().port}`;
  const pedirPush = async (ruta, o = {}) => {
    const r = await fetch(`${basePush}/api${ruta}`, {
      method: o.metodo || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
  };
  const nacePush = async (usuario) => (await pedirPush('/registro', {
    metodo: 'POST', cuerpo: { usuario, nombre: usuario, clave: 'semillas' },
  })).datos.token;
  const esperarEnvios = () => new Promise((listo) => setTimeout(listo, 150));

  const clave1 = (await pedirPush('/push/clave')).datos.clave;
  probar('el servidor da su clave pública', b64u(clave1).length === 65);
  probar('y es siempre la misma', (await pedirPush('/push/clave')).datos.clave === clave1);

  const receptoraT = await nacePush('receptora');
  const avisadorT = await nacePush('avisador');
  const otraPushT = await nacePush('otracuenta');
  const telefono = navegadorFalso();

  probar('suscribirse pide sesión', (await pedirPush('/push/suscribir', { metodo: 'POST', cuerpo: telefono.suscripcion('tel') })).estado === 401);
  probar('una suscripción mala se rechaza',
    (await pedirPush('/push/suscribir', { metodo: 'POST', token: receptoraT, cuerpo: { endpoint: 'https://mi-servidor.example/x', keys: {} } })).estado === 400);
  probar('una buena se guarda',
    (await pedirPush('/push/suscribir', { metodo: 'POST', token: receptoraT, cuerpo: Object.assign(telefono.suscripcion('tel'), { idioma: 'es' }) })).estado === 200);

  enviados.length = 0;
  const mencionPush = await pedirPush('/pios', { metodo: 'POST', token: avisadorT, cuerpo: { texto: 'hola @receptora, ¿vienes?' } });
  await esperarEnvios();
  probar('una mención sale al teléfono', enviados.length === 1 && enviados[0].url === 'https://fcm.googleapis.com/fcm/send/tel',
    String(enviados.length));
  const cabeceras = enviados[0] ? enviados[0].init.headers : {};
  probar('firmada con VAPID', /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/.test(cabeceras.Authorization || '') && cabeceras.Authorization.endsWith(clave1));
  probar('y cifrada como pide el estándar', cabeceras['Content-Encoding'] === 'aes128gcm' && cabeceras.TTL === '86400');
  const carga = enviados[0] ? telefono.descifrar(enviados[0].init.body) : {};
  probar('el teléfono la descifra y dice quién y qué', carga.titulo === '@avisador te mencionó'
    && carga.cuerpo === 'hola @receptora, ¿vienes?' && carga.url === `/#/p/${mencionPush.datos.pio.id}`, JSON.stringify(carga));

  // Diez corazones no son diez notificaciones: se reemplazan entre sí.
  const suyoPush = (await pedirPush('/pios', { metodo: 'POST', token: receptoraT, cuerpo: { texto: 'un pío mío' } })).datos.pio.id;
  enviados.length = 0;
  await pedirPush(`/pios/${suyoPush}/megusta`, { metodo: 'POST', token: avisadorT });
  await pedirPush(`/pios/${suyoPush}/megusta`, { metodo: 'POST', token: otraPushT });
  await esperarEnvios();
  const etiquetas = enviados.map((e) => telefono.descifrar(e.init.body).tag);
  probar('los me gusta de un mismo pío comparten etiqueta', etiquetas.length === 2 && etiquetas[0] === etiquetas[1] && etiquetas[0] === `megusta-${suyoPush}`);

  // Con una cuenta bloqueada o silenciada no suena nada.
  await pedirPush('/usuarios/avisador/bloquear', { metodo: 'POST', token: receptoraT, cuerpo: { minutos: 60 } });
  enviados.length = 0;
  await pedirPush('/pios', { metodo: 'POST', token: avisadorT, cuerpo: { texto: 'otra vez @receptora' } });
  await esperarEnvios();
  probar('de una cuenta bloqueada no llega', enviados.length === 0);
  await pedirPush('/usuarios/avisador/bloquear', { metodo: 'POST', token: receptoraT, cuerpo: { minutos: 0 } });
  await pedirPush('/usuarios/avisador/silenciar', { metodo: 'POST', token: receptoraT });
  enviados.length = 0;
  await pedirPush('/pios', { metodo: 'POST', token: avisadorT, cuerpo: { texto: 'y otra @receptora' } });
  await esperarEnvios();
  probar('ni de una silenciada', enviados.length === 0);
  await pedirPush('/usuarios/avisador/silenciar', { metodo: 'POST', token: receptoraT });

  // La granja duerme: de noche el aviso queda en la campana y el teléfono calla.
  relojPush = Date.UTC(2026, 8, 15, 6, 0); // las 3 de la mañana en Santiago
  enviados.length = 0;
  await pedirPush('/pios', { metodo: 'POST', token: avisadorT, cuerpo: { texto: 'de madrugada @receptora' } });
  await esperarEnvios();
  probar('de noche el teléfono no suena', enviados.length === 0);
  probar('pero el aviso está en la campana', (await pedirPush('/notificaciones', { token: receptoraT })).datos.notificaciones
    .some((n) => n.pio && n.pio.texto === 'de madrugada @receptora'));
  // Quien vive en otra zona duerme a otra hora: las 3 de Santiago son las 8 en Madrid.
  await pedirPush('/yo', { metodo: 'PATCH', token: receptoraT, cuerpo: { descanso: { zona: 'Europe/Madrid' } } });
  enviados.length = 0;
  await pedirPush('/pios', { metodo: 'POST', token: avisadorT, cuerpo: { texto: 'buen día en Madrid @receptora' } });
  await esperarEnvios();
  probar('el horario se cuenta en la zona de quien duerme', enviados.length === 1);
  await pedirPush('/yo', { metodo: 'PATCH', token: receptoraT, cuerpo: { descanso: { zona: 'America/Santiago', silencio: false } } });
  enviados.length = 0;
  await pedirPush('/pios', { metodo: 'POST', token: avisadorT, cuerpo: { texto: 'insomne @receptora' } });
  await esperarEnvios();
  probar('con el silencio apagado, suena igual de noche', enviados.length === 1);
  await pedirPush('/yo', { metodo: 'PATCH', token: receptoraT, cuerpo: { descanso: { silencio: true } } });
  relojPush = MEDIODIA;

  // El mismo teléfono con otra cuenta: deja de recibir las de la primera.
  await pedirPush('/push/suscribir', { metodo: 'POST', token: otraPushT, cuerpo: telefono.suscripcion('tel') });
  probar('un navegador queda con una sola cuenta', !(conPush.almacen.buscarUsuario('receptora').suscripciones || []).length
    && conPush.almacen.buscarUsuario('otracuenta').suscripciones.length === 1);
  await pedirPush('/push/suscribir', { metodo: 'POST', token: receptoraT, cuerpo: telefono.suscripcion('tel') });

  // Si el servicio dice que ese navegador ya no existe, se borra.
  respuestaDelServicio = 410;
  await pedirPush('/pios', { metodo: 'POST', token: avisadorT, cuerpo: { texto: 'última @receptora' } });
  await esperarEnvios();
  await esperarEnvios();
  probar('una suscripción vencida se borra sola', (conPush.almacen.buscarUsuario('receptora').suscripciones || []).length === 0);
  respuestaDelServicio = 201;

  // Las claves sobreviven a un reinicio: si cambiaran, todas las suscripciones morirían.
  await new Promise((listo) => conPush.close(listo));
  conPush = armarServidorPush();
  await new Promise((listo) => conPush.listen(0, '127.0.0.1', listo));
  basePush = `http://127.0.0.1:${conPush.address().port}`;
  probar('la clave sobrevive a un reinicio', (await pedirPush('/push/clave')).datos.clave === clave1);
  await new Promise((listo) => conPush.close(listo));

  // Con huevo: el aviso espera a que nazca, y si se deshace no llega nunca.
  conPush = armarServidorPush({ incubacion: 300 });
  await new Promise((listo) => conPush.listen(0, '127.0.0.1', listo));
  basePush = `http://127.0.0.1:${conPush.address().port}`;
  const receptora2T = (await pedirPush('/sesion', { metodo: 'POST', cuerpo: { usuario: 'receptora', clave: 'semillas' } })).datos.token;
  const avisador2T = (await pedirPush('/sesion', { metodo: 'POST', cuerpo: { usuario: 'avisador', clave: 'semillas' } })).datos.token;
  await pedirPush('/push/suscribir', { metodo: 'POST', token: receptora2T, cuerpo: telefono.suscripcion('tel2') });
  enviados.length = 0;
  await pedirPush('/pios', { metodo: 'POST', token: avisador2T, cuerpo: { texto: 'huevo para @receptora' } });
  await esperarEnvios();
  probar('mientras el pío es huevo, no suena', enviados.length === 0);
  await new Promise((listo) => setTimeout(listo, 400));
  probar('al nacer, llega', enviados.length === 1);
  enviados.length = 0;
  const arrepentidoPush = (await pedirPush('/pios', { metodo: 'POST', token: avisador2T, cuerpo: { texto: 'mejor no @receptora' } })).datos.pio.id;
  await pedirPush(`/pios/${arrepentidoPush}`, { metodo: 'DELETE', token: avisador2T });
  await new Promise((listo) => setTimeout(listo, 600));
  probar('si se deshace antes de nacer, no llega nunca', enviados.length === 0);

  probar('desuscribirse la borra',
    (await pedirPush('/push/desuscribir', { metodo: 'POST', token: receptora2T, cuerpo: { endpoint: 'https://fcm.googleapis.com/fcm/send/tel2' } })).estado === 200
    && (conPush.almacen.buscarUsuario('receptora').suscripciones || []).length === 0);

  await new Promise((listo) => conPush.close(listo));
  fs.rmSync(carpetaPush, { recursive: true, force: true });

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
