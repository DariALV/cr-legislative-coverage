# explorer

## 2026-11-07 02:20 — Explorador local de la base (private_visuals/db_explorer)

- Pedido del usuario: página local simple (HTML/CSS/JS), bonita y minimalista, para consultar las tablas de la base, empezando por expedientes, con el estilo de `private_visuals/embedding_cross`.
- Cómo: `private_visuals/db_explorer/server.py` (solo librería estándar: `http.server` + `sqlite3`, conexión `mode=ro`, nunca escribe) sirve la página y una API JSON: `/api/bills` (lista compacta de los 5.898 expedientes, con un "haystack" sin tildes de número + nombre + proponentes + materias para buscar en el navegador), `/api/bill/<n>` (todo el detalle) y `/api/news/<id>` (contenido completo de una noticia bajo demanda). Se descartó sql.js porque obligaría a cargar la base de 245 MB en el navegador.
- Página: lista a la izquierda (búsqueda sin tildes, chips de estado, filtros por tipo, bandera, estado del texto, con noticias / votaciones / ley, y orden) y detalle a la derecha con pestañas Resumen, Texto, Proponentes (con fracción según `deputy_factions` en la fecha de presentación), Trámite (línea de tiempo), Comisiones (`organ_bills` + `organs`), Votaciones y Noticias (`news_bill_links`). Rutas por hash (`#/bill/23000`), atajos `/` (buscar) y `j`/`k` (siguiente/anterior). Responsive.
- Marca en rojo datos sucios del SIL ya vistos en la auditoría: vencimiento o pasos con fecha anterior a la presentación, y avisa cuando un expediente "en trámite" tiene un paso de archivo.
- Votaciones muestra estado vacío: `votes` y `vote_deputies` siguen sin datos.
- Correr: `python private_visuals/db_explorer/server.py` → http://localhost:8765 (también quedó `.claude/launch.json` con la config `db-explorer`).
- Probado en el navegador con 23000, 23414 (43 noticias) y 25754 (presupuesto, exposición de ~1 M de caracteres: carga en ~1,7 s, se muestra recortada); sin errores de consola; vista móvil bien.

## 2026-11-07 02:30 — Issue y commit del explorador (#67)

- Por pedido del usuario se creó #67 "Local database explorer" en el milestone "Private visuals" (enhancement), con el diseño y las salvedades (votaciones vacías, solo expedientes por ahora).
- Commit con `private_visuals/db_explorer/`, `.claude/launch.json` y este log. No se incluyeron los cambios pendientes de otro trabajo (`docs/bills.md`, `asamblea_parser.py`, `claude_logs/2026-11-06.md`).

## 2026-11-07 01:48 — Ampliar el explorador a diputados, órganos y noticias (#67)

- Pedido del usuario: que el explorador muestre también diputados, órganos, noticias, etc., y que cada referencia a otra entidad sea un link a su página (p. ej. un diputado en proponentes o en votaciones).
- Revisión de datos para el diseño (sin código todavía):
  - `deputies` es diputado × período (235 filas, 230 personas por `person_id`; solo 5 repiten período). `bill_proponents.deputy_id` está lleno en 24.669 de 25.240; 571 proponentes sin diputado (95/219/215/42 por período).
  - `deputy_bills` (27.937) incluye todo lo de `bill_proponents` más 3.290 filas de expedientes que no están en `bills` (desde el 19115, anteriores al 20000).
  - `bill_steps.organ` es texto libre ("JURIDICOS (ÁREA VII)", "COMISION ESPECIAL 19204", "ARCHIVO"): solo 39.246 de 100.824 pasos coinciden exacto con `organs.name` (casi todos PLENARIO).
  - `organs`: 1.880 (1.845 especiales). `organ_bills` cubre solo 27 órganos y 1.094 expedientes. `organ_memberships`: 5.230 en 138 órganos; 25 con `organ_code` 0 "COMISION NO DEFINIDA".
  - `news_articles`: 29.875 (crhoy 9.442, nacion 9.424, delfino 5.399, elmundo 3.388, semanario 2.222); solo 532 enlazadas a expedientes (1.425 links, todos `source = link`).
  - `laws` 10.983 (7.883 con expediente). `votes` / `vote_deputies` siguen vacías.
- Decisiones abiertas presentadas al usuario (pendiente).

## 2026-11-07 02:00 — Explorador ampliado: diputados, órganos y noticias con links cruzados (#67)

