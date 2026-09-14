-- Corrales: los subtemas de Pío, cada uno con su feed y su chat.
-- Pegar entero en Supabase → SQL Editor → New query → Run.
--
-- Es la segunda y última migración de esta tanda: incluye las dos tablas, la
-- de corrales y la de mensajes del chat, aunque el chat llegue después. Correr
-- una migración es molesto; correr dos por lo mismo, más.

create table if not exists pio_corrales (
  nombre  text   primary key,
  creado  bigint not null,
  dueno   text   not null,
  datos   jsonb  not null
);

create index if not exists pio_corrales_dueno_idx on pio_corrales (dueno);

-- El chat. Va en su propia tabla y no en jsonb dentro del corral porque acá sí
-- se espera volumen: un corral activo junta miles de mensajes, y traerlos
-- todos cada vez que alguien abre la pestaña no escala.
create table if not exists pio_mensajes (
  id      text   primary key,
  corral  text   not null,
  autor   text   not null,
  creado  bigint not null,
  datos   jsonb  not null
);

-- La consulta que hace el chat todo el tiempo: los últimos de este corral.
create index if not exists pio_mensajes_corral_idx on pio_mensajes (corral, creado desc);

-- Igual que el resto: nadie entra desde el navegador, Pío habla con la clave
-- service_role desde el servidor. RLS encendido para que la clave anon no
-- pueda leer nada aunque se filtre.
alter table pio_corrales enable row level security;
alter table pio_mensajes enable row level security;
