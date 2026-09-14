'use strict';

// Nombres de usuario que nadie puede tomar al registrarse. Quedan guardados
// para el equipo del sitio.
//
// El criterio no es "nos gusta ese nombre". Cada grupo responde a un riesgo
// concreto, y ese es el orden en que estan puestos: primero lo que permite
// hacerse pasar por alguien, despues lo que rompe cosas.
//
// Recordar que el usuario valido es /^[a-z0-9_]{3,15}$/, asi que aca no hay
// acentos ni nombres de menos de tres letras: esos ya son imposibles de crear.

// 1. La marca y su jerga. Quien tenga @pio o @pollito parece el sitio mismo.
const MARCA = [
  'pio', 'pios', 'piar', 'piando', 'repio', 'repios',
  'pollito', 'pollitos', 'pollita', 'pollitas',
  'pollo', 'pollos', 'gallo', 'gallos', 'gallina', 'gallinas',
  'ganso', 'gansa', 'pato', 'pata', 'huevo', 'huevos',
  'nido', 'nidos', 'plaza', 'plazas', 'corral', 'corrales', 'gallinero',
];

// 2. Autoridad. Este es el grupo que de verdad importa: son los nombres con
// los que se estafa a la gente diciendo "soy del soporte oficial".
const AUTORIDAD = [
  'admin', 'admins', 'administrador', 'administradores', 'administrator',
  'root', 'superuser', 'superusuario', 'sistema', 'system',
  'staff', 'equipo', 'team', 'oficial', 'oficiales', 'official',
  'moderador', 'moderadores', 'moderacion', 'mod', 'mods',
  'soporte', 'support', 'ayuda', 'help', 'contacto', 'contact',
  'seguridad', 'security', 'abuse', 'legal', 'privacidad', 'privacy',
  'terminos', 'terms', 'dmca', 'verificado', 'verified', 'denuncias',
];

// 3. Infraestructura y correo. Si el dia de manana hay correo saliente,
// @noreply y @postmaster son municion para phishing.
const INFRAESTRUCTURA = [
  'noreply', 'no_reply', 'postmaster', 'webmaster', 'hostmaster',
  'mail', 'correo', 'email', 'www', 'ftp', 'smtp', 'dns',
  'api', 'apis', 'cdn', 'static', 'assets', 'bot', 'bots',
  'null', 'undefined', 'nan', 'true', 'false',
];

// 4. Rutas del sitio. Hoy el perfil vive en #/u/<usuario>, pero si manana
// alguna de estas pasa a ser una ruta propia, un usuario con ese nombre la
// tapa. Reservarlas ahora sale gratis; desalojarlas despues, no.
const RUTAS = [
  'buscar', 'search', 'avisos', 'notificaciones', 'perfil', 'perfiles',
  'profile', 'cuenta', 'cuentas', 'account', 'ajustes', 'config',
  'configuracion', 'settings', 'login', 'logout', 'signin', 'signup',
  'registro', 'register', 'sesion', 'session', 'inicio', 'home',
  'explorar', 'explore', 'hilo', 'hilos', 'thread', 'acerca', 'about',
  'blog', 'docs', 'estado', 'status', 'mapa', 'sitemap',
  'panel', 'dashboard', 'admin_panel', 'tendencias', 'temas',
];

// 5. Genericos que confunden. "@usuario dijo" o "@eliminado" leidos rapido
// parecen etiquetas del sistema, no personas.
const GENERICOS = [
  'usuario', 'usuarios', 'user', 'users', 'anonimo', 'anonymous',
  'invitado', 'guest', 'todos', 'everyone', 'nadie', 'alguien',
  'test', 'tests', 'prueba', 'pruebas', 'demo', 'ejemplo', 'example',
  'eliminado', 'borrado', 'deleted', 'suspendido', 'baneado',
];

const RESERVADOS = new Set([
  ...MARCA,
  ...AUTORIDAD,
  ...INFRAESTRUCTURA,
  ...RUTAS,
  ...GENERICOS,
]);

function esReservado(usuario) {
  return RESERVADOS.has(String(usuario == null ? '' : usuario).trim().toLowerCase());
}

module.exports = {
  RESERVADOS,
  esReservado,
  POR_GRUPO: { MARCA, AUTORIDAD, INFRAESTRUCTURA, RUTAS, GENERICOS },
};
