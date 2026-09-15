'use strict';

const crypto = require('crypto');
const M = require('./modelo');
const { crearDeposito, vacio } = require('./deposito');
const E = require('./emojis');
const R = require('./recuperacion');
const C = require('./corrales');
const MSG = require('./mensajes');
const { esReservado } = require('./reservados');

// Cada cambio dice qué registro tocar. El depósito de archivo los ignora y
// reescribe todo; el de Supabase escribe sólo estos.
const cambioUsuario = (u) => ({ tabla: 'pio_usuarios', clave: u.usuario, valor: u });
const cambioPio = (p) => ({ tabla: 'pio_pios', clave: p.id, valor: p });
const cambioSesion = (token, s) => ({
  tabla: 'pio_sesiones',
  clave: token,
  valor: { token, usuario: s.usuario, creada: s.creada },
});
const cambioAviso = (a) => ({ tabla: 'pio_avisos', clave: a.id, valor: a });
const cambioCorral = (c) => ({ tabla: 'pio_corrales', clave: c.nombre, valor: c });
const cambioMensaje = (m) => ({ tabla: 'pio_mensajes', clave: m.id, valor: m });

// Cuantos mensajes se guardan en memoria. Los viejos siguen en la base; lo que
// se pierde es poder mirar hacia atras, que todavia no existe como funcion.
const MENSAJES_EN_MEMORIA = 500;
const cambioSecuencia = (n) => ({ tabla: 'pio_meta', clave: 'secuencia', valor: { clave: 'secuencia', valor: n } });
const baja = (tabla, clave) => ({ tabla, clave, valor: null });

// Entre un cambio de nombre y el siguiente. Reescribir todas las referencias
// es caro, y sin espera alguien podria reservarse nombres a repeticion.
const ESPERA_CAMBIO = 30 * 24 * 60 * 60 * 1000;

// Todo pío nace como huevo: durante estos segundos sólo lo ve quien lo
// escribió, que todavía puede deshacerlo. Es la pausa que frena lo que se
// escribe en caliente, sin necesidad de un botón de editar.
const INCUBACION = 10 * 1000;

// El pío bomba explota a las veinticuatro horas de haber sido escrito: se va
// de todos lados y de la base, con sus avisos y su conversación entera.
const MECHA = 24 * 60 * 60 * 1000;

// Los plazos que se ofrecen para un bloqueo, en minutos: una hora, un día, una
// semana y un mes. Pocos y claros; un campo libre invita a poner "999999".
const DURACIONES_DE_BLOQUEO = [60, 24 * 60, 7 * 24 * 60, 30 * 24 * 60];

// Cuanto vale una sesion, contado desde que se abrio. Es absoluto y no
// deslizante a proposito: renovarlo con cada uso obligaria a escribir en la
// base en cada peticion, o a agregar una columna. Dos meses es bastante mas de
// lo que dura la paciencia de nadie con una pestana abierta.
const VIDA_SESION = 60 * 24 * 60 * 60 * 1000;
// Cada cuanto se barren las vencidas. Hacerlo en cada peticion seria recorrer
// todas las sesiones para nada mil veces por minuto.
const ENTRE_BARRIDAS = 60 * 60 * 1000;

const sesionVencida = (sesion, ahora) => ahora - (sesion.creada || 0) > VIDA_SESION;

// Persistencia en un unico JSON. Alcanza de sobra para el tamano de Pio y
// deja el estado legible a ojo, que es comodo para depurar.
class Almacen {
  constructor(directorio, ajustes = {}, opciones = {}) {
    this.deposito = opciones.deposito || crearDeposito(directorio, ajustes, opciones);
    this.incubacion = ajustes.incubacion == null ? INCUBACION : Number(ajustes.incubacion);
    // Una mecha de cero sería un pío que explota al nacer: no tiene sentido.
    this.mecha = Number(ajustes.mecha) > 0 ? Number(ajustes.mecha) : MECHA;
    this.datos = vacio();
    this.proximaExplosion = 0;
    // Se arranca a cargar sin bloquear: quien necesite los datos espera esta
    // promesa. Así crearServidor() sigue siendo síncrono y las pruebas no
    // tienen que cambiar de forma.
    this.listo = this.cargar();
  }

  async cargar() {
    this.datos = await this.deposito.cargar();
    // Al arrancar se barre sin esperar a la primera hora: es el momento en que
    // mas basura acumulada puede haber.
    this.ultimaBarrida = 0;
    // Lo mismo con las bombas: pudo haber explotado alguna con el sitio apagado.
    this.proximaExplosion = 0;
    return this;
  }

  async guardar(cambios) {
    try {
      await this.deposito.guardar(this.datos, cambios || []);
    } catch (err) {
      // Lo de memoria ya se cambio, pero el deposito lo rechazo. Si se dejara
      // asi, quien hizo el cambio lo veria aplicado y nadie mas: vuelve a
      // leerse todo para que la memoria diga la verdad.
      await this.cargar().catch(() => {});
      throw err;
    }
  }

  // Los del sitio, ya listos para dibujar. Sin nada guardado, los de fábrica:
  // asi un Pio recien instalado ya tiene emojis y no una lista vacia.
  emojis() {
    const propios = E.servibles(this.datos.emojis);
    return propios.length ? propios : E.porDefecto();
  }

  proximoId(prefijo) {
    this.datos.secuencia += 1;
    return `${prefijo}${this.datos.secuencia.toString(36)}`;
  }

  // --- usuarios -----------------------------------------------------------

  // Busca por el nombre actual y tambien por los que tuvo antes. Eso hace dos
  // cosas de una: los enlaces y las menciones viejas siguen llevando a la
  // persona correcta, y nadie puede quedarse con un nombre que alguien dejo.
  buscarUsuario(usuario) {
    const u = M.normalizarUsuario(usuario);
    if (!u) return null;
    return this.datos.usuarios.find((x) => x.usuario === u)
      || this.datos.usuarios.find((x) => (x.alias || []).includes(u))
      || null;
  }

