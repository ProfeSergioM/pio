# 🐤 Pío

Una red social donde cada mensaje entra en **100 caracteres**. Ni uno más.
Si no entra, no era tan importante.

Servidor en Node **sin una sola dependencia** y cliente en HTML/CSS/JS a mano.
Todo se guarda en `datos/pio.json`, en tu propia máquina.

## Arrancar

```bash
npm start
```

Abre <http://localhost:3100> y crea tu pollito. El sitio arranca vacío: no hay
cuentas ni píos de ejemplo, y `datos/pio.json` se crea solo con el primer
registro.

Para volver a empezar de cero, borra `datos/pio.json`. El puerto se cambia con
`PUERTO=4000 npm start` (también acepta `PORT`).

## Pruebas

```bash
npm test
```

Levanta un servidor real en un puerto libre, con datos en una carpeta
temporal, y le pega por HTTP igual que el cliente. 277 comprobaciones: el
límite de 100, cuentas, nido, repíos, hilos, borrado, avisos, búsqueda,
persistencia, altas masivas, nombres reservados, respuestas en cascada,
adjuntos, depósitos, subida de imágenes, búsqueda de GIF y verificación de
tokens de Google. Ninguna sale a internet: los servicios externos se inyectan
falseados.
No hay framework ni dependencias: si algo falla, la salida te dice qué y el
proceso termina en 1.

## Ajustes

Todo opcional: sin nada de esto Pío arranca igual.

Hay dos formas de configurarlo, y se pueden mezclar: variables de entorno, o
un archivo `datos/config.json`. **La variable de entorno siempre gana.** El
archivo es la comodidad para trabajar en tu máquina —  `datos/` ya está fuera
del control de versiones, así que las claves no se escapan a un commit por
descuido— y las variables son para el despliegue.

```json
{
  "imgbbClave": "...",
  "giphyClave": "...",
  "cloudinary": { "nube": "...", "clave": "...", "secreto": "..." }
}
```

| Variable | Clave en el archivo | Para qué |
|---|---|---|
| `PUERTO` | — | El puerto. Por defecto 3100 (también acepta `PORT`). |
| `PIO_ALTAS_POR_HORA` | `altas` | Cuentas nuevas por IP y por hora. Por defecto 5. |
| `PIO_SUBIDAS_POR_HORA` | `subidas` | Imágenes por IP y por hora. Por defecto 20. |
| `PIO_GOOGLE_CLIENT_ID` | `googleClienteId` | Enciende el acceso con Google. |
| `PIO_IMGBB_KEY` | `imgbbClave` | Enciende la subida de imágenes vía ImgBB. |
| `PIO_CLOUDINARY_NUBE` | `cloudinary.nube` | Enciende la subida vía Cloudinary. |
| `PIO_CLOUDINARY_CLAVE` | `cloudinary.clave` | Su API key. |
| `PIO_CLOUDINARY_SECRETO` | `cloudinary.secreto` | Su API secret. Nunca sale del servidor. |
| `PIO_IMAGENES_PROVEEDOR` | `proveedor` | Cuál gana si están los dos: `imgbb` o `cloudinary`. |
| `PIO_GIPHY_KEY` | `giphyClave` | Enciende el buscador de GIF. |
| `PIO_ACORTADOR` | `acortador` | `no` apaga el acortador de direcciones. |
| `SUPABASE_URL` | `supabase.url` | Guarda en Supabase en vez de en un archivo. |
| `SUPABASE_SERVICE_KEY` | `supabase.clave` | La `service_role`, nunca la `anon`. |
| `PIO_DEPOSITO` | `deposito` | `archivo` fuerza el JSON local aunque haya credenciales. |
| `PIO_PROXIES` | `proxies` | Cuántos proxies de confianza hay delante. En tu máquina 0, en Render 1. |

Sin ninguna de estas, Pío arranca igual: cada función que necesita una clave
queda apagada y lo dice.

## Qué hay adentro

