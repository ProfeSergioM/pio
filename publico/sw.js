'use strict';

// El trabajador de Pío: lo que hace falta para que el sitio se pueda instalar
// como app y abra aunque se corte internet.
//
// La regla es "primero la red". Pío cambia seguido, y guardar primero y
// preguntar después dejaría a la gente con la versión de ayer. Lo guardado
// sólo se usa cuando la red no contesta, para que la app abra y diga que no
// hay conexión en vez de mostrar el dinosaurio del navegador.
//
// Lo que nunca se guarda: la API —píos, avisos, perfiles— y las páginas para
// compartir. Mostrar píos viejos como si fueran de ahora sería peor que no
// mostrar nada.

const VERSION = 'pio-cascara-1';

// Lo mínimo para que la app abra sin red.
const CASCARA = [
  '/',
  '/estilos.css',
  '/app.js',
  '/idiomas.js',
  '/temas/fichas.css',
  '/temas/revista.css',
  '/temas/pixel.css',
  '/manifest.webmanifest',
  '/iconos/pio-192.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSION)
      .then((caja) => caja.addAll(CASCARA))
      .then(() => self.skipWaiting()),
  );
});

// Al estrenar versión se tira lo de las anteriores.
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  // Lo de afuera —imágenes de Cloudinary, Spotify, Google— lo maneja el
  // navegador como siempre.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/p/')) return;
  evento.respondWith(primeroLaRed(pedido));
});

async function primeroLaRed(pedido) {
  const caja = await caches.open(VERSION);
  try {
    const respuesta = await fetch(pedido);
    if (respuesta.ok && respuesta.type === 'basic') caja.put(pedido, respuesta.clone());
    return respuesta;
  } catch (err) {
    const guardada = await caja.match(pedido, { ignoreSearch: true });
    if (guardada) return guardada;
    // Cualquier dirección de la app es la misma página: el resto va detrás del #.
    if (pedido.mode === 'navigate') {
      const inicio = await caja.match('/');
      if (inicio) return inicio;
    }
    return Response.error();
  }
}