  // Devuelve la cuenta y el codigo de recuperacion en claro. Ese codigo es lo
  // unico que no se puede volver a ver: de aca en adelante solo existe su hash.
  async crearUsuario(usuario, nombre, clave) {
    const codigo = R.generar();
    const u = M.normalizarUsuario(usuario);
    const error = M.validarUsuario(u) || M.validarNombre(nombre) || M.validarClave(clave);
    if (error) throw new ErrorPio(400, M.mensaje(error), error.clave, error.datos);
    if (this.buscarUsuario(u)) throw new ErrorPio(409, 'Ya hay un pollito con ese nombre.', 'usuario.ocupado');

    const sal = crypto.randomBytes(16).toString('hex');
    const nuevo = {
      id: this.proximoId('u'),
      usuario: u,
      nombre: M.normalizarTexto(nombre),
      bio: '',
      alias: [],
      usuarioCambiado: null,
      sal,
      hash: hashear(clave, sal),
      recuperacion: R.guardable(codigo),
      google: null,
      creado: Date.now(),
      siguiendo: [],
    };
    this.datos.usuarios.push(nuevo);
    await this.guardar([cambioUsuario(nuevo), cambioSecuencia(this.datos.secuencia)]);
    return { cuenta: nuevo, codigo };
  }

  // Cierra todas las sesiones de una cuenta, menos la que se indique. Cambiar
  // la clave y no echar a las demas seria dejar adentro justamente a quien uno
  // esta tratando de sacar.
  cerrarLasDemas(cuenta, salvo) {
    const cambios = [];
    for (const [token, sesion] of Object.entries(this.datos.sesiones)) {
      if (sesion.usuario !== cuenta.usuario || token === salvo) continue;
      delete this.datos.sesiones[token];
      cambios.push(baja('pio_sesiones', token));
    }
    return cambios;
  }

  // El token de quien está haciendo el cambio: es la única sesión que
  // sobrevive. Si no se pasa, se cierran todas.
  async cambiarClave(cuenta, actual, nueva, tokenActual) {
    // Una cuenta de Google no tiene clave todavia: puede poner una primera vez
    // sin tener que demostrar cual era, porque no habia ninguna.
    const tenia = !!(cuenta.sal && cuenta.hash);
    if (tenia && !this.verificarClave(cuenta.usuario, actual)) {
      throw new ErrorPio(401, 'Esa no es tu clave actual.', 'clave.actualmala');
    }
    const error = M.validarClave(nueva);
    if (error) throw new ErrorPio(400, M.mensaje(error), error.clave, error.datos);

    cuenta.sal = crypto.randomBytes(16).toString('hex');
    cuenta.hash = hashear(nueva, cuenta.sal);
    // Si no tenia clave, tampoco tenia codigo: se le da uno ahora.
    const codigo = cuenta.recuperacion ? null : R.generar();
    if (codigo) cuenta.recuperacion = R.guardable(codigo);

    await this.guardar([cambioUsuario(cuenta), ...this.cerrarLasDemas(cuenta, tokenActual || null)]);
    return { cuenta, codigo };
  }

  async nuevoCodigo(cuenta) {
    const codigo = R.generar();
    cuenta.recuperacion = R.guardable(codigo);
    await this.guardar([cambioUsuario(cuenta)]);
    return codigo;
  }

  // Recuperar con el codigo. El codigo se gasta: se entrega uno nuevo, porque
  // dejar valido el viejo seria dejar una llave de repuesto ya usada.
  async recuperar(usuario, codigoCrudo, nueva) {
    const cuenta = this.buscarUsuario(usuario);
    // Mismo error dé lo que dé: decir "ese pollito no existe" le regala a
    // cualquiera una lista de qué cuentas hay.
    const malo = () => new ErrorPio(401, 'Ese usuario y ese código no coinciden.', 'codigo.malo');
    if (!cuenta || !cuenta.recuperacion) throw malo();
    if (!R.coincide(codigoCrudo, cuenta.recuperacion)) throw malo();

    const error = M.validarClave(nueva);
    if (error) throw new ErrorPio(400, M.mensaje(error), error.clave, error.datos);

    cuenta.sal = crypto.randomBytes(16).toString('hex');
    cuenta.hash = hashear(nueva, cuenta.sal);
    const codigo = R.generar();
    cuenta.recuperacion = R.guardable(codigo);

    // Todas afuera: quien entra por acá viene de haber perdido el control.
    await this.guardar([cambioUsuario(cuenta), ...this.cerrarLasDemas(cuenta, null)]);
    return { cuenta, codigo };
  }

  buscarPorGoogle(sub) {
    if (!sub) return null;
    return this.datos.usuarios.find((x) => x.google === sub) || null;
  }

  // Del correo sale un usuario que puede estar tomado o ser muy corto, asi
  // que se limpia, se rellena si hace falta y se numera hasta encontrar uno
  // libre. El usuario se puede cambiar despues; lo que ata la cuenta es el
  // sub de Google, no esto.
  usuarioLibre(base) {
    const limpio = M.normalizarUsuario(base).replace(/[^a-z0-9_]/g, '').slice(0, 15);
    // El relleno no puede ser "pollito": es un nombre reservado, y entrar por
    // Google no puede ser el atajo para quedarse con uno.
    const raiz = limpio.length >= 3 ? limpio : `ave${limpio}`.slice(0, 15);
    const libre = (u) => !this.buscarUsuario(u) && !esReservado(u);
    if (libre(raiz)) return raiz;
    for (let n = 2; n < 100000; n += 1) {
      const sufijo = String(n);
      const intento = raiz.slice(0, 15 - sufijo.length) + sufijo;
      if (libre(intento)) return intento;
    }
    throw new ErrorPio(500, 'No quedan nombres libres parecidos a ese.', 'usuario.sinlugar');
  }

  // Se ata por el sub, que es el identificador estable de Google. Por correo
  // seria fragil: un correo se cambia, se libera y se lo puede quedar otro.
  async desdeGoogle(quien) {
    const existente = this.buscarPorGoogle(quien.sub);
    if (existente) return { cuenta: existente, nueva: false };

    const base = String(quien.email || '').split('@')[0] || quien.nombre || 'pollito';
    const usuario = this.usuarioLibre(base);
    const nombre = M.normalizarTexto(quien.nombre) || usuario;
    const nuevo = {
      id: this.proximoId('u'),
      usuario,
      nombre: M.recortar(nombre, M.LIMITE_NOMBRE),
      bio: '',
      alias: [],
      usuarioCambiado: null,
      sal: null,
      hash: null,
      google: quien.sub,
      creado: Date.now(),
      siguiendo: [],
    };
    this.datos.usuarios.push(nuevo);
    await this.guardar([cambioUsuario(nuevo), cambioSecuencia(this.datos.secuencia)]);
    return { cuenta: nuevo, nueva: true };
  }