| Archivo | Qué hace |
|---|---|
| [`src/modelo.js`](src/modelo.js) | Reglas puras: el límite, validaciones, etiquetas, menciones |
| [`src/almacen.js`](src/almacen.js) | Cuentas, píos y persistencia en un único JSON |
| [`src/api.js`](src/api.js) | Rutas HTTP, líneas de tiempo y serialización |
| [`src/limite.js`](src/limite.js) | Ventana deslizante contra las altas en masa |
| [`src/google.js`](src/google.js) | Verificación del ID token de Google, a mano |
| [`src/ajustes.js`](src/ajustes.js) | Claves y opciones, de entorno o de archivo |
| [`src/imagenes.js`](src/imagenes.js) | Subida de imágenes: ImgBB o Cloudinary |
| [`src/gifs.js`](src/gifs.js) | Búsqueda de GIF en Giphy |
| [`src/enlaces.js`](src/enlaces.js) | Acortar direcciones, con proveedor de repuesto |
| [`src/emojis.js`](src/emojis.js) | Los emojis propios del sitio |
| [`src/deposito.js`](src/deposito.js) | Dónde vive todo: archivo JSON o Supabase |
| [`supabase.sql`](supabase.sql) | Las tablas, listas para pegar y ejecutar |
| [`servidor.js`](servidor.js) | Servidor: API + archivos estáticos |
| [`publico/`](publico) | El cliente (una sola página, ruteo por `#`) |
| [`publico/idiomas.js`](publico/idiomas.js) | Español e inglés, en un solo archivo |
| [`src/reservados.js`](src/reservados.js) | Nombres de usuario que nadie puede tomar |
| [`pruebas/`](pruebas) | La batería de pruebas |

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
máquina; para exponerlo a internet haría falta HTTPS y expiración de tokens.
El límite de altas ya está, más abajo.

**El repío no crea un pío nuevo.** Se guarda como `{usuario, fecha}` dentro
del pío original, y esa fecha es la que ordena la línea de tiempo. Por eso un
repío puede aparecer arriba de todo sin duplicar el texto ni perder al autor.

**Las respuestas no ensucian la plaza.** Sólo se ven dentro del hilo o en el
perfil de quien las escribió.

**Los avisos son derivados, no hechos históricos.** Si alguien saca el me
gusta, deja de seguirte o borra el pío donde te mencionó, el aviso se va con
la acción. Nadie queda mirando un "le gustó tu pío" de algo que ya nadie
marcó. Un pío que te responde *y* te menciona avisa una sola vez: gana la
respuesta, que dice más. Y mencionarse a uno mismo no avisa nada.

## Altas masivas

Cinco cuentas nuevas por hora y por IP, con una ventana deslizante en memoria.
Se cuentan las altas que salieron bien, **no los intentos**: un pedido mal
formado no crea nada, así que no gasta cupo. Entrar con Google pasa por el
mismo límite, para que no sea la puerta de atrás.

El dato de quién pide sale de `req.socket` y de ningún otro lado.
`X-Forwarded-For` la escribe cualquiera con `curl`; si Pío le creyera,
estaría publicando el modo de saltearse el límite. El día que esto viva detrás
de un proxy de verdad, ahí habrá que decidir en cuál confiar.

No se guarda en el JSON: son marcas que se vencen solas, y ensuciar los datos
con basura que caduca en una hora no vale la pena. Si reiniciás el servidor, el
castigo se levanta.

## Entrar con Google

Apagado por defecto. Para encenderlo hace falta un client ID, que se saca en
Google Cloud Console → APIs y servicios → Credenciales → ID de cliente de
OAuth, tipo "Aplicación web", con `http://localhost:3100` en los orígenes
autorizados de JavaScript. No hace falta client secret.

```bash
PIO_GOOGLE_CLIENT_ID=tu-id.apps.googleusercontent.com npm start
```

El servidor verifica el ID token a mano, con lo que Node ya trae: firma RS256
contra las claves públicas de Google, emisor, destinatario, vencimiento y
correo verificado. **El algoritmo lo fija el servidor, no el token**: aceptar
el `alg` que viene adentro sería como preguntarle al sobre si hay que revisar
el sello.

La cuenta se ata al `sub` de Google, no al correo. Un correo se cambia, se
libera y se lo puede quedar otro; el `sub` no. El usuario sale del correo y si
está tomado se numera. A una cuenta de Google no se entra con clave, porque no
tiene ninguna.

Vale decirlo: con esto Pío deja de correr sólo en tu máquina. El navegador
carga el script de Google y Google ve a cualquiera que abra la portada, entre o
no. Si eso no te cierra, dejalo apagado y no se carga nada de afuera.

## Español e inglés

El selector está arriba en la portada y en el menú lateral (🌐). Lo elegido se
guarda en el navegador; si nunca elegiste, se mira el idioma del navegador.

**La jerga no se traduce.** Pío, piar, nido, plaza, repío y pollito son la
marca, y quedan igual en los dos idiomas: "Create nido", "3 píos", "repiado by
@pato". Se traduce todo lo que las rodea. Es lo que hizo Twitter con "tweet",
que nunca se tradujo en ningún idioma.

