# 🐤 Pío

Una red social donde cada mensaje entra en **100 caracteres**. Ni uno más.
Si no entra, no era tan importante.

Servidor en Node **sin una sola dependencia** y cliente en HTML/CSS/JS a mano.
Todo se guarda en `datos/pio.json`, en tu propia máquina.

## Arrancar

```bash
node pruebas/semillas.js
```

```bash
node servidor.js
```

Abrí <http://localhost:3100>. Las cuentas de ejemplo (`pollito`, `gansa`,
`pato`, `gallo`) usan la clave `semillas`. También podés crear la tuya desde
"Crear nido".

El puerto se cambia con `PUERTO=4000 node servidor.js`.

## Pruebas

```bash
node pruebas/todos.js
```

Levanta un servidor real en un puerto libre, con datos en una carpeta
temporal, y le pega por HTTP igual que el cliente. 54 comprobaciones: el
límite de 100, cuentas, nido, repíos, hilos, borrado, búsqueda y persistencia.

## Qué hay adentro

| Archivo | Qué hace |
|---|---|
| [`src/modelo.js`](src/modelo.js) | Reglas puras: el límite, validaciones, etiquetas, menciones |
| [`src/almacen.js`](src/almacen.js) | Cuentas, píos y persistencia en un único JSON |
| [`src/api.js`](src/api.js) | Rutas HTTP, líneas de tiempo y serialización |
| [`servidor.js`](servidor.js) | Servidor: API + archivos estáticos |
| [`publico/`](publico) | El cliente (una sola página, ruteo por `#`) |
| [`pruebas/`](pruebas) | Batería de pruebas y datos de ejemplo |

## Decisiones que vale la pena conocer

**El límite se cuenta en puntos de código, no en unidades UTF-16.** Un emoji
vale 1, no 2: `[...texto].length`. Entran 100 🐤 justos, y 101 no. La misma
cuenta la hace el cliente (para el anillo) y el servidor (para decidir).

**El servidor nunca confía en el cliente.** El anillo rojo es cortesía; quien
rechaza los 101 caracteres es `validarPio` en el servidor, y hay una prueba
que le pega por HTTP para comprobarlo.

**Las claves van con `scrypt` + sal por cuenta** y se comparan con
`timingSafeEqual`. Las sesiones son un token al portador guardado junto a los
datos, así sobreviven a un reinicio. Es suficiente para algo que corre en tu
máquina; para exponerlo a internet haría falta HTTPS, expiración de tokens y
límite de intentos.

**El repío no crea un pío nuevo.** Se guarda como `{usuario, fecha}` dentro
del pío original, y esa fecha es la que ordena la línea de tiempo. Por eso un
repío puede aparecer arriba de todo sin duplicar el texto ni perder al autor.

**Las respuestas no ensucian la plaza.** Sólo se ven dentro del hilo o en el
perfil de quien las escribió.

## Vocabulario

| En Pío | En el resto del mundo |
|---|---|
| pío | el mensaje |
| piar | publicar |
| nido | tu línea de tiempo (vos y quienes seguís) |
| plaza | todo lo público |
| repío | compartir el pío de otro |
| pollito | el que usa Pío |

## La API

Todas las respuestas son JSON. Las rutas que piden sesión esperan
`Authorization: Bearer <token>`.

```
POST   /api/registro              {usuario, nombre, clave} -> {token, yo}
POST   /api/sesion                {usuario, clave}         -> {token, yo}
DELETE /api/sesion                cierra la sesión
GET    /api/yo                    tu perfil
PATCH  /api/yo                    {nombre?, bio?}

GET    /api/pios?tipo=plaza|nido|usuario|etiqueta|megusta
POST   /api/pios                  {texto, respuestaA?}
DELETE /api/pios/:id              sólo los propios
POST   /api/pios/:id/megusta      alterna
POST   /api/pios/:id/repio        alterna, no vale el propio
GET    /api/pios/:id/hilo         {antes, pio, despues}

GET    /api/usuarios/:usuario
POST   /api/usuarios/:usuario/seguir   alterna
GET    /api/buscar?q=
GET    /api/tendencias            etiquetas de los últimos 7 días
```

## Lo que todavía no está

- Imágenes y avatares de verdad (hoy es la inicial sobre un degradé).
- Notificaciones y menciones que avisen.
- Paginación en el cliente: el servidor ya devuelve `hayMas` y acepta `antes`,
  pero la interfaz todavía no pide la página siguiente.
- Varios procesos a la vez: el JSON se reescribe entero en cada cambio.