  verificarClave(usuario, clave) {
    const cuenta = this.buscarUsuario(usuario);
    if (!cuenta) return null;
    // Las cuentas de Google no tienen clave. Sin este corte se terminaria
    // comparando contra una sal vacia, que es una puerta abierta.
    if (!cuenta.sal || !cuenta.hash) return null;
    const intento = Buffer.from(hashear(clave, cuenta.sal), 'hex');
    const guardado = Buffer.from(cuenta.hash, 'hex');
    if (intento.length !== guardado.length) return null;
    if (!crypto.timingSafeEqual(intento, guardado)) return null;
    return cuenta;
  }

  async abrirSesion(cuenta) {
    const token = crypto.randomBytes(24).toString('hex');
    this.datos.sesiones[token] = { usuario: cuenta.usuario, creada: Date.now() };
    await this.guardar([cambioSesion(token, this.datos.sesiones[token])]);
    return token;
  }

  async cerrarSesion(token) {
    if (token && this.datos.sesiones[token]) {
      delete this.datos.sesiones[token];
      await this.guardar([baja('pio_sesiones', token)]);
    }
  }

  porToken(token) {
    const sesion = token ? this.datos.sesiones[token] : null;
    if (!sesion) return null;
    // Una sesion vencida se trata como inexistente aunque todavia este en la
    // base: de sacarla se encarga la barrida, sin hacer esperar a nadie.
    if (sesionVencida(sesion, Date.now())) return null;
    return this.buscarUsuario(sesion.usuario);
  }

  // Saca de la base las sesiones vencidas. Se llama en cada peticion, pero
  // recorre la lista una vez por hora como mucho.
  async barrerSesiones(forzar) {
    const ahora = Date.now();
    if (!forzar && ahora - (this.ultimaBarrida || 0) < ENTRE_BARRIDAS) return 0;
    this.ultimaBarrida = ahora;

    const cambios = [];
    for (const [token, sesion] of Object.entries(this.datos.sesiones)) {
      if (!sesionVencida(sesion, ahora)) continue;
      delete this.datos.sesiones[token];
      cambios.push(baja('pio_sesiones', token));
    }
    if (cambios.length) await this.guardar(cambios);
    return cambios.length;
  }

  // Saca de la base los píos bomba que ya explotaron, con sus avisos. Se llama
  // en cada petición, pero sólo recorre los píos cuando llegó la hora de la
  // próxima explosión: el resto de las veces es comparar dos números.
  async detonar(ahora = Date.now()) {
    if (ahora < this.proximaExplosion) return 0;

    const explotados = new Set();
    let proxima = Infinity;
    for (const p of this.datos.pios) {
      if (!p.explota) continue;
      if (p.explota <= ahora) explotados.add(p.id);
      else proxima = Math.min(proxima, p.explota);
    }
    // Se fija antes de guardar: las peticiones que lleguen mientras tanto ya no
    // vuelven a recorrer ni a borrar lo mismo dos veces.
    this.proximaExplosion = proxima;
    if (!explotados.size) return 0;

    const avisos = this.datos.notificaciones.filter((n) => explotados.has(n.pio));
    this.datos.pios = this.datos.pios.filter((p) => !explotados.has(p.id));
    this.datos.notificaciones = this.datos.notificaciones.filter((n) => !explotados.has(n.pio));
    await this.guardar([
      ...[...explotados].map((id) => baja('pio_pios', id)),
      ...avisos.map((n) => baja('pio_avisos', n.id)),
    ]);
    return explotados.size;
  }

  // Valida TODO antes de tocar nada. Antes se aplicaba campo por campo, y si
  // el segundo fallaba quedaba el primero escrito y un error en pantalla: el
  // perfil a medias y el usuario sin entender que pasó.
  async actualizarPerfil(cuenta, cambios) {
    const revisar = (valor, validar) => {
      if (valor === undefined) return;
      const error = validar(valor);
      if (error) throw new ErrorPio(400, M.mensaje(error), error.clave, error.datos);
    };

    revisar(cambios.nombre, M.validarNombre);
    revisar(cambios.bio, M.validarBio);

    const nuevoUsuario = cambios.usuario === undefined
      ? null
      : this.revisarCambioDeUsuario(cuenta, cambios.usuario);

    // Recién ahora, con todo aprobado, se escribe.
    if (cambios.nombre !== undefined) cuenta.nombre = M.normalizarTexto(cambios.nombre);
    if (cambios.bio !== undefined) cuenta.bio = M.normalizarTexto(cambios.bio);
    // Ya viene revisado de la API: sólo direcciones de los servicios de imágenes.
    if (cambios.avatar !== undefined) cuenta.avatar = cambios.avatar || null;

    const lista = nuevoUsuario
      ? this.aplicarCambioDeUsuario(cuenta, nuevoUsuario)
      : [cambioUsuario(cuenta)];

    await this.guardar(lista);
    return cuenta;
  }

  async alternarSeguir(cuenta, objetivoUsuario) {
    const objetivo = this.buscarUsuario(objetivoUsuario);
    if (!objetivo) throw new ErrorPio(404, 'No existe ese pollito.', 'pollito.noexiste');
    if (objetivo.usuario === cuenta.usuario) throw new ErrorPio(400, 'No puedes seguirte a ti mismo.', 'seguir.vosmismo');
    const i = cuenta.siguiendo.indexOf(objetivo.usuario);
    const cambios = [cambioUsuario(cuenta)];
    if (i === -1) {
      cuenta.siguiendo.push(objetivo.usuario);
      const aviso = this.anotarAviso(objetivo.usuario, cuenta.usuario, 'seguir', null);
      if (aviso) cambios.push(cambioAviso(aviso), cambioSecuencia(this.datos.secuencia));
    } else {
      cuenta.siguiendo.splice(i, 1);
      for (const ido of this.olvidarAviso(objetivo.usuario, cuenta.usuario, 'seguir', null)) {
        cambios.push(baja('pio_avisos', ido.id));
      }
    }
    await this.guardar(cambios);
    return i === -1;
  }