Los errores del servidor viajan con una clave y sus datos —
`{clave: 'pio.largo', datos: {sobra: 3, limite: 100}}` — y no como una frase
ya armada. El cliente la dice en el idioma que corresponda; si no conoce la
clave, muestra el español que vino de respaldo. Así el servidor no necesita
saber nada de idiomas.

## Imágenes y GIF

Apagadas por defecto. Se encienden con la clave del proveedor que elijas:
**ImgBB** (una API key y listo) o **Cloudinary** (nube, key y secret, pero da
recorte y miniaturas sin trabajo extra). Los GIF salen de **Giphy**.

Las tres comparten una regla: **la clave nunca llega al navegador**. El cliente
le manda la imagen a nuestro servidor y el servidor habla con el proveedor. Si
el navegador llamara directo, la clave estaría a la vista de cualquiera que
abra el inspector. Por eso también `/api/gifs` pide sesión: sin eso sería un
proxy abierto a Giphy pagado con nuestra clave.

Dos cuidados más, del lado de la validación:

**No se le cree al tipo que declara el cliente.** Se lee la firma real del
archivo —`\x89PNG`, `GIF8`, `RIFF…WEBP`—. Un `data:image/png` delante de un
ejecutable sigue siendo un ejecutable.

**La URL que devuelve el proveedor se sanea antes de usarla.** Sólo `https` y
sólo sus dominios. Esa dirección termina en un `<img src>`, y si algún día la
respuesta viniera manipulada, no queremos que se convierta en algo ejecutable
dentro de la página.

## Dónde vive todo

Dos depósitos con la misma boca. El de **archivo** guarda en `datos/pio.json`,
que es cómodo para trabajar en tu máquina y es lo que usan las pruebas. El de
**Supabase** habla por HTTP con `fetch`, sin una sola dependencia de npm, y es
el que hace falta para desplegar: los hostings gratuitos borran el disco en
cada reinicio.

Se elige solo. Si hay credenciales de Supabase, las usa; si no, el archivo.
`PIO_DEPOSITO=archivo npm start` fuerza el archivo, que es lo que conviene
para trabajar sin ensuciar la base de verdad.

Para armar las tablas, pegá [`supabase.sql`](supabase.sql) en el SQL Editor de
Supabase. Todas llevan prefijo `pio_`, así que conviven con cualquier otra
cosa que ya tengas en ese proyecto.

**Las lecturas van a memoria, las escrituras a la base.** Al arrancar se carga
todo y las consultas se responden desde ahí, que es instantáneo; sólo los
cambios salen a Supabase, y sólo el registro que cambió. Reescribir todo en
cada pío, que es lo que hace el depósito de archivo, sobre HTTP sería
insostenible.

Esto alcanza de sobra para un sitio chico y tiene un límite que conviene decir
en voz alta: **no sirve para varios procesos a la vez**, porque cada uno
tendría su propia copia en memoria y no se enteraría de los cambios del otro.
Un solo proceso, que es lo que hay.

En `jsonb` va el objeto entero con la misma forma que tenía en el JSON, y en
columnas sueltas sólo lo que de verdad se consulta u ordena. Por eso el código
de dominio no se enteró del cambio.

## Desplegar

El archivo [`render.yaml`](render.yaml) ya describe el servicio. En Render:
**New → Blueprint**, se elige el repositorio, y Render lo lee y arma todo solo.
No hay nada que compilar: el proyecto no tiene dependencias, así que el build
es un no-op y el arranque es `node servidor.js`.

Las claves no están en el archivo. Van marcadas como `sync: false`, que
significa "preguntámelo en el panel"; Render las pide al desplegar y las guarda
de su lado. Las dos imprescindibles son `SUPABASE_URL` y
`SUPABASE_SERVICE_KEY`; el resto enciende funciones sueltas.

**`PIO_PROXIES=1` no es opcional en Render.** Hay un balanceador delante, y sin
eso el límite de altas vería siempre la IP del proxy y metería a todos los
visitantes en el mismo cubo: cinco altas por hora para el sitio entero.

Dos cosas del plan gratuito que conviene saber de antemano, porque van a pasar:

- **El servicio de Render se duerme tras 15 minutos sin visitas.** La primera
  visita después de eso tarda cerca de un minuto en responder.
- **Los proyectos de Supabase se pausan tras una semana sin actividad** y hay
  que reactivarlos a mano desde su panel.

## Acortar direcciones

Encendido por defecto: ni is.gd ni TinyURL piden credenciales. En el diálogo de
piar hay un botón 🔗 que busca las direcciones del texto y las reemplaza por su
versión corta, lo cual importa bastante cuando el pío entero son cien
caracteres.

