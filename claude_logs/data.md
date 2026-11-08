# data

## 2026-11-06 21:57 — Descripción de expedientes desde el SIL: "Texto base" (#66, #32)

- Contexto: al pasar los expedientes de Delfino al SIL (#66) se perdió el "Propósito del Proyecto" de Delfino, y los embeddings acordados usan nombre + descripción (#32).
- Observación: la pestaña General del SIL (`consulta_ll_proyectosgeneral`) no tiene descripción; la lista solo trae el título.
- Observación: la pantalla CNSPROYECTOS tiene acciones "Texto base" (`VerTextoBaseSQL`, .docx), "Texto base PDF", "Texto decreto", "Texto actualizado mociones 137" y "Ver expediente digital".
  - Se descarga con `POST SIL_CNSPROYECTOS_PRINCIPAL/Procesar` (campos `accion`, `marco=consulta_ll_proyectos`, `adjuntos=[]`, `datos={"seleccion":[{IdPROYECTO_DE_LEY, Numero_Proyecto}],marco,accion}`, todos `base64|`) → id → `GET Utilidades/DescargarArchivo?id=…`.
  - 13/13 expedientes de prueba (20001–25897) tienen el .docx; el PDF falta en los viejos (20500, 23000: "[30016] No existe un texto asociado").
  - El .docx trae título, proponentes, la exposición de motivos (de "ASAMBLEA LEGISLATIVA:" a "DECRETA") y el articulado. 1.900–5.900 palabras en la muestra. El primer párrafo a veces resume ("La presente iniciativa propone…", 25481) y a veces solo cuenta antecedentes (20500, 23000).
  - Costo estimado: 2 requests más por expediente (~65 min extra con 3 sesiones); .docx de 40–130 KB.
- Pendiente de decisión del usuario: qué guardar como descripción (exposición completa, primer párrafo, o resumen generado). Recomendado: exposición completa, guardando texto extraído y no el .docx.
- 21:57: el usuario propone partir el texto base en chunks y probar promedio vs máximo para los embeddings. Se le respondió con pros/contras (ver entrada siguiente si se decide algo). Nada implementado aún.

## 2026-11-06 23:55 — Prueba: extraer la exposición de motivos del texto base (#32, #66)

- Pregunta del usuario: si se puede garantizar la extracción de los motivos (opción b). Respuesta: garantía no, pero se midió en una muestra.
- Se hizo un script temporal en el scratchpad, que no está en el repo. Usa `AsambleaFetcher` + `Procesar` (`VerTextoBaseSQL`) + `DescargarArchivo`. Muestra: 60 expedientes con semilla 7, mitad del oro y mitad de todo el catálogo. 10 de los más nuevos (25647+) no se pudieron probar porque no tienen la pestaña general en caché (la corrida del SIL sigue incompleta).
- Resultado: 50 .docx bajados y 1 sin texto ("[30016] No existe un texto asociado", 24514). De los 50, la exposición sale en 48 con los marcadores "ASAMBLEA LEGISLATIVA:" → "DECRETA" / "ACUERDA". "ACUERDA" hacía falta para los proyectos de acuerdo (reforma del reglamento, ciudadano distinguido).
- Sin exposición: 20475 (comisión especial investigadora, solo una nota) y 20506 (presupuesto: "el contenido no se incluye en el sistema"). En total 48/51 = 94 %. Para estos casos el respaldo sería usar solo el nombre.
- Largo de la exposición: mediana 1.412 palabras, p90 3.445, máx. 4.199 (≈6 k tokens), así que siempre cabe en 8000. 21/48 pasan de ~1.500 palabras (≈2048 tokens): un corte en 2048 truncaría al 44 %. Texto completo: mediana 2.256 palabras, máx. 17.171.
- Peso de los .docx: 9,9 MB para 50 (≈200 KB c/u, algunos de 1–3 MB por imágenes) → ~1,2 GB si se guardan todos; el texto extraído pesa mucho menos.
- Nueva recomendación: embeber la exposición completa (≤ 8000) en vez de cortarla en 2048 (~15 M tokens por modelo, ~1–1,5 h).

## 2026-11-06 00:10 — Diseño del extractor de texto base (#66, #32)

- Decidido por el usuario: embeber la exposición de motivos completa (≤ 8000 tokens, sin cortar en 2048). No guardar el .docx, solo el texto (.txt o en la base). El extractor va como un método más de las clases del SIL. El usuario lo correrá cuando termine la corrida de expedientes, que ya casi acaba.
- Propuesta presentada, pendiente de confirmación:
  - `AsambleaFetcher.fetch_bill_text` (Procesar `VerTextoBaseSQL` + `DescargarArchivo`, con el `IdPROYECTO_DE_LEY` de la pestaña general en caché). El .docx se lee en memoria con zipfile, sin dependencias nuevas, y se guarda el texto completo como caché en `raw/text/asamblea/bills/`.
  - `AsambleaParser.parse_bill_text` separa la exposición.
  - Bloque 4 en `fetch_asamblea`, con 3 sesiones y su propia barra.
  - Tabla `bill_texts` (number, exposition, status, total_words, exposition_words), con el texto completo solo en la caché raw.
  - Estados: ok / no_exposition / no_text. El "sin texto" (30016) también se guarda en caché para no reintentarlo.
  - El texto base no cambia, así que no se refresca.
  - Docs en `docs/bills.md` y `docs/asamblea.md`.

## 2026-11-06 23:44 — Corrida de asamblea cae en parse_int por Numero_Archivado no entero

- `scrap_and_save_asamblea` terminó las descargas (bills 5,898/5,898, 3h10m) y cayó al parsear: `parse_int("16605.1")` en `asamblea_parser.parse_bill` (`Numero_Archivado`).
- Revisión de la caché (pestañas General): 3247 vacíos, 2658 enteros, 2 raros: `16605.1` (iniciado 05/09/2019) y `16335.` (03/04/2020). Son typos/valores sucios del SIL.
- Las descargas quedaron en caché, así que repetir no vuelve a bajar nada.
- Pendiente decidir con el usuario cómo tratarlos (parte entera + aviso, texto, o None); no se tocó código.

## 2026-11-06 23:52 — Numero_Archivado: parte entera + aviso (#66)

- Decisión del usuario: opción 1 (parte entera + aviso). Se descartó guardarlo como texto (cambia el esquema por 2 casos) y dejarlo en None (los marcaría "in progress", lo que es incorrecto).
- `parse_archive_number` en `tools/scraping_tools/asamblea_parser.py`: enteros como antes; "16605.1" → 16605, "16335." → 16335 con `logger.warning` (logger "cr", va al log de la corrida). Cualquier otro valor no numérico sigue lanzando ValueError, para no tragar datos raros nuevos sin verlos.
- Probado sobre los valores sueltos; falta volver a correr `scrap_and_save_asamblea` (todo sale de la caché).
- Salvedad en `docs/bills.md` y comentario en #66.

## 2026-11-06 00:45 — Extractor de texto base implementado (#66, #32)

- El usuario aprobó el diseño completo: texto en `raw/text/asamblea/bills/<n>.txt`, tabla nueva `bill_texts`, estados ok / no_exposition / no_text, sin refresco, bloque 4 dentro de `scrap_and_save_asamblea`.
- Implementado:
  - `AsambleaFetcher.fetch_bill_text` / `bill_text_file_id` / `load_bill_text` / `save_bill_text`, y `docx_text` (zipfile + regex sobre word/document.xml, sin dependencias nuevas).
  - `AsambleaParser.parse_bill_text`, que además quita la línea "LA ASAMBLEA LEGISLATIVA DE LA REPÚBLICA DE COSTA RICA" que va justo antes de DECRETA.
  - Campos nuevos en `Bill` y la tabla `bill_texts`, que se reemplaza junto con las otras tablas de expedientes.
  - `Pipeline.fetch_in_sessions`, un helper común; `fetch_sil_bills` ahora lo usa y `fetch_sil_bill_texts` es el bloque 4.
  - `Config.RAW_TEXT_DIR`, y la documentación en `docs/bills.md` y `docs/asamblea.md`.
- Respuesta del SIL a `Procesar`: `resultadosServiciosIU[{accion: "archivoAbrir", id}]`; sin texto, viene en `Mensajes` "[30016]".
- Pruebas: 6 expedientes reales con caché temporal y base de prueba en el scratchpad (25481 ok, 24514 no_text, 20506 y 20475 no_exposition, 20593 y 24774 ok con ACUERDA). Re-parseo de los 50 .docx de la muestra: 48 ok y 2 no_exposition; todas las exposiciones terminan en la fórmula "Por las razones expuestas, sometemos…". El bloque en paralelo se probó con 3 números; uno inexistente se avisa y se salta. Quedaron 2 textos reales en la caché (`raw/text/asamblea/bills/`).
- No se corrió la descarga completa: la corrida de expedientes del usuario sigue en curso.
- Ojo: en `asamblea_parser.py` hay cambios que no son de esta sesión (`parse_archive_number`, para números de archivo como "16605.1", y un logger). Hay que decidir si van en el mismo commit.

## 2026-11-06 00:55 — Commit del extractor de texto base (#66, #32)

- Commit f11e3c6 `feature: sil bill base texts #66 #32`. El usuario eligió un solo commit, que incluye también el arreglo de `parse_archive_number` hecho fuera de esta sesión.
- Pendiente: correr `scrap_and_save_asamblea()` cuando termine la corrida de expedientes, comentar en #66 los conteos reales por estado y después volver al `EmbeddingRunner`.

## 2026-11-07 01:05 — Auditoría de la base antes de los embeddings (#66, #16, #32, #22)

Pedido del usuario: buscar anomalías en expedientes y noticias antes de embeber. Solo lectura sobre `databases/private_corpus.db` (scripts temporales en el scratchpad); no se tocó código ni datos.

**Expedientes (5.898, 20000–25897, sin huecos, todos con fecha y nombre):**
- `bill_texts` completo: 5.277 ok, 398 no_exposition, 223 no_text. Los no_text / no_exposition son casi todos comisiones investigadoras, nombramientos, atraques y presupuestos (no tienen exposición). En proyectos ordinarios: 102 no_exposition y 14 no_text.
- Recuperables: ~92 de los 107 no_exposition de tipos con exposición (ordinarios, reglamento, constitucionales, honores) no tienen la línea "ASAMBLEA LEGISLATIVA:", pero sí "EXPOSICIÓN DE MOTIVOS" o una línea "Expediente N.º" justo antes del texto, y luego DECRETA (p. ej. 20025, 20057, 20810, 25697).
- Del oro: 549 expedientes con exposición, 13 no_exposition, 15 no_text (caerían a solo nombre).
- Exposiciones largas: 188 pasan de 5.500 palabras (no caben en 8.192 tokens; contradice la muestra de 51, máx. 4.199). Las más grandes son presupuestos (23318, 23912, 24535, 25177, 25754: 100–150 mil palabras de cuadros) y proyectos con anexos técnicos (22583, 25591). Revisados: no es falla de marcadores, el texto realmente está antes de DECRETA. Total ok ≈ 10,2 M palabras.
- Exposiciones cortas en textos largos (4) y exposición ≈ texto completo (52): revisados, son legítimos (acuerdos con articulado corto).
- `status` subestima los archivados: 255 expedientes "in progress" sin `archive_number` tienen un paso "ARCHIVO…" en `bill_steps` (165 de ellos como último paso). 195 "in progress" tienen el plazo cuatrienal vencido.
- 11 leyes con `archive_number` (la ley gana; 21454 tiene archive_number = law_number = 10318, typo del SIL). 9 expedientes en `organ_bills` con estado law/archived (vetos, consultas).
- Fechas sucias del SIL: 3 vencimientos antes de la presentación (20976 con `date_expiry` 1900-06-12); 113 pasos con fecha anterior a la presentación (21283/21284/22873: exactamente un año antes, typo de año); 4 pasos con fecha futura (órdenes del día programadas).
- 56 sin materias (25 de 2026, normal), 6 sin pasos, 408 sin proponentes (comisiones, nombramientos, atraques). Proponentes sin `deputy_id`: 571, todos "PODER EJECUTIVO" o "PLENARIO LEGISLATIVO", o sea el cruce con diputados está completo.
- `votes` y `vote_deputies` están vacías: nunca se corrió la lista de votaciones (no existe `raw/links/delfino/votes_list.json`; hay 5.019 páginas de votos en caché de la caminata vieja).
- `news_bill_links`: 2 enlaces a números fuera de `bills` (19576, anterior a 20000; 256288, typo en Delfino).

**Noticias (29.875; mayo–oct 2026, todas dentro del período):**
- Cobertura diaria sin huecos en CRHoy, Nación y El Mundo. Delfino tiene 5 días en 0 (domingos/sábados) y Semanario 28 (fines de semana): parece normal.
- CRHoy: 174 Partial sin contenido (163 de opinión); 540 notas < 500 caracteres (breves de sucesos). Títulos repetidos: lotería, chances, "La frase del día".
- Delfino: 80 pares url / url-2 con el mismo título; la -2 es un resumen (La Jornada, deportes) que reusa el titular de la nota principal y la contiene junto con otras. Boilerplate: aviso de opinión en ~1.200 notas, "Los detalles en …".
- Nación: 101 filas con contenido idéntico a otra (notas evergreen republicadas con otra url y fecha). 622 publicadas exactamente a las 05:00 o 06:00 (edición programada, parece real). Boilerplate: aviso de IA en 788 notas, instrucciones del Foro (~180).
- El Mundo: 2.749 de 3.388 siguen con la data line `(elmundo.cr)` / `(dpa)` al inicio (pendiente de #16).
- Semanario: `author` vacío en las 2.222 notas.
- 2 contenidos compartidos entre medios; ninguna url duplicada tras normalizar.

Pendiente de decisión del usuario (no se implementó nada): recuperar exposiciones con el marcador alternativo, recalcular `status` con los pasos de archivo, qué hacer con duplicados (-2 de Delfino, republicaciones de Nación), limpiar boilerplate antes de embeber, Semanario sin autor, y correr los votos.

## 2026-11-07 01:30 — Recuperar exposiciones: prueba de marcadores alternativos (#66, #32)

- El usuario eligió empezar por recuperar exposiciones. Prueba en scratchpad sobre la caché `raw/text/asamblea/bills/` (sin tocar código).
- Causa principal: typos en el encabezado de inicio, que hoy se exige exacto (`^ASAMBLEALEGISLATIVA:?$`): "ASAMBLEA LEGISTATIVA:" (22), "ASAMBLEA LEGISLATIVA." (5), "LEGISLTIVA" (4), "LA ASAMBLEA LEGISLATIVA:" (5), "LEGISTIVA" (3), "ASAMBELA" (2), "LEGISLATIVO", "LESGISLATIVA". Otros no tienen encabezado y empiezan tras "EXPOSICIÓN DE MOTIVOS" o tras la línea "Expediente N.º …".
- Reglas probadas, en orden y solo cuando falla la actual: (b) encabezado tolerante (sin "LA" inicial ni puntuación final, largo 17–21, similitud ≥ 0,85 con ASAMBLEALEGISLATIVA, el último antes de DECRETA); (c) última línea "EXPOSICIÓN DE MOTIVOS"; (d) última línea "Expediente N.º" antes de DECRETA. Fin: además de DECRETA/ACUERDA, "DECRETAN"/"ACUERDAN".
- Resultado: 120 recuperadas de 398 no_exposition (44 por b, 45 por c, 31 por d); 93 no son presupuestos y 27 sí. 12 son del oro. Mediana 1.753 palabras. Quedan ~10 ordinarios sin marcador de fin (p. ej. 20693, 21076, 21872: no tienen DECRETA) y 2 con cuerpo < 50 palabras.
- Ruido: con la regla (d) a veces entran 1–3 líneas de portada al inicio (23038, 24513).
- Las ok actuales no cambian (las reglas nuevas solo se aplican si falla la actual).
- Decisiones abiertas presentadas al usuario: reglas y orden, si se marca de dónde salió la exposición, presupuestos, y cómo re-parsear.

## 2026-11-07 01:55 — Respuestas sobre exposiciones y revisión de presupuestos y anómalos (#66, #32)

- Decidido por el usuario: (1) las tres reglas de inicio alternativas (encabezado con typos, "EXPOSICIÓN DE MOTIVOS", "Expediente N.º") más DECRETAN/ACUERDAN; (2) opción A: status `ok`, sin columna nueva, salvedad en docs y #66; (5) re-parsear con `scrap_and_save_asamblea()`. (3) El usuario quiere intentar embeber también los presupuestos.
- Presupuestos (59): sí tienen motivos en prosa al inicio (contexto macro, objetivos, explicación por artículo), bajo "EXPOSICIÓN DE MOTIVOS" (a veces "EXPOSICIÓN DE MOTIVOS PROYECTO DE LEY" en la misma línea, o "PRESENTACIÓN"), y terminan en "LA ASAMBLEA LEGISLATIVA DE LA REPÚBLICA DE COSTA RICA DECRETA: <título>" en una sola línea (que la regla de fin actual no reconoce).
- Hallazgo: en los 11 presupuestos hoy "ok" la exposición guardada está mal. "ASAMBLEA LEGISLATIVA:" aparece por primera vez dentro de los cuadros (p. ej. línea 1.446 de 25754, como nombre de institución), así que la exposición empieza a mitad de los cuadros y se pierde la prosa del inicio (25754 tiene la prosa en las líneas 105–230).
- 10 presupuestos (2016–2019) no tienen texto: "Por su naturaleza el contenido de este expediente no se incluye en el sistema" (legajo físico). 22174 no tiene encabezado: empieza con siglas.
- Anómalos no presupuestarios restantes (15):
  - Sin texto real: 20009, 20964, 20979 (presupuestos mal tipificados como ordinarios, "no se incluye en el sistema"), 20756 y 20757 (retirados, "carece de interés actual"), 22263 (retirado), 21914 (nota de la Secretaría).
  - Con exposición pero sin DECRETA (pasan directo de los motivos a "ARTÍCULO 1" / "TÍTULO I", o a "LA ASAMBLEA LEGISLATIVA DE LA REPÚBLICA DE COSTA RICA" sin DECRETA): 20693 (Ley de Empleo Público), 21872, 23953, 24281, 21076, 20537. 22214 tiene DECRETA, pero ninguno de los marcadores de inicio.
- Propuestas nuevas presentadas (pendientes): fin alternativo en el encabezado "LA ASAMBLEA… COSTA RICA" o en la primera línea "ARTÍCULO 1" / "TÍTULO I" / "CAPÍTULO I"; aceptar "…DECRETA: <texto>" en una línea; regla para presupuestos que empiece en "EXPOSICIÓN DE MOTIVOS" o "PRESENTACIÓN" y no en "ASAMBLEA LEGISLATIVA:".

## 2026-11-07 02:30 — Exposiciones recuperadas: implementado y re-parseado (#66, #32)

- El usuario aprobó las reglas A (presupuestos) y B (fin sin DECRETA) junto con las de inicio alternativo.
- Implementado en `tools/scraping_tools/asamblea_parser.py`: `exposition_bounds` (con los fallbacks, que solo se usan si fallan los marcadores de siempre), `budget_exposition_bounds`, `is_misspelled_heading` (difflib, similitud ≥ 0,85, largo ±2), `last_match`, `trim_end_header` y `words_between`. `parse_bill_text` ahora usa `bill.file_type`.
- Corrección en la marcha: se descartó "DECRETAN" como marcador de fin, porque cortaba 5 exposiciones buenas (21137, 22398, 24186, 24365, 24468) en decretos ejecutivos citados dentro de los motivos. Cambió el diseño propuesto a las 01:30.
- Presupuestos: empiezan en el primer párrafo de prosa (≥ 25 palabras) después de "EXPOSICIÓN DE MOTIVOS" / "PRESENTACIÓN", así que quedan fuera la portada y el índice.
- Verificación sobre la caché completa antes de correr: ninguna exposición ok que no sea de presupuesto cambió. Se respaldó la base en el scratchpad.
- Se corrió `Pipeline().scrap_and_save_asamblea()` con `.venv` (todo desde la caché, no había expedientes nuevos). `bill_texts`: 5.411 ok (antes 5.277; 134 recuperadas, 36 de ellas presupuestos, y los 11 presupuestos que ya estaban ok ahora empiezan en la prosa), 264 no_exposition, 223 no_text. Oro: 561 ok, 1 no_exposition, 15 no_text. 216 exposiciones pasan de 5.500 palabras.
- Recuperadas, entre otras: 20693 (Empleo Público), 21872, 23953, 21076, 20537, 22174 (presupuesto 2021). Siguen sin exposición: 24281 (sin encabezado), 22214 (sin ningún marcador de inicio) y los textos que son solo una nota.
- Ojo: la python global no tiene las dependencias; hay que usar `.venv/Scripts/python.exe`.
- Docs: `docs/bills.md` (fallbacks, presupuestos, conteos de la corrida completa).

## 2026-11-07 01:37 — Commit de exposiciones (#66, #32)

- Commit 2a8c593 `feature: fallback exposition markers #66 #32` (parser, docs/bills.md, logs del 6 y 7 de nov).
- Corrección: las entradas "01:55" y "02:30" de hoy tienen horas estimadas que están mal; en realidad fueron antes de esta (01:37).

## 2026-11-07 02:50 — Qué pasó con las votaciones (#22, #66)

- El usuario preguntó por qué no hay votaciones si se descargaron de Delfino.
- Historia: la corrida completa del 2026-11-06 (08:11, `logs/run_2026-11-06_004205.log`) sí guardó 271.410 votos de diputados, pero en la tabla vieja `bill_votes`, que venía de recorrer las páginas de proyecto de Delfino. Luego el commit 4534050 (#66 #22) cambió los expedientes al SIL y los votos a la lista de votaciones de Delfino (`votes` / `vote_deputies`). `Database.drop_delfino_bill_tables()` borra las tablas viejas (incluida `bill_votes`) cuando detecta el esquema viejo, y eso pasó en la corrida del SIL (2026-11-07 00:54). Las tablas nuevas solo se llenan en `scrap_and_save` (la corrida completa de noticias), que no se ha vuelto a correr; tampoco existe `raw/links/delfino/votes_list.json`.
- Nada descargado se perdió: `raw/html/delfino/asamblea/votes/` tiene 5.019 páginas (descargadas el 2026-11-06 entre 03:00 y 04:04), ninguna de error. Con `DelfinoVotesParser.parse_vote_page` dan 271.752 votos de diputados; solo 3 páginas sin diputados. Cubren 1.995 expedientes (20000–25864), de 2018 a 2026.
- Cada página trae el número de expediente, la fecha de la sesión, el tipo de votación y una URL canónica. Por tipo: 4.540 `proyecto`, 373 `plena` (comisiones plenas) y 106 `eleccion`. La lista de votaciones nueva solo reconoce `/votaciones/proyecto/<id>`, así que las de plena y elección quedarían fuera.
- Opciones presentadas al usuario (pendiente): (A) correr solo la parte de votos del pipeline (lista de Delfino, ~460 páginas; las páginas de votación ya están en caché) y guardar; (B) reconstruir los votos solo desde la caché, sin red, con un parser de metadatos nuevo.

## 2026-11-07 03:15 — Corrida de solo votos: más lenta y con menos historia de lo esperado (#22, #66)

- El usuario eligió la opción A. Se corrió solo la parte de votos del pipeline con un script en el scratchpad (`scrap_delfino_votes` → `replace_vote_tables` → `link_vote_deputies`), sin noticias.
- La lista de votaciones de Delfino terminó rápido: 202 páginas y 1.955 votaciones, `complete = True` en `raw/links/delfino/votes_list.json`. Pero **solo llega hasta el 2026-06-10**: la lista no tiene votaciones anteriores.
- Error de estimación (mío): dije ~8 min suponiendo que las páginas de votación ya estaban en caché. No lo estaban. Las 5.019 viejas se guardaron con las URLs de la caminata por proyectos, que no coinciden con `/votaciones/proyecto/<id>` de la lista, así que se están bajando todas de nuevo (~1 por segundo, ~35 min en total).
- Consecuencia: la opción A da ~1.955 votaciones de jun–nov 2026, contra 2018–2026 (271.752 votos de diputados) en la caché vieja. Pendiente de mostrarle al usuario los números finales y reconsiderar la opción B.

## 2026-11-07 02:16 — Votos cargados desde la lista de Delfino (#22, #66, #67)

- La corrida de solo votos terminó (log `logs/run_2026-11-07_014252.log`): 1.955 votaciones de 87 expedientes (2026-06-10 a 2026-11-05) y 111.378 votos de diputados. Resultados: 1.810 rechazadas, 140 aprobadas, 5 anuladas. Valores: against 77.925, for 17.708, absent 15.731, más 12 "Abstención" y 2 "Ausente (pierde dieta)".
- Cruce con diputados: 105.516 de 111.378. Los 5.862 sin cruce vienen de 3 nombres: "Gerarld Bogantes Rivera" (typo de Delfino), "José María Villalta Flórez-Estrada" y "Kathia Calvo Cruz". La votación 20261103003 (expediente 25754) no trae diputados.
- Las páginas de votación se bajaron todas de nuevo: las 5.019 viejas están guardadas con otras URLs. La carpeta quedó con 6.672 archivos.
- Explorador: el usuario ya había reorganizado la página en `js/` con pestañas de diputados, órganos y noticias (commits 5ea7b17 y 94e2cfe). Se arregló `js/bills.js`: los votos se guardan como for/against/absent y la página esperaba etiquetas en español, así que salían en inglés y sin color. Ahora dicen A favor / En contra / Ausente. Verificado en el navegador con 25754.
- Comentario con la salvedad en #22. Pendiente de decisión del usuario: reconstruir los votos de 2018 a mayo de 2026 desde la caché vieja.

## 2026-11-07 02:21 — Diseño: votos históricos desde la caché vieja (#22)

- El usuario pidió diseñar la opción B. Solo se inspeccionó la caché (scripts en el scratchpad); no hay código nuevo.
- De las 5.019 páginas viejas, 217 tienen la misma URL que votos de la lista (se reusaron); quedan 4.802 fuera de la lista: 4.323 `proyecto` (2018-05-17 a 2026-06-09, 1.799 expedientes), 373 `plena` (comisiones plenas, 2024-09-18 a 2026-04-08, 136 expedientes) y 106 `eleccion` (nombramientos, 2023-08-28 a 2026-06-10, 21 expedientes). Todas de expedientes ≥ 20000.
- Sin solapamiento ni choques: ningún id viejo está en la lista ni se repite entre tipos. Los `proyecto` viejos terminan el 2026-06-09 y la lista empieza el 2026-06-10.
- Cada página trae todo lo que pide `votes`: id y URL canónica, fecha de la sesión, tipo de votación (p. ej. "Dispensa de trámites (art. 177)", "Segundo debate en comisión Plena III", "Nombramiento"), expediente, descripción, resultado y los grupos de diputados. En las elecciones los grupos son candidatos ("Andrea Álvarez Marín - 39", "En blanco - 14"), no a favor / en contra.
- Ids de dos largos: 11 dígitos (20251203001) y 9 (202203103); se guardan como texto, igual que ahora.
- Salvedad: la caché vieja salió de recorrer las páginas de proyecto de Delfino, así que no se puede confirmar que tenga todas las votaciones de 2018 a junio de 2026.
- Decisiones abiertas presentadas al usuario: qué tipos incluir, columna `kind`, si va al pipeline o es una carga única, índice JSON para no re-parsear, y cómo documentarlo.

## 2026-11-07 02:22 — Decisiones sobre los votos históricos (#22)

- Decidido por el usuario (todas las recomendadas): (1) entran las votaciones del Plenario y las de comisiones plenas (4.696); las 106 elecciones quedan fuera. (2) Columna nueva `kind` en `votes`. (3) Va en el pipeline: `scrap_delfino_votes` suma los votos de la caché vieja a los de la lista, para que la corrida completa no los borre. (4) Índice `raw/links/delfino/votes_history.json` generado una vez desde la caché.
- Pendiente de confirmar antes de implementar: valores de `kind` en inglés (`plenary` / `full_committee`), salvedad de completitud en #22 y `docs/bills.md`, y que el explorador muestre el tipo.

## 2026-11-07 02:24 — Corrección: la lista de votaciones sí llega a 2019; el pipeline paró antes (#22)

- Al leer `docs/bills.md` ("from 2019, ~1,100 pages") se revisó la lista en vivo (3 requests): la página 202 trae votaciones del 10–11 de junio de 2026; la **203 trae solo enlaces `/votaciones/eleccion/…`** (elecciones del 10 de junio); la 500 trae votaciones de proyecto de octubre de 2024.
- Causa: `scrap_delfino_votes` da la lista por terminada (`complete = True`) cuando una página no tiene enlaces `/votaciones/proyecto/<id>`, y `VOTE_LINK_REGEX` solo reconoce ese tipo. La página 203, solo con elecciones, cortó la lectura. **Corrige la entrada de las 03:15**: la lista no termina en junio de 2026.
- **También corrige** la explicación de la descarga lenta: las páginas viejas sí están guardadas con la URL canónica (400 de 400 revisadas), la misma que usa la lista. Se bajaron 1.653 páginas porque eran votaciones de jun–nov 2026, que la caminata vieja no tenía, no por URLs distintas.
- Consecuencia: leer la lista completa reusaría casi toda la caché vieja y además traería votaciones que la caminata vieja no vio. Eso reemplazaría el diseño de reconstrucción desde la caché (índice JSON y parser de metadatos). Se pausa la implementación para consultar al usuario.

## 2026-11-07 02:25 — Decisión: arreglar la lectura de la lista (#22)

- El usuario eligió arreglar la lista en vez de reconstruir desde la caché: la lista reconoce votaciones `proyecto`, `plena` y `eleccion` y solo se da por terminada cuando una página no trae ninguna. Se guarda `kind` y las elecciones se descartan al guardar. Se descartan el índice `votes_history.json` y el parser de metadatos de páginas.
- Se sigue leyendo desde la página 202: hay que reabrir `raw/links/delfino/votes_list.json` (`complete` quedó en true por el error).

## 2026-11-07 02:28 — Implementación: la lista reconoce todos los tipos de votación (#22)

- `tools/scraping_tools/delfino_votes.py`: `VOTE_LINK_REGEX` acepta `/votaciones/<tipo>/<id>` de cualquier tipo, `VOTE_KINDS` traduce proyecto → plenary, plena → full_committee, eleccion → election, mocion → motion (un tipo desconocido conserva la palabra de Delfino). La URL guardada usa el tipo de la tarjeta. `has_vote_cards()` decide el fin de la lista con enlaces de cualquier tipo.
- Hallazgo al probar en vivo: existe un cuarto tipo, `mocion` (p. ej. "Moción de sesión extraordinaria (art. 32)", página 350): mociones del Plenario sin expediente. Quedan fuera solas porque no tienen número de expediente (se registran en el log, como antes). Sin elecciones ni mociones, la página 350 da 7 votaciones de proyecto.
- `Vote.kind` (por defecto plenary); `vote_to_json` / `vote_from_json` lo guardan (las entradas viejas del JSON se leen como plenary). `pipeline.KEPT_VOTE_KINDS = {plenary, full_committee}` filtra antes de bajar las páginas de votación. El log de la corrida da el conteo por tipo y cuántas elecciones quedaron fuera.
- `votes.kind TEXT NOT NULL DEFAULT 'plenary'`, con `add_missing_vote_columns()` para tablas viejas (ALTER al final) y el INSERT con columnas explícitas.
- Estado reabierto a mano: `votes_list.json` con `complete = false` y `last_page = 1`, para releer también las páginas 1–202 y recoger las plenas que se saltaron.
- Explorador: etiqueta Plenario / Comisión plena en cada votación. `docs/bills.md` actualizado (campo kind, tipos de la lista, condición de fin, caché por URL canónica).
- Corriendo de nuevo solo los votos.

## 2026-11-07 03:33 — Votos completos cargados (#22)

- Corrida de solo votos (`logs/run_2026-11-07_022724.log`, 02:27–03:32): la lista se leyó entera (1.042 páginas, 9.693 votaciones desde 2018-05-10: 9.034 plenary, 411 full_committee, 248 election en el JSON; 725 mociones sin expediente saltadas).
- Guardado: 9.285 votaciones de 1.990 expedientes (8.876 plenary del 2018-05-17 al 2026-11-05; 409 full_committee del 2024-09-18 al 2026-04-08) y 513.432 votos de diputados (for 206.630, against 189.267, absent 117.279, Abstención 225, Ausente (pierde dieta) 31). Resultados: 5.009 Rechazado, 4.243 Aprobado, 20 Anulado, 13 Empate. Ninguna votación de un expediente ausente en `bills`.
- De las 9.285 páginas, 6.970 salieron de la caché vieja y 2.315 se bajaron. La caminata vieja tenía solo la mitad de las votaciones (los años 2018–2022 coinciden exactos; faltaban sobre todo 2023, 2025 y 2026), así que no hace falta reconstruir nada desde ella.
- Cruce con diputados: 498.468 de 513.432; 6 nombres sin cruce (Gerarld Bogantes Rivera, Cynthia Córdoba Serrano, Jonathan Acuña Soto, José María Villalta Flórez-Estrada, Kathia Calvo Cruz, Shirley Díaz Mejía). Varios son diputados reales: revisar el matcher queda como posible tarea aparte.
- 5 votaciones sin diputados. Las tarjetas de comisión plena no dicen cuál plena (solo el encabezado de la página de votación).
- Explorador reiniciado y verificado con 23576 (2 votaciones "Comisión plena"); sin errores de consola. Comentario de corrección en #22; `docs/bills.md` con los números.

## 2026-11-07 03:34 — Commit de la lista completa de votos (#22, #66)

- Por pedido del usuario: commit con `pipeline.py`, `database.py`, `bill.py`, `delfino_votes.py`, `docs/bills.md` y este log, ligado a #22 y #66 sin closes (los dos siguen abiertos por otros temas).

## 2026-11-07 03:37 — Por qué 6 nombres de Delfino no cruzan con diputados (#22, #65)

- Pedido del usuario. Solo diagnóstico (scripts en el scratchpad); no se cambió código. `DeputyMatcher` (`tools/scraping_tools/asamblea_parser.py`) solo lo usa `link_vote_deputies`; los proponentes usan `make_deputy_index` y no se ven afectados.
- Causas, con los votos sin cruzar:
  - Guion: "José María Villalta Flórez-Estrada" contra "VILLALTA FLOREZ ESTRADA" en el SIL (3.886). `normalize_name` no trata el guion como espacio.
  - Grafías distintas entre Delfino y el SIL: "Jonathan" / "JOHNATAN JESÚS" Acuña Soto (5.082), "Gerarld" / "GERALD" Bogantes Rivera (2.105), "Kathia" / "KATTIA" Calvo Cruz (2.105), "Díaz Mejía" / "DÍAZ MEJÍAS" Shirley (1.781).
  - Fecha mal escrita en Delfino: Cynthia Córdoba Serrano tiene 2.647 votos cruzados; los 5 sin cruzar son votaciones 202407151–155 con fecha 2024-04-15, antes de que asumiera (2024-05-02), pero el id dice 2024-07-15. En total 19 votaciones tienen una fecha que no calza con su id (p. ej. 202309262–265 con fecha 2023-06-26, 202308221 con 2022-08-22).
- Simulación sobre todos los votos (solo se aplican si las reglas 1–3 no encuentran a nadie): guion como espacio + regla 4 "un solo diputado en funciones con los mismos dos apellidos" (últimas dos palabras de Delfino) + regla 5 "un solo diputado en funciones con similitud ≥ 0,85" (difflib). Cruzan los 5 nombres, y ningún cruce existente cambia. Solo quedan los 5 votos de Córdoba. Jonathan necesita la regla 4 (similitud 0,818); Shirley necesita la 5 (los apellidos difieren).
- Pendiente de decisión del usuario: reglas a agregar y qué hacer con las 19 fechas.

## 2026-11-07 03:39 — Matcher de diputados: guion, apellidos y similitud (#22)

- Decidido por el usuario: las tres reglas recomendadas, y dejar las 19 fechas de Delfino como vienen, documentadas.
- `asamblea_parser.py`: `matcher_name()` (normalize_name con el guion como espacio, solo para `DeputyMatcher`), regla 4 (un solo diputado en funciones con los mismos dos apellidos, las últimas dos palabras del nombre de Delfino) y regla 5 (un solo diputado en funciones con similitud ≥ `MATCH_SIMILARITY` = 0,85, difflib).
- Recruce sin red con un script del scratchpad (`link_vote_deputies`): 14.959 votos nuevos cruzados, 0 cruces existentes cambiados, 513.427 de 513.432. Revisado: cada nombre cayó en el diputado correcto (Villalta en sus periodos 2018–2022 y 2026–2030). Quedan los 5 votos de Córdoba (fechas de Delfino).
- Incidente: la primera versión del script armó la ruta sin ".db" y `sqlite3` creó un archivo vacío `databases/private_corpus`. Se verificó que estaba vacío y se borró; la base real no se tocó.
- `docs/bills.md` con las reglas y la salvedad de las fechas; comentario en #22.

## 2026-11-07 03:40 — Commit del matcher de diputados (#22)

- Por pedido del usuario: commit con `asamblea_parser.py`, `docs/bills.md` y este log, ligado a #22.

## 2026-11-08 00:49 — ver sample.md: la exposición de 25699 en bill_texts es la de otro expediente (#66)