  // Lo mismo que silenciar, pero para todo el sitio y decidido desde el panel.
  // Pensado para el piobot: que siga piando —mantiene la base viva y sirve para
  // probar— sin llenarle la plaza a nadie.
  async alternarOculto(usuario) {
    const cuenta = this.buscarUsuario(usuario);
    if (!cuenta) throw new ErrorPio(404, 'No existe ese pollito.', 'pollito.noexiste');
    if (!Array.isArray(this.datos.ocultos)) this.datos.ocultos = [];
    const i = this.datos.ocultos.indexOf(cuenta.usuario);
    if (i === -1) this.datos.ocultos.push(cuenta.usuario);
    else this.datos.ocultos.splice(i, 1);
    await this.guardarOcultos();
    return i === -1;
  }

  guardarOcultos() {
    return this.guardar([{
      tabla: 'pio_meta', clave: 'ocultos', valor: { clave: 'ocultos', valor: this.datos.ocultos },
    }]);
  }

  // Silenciar es dejar de ver sin que el otro se entere: no hay aviso, y sus
  // pios siguen llegando a la base. Solo cambia lo que se le muestra a quien
  // silencio.
  // El bloqueo suave: por un tiempo que elige quien bloquea, los píos de la
  // otra cuenta se le muestran borrosos y sus avisos no le llegan. Vence solo.
  // Se guarda como { usuario: hasta }, así no hace falta nada que lo quite.
  async bloquear(cuenta, objetivoUsuario, minutos) {
    const objetivo = this.buscarUsuario(objetivoUsuario);
    if (!objetivo) throw new ErrorPio(404, 'No existe ese pollito.', 'pollito.noexiste');
    if (objetivo.usuario === cuenta.usuario) {
      throw new ErrorPio(400, 'No puedes bloquearte a ti mismo.', 'bloqueo.vosmismo');
    }
    const cuanto = Number(minutos);
    if (cuanto !== 0 && !DURACIONES_DE_BLOQUEO.includes(cuanto)) {
      throw new ErrorPio(400, 'Ese plazo de bloqueo no está entre los que se ofrecen.', 'bloqueo.plazo');
    }
    const ahora = Date.now();
    // De paso se barren los vencidos: si no, la lista crece para siempre.
    const vigentes = Object.entries(cuenta.bloqueados || {}).filter(([, hasta]) => hasta > ahora);
    cuenta.bloqueados = Object.fromEntries(vigentes);
    if (cuanto === 0) delete cuenta.bloqueados[objetivo.usuario];
    else cuenta.bloqueados[objetivo.usuario] = ahora + cuanto * 60 * 1000;
    await this.guardar([cambioUsuario(cuenta)]);
    return cuenta.bloqueados[objetivo.usuario] || null;
  }

  bloqueoVigente(cuenta, usuario, ahora = Date.now()) {
    const hasta = cuenta && usuario && cuenta.bloqueados && cuenta.bloqueados[usuario];
    return hasta && hasta > ahora ? hasta : null;
  }

  async alternarSilencio(cuenta, objetivoUsuario) {
    const objetivo = this.buscarUsuario(objetivoUsuario);
    if (!objetivo) throw new ErrorPio(404, 'No existe ese pollito.', 'pollito.noexiste');
    if (objetivo.usuario === cuenta.usuario) {
      throw new ErrorPio(400, 'No puedes silenciarte a ti mismo.', 'silencio.vosmismo');
    }
    if (!Array.isArray(cuenta.silenciados)) cuenta.silenciados = [];
    const i = cuenta.silenciados.indexOf(objetivo.usuario);
    if (i === -1) cuenta.silenciados.push(objetivo.usuario);
    else cuenta.silenciados.splice(i, 1);
    await this.guardar([cambioUsuario(cuenta)]);
    return i === -1;
  }

  // Cambiar de nombre obliga a reescribir todo lo que apuntaba al viejo: los
  // pios, los me gusta, los repios, las listas de seguidos de los demas, los
  // avisos y las sesiones. Es caro, y por eso hay una espera entre cambios;
  // tambien evita que alguien se reserve nombres cambiandose cien veces.
  // Devuelve el nombre nuevo si el cambio se puede hacer, null si no hay
  // cambio, y tira si no se puede. No toca nada.
  revisarCambioDeUsuario(cuenta, pedido) {
    const nuevo = M.normalizarUsuario(pedido);
    if (nuevo === cuenta.usuario) return null;

    const error = M.validarUsuario(nuevo);
    if (error) throw new ErrorPio(400, M.mensaje(error), error.clave, error.datos);

    const dueno = this.buscarUsuario(nuevo);
    if (dueno && dueno !== cuenta) {
      throw new ErrorPio(409, 'Ya hay un pollito con ese nombre.', 'usuario.ocupado');
    }

    const ultimo = cuenta.usuarioCambiado || 0;
    const falta = ESPERA_CAMBIO - (Date.now() - ultimo);
    if (ultimo && falta > 0) {
      const dias = Math.ceil(falta / 86400000);
      throw new ErrorPio(
        429,
        `Cambiaste tu nombre hace poco. Vas a poder de nuevo en ${dias} días.`,
        'usuario.reciente',
        { dias },
      );
    }
    return nuevo;
  }

  async cambiarUsuario(cuenta, pedido) {
    const nuevo = this.revisarCambioDeUsuario(cuenta, pedido);
    if (!nuevo) return cuenta;
    await this.guardar(this.aplicarCambioDeUsuario(cuenta, nuevo));
    return cuenta;
  }