- El usuario aceptó todas las recomendaciones de la entrada 01:48: secciones arriba (Expedientes · Diputados · Órganos · Noticias) con el mismo esquema lista + detalle; rutas `#/bill/<n>`, `#/deputy/<person_id>`, `#/organ/<code>`, `#/news/<id>`; diputado = persona (`person_id`, todos sus períodos); órganos de `bill_steps` enlazados solo si el nombre coincide exacto con un único órgano; noticias buscadas en el servidor con paginación; votaciones con links listos aunque vacías; proponentes sin `deputy_id` como texto; leyes y fracciones sin sección propia (fracción es filtro); código en módulos ES; commit con #67 y salvedades en el issue.
- `server.py` (sigue solo librería estándar, `mode=ro`): nuevos `/api/deputies`, `/api/deputy/<pid>`, `/api/organs`, `/api/organ/<code>`, `/api/news` (búsqueda sin tildes en título, descripción, autor y sección sobre un índice en memoria de las 29.875 noticias; filtros de medio, fechas, solo enlazadas; orden), `/api/news-facets` y `/api/news/<id>` (ahora devuelve la noticia completa con sus expedientes). En el detalle del expediente: `person_id` en proponentes y votos, y `organ_code` en los pasos. Los archivos estáticos se sirven con `Cache-Control: no-store`.
- Frontend: `app.js` se reemplazó por `js/main.js` (router y lista genérica con scroll infinito, local o paginada en el servidor), `js/util.js` (helpers y `link.*` para referencias), `js/bills.js`, `js/deputies.js`, `js/organs.js`, `js/news.js`. Las filas de la lista ahora son `<a>`.
- Links: proponente → diputado; órgano en Comisiones y en Trámite (cuando hay coincidencia exacta) → órgano; noticia del expediente → noticia (más un ícono al medio); diputado → expedientes, órganos, reemplazos (por nombre, solo si no es ambiguo) y votos; órgano → miembros y expedientes; noticia → expedientes.
- Diputado: pestañas Resumen (períodos, fracciones, reemplazos), Expedientes (de `deputy_bills`; los anteriores al 20000 quedan sin link y marcados "fuera del corpus"), Órganos y Votaciones. Órgano: Miembros (agrupados por legislatura) y Expedientes.
- Probado en el navegador: bill 23000 → proponente → diputada (143 expedientes, 36 puestos) → órgano 22988 (5 miembros); órgano 101 con 21 expedientes; noticias "presupuesto" 505, enlazadas 18 → noticia con 26 expedientes → expediente 25867 (Trámite con link a PLENARIO). Sin errores de consola; móvil sin scroll horizontal. La primera carga de noticias tarda unos segundos (arma el índice).

## 2026-11-07 02:01 — Commit del explorador ampliado (#67)

- El usuario aprobó el commit `feature: explorer for deputies, organs and news closes #67` (server, `js/`, html, css, borrado de `app.js` y este log, incluida la entrada de las 02:50 sobre votaciones). Salvedades ya comentadas en #67.

## 2026-11-07 02:03 — "No se pudo conectar con el servidor" en el explorador (#67)

- Causa: en el puerto 8765 escuchaban dos procesos: un `server.py` viejo (01:27, código anterior, sin `/api/deputies` ni `/api/organs`) y el nuevo que lanzó el usuario (02:02, `.venv`). En Windows, `http.server` deja que dos procesos se enlacen al mismo puerto (`allow_reuse_address`) y contestaba el viejo, con 404 en los endpoints nuevos, así que la página mostraba el error.
- Arreglo: se detuvo el proceso viejo (PID 18752). Ahora 8765 responde 200 en bills, deputies, organs y news-facets.
- Ojo: si se vuelve a lanzar el servidor sin cerrar el anterior puede volver a pasar. Queda también el servidor de prueba de Claude en 8766.

## 2026-11-07 02:13 — El explorador no arranca si el puerto está ocupado (#67)

- Pedido del usuario tras el problema de las 02:03. `server.py` usa ahora una subclase `Server` con `allow_reuse_address = False` y, en Windows, `SO_EXCLUSIVEADDRUSE`. Si el puerto está tomado, sale con "El puerto N ya está en uso… Cerralo o usá --port <otro>." (código 1).
- Probado: contra el 8765 ocupado sale con el mensaje; en un puerto libre arranca (200 en /api/organs) y una segunda copia en ese mismo puerto se rechaza.

## 2026-11-07 02:13 — Commit del chequeo de puerto (#67)

- Commit `feature: explorer refuses busy port #67` (server.py y este log, incluidas las entradas de 02:03 en adelante).

## 2026-11-07 02:25 — Fotos de diputados desde Delfino: revisión para el diseño (#67)

- Pedido del usuario: bajar las fotos de los diputados de Delfino, guardarlas en `raw/` (que está en `.gitignore`, así no terminan en el repo) y usarlas en el explorador de `private_visuals`; si no hay foto, dos iniciales (primer nombre + primer apellido).
- Fuente: Delfino no tiene página de directorio de diputados (`/asamblea/diputados` da 308→404, `/diputados` 404). Pero cada tarjeta de diputado en las páginas de votación (`raw/html/delfino/asamblea/votes/`, en caché) trae la foto: `<img alt="<nombre>" src="https://d1qqtien6gys07.cloudfront.net/static/images/asamblea/diputados/<archivo>.jpg">` (la segunda imagen es el logo del partido). En toda la caché hay 116 nombres distintos con 116 URLs de foto distintas (un archivo por persona).
- Cobertura esperada: solo diputados que aparecen en votaciones de Delfino (2018 en adelante); los 61 de 2014–2018 casi seguro quedan sin foto.
- Las iniciales actuales del explorador (`util.initials`) toman las dos primeras palabras de "NOMBRES APELLIDOS", así que con dos nombres salen mal (p. ej. "Ana Lucía …" → "AL").
- Decisiones abiertas presentadas al usuario (pendiente).