**Son dos proveedores a propósito.** El día que se escribió esto, is.gd
respondía `Error, database insert failed` con código 200 y tipo `text/html` —
ni siquiera el JSON de error que promete su documentación. Se prueba is.gd y,
si no contesta algo usable, TinyURL. Hay prueba de ese caso exacto.

Y lo mismo que con todo lo demás: **sólo se acortan direcciones `http` y
`https`**. Un `javascript:` acortado sería una trampa con aspecto inofensivo,
que es justamente para lo que sirve un acortador. La dirección que vuelve se
comprueba contra el dominio del proveedor al que se le preguntó.

## Vocabulario

| En Pío | En el resto del mundo |
|---|---|
| pío | el mensaje |
| piar | publicar |
| nido | tu línea de tiempo (vos y quienes seguís) |
| plaza | todo lo público |
| repío | compartir el pío de otro |
| pollito | el que usa Pío |
| aviso | la notificación |

## La API

Todas las respuestas son JSON. Las rutas que piden sesión esperan
`Authorization: Bearer <token>`.

```
GET    /api/config       qué hay encendido         ->     {google}
POST   /api/registro     {usuario, nombre, clave}  -> 201 {token, yo}
POST   /api/sesion/google {credencial}             ->     {token, yo}
POST   /api/sesion       {usuario, clave}          ->     {token, yo}
DELETE /api/sesion       cierra la sesión          ->     {ok}
GET    /api/yo           tu perfil                 ->     {yo}
PATCH  /api/yo           {nombre?, bio?}           ->     {yo}

GET    /api/pios?tipo=plaza                        ->     {tipo, pios, hayMas}
GET    /api/pios?tipo=nido                               (pide sesión)
GET    /api/pios?tipo=usuario&usuario=pollito
GET    /api/pios?tipo=etiqueta&etiqueta=granja
GET    /api/pios?tipo=megusta&usuario=pollito
POST   /api/pios         {texto, respuestaA?}      -> 201 {pio}
DELETE /api/pios/:id     sólo los propios          ->     {ok}
POST   /api/pios/:id/megusta   alterna             ->     {pio}
POST   /api/pios/:id/repio     alterna, no el propio ->   {pio}
GET    /api/pios/:id/hilo                          ->     {antes, pio, despues}

GET    /api/notificaciones                         ->     {notificaciones, sinLeer}
POST   /api/notificaciones/leidas  marca todo leído ->     {ok, sinLeer}

GET    /api/usuarios/:usuario                      ->     {perfil}
POST   /api/usuarios/:usuario/seguir   alterna     ->     {perfil}
GET    /api/buscar?q=                              ->     {pios, usuarios}
GET    /api/tendencias   etiquetas de 7 días       ->     {tendencias}
```

Las líneas de tiempo vienen de a 50. Para pedir la siguiente página agregá
`&antes=<orden del último pío que recibiste>`; `hayMas` te dice si vale la pena.
Los errores son `{error}` con el código HTTP correspondiente: 400 si el pedido
está mal, 401 si falta o venció la sesión, 404 si no existe.

## Los límites

| Qué | Cuánto |
|---|---|
| pío | **100 caracteres** |
| bio | 100 |
| nombre | 30 |
| usuario | de 3 a 15: minúsculas, números y `_` |
| clave | de 6 a 200 |
| página | 50 píos |
| cuerpo del pedido | 64 KB |

El único que importa de verdad es el primero. Los demás están para que nada
crezca sin control.

## Lo que todavía no está

- Avatares de verdad: hoy el del perfil sigue siendo la inicial sobre un
  degradé, aunque los píos ya aceptan imágenes.
- Avisos en vivo: hoy el contador se refresca al cambiar de vista, no solo.
- Paginación en el cliente: el servidor ya devuelve `hayMas` y acepta `antes`,
  pero la interfaz todavía no pide la página siguiente.
- Varios procesos a la vez: cada uno tendría su propia copia en memoria.
- Medallitas por seguidores en el perfil: 10, 25, 50, 100, 200, 500, 1000,
  5000 y más de 10.000. Chiquitas, y sólo en el perfil — no en cada pío, que
  es donde ensuciarían la lectura.
- Etiquetar cuentas dentro de una imagen, con su posición sobre la foto.
- Corrales: subtemas con su propio feed y una pestaña de chat.
- Panel de administración.
- Nadie puede cambiar ni recuperar su clave. Si un pollito la olvida, queda
  afuera para siempre.
- Las sesiones no vencen nunca.