  // Mueve todo lo que apuntaba al nombre viejo y devuelve la lista de cambios.
  // No guarda: de eso se encarga quien llama, para que una sola escritura
  // cubra el cambio de nombre junto con el resto del perfil.
  aplicarCambioDeUsuario(cuenta, nuevo) {
    const viejo = cuenta.usuario;
    // Un renombre, no una baja seguida de un alta: entre las dos habria dos
    // filas con el mismo sub de Google, y el indice unico rechaza todo.
    const cambios = [];

    cuenta.alias = cuenta.alias || [];
    if (!cuenta.alias.includes(viejo)) cuenta.alias.push(viejo);
    cuenta.usuario = nuevo;
    cuenta.usuarioCambiado = Date.now();
    cambios.push(Object.assign(cambioUsuario(cuenta), { desde: viejo }));

    for (const pio of this.datos.pios) {
      let tocado = false;
      if (pio.autor === viejo) { pio.autor = nuevo; tocado = true; }
      const i = pio.meGusta.indexOf(viejo);
      if (i !== -1) { pio.meGusta[i] = nuevo; tocado = true; }
      for (const r of pio.repios) {
        if (r.usuario === viejo) { r.usuario = nuevo; tocado = true; }
      }
      if (tocado) cambios.push(cambioPio(pio));
    }

    for (const m of this.datos.mensajes) {
      if (m.autor === viejo) {
        m.autor = nuevo;
        cambios.push(cambioMensaje(m));
      }
    }

    for (const corral of this.datos.corrales) {
      if (corral.dueno === viejo) {
        corral.dueno = nuevo;
        cambios.push(cambioCorral(corral));
      }
    }

    // Tampoco la forma de salir de lo que ocultó el panel.
    const k = (this.datos.ocultos || []).indexOf(viejo);
    if (k !== -1) {
      this.datos.ocultos[k] = nuevo;
      cambios.push({ tabla: 'pio_meta', clave: 'ocultos', valor: { clave: 'ocultos', valor: this.datos.ocultos } });
    }

    for (const otro of this.datos.usuarios) {
      let tocado = false;
      const i = otro.siguiendo.indexOf(viejo);
      if (i !== -1) { otro.siguiendo[i] = nuevo; tocado = true; }
      // Un renombre no puede ser la forma de salir del silencio de alguien.
      const j = (otro.silenciados || []).indexOf(viejo);
      if (j !== -1) { otro.silenciados[j] = nuevo; tocado = true; }
      // Ni de un bloqueo.
      if (otro.bloqueados && otro.bloqueados[viejo]) {
        otro.bloqueados[nuevo] = otro.bloqueados[viejo];
        delete otro.bloqueados[viejo];
        tocado = true;
      }
      if (tocado && otro !== cuenta) cambios.push(cambioUsuario(otro));
    }

    for (const aviso of this.datos.notificaciones) {
      let tocado = false;
      if (aviso.para === viejo) { aviso.para = nuevo; tocado = true; }
      if (aviso.de === viejo) { aviso.de = nuevo; tocado = true; }
      if (tocado) cambios.push(cambioAviso(aviso));
    }

    for (const [token, sesion] of Object.entries(this.datos.sesiones)) {
      if (sesion.usuario === viejo) {
        sesion.usuario = nuevo;
        cambios.push(cambioSesion(token, sesion));
      }
    }

    return cambios;
  }

  seguidores(usuario) {
    const u = M.normalizarUsuario(usuario);
    return this.datos.usuarios.filter((x) => x.siguiendo.includes(u));
  }

  // --- pios ---------------------------------------------------------------

  buscarPio(id) {
    return this.datos.pios.find((p) => p.id === id) || null;
  }

  async publicar(cuenta, texto, respuestaA, adjunto, corral, extra = {}) {
    // Con imagen el texto puede faltar, porque la imagen ya dice algo. Lo que
    // no cambia nunca es el limite de cien.
    const limpio = M.normalizarTexto(texto);
    const error = adjunto && !limpio ? null : M.validarPio(texto);
    if (error) throw new ErrorPio(400, M.mensaje(error), error.clave, error.datos);
    const padre = respuestaA ? this.buscarPio(respuestaA) : null;
    if (respuestaA && !padre) {
      throw new ErrorPio(404, 'Ese pío ya no está.', 'pio.noesta');
    }
    // Una respuesta vive donde vive el pio al que contesta: si no, media
    // conversacion quedaria en un corral y la otra media en la plaza.
    if (padre) corral = padre.corral || null;
    const nuevo = {
      id: this.proximoId('p'),
      autor: cuenta.usuario,
      texto: limpio,
      creado: Date.now(),
      respuestaA: respuestaA || null,
      etiquetas: M.etiquetas(limpio),
      menciones: M.menciones(limpio),
      // Uno solo, a proposito: un pio de cien caracteres con una galeria
      // adentro deja de ser un pio. El adjunto ya viene validado de la API.
      adjunto: adjunto || null,
      // En que corral vive. Sin corral es la plaza, que es el tema general
      // sin necesidad de llamarlo asi.
      corral: corral || null,
      meGusta: [],
      repios: [],
    };
    // La respuesta a la pregunta del día vive en la plaza y no contesta a nadie:
    // una respuesta a otro pío o un pío de corral no pueden serlo.
    if (extra.pregunta && !nuevo.respuestaA && !nuevo.corral) nuevo.pregunta = extra.pregunta;
    // ✍️ Escrito a mano: tecleado, sin pegar. Lo dice el cliente y no hay forma
    // de comprobarlo desde acá: es un guiño, como los cien justos, no un control.
    // Sin texto no hay nada que se haya escrito.
    if (extra.aMano && limpio) nuevo.aMano = true;
    // Los píos de antes no tienen `nace`: nacieron hace rato.
    if (this.incubacion > 0) nuevo.nace = nuevo.creado + this.incubacion;
    // Lo que se contesta a una bomba explota con ella, lo pida o no: si no, la
    // conversación quedaría colgando de un pío que ya no está, y lo que se
    // quiso que desapareciera seguiría citado en las respuestas. Una bomba que
    // contesta a otra se lleva la mecha más corta.
    const mechas = [];
    if (extra.bomba) mechas.push(nuevo.creado + this.mecha);
    if (padre && padre.explota) mechas.push(padre.explota);
    if (mechas.length) {
      nuevo.explota = Math.min(...mechas);
      this.proximaExplosion = Math.min(this.proximaExplosion, nuevo.explota);
    }
    this.datos.pios.push(nuevo);
    const cambios = [cambioPio(nuevo)];
    for (const aviso of this.avisarDelPio(cuenta, nuevo)) cambios.push(cambioAviso(aviso));
    cambios.push(cambioSecuencia(this.datos.secuencia));
    await this.guardar(cambios);
    return nuevo;
  }