## 2026-11-07 02:29 — Fotos de diputados: decisiones (#67)

- El usuario aceptó las cuatro recomendaciones: (1) fotos sacadas de las tarjetas de las páginas de votación en caché (sin pedir páginas nuevas, solo los .jpg) y cruzadas por nombre + fecha de la votación con `DeputyMatcher` → `person_id`; descartado: cruzar solo por nombre, o bajar las páginas de perfil. (2) Guardado en `raw/images/delfino/deputies/` con un `index.json`; la base no cambia (descartado: tabla `deputy_photos`). (3) Script propio del explorador, `private_visuals/db_explorer/fetch_photos.py`, corrido a mano (descartado: paso del pipeline). (4) Foto en todos los avatares: lista y ficha de diputados, proponentes y miembros de órganos; sin foto, iniciales de primer nombre + primer apellido.
- Prototipo (solo nombre, sin fecha): 173 slugs de Delfino, una URL de foto por slug; 168 cruzan con una persona. Sin cruce: Shirley Díaz Mejía, José María Villalta Flórez-Estrada, Jonathan Acuña Soto, Gerarld Bogantes Rivera (typo), Kathia Calvo Cruz. Personas con foto por período: 2014–2018 4/61, 2018–2022 57/59, 2022–2026 57/58, 2026–2030 54/57.

## 2026-11-07 02:38 — Fotos de diputados en el explorador (#67)

- `private_visuals/db_explorer/fetch_photos.py`: lee las 6.757 páginas de votación en caché (todas con fecha), toma de cada tarjeta el slug, el nombre y la foto, cruza nombre + fechas con `DeputyMatcher` → `person_id` (si da más de una persona, queda sin cruce) y baja cada foto una vez a `raw/images/delfino/deputies/` (1 por segundo, `Config.USER_AGENT`, salta las ya bajadas). Escribe `index.json` con slug, nombre de Delfino, person_id, URL, archivo y primera/última votación. Corre en ~5 min (sobre todo el parseo).
- Resultado: 173 personas de Delfino, 173 fotos bajadas (9,2 MB), 0 fallidas; 168 cruzadas con el SIL. Personas con foto por período: 2014–2018 4/61, 2018–2022 57/59, 2022–2026 57/58, 2026–2030 54/57 (168 de 230).
- Sin cruce, todas por diferencias de escritura entre Delfino y el SIL: "José María Villalta Flórez-Estrada" (SIL: FLOREZ ESTRADA, sin guion), "Gerarld Bogantes Rivera" (GERALD), "Kathia Calvo Cruz" (KATTIA), "Jonathan Acuña Soto" (JOHNATAN JESÚS), "Shirley Díaz Mejía" (DÍAZ MEJÍAS). Quedan con iniciales. Son las mismas que fallan en el cruce de votos.
- `server.py`: lee el índice (`photos()`, en caché; hay que reiniciar el servidor después de correr el script), agrega `photo` (`/photos/<archivo>` o null) e `ini` a la lista y la ficha de diputados, a los proponentes y a los miembros de órganos, y sirve `/photos/<archivo>` solo para los archivos del índice (nada más de `raw/` queda expuesto), con caché de un día.
- Iniciales: primera letra del primer nombre + primera del primer apellido, saltando partículas (DE, DEL, LA, LAS, LOS, Y): "ANA LUCÍA DELGADO ORQUERA" → AD, "MARÍA DE LA CRUZ PÉREZ" → MC. Los proponentes que no son diputados siguen con las iniciales de su nombre.
- Frontend: `util.face(p, color, cls)` arma el círculo con la foto, o con las iniciales; si la foto no carga, vuelven las iniciales. Se usa en `deputies.js` (lista y ficha), `bills.js` (proponentes) y `organs.js` (miembros). Las votaciones del expediente siguen como tabla, sin avatar.
- Probado en el navegador (servidor de prueba en otro puerto, porque 8765 y 8766 seguían ocupados con código viejo): lista de diputados con fotos e iniciales (Johnatan Acuña Soto → JA), ficha sin foto (Jorge Rodríguez Araya → JR), proponentes de 23000 con fotos, `/api/deputies` 168 de 230 con foto, sin errores de consola. El servidor del usuario en 8765 hay que reiniciarlo para ver los cambios.
- En el árbol hay cambios de otro trabajo que no son de esto (`docs/bills.md`, `pipeline.py`, `database.py`, `bill.py`, `delfino_votes.py`); quedan fuera del commit.

## 2026-11-07 02:39 — Commit de las fotos de diputados (#67)

- El usuario aprobó el commit `feature: deputy photos in explorer #67` (`fetch_photos.py`, server, `js/`, css y este log; incluye el arreglo previo de etiquetas de votos en `bills.js`). Quedan fuera los cambios de otro trabajo (`docs/bills.md`, `pipeline.py`, `database.py`, `bill.py`, `delfino_votes.py`).
