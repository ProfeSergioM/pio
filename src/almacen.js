'use strict';

const crypto = require('crypto');
const M = require('./modelo');
const { crearDeposito, vacio } = require('./deposito');
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
const cambioSecuencia = (n) => ({ tabla: 'pio_meta', clave: 'secuencia', valor: { clave: 'secuencia', valor: n } });
const baja = (tabla, clave) => ({ tabla, clave, valor: null });

// Persistencia en un unico JSON. Alcanza de sobra para el tamano de Pio y
// deja el estado legible a ojo, que es comodo para depurar.
class Almacen {
  constructor(directorio, ajustes = {}, opciones = {}) {
    this.deposito = opciones.deposito || crearDeposito(directorio, ajustes, opciones);
    this.datos = vacio();
    // Se arranca a cargar sin bloquear: quien necesite los datos espera esta
    // promesa. Así crearServidor() sigue siendo síncrono y las pruebas no
    // tienen que cambiar de forma.
    this.listo = this.cargar();
  }

  async cargar() {
    this.datos = await this.deposito.cargar();
    return this;
  }

  async guardar(cambios) {
    await this.deposito.guardar(this.datos, cambios || []);
  }

  proximoId(prefijo) {
    this.datos.secuencia += 1;
    return `${prefijo}${this.datos.secuencia.toString(36)}`;
  }

  // --- usuarios -----------------------------------------------------------

  buscarUsuario(usuario) {
    const u = M.normalizarUsuario(usuario);
    return this.datos.usuarios.find((x) => x.usuario === u) || null;
  }

  async crearUsuario(usuario, nombre, clave) {
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
      sal,
      hash: hashear(clave, sal),
      google: null,
      creado: Date.now(),
      siguiendo: [],
    };
    this.datos.usuarios.push(nuevo);
    await this.guardar([cambioUsuario(nuevo), cambioSecuencia(this.datos.secuencia)]);
    return nuevo;
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
    return sesion ? this.buscarUsuario(sesion.usuario) : null;
  }

  async actualizarPerfil(cuenta, cambios) {
    if (cambios.nombre !== undefined) {
      const error = M.validarNombre(cambios.nombre);
      if (error) throw new ErrorPio(400, M.mensaje(error), error.clave, error.datos);
      cuenta.nombre = M.normalizarTexto(cambios.nombre);
    }
    if (cambios.bio !== undefined) {
      const error = M.validarBio(cambios.bio);
      if (error) throw new ErrorPio(400, M.mensaje(error), error.clave, error.datos);
      cuenta.bio = M.normalizarTexto(cambios.bio);
    }
    await this.guardar([cambioUsuario(cuenta)]);
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

  seguidores(usuario) {
    const u = M.normalizarUsuario(usuario);
    return this.datos.usuarios.filter((x) => x.siguiendo.includes(u));
  }

  // --- pios ---------------------------------------------------------------

  buscarPio(id) {
    return this.datos.pios.find((p) => p.id === id) || null;
  }

  async publicar(cuenta, texto, respuestaA, adjunto) {
    // Con imagen el texto puede faltar, porque la imagen ya dice algo. Lo que
    // no cambia nunca es el limite de cien.
    const limpio = M.normalizarTexto(texto);
    const error = adjunto && !limpio ? null : M.validarPio(texto);
    if (error) throw new ErrorPio(400, M.mensaje(error), error.clave, error.datos);
    if (respuestaA && !this.buscarPio(respuestaA)) {
      throw new ErrorPio(404, 'Ese pío ya no está.', 'pio.noesta');
    }
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
      meGusta: [],
      repios: [],
    };
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
    return nuevo;
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
    return nuevos;
  }

  avisosDe(cuenta, limite = 50) {
    return this.datos.notificaciones
      .filter((n) => n.para === cuenta.usuario)
      .sort((a, b) => b.creado - a.creado)
      .slice(0, limite);
  }

  sinLeer(cuenta) {
    return this.datos.notificaciones.filter((n) => n.para === cuenta.usuario && !n.leida).length;
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

  contarRespuestas(id) {
    return this.respuestasDe(id).length;
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

module.exports = { Almacen, ErrorPio };