  async borrar(cuenta, id) {
    const pio = this.buscarPio(id);
    if (!pio) throw new ErrorPio(404, 'Ese pío ya no está.', 'pio.noesta');
    if (pio.autor !== cuenta.usuario) throw new ErrorPio(403, 'Solo puedes borrar tus propios píos.', 'pio.ajeno');
    // Las respuestas quedan huerfanas a proposito: se muestran sueltas.
    this.datos.pios = this.datos.pios.filter((p) => p.id !== id);
    const huerfanos = this.datos.notificaciones.filter((n) => n.pio === id);
    this.datos.notificaciones = this.datos.notificaciones.filter((n) => n.pio !== id);
    await this.guardar([baja('pio_pios', id), ...huerfanos.map((n) => baja('pio_avisos', n.id))]);
    return true;
  }

  async alternarMeGusta(cuenta, id) {
    const pio = this.buscarPio(id);
    if (!pio) throw new ErrorPio(404, 'Ese pío ya no está.', 'pio.noesta');
    const i = pio.meGusta.indexOf(cuenta.usuario);
    const cambios = [cambioPio(pio)];
    if (i === -1) {
      pio.meGusta.push(cuenta.usuario);
      const aviso = this.anotarAviso(pio.autor, cuenta.usuario, 'megusta', pio.id);
      if (aviso) cambios.push(cambioAviso(aviso), cambioSecuencia(this.datos.secuencia));
    } else {
      pio.meGusta.splice(i, 1);
      for (const ido of this.olvidarAviso(pio.autor, cuenta.usuario, 'megusta', pio.id)) {
        cambios.push(baja('pio_avisos', ido.id));
      }
    }
    await this.guardar(cambios);
    return i === -1;
  }

  async alternarRepio(cuenta, id) {
    const pio = this.buscarPio(id);
    if (!pio) throw new ErrorPio(404, 'Ese pío ya no está.', 'pio.noesta');
    if (pio.autor === cuenta.usuario) throw new ErrorPio(400, 'Repiar lo tuyo es hacer trampa.', 'repio.propio');
    const i = pio.repios.findIndex((r) => r.usuario === cuenta.usuario);
    const cambios = [cambioPio(pio)];
    if (i === -1) {
      pio.repios.push({ usuario: cuenta.usuario, fecha: Date.now() });
      const aviso = this.anotarAviso(pio.autor, cuenta.usuario, 'repio', pio.id);
      if (aviso) cambios.push(cambioAviso(aviso), cambioSecuencia(this.datos.secuencia));
    } else {
      pio.repios.splice(i, 1);
      for (const ido of this.olvidarAviso(pio.autor, cuenta.usuario, 'repio', pio.id)) {
        cambios.push(baja('pio_avisos', ido.id));
      }
    }
    await this.guardar(cambios);
    return i === -1;
  }

  respuestasDe(id) {
    return this.datos.pios.filter((p) => p.respuestaA === id);
  }

  // Borra una cuenta y todo lo que colgaba de ella. Es irreversible y por eso
  // vive en un solo lugar: repartir un borrado en cascada por varios sitios es
  // la forma mas segura de dejar restos.
  async borrarCuenta(usuario) {
    const cuenta = this.buscarUsuario(usuario);
    if (!cuenta) throw new ErrorPio(404, 'No existe ese pollito.', 'pollito.noexiste');
    const quien = cuenta.usuario;
    const cambios = [baja('pio_usuarios', quien)];

    for (const p of this.datos.pios.filter((x) => x.autor === quien)) {
      cambios.push(baja('pio_pios', p.id));
    }
    this.datos.pios = this.datos.pios.filter((p) => p.autor !== quien);

    // Lo que dejo en pios ajenos: me gusta, repios y respuestas huerfanas.
    for (const p of this.datos.pios) {
      let tocado = false;
      const i = p.meGusta.indexOf(quien);
      if (i !== -1) { p.meGusta.splice(i, 1); tocado = true; }
      const antes = p.repios.length;
      p.repios = p.repios.filter((r) => r.usuario !== quien);
      if (p.repios.length !== antes) tocado = true;
      if (tocado) cambios.push(cambioPio(p));
    }

    for (const otro of this.datos.usuarios) {
      let tocado = false;
      const i = otro.siguiendo.indexOf(quien);
      if (i !== -1) { otro.siguiendo.splice(i, 1); tocado = true; }
      const j = (otro.silenciados || []).indexOf(quien);
      if (j !== -1) { otro.silenciados.splice(j, 1); tocado = true; }
      if (otro.bloqueados && otro.bloqueados[quien]) { delete otro.bloqueados[quien]; tocado = true; }
      if (tocado) cambios.push(cambioUsuario(otro));
    }
    const k = (this.datos.ocultos || []).indexOf(quien);
    if (k !== -1) {
      this.datos.ocultos.splice(k, 1);
      cambios.push({ tabla: 'pio_meta', clave: 'ocultos', valor: { clave: 'ocultos', valor: this.datos.ocultos } });
    }
    this.datos.usuarios = this.datos.usuarios.filter((u) => u.usuario !== quien);

    for (const n of this.datos.notificaciones.filter((x) => x.para === quien || x.de === quien)) {
      cambios.push(baja('pio_avisos', n.id));
    }
    this.datos.notificaciones = this.datos.notificaciones
      .filter((n) => n.para !== quien && n.de !== quien);

    for (const [token, s] of Object.entries(this.datos.sesiones)) {
      if (s.usuario === quien) { delete this.datos.sesiones[token]; cambios.push(baja('pio_sesiones', token)); }
    }

    for (const m of this.datos.mensajes.filter((x) => x.autor === quien)) {
      cambios.push(baja('pio_mensajes', m.id));
    }
    this.datos.mensajes = this.datos.mensajes.filter((m) => m.autor !== quien);

    await this.guardar(cambios);
    return quien;
  }

  async borrarPio(id) {
    const pio = this.buscarPio(id);
    if (!pio) throw new ErrorPio(404, 'Ese pío ya no está.', 'pio.noesta');
    this.datos.pios = this.datos.pios.filter((p) => p.id !== id);
    const huerfanos = this.datos.notificaciones.filter((n) => n.pio === id);
    this.datos.notificaciones = this.datos.notificaciones.filter((n) => n.pio !== id);
    await this.guardar([baja('pio_pios', id), ...huerfanos.map((n) => baja('pio_avisos', n.id))]);
    return id;
  }

  // Borrar el corral NO borra sus pios: se quedan sin corral, o sea en la
  // plaza. Que se evapore lo que la gente escribio seria peor que el desorden.
  async borrarCorral(nombre) {
    const corral = this.buscarCorral(nombre);
    if (!corral) throw new ErrorPio(404, 'Ese corral no existe.', 'corral.noexiste');
    const cambios = [baja('pio_corrales', corral.nombre)];

    for (const p of this.datos.pios) {
      if (p.corral === corral.nombre) { p.corral = null; cambios.push(cambioPio(p)); }
    }
    for (const u of this.datos.usuarios) {
      const i = (u.corrales || []).indexOf(corral.nombre);
      if (i !== -1) { u.corrales.splice(i, 1); cambios.push(cambioUsuario(u)); }
    }
    for (const m of this.datos.mensajes.filter((x) => x.corral === corral.nombre)) {
      cambios.push(baja('pio_mensajes', m.id));
    }
    this.datos.mensajes = this.datos.mensajes.filter((m) => m.corral !== corral.nombre);
    this.datos.corrales = this.datos.corrales.filter((c) => c.nombre !== corral.nombre);

    await this.guardar(cambios);
    return corral.nombre;
  }

  async guardarEmojis(lista) {
    const limpios = E.servibles(lista);
    this.datos.emojis = Array.isArray(lista) ? lista : [];
    await this.guardar([{ tabla: 'pio_meta', clave: 'emojis', valor: { clave: 'emojis', valor: this.datos.emojis } }]);
    return limpios;
  }

  // --- corrales -----------------------------------------------------------

  buscarCorral(nombre) {
    const n = C.aNombre(nombre);
    if (!n) return null;
    return this.datos.corrales.find((c) => c.nombre === n) || null;
  }

  async crearCorral(cuenta, pedido) {
    const error = C.validarNombre(pedido.nombre)
      || C.validarTitulo(pedido.titulo)
      || C.validarDescripcion(pedido.descripcion);
    if (error) throw new ErrorPio(400, C.mensaje(error), error.clave, error.datos);

    const nombre = C.aNombre(pedido.nombre);
    if (this.buscarCorral(nombre)) {
      throw new ErrorPio(409, C.mensaje({ clave: 'corral.ocupado' }), 'corral.ocupado');
    }

    const nuevo = {
      nombre,
      titulo: M.recortar(M.normalizarTexto(pedido.titulo), C.LIMITE_TITULO),
      descripcion: M.recortar(M.normalizarTexto(pedido.descripcion || ''), C.LIMITE_DESCRIPCION),
      dueno: cuenta.usuario,
      creado: Date.now(),
    };
    this.datos.corrales.push(nuevo);

    // Quien lo crea queda suscrito: nadie arma un corral para no mirarlo.
    cuenta.corrales = cuenta.corrales || [];
    cuenta.corrales.push(nombre);

    await this.guardar([cambioCorral(nuevo), cambioUsuario(cuenta)]);
    return nuevo;
  }

  async alternarCorral(cuenta, nombre) {
    const corral = this.buscarCorral(nombre);
    if (!corral) throw new ErrorPio(404, C.mensaje({ clave: 'corral.noexiste' }), 'corral.noexiste');
    cuenta.corrales = cuenta.corrales || [];
    const i = cuenta.corrales.indexOf(corral.nombre);
    if (i === -1) cuenta.corrales.push(corral.nombre);
    else cuenta.corrales.splice(i, 1);
    await this.guardar([cambioUsuario(cuenta)]);
    return i === -1;
  }

  // Los mensajes de un corral, del mas viejo al mas nuevo. Con `desde` se
  // piden solo los posteriores, que es lo que hace el chat cada pocos
  // segundos: traer todo de nuevo seria mandar la misma conversacion mil veces.
  mensajesDe(corral, desde) {
    const corte = Number(desde) || 0;
    const suyos = this.datos.mensajes.filter((m) => m.corral === corral && m.creado > corte);
    return suyos.slice(-MSG.POR_TANDA);
  }

  async decir(cuenta, corral, texto) {
    if (!(cuenta.corrales || []).includes(corral.nombre)) {
      throw new ErrorPio(403, MSG.mensaje({ clave: 'mensaje.afuera' }), 'mensaje.afuera');
    }
    const error = MSG.validar(texto);
    if (error) throw new ErrorPio(400, MSG.mensaje(error), error.clave, error.datos);

    const nuevo = {
      id: this.proximoId('m'),
      corral: corral.nombre,
      autor: cuenta.usuario,
      texto: M.normalizarTexto(texto),
      creado: Date.now(),
    };
    this.datos.mensajes.push(nuevo);
    // Se recorta la memoria, no la base: lo viejo sigue guardado.
    if (this.datos.mensajes.length > MENSAJES_EN_MEMORIA) {
      this.datos.mensajes = this.datos.mensajes.slice(-MENSAJES_EN_MEMORIA);
    }
    await this.guardar([cambioMensaje(nuevo), cambioSecuencia(this.datos.secuencia)]);
    return nuevo;
  }

  suscritos(corral) {
    return this.datos.usuarios.filter((u) => (u.corrales || []).includes(corral)).length;
  }

  piosDe(corral) {
    return this.datos.pios.filter((p) => p.corral === corral).length;
  }

  // --- avisos -------------------------------------------------------------

  // Los avisos son derivados, no hechos historicos: si la accion que los
  // provoco se deshace, el aviso se va con ella. Nadie queda mirando un
  // "le gusto tu pio" de algo que ya nadie marco.
  anotarAviso(para, de, tipo, pio) {
    const destino = M.normalizarUsuario(para);
    if (!destino || destino === de) return null;
    if (!this.buscarUsuario(destino)) return null;
    const nuevo = {
      id: this.proximoId('n'),
      para: destino,
      de,
      tipo,
      pio: pio || null,
      creado: Date.now(),
      leida: false,
    };
    this.datos.notificaciones.push(nuevo);
    // Quien quiera enterarse —las notificaciones al teléfono— se engancha acá.
    if (typeof this.alAvisar === 'function') this.alAvisar(nuevo);
    return nuevo;
  }

  // --- notificaciones al teléfono ---

  guardarVapid(claves) {
    this.datos.vapid = claves;
    return this.guardar([{ tabla: 'pio_meta', clave: 'vapid', valor: { clave: 'vapid', valor: claves } }]);
  }

  // Un navegador que se suscribe queda con una sola cuenta: si antes estaba
  // con otra —el mismo teléfono, otra sesión—, deja de recibir las de aquella.
  async suscribir(cuenta, suscripcion, maximo) {
    const cambios = [];
    for (const otra of this.datos.usuarios) {
      if (otra === cuenta || !(otra.suscripciones || []).some((s) => s.endpoint === suscripcion.endpoint)) continue;
      otra.suscripciones = otra.suscripciones.filter((s) => s.endpoint !== suscripcion.endpoint);
      cambios.push(cambioUsuario(otra));
    }
    const resto = (cuenta.suscripciones || []).filter((s) => s.endpoint !== suscripcion.endpoint);
    cuenta.suscripciones = [...resto, suscripcion].slice(-maximo);
    cambios.push(cambioUsuario(cuenta));
    await this.guardar(cambios);
  }

  async desuscribir(cuenta, endpoint) {
    const antes = (cuenta.suscripciones || []).length;
    cuenta.suscripciones = (cuenta.suscripciones || []).filter((s) => s.endpoint !== endpoint);
    if (cuenta.suscripciones.length !== antes) await this.guardar([cambioUsuario(cuenta)]);
  }

  async quitarSuscripciones(endpoints) {
    const cambios = [];
    for (const cuenta of this.datos.usuarios) {
      const antes = (cuenta.suscripciones || []).length;
      cuenta.suscripciones = (cuenta.suscripciones || []).filter((s) => !endpoints.includes(s.endpoint));
      if (cuenta.suscripciones.length !== antes) cambios.push(cambioUsuario(cuenta));
    }
    if (cambios.length) await this.guardar(cambios);
  }

  // Devuelve los avisos que se llevó, no un sí o un no: quien llama necesita
  // saber cuáles borrar del depósito.
  olvidarAviso(para, de, tipo, pio) {
    const objetivo = pio || null;
    const igual = (n) => n.para === para && n.de === de && n.tipo === tipo && n.pio === objetivo;
    const idos = this.datos.notificaciones.filter(igual);
    if (idos.length) this.datos.notificaciones = this.datos.notificaciones.filter((n) => !igual(n));
    return idos;
  }

  // Un pio le avisa a quien responde y a quien menciona. Si son la misma
  // persona gana la respuesta, que dice mas, y no se avisa dos veces.
  avisarDelPio(cuenta, pio) {
    const avisados = new Set();
    const nuevos = [];
    const anotar = (para, tipo) => {
      const aviso = this.anotarAviso(para, cuenta.usuario, tipo, pio.id);
      if (aviso) nuevos.push(aviso);
      avisados.add(para);
    };
    if (pio.respuestaA) {
      const padre = this.buscarPio(pio.respuestaA);
      if (padre) anotar(padre.autor, 'respuesta');
    }
    for (const quien of pio.menciones) {
      if (avisados.has(quien)) continue;
      anotar(quien, 'mencion');
    }
    // A quien etiquetaron en la foto se le avisa, salvo que ya tenga aviso por
    // este pío: dos avisos por lo mismo es ruido.
    for (const e of (pio.adjunto && pio.adjunto.etiquetas) || []) {
      if (avisados.has(e.usuario)) continue;
      anotar(e.usuario, 'foto');
    }
    return nuevos;
  }

  avisosDe(cuenta, limite = 50) {
    return this.datos.notificaciones
      .filter((n) => n.para === cuenta.usuario && this.avisoListo(n))
      .sort((a, b) => b.creado - a.creado)
      .slice(0, limite);
  }

  sinLeer(cuenta) {
    // Lo de una cuenta silenciada no se muestra, así que tampoco se cuenta: una
    // insignia con un número que no lleva a nada es peor que ninguna.
    const callados = new Set([...(cuenta.silenciados || []), ...(this.datos.ocultos || [])]);
    return this.datos.notificaciones
      .filter((n) => n.para === cuenta.usuario && !n.leida && !callados.has(n.de) && this.avisoListo(n)
        && !this.bloqueoVigente(cuenta, n.de))
      .length;
  }

  async marcarLeidos(cuenta) {
    const tocados = [];
    for (const n of this.datos.notificaciones) {
      if (n.para === cuenta.usuario && !n.leida) {
        n.leida = true;
        tocados.push(n);
      }
    }
    if (tocados.length) await this.guardar(tocados.map(cambioAviso));
    return tocados.length;
  }

  contarRespuestas(id, yo = null) {
    return this.respuestasDe(id).filter((p) => this.visiblePara(p, yo)).length;
  }

  esHuevo(pio, ahora = Date.now()) {
    return !!(pio && pio.nace && ahora < pio.nace);
  }

  explotado(pio, ahora = Date.now()) {
    return !!(pio && pio.explota && ahora >= pio.explota);
  }

  // Un huevo sólo lo ve quien lo puso. Una bomba que explotó no la ve nadie,
  // aunque la barrida todavía no haya pasado a sacarla.
  visiblePara(pio, yo) {
    return !!pio && !this.explotado(pio) && (!this.esHuevo(pio) || (!!yo && yo.usuario === pio.autor));
  }

  // Un aviso de un pío que todavía es huevo espera a que nazca: avisar de algo
  // que quien recibe el aviso no puede ver sería un aviso roto.
  avisoListo(aviso) {
    return !aviso.pio || !this.esHuevo(this.buscarPio(aviso.pio));
  }
}

function hashear(clave, sal) {
  return crypto.scryptSync(String(clave), sal, 32).toString('hex');
}

class ErrorPio extends Error {
  // El mensaje viaja ya armado en espanol, de respaldo; la clave es para que
  // el otro lado lo diga en el idioma que corresponda.
  constructor(codigo, mensaje, clave, datos) {
    super(mensaje);
    this.codigo = codigo;
    this.clave = clave || null;
    this.datos = datos || null;
  }
}

module.exports = { Almacen, ErrorPio, DURACIONES_DE_BLOQUEO, MECHA };
