# jev — evaluador TypeSafe (Jev)

Diario del tema. Las pruebas del 2026-11-08 se escribieron en `general.md` antes de que existiera este tema; no se copian, se indexan aquí.

## 2026-11-09 10:00 — tema jev creado: índice de las pruebas del 2026-11-08 y dónde están los datos crudos (#34 #39 #43)
- Entradas en `general.md` (buscar por título con `grep -A 15`): «diseño de las preguntas a Jev» (19:22), «Costo de Jev para 29.698 noticias × K» (19:40), «Filtro previo de noticias antes de Jev» (19:54), «Prueba v2 de Jev» (20:05), «pruebas del filtro de Jev por noticia» (20:23, 20:52), «el filtro de Jev se queda con las preguntas en inglés» (21:06), «Prueba de Jev contra las etiquetas de la muestra» (21:21).
- Probabilidades por noticia o par: `results/jev/*.csv`.
- Respuestas crudas de la API (una línea por request): `results/jev/answers/answers_*.jsonl`; barrido de K: `results/jev/answers/k_sweep.json`.
- Scripts que generaron todo (antes desechables, en el scratchpad): `results/jev/scripts/`. Leen `TYPESAFE_API_KEY` de `.env`. No se guardaron los payloads con el texto de las noticias (`payloads_v1.json`, 1 MB); se regeneran con `jev_probe.py`.

## 2026-11-09 15:40 — decisión: no se amplía la muestra; la prioridad pasa a ser Jev (#34 #39 #27)

- El usuario: es un trabajo universitario y queda poco tiempo. El ranker anda bien (~0,95 en la muestra) y Jev también; según el usuario, sus errores en la prueba contra la muestra (general 2026-11-08 21:21) se explican por etiquetas mal puestas y ambigüedades que le costarían hasta a un humano. No se agregan noticias a la muestra; las siguientes pruebas son de Jev.
- Hueco principal: nunca se probó de punta a punta. Las pruebas v1/v2 usaron candidatos de relleno por TF-IDF, no el top-50 del ranker, y en 21 noticias.

## 2026-11-09 15:46 — decisión: diseño de la prueba de punta a punta (ranker top-50 → Jev) en la muestra (#34 #39)

- Prueba: las 300 noticias de la muestra, top-50 del ranker evolutivo y un request a Jev por noticia. Se compara contra las etiquetas: recall y precisión por expediente, más el acierto de «ninguno» en las negativas.
- (1) La pregunta de match se corrige: cualquier expediente del SIL cuenta (nombramientos, comisiones, Reglamento), no solo proyectos de ley.
- (2) «Mismo tema» no abre la puerta del match, pero se guarda como señal aparte. El usuario lo quiere para el análisis: el problema que trata un expediente puede tener cobertura aunque el expediente no la tenga.
- (3) Umbral fijo de 0,5 decidido de antemano; se reportan las curvas.
- (4) Se agrega la segunda ráfaga de preguntas para los pares que pasan la puerta: tono (cobertura positiva o negativa) y profundidad (bien cubierta o por encimita). El usuario quiere usarla en el reporte. Falta definir su redacción.

## 2026-11-09 15:57 — pendiente: preguntas extra de la segunda ráfaga, solo para los pares que pasan el match (#34 #39)

- El usuario aprueba el diseño de la prueba de punta a punta: clase real en tools/llm_tools/jev.py (#10), top-50 en CSV desde la máquina con los embeddings, etiquetas de hoy con re-corrida al cerrar la revisión. Pide más preguntas para los pares con match: posición de cada partido (5 escalas) y todo lo que informe sobre el expediente.
- Partidos 2026-2030 según deputy_factions: Pueblo Soberano 31, Liberación Nacional 17, Frente Amplio 7, Unidad Social Cristiana 1, Coalición Agenda Ciudadana 1.
- Propuesta de Claude (sin respuesta): Choice de 6 opciones por partido y por el Ejecutivo; Nouls de voces citadas; Choice de etapa del trámite; Nouls de contenido (explica, impacto, cifras, conflicto); género por noticia. Validación con la base: posición del partido contra sus votos en vote_deputies, etapa contra bill_steps. En el estado va la lista de diputados con su partido.

## 2026-11-09 16:01 — decisión: se aprueban todas las preguntas extra; pendiente: diseño de la clase Jev (#10 #34)

- El usuario aprueba toda la lista: postura de los 5 partidos y del Ejecutivo (Choice de 6 opciones), 6 voces citadas, etapa del trámite, 4 preguntas de contenido y género por noticia, más centralidad, postura, author_judges y new_development.
- Claude empezó a escribir código antes de acordar la clase; el usuario lo frenó. No se escribió nada. Propuesta de diseño en el chat (sin respuesta): SDK typesafe_sdk en lugar de HTTP a mano; clases separadas para la API (Jev), el contexto de la base (fichas y lista de diputados) y la corrida (reanudable, con tope de costo); 2 requests por noticia; salida en JSONL crudo más CSV en formato largo; modelo fijado a una versión.

## 2026-11-09 16:12 — Implementada la clase Jev y la prueba de punta a punta; probada con 3 noticias (#10 #34 #39)

- Código: `tools/llm_tools/jev.py` (Jev, solo API, con el SDK typesafe_sdk; reemplaza el stub de prueba), `jev_questions.py` (redacción de todas las preguntas), `jev_context.py` (fichas de expediente con los 3 primeros proponentes y su partido, y la lista de los 57 diputados 2026-2030), `jev_runner.py` (2 requests por noticia, reanudable con answers.jsonl, tope de costo, 3 hilos; escribe gate.csv, news.csv, details.csv en formato largo y run.json). `tools/retrieval_tools/candidate_ranker.py` (top-K para cualquier noticia con la receta evolucionada, solo numpy, estandariza con la media y el desvío del oro) y `tools/sample_tools/sample_labels.py` (lee el CSV exportado de la pestaña Etiquetas). Scripts: `run_candidates.py`, `run_jev.py`, `run_jev_eval.py`. Config: RANKER_RECIPE, CANDIDATES_K y JEV_*.
- Receta: semilla 7, elegida por el CV en el oro (@50 0,960 contra 0,948 de la semilla 100), no por la muestra.
- Versión: la API solo ofrece los alias jev-latest y jev-preview; se usa jev-latest y cada respuesta guarda el modelo que informa la API (hoy jev-1.14.0).
- Prueba real (3 noticias de la muestra, 12–15 candidatos de relleno al azar, 5 requests, 41.112 tokens, $0,0017): la puerta acierta en 22817; en 22388 y 23667; y da ninguno en la negativa. Se verificó que retoma sin repetir requests y que run_jev_eval corre con un CSV de etiquetas de prueba. Se borró la carpeta de prueba.
- Sin probar: `candidate_ranker.py` y `run_candidates.py`, porque en esta máquina no hay numpy ni embeddings. Tienen que correr en la otra máquina antes de la prueba de las 300.
- Evaluación: la verdad es el expediente principal más los otros mencionados; un match en un "alternativo" no cuenta como falso positivo. Salen métricas para todas y para las «Correcto», curvas de 0,05 a 0,95, resultados por medio, centralidad y una lista de errores (eval_errors.csv) para la adjudicación.

## 2026-11-09 16:25 — Ajuste de dos preguntas del detalle tras revisar la noticia del veto a mano (#34)

- Revisión manual de la nota del veto (22817, CRHoy) contra las respuestas: centralidad, postura, juicio del autor, hecho reciente, Ejecutivo, voces y contenido cuadran con el texto. Dos fallas de redacción, ajustadas con permiso del usuario:
  - «Oficialismo»: Jev atribuía a Pueblo Soberano (en contra, 0,81) el voto de la fracción oficialista de la Asamblea 2022-2026. Ahora la ficha del partido dice que la equivalencia vale solo desde mayo de 2026. Resultado: no_mentioned 0,59 (en contra 0,28).
  - `gives_figures` contaba los números de expediente como cifras: la columna de opinión daba 0,87. Ahora excluye números de expediente y de ley, fechas y votaciones. Resultado: columna 0,02–0,03; la nota del veto 0,74 (55 años, 10 años de servicio).
- Re-corrida de 2 noticias, $0,0014; se borró la carpeta de prueba.

## 2026-11-09 16:51 — Prueba de punta a punta en las 300 de la muestra: recall 0,87, precisión 0,84, «ninguno» 0,97 en las Correcto (#34 #39 #41)

- Etiquetas: CSV exportado de la pestaña Etiquetas, leído desde Descargas (no va al repo). 300 en la muestra (102 positivas, 198 negativas); 189 «Correcto» (62 positivas). Coincide con la hoja.
- run_candidates (receta de la semilla 7, en esta máquina con numpy): principal en el top-50 0,935 en las Correcto, igual que la evaluación anterior (ranker 2026-11-08 21:42); 0,90 en todas.
- run_jev: 404 requests, 11,0 M tokens, $0,46, 62 s, modelo jev-1.14.0, 2 noticias recortadas. 104 noticias con match, 153 matches.
- Umbral 0,5. Verdad = principal + otros mencionados:
  - Correcto (189): ranker 0,940; recall del pipeline 0,866 (Jev 0,921 dado que está en los candidatos); precisión 0,841; noticias positivas detectadas 0,887; «ninguno» en negativas 0,969.
  - Todas (300): ranker 0,871; recall 0,811; precisión 0,713; «ninguno» 0,934. Lo que baja son las filas Corregir/Dudoso: 35 de los 54 errores están ahí.
- Curva en Correcto: 0,3 → recall 0,90 / prec 0,58; 0,5 → 0,87 / 0,84; 0,7 → 0,76 / 0,93. El 0,5 queda en un buen punto.
- Por medio (Correcto): recall CRHoy 0,80, El Mundo 0,90, La Nación 0,92, Semanario 0,85; precisión 0,71 / 0,86 / 0,85 / 0,94. Son n chicos (12–19 positivas por medio).
- Centralidad contra la etiqueta: Central 0,87 de acuerdo, Secundario 1,00 (n 8), De paso 0,44 (n 9): Jev sobreestima las menciones de paso.
- same_topic: 191 de 198 negativas tienen algún candidato con same_topic ≥ 0,5. Entre 50 candidatos casi siempre hay uno del mismo tema, así que tal como está no sirve para separar. Hay que definir cómo se usa en el análisis.
- Errores en Correcto (11 FP, 9 FN): (1) leyes viejas o expedientes ya concluidos con el mismo tema (préstamos aprobados, la ley de violencia contra las mujeres 20308, el reglamento de hostigamiento 21372): es la decisión 8 pendiente (trámite concluido / ley vigente); (2) expedientes hermanos con el mismo nombre (dos comisiones investigadoras de hostigamiento, 25400 y 25800); (3) menciones de tipo Descripción con puntaje bajo; (4) 4 de los 9 FN no estaban en el top-50. Algunas etiquetas parecen erróneas (p. ej. sorteo 308, 23216). Resultados en results/jev/sample/ (eval_*.csv, eval_errors.csv).

## 2026-11-09 17:11 — Score de 0 a 1 y prueba de «mismo tema» estricto en el top-5 (#34 #39)

- Score de 0 a 1: el usuario lo prefiere a la escala 0–2. No hace falta volver a preguntar: `details.csv` lleva una columna `score_01` = score / nivel máximo (centralidad: 0 de paso … 1 tema principal; postura: 0 muy crítica, 0,5 neutral, 1 muy favorable). Las tablas se regeneraron desde answers.jsonl, sin requests nuevos.
- Cuidados para el reporte anotados en STATUS («Para redactar el reporte»), a pedido del usuario.
- Prueba de «mismo tema» (script en el scratchpad, no en el repo): pregunta estricta («el problema específico que el expediente busca resolver, no solo el mismo campo»), solo para los 5 primeros candidatos, un request por noticia. 300 requests, 1,06 M tokens, $0,044. Resultados en results/jev/sample/topic_probe.csv.
  - Negativas que no son «Mismo tema» (185) con algún candidato del top-5 ≥ 0,8: 60 con la pregunta vieja, 29 con la nueva. Con ≥ 0,9: de 32 a 7.
  - Etiquetas «Mismo tema» (13) detectadas con ≥ 0,8: de 8 a 2. El expediente relacionado de la etiqueta casi nunca está en el top-5 (presupuestos 25803/25754, nombramientos 25258).
  - En las positivas, el expediente principal da 0,95 de mediana (87 % ≥ 0,8).
  - Muchos de los ≥ 0,8 en negativas sí son el mismo problema concreto (tarifa de bus ↔ comisión sobre tarifas, sequía en Guanacaste ↔ préstamo de acueductos, Crucitas ↔ ley contra la minería ilegal). La pregunta es más precisa, pero el ranker no busca expedientes «del mismo tema», y hay solo 13 etiquetas para validarla.
- Lectura de Claude: no hay forma barata de validar «mismo tema» con la muestra. Recomendación: sacarlo del pipeline y dejarlo como trabajo futuro. Quitarlo de la puerta ahorra ~1/3 de las preguntas de cada request.

## 2026-11-09 17:48 — decisión: presupuesto de $20 para Jev ($5 de pruebas) y filtro de Jev sobre todo el corpus (#43 #34)

- El usuario es estudiante: el dinero va antes que el tiempo. Presupuesto total de Jev: $20; $5 para pruebas desde ahora, $15 para el resto (corpus completo).
- Gastado hoy antes de esta decisión: ~$0,51 (pruebas de la clase $0,003, muestra $0,46, mismo tema $0,044).
- Filtro previo: la pregunta de Jev por noticia (assembly) sobre las 29.698 noticias, sin el filtro de palabras. El usuario confía más en Jev que en las palabras, y cuesta ~$2 más. Se descarta la cascada estricto → Jev.
- Se autoriza la prueba de mover las definiciones de explicit/implicit al estado (sin same_topic en la puerta).

## 2026-11-09 17:50 — Prueba de definiciones en el estado: explicit aguanta, implicit se desarma; la versión intermedia ahorra ~25 % (#34 #43)

- Puerta compacta (script en el scratchpad; results/jev/sample_compact/): definiciones de mención explícita e implícita en `definitions` del estado, preguntas cortas que las citan, sin same_topic. 300 requests, 21.044 tokens por noticia (contra 34.319), $0,27 (cuenta para los $5 de pruebas).
- Resultado (Correcto, umbral 0,5): recall 0,93, pero precisión 0,28 (era 0,84) y «ninguno» 0,54 (era 0,97). Por pregunta: explicit da igual (7 falsos «sí» de 14.885 candidatos en las dos versiones); implicit sin sus criterios pasa de 46 a 348 falsos «sí». Esa definición necesita ir dentro de la pregunta.
- Versión intermedia simulada sin costo (explicit compacto + implicit de la corrida actual; results/jev/sample_hybrid_sim/): Correcto recall 0,866 (igual), precisión 0,817 (0,841), «ninguno» 0,953 (0,969). La diferencia es de ~2 falsos positivos y cabe en el ruido, pero la simulación mezcla dos estados distintos.
- Ahorro de la intermedia: explicit pasa de 605 a ~126 caracteres por candidato y se quita same_topic (160) → ~8.400 tokens menos por noticia (~25,900 en vez de 34.300).
- Costo proyectado del corpus (filtro de Jev sobre las 29.698 ≈ $2,3; pasan ~22 % ≈ 6.500; detalle ≈ $0,8): puerta actual ≈ $12,5; intermedia ≈ $10,2. Las dos caben en los $15.

## 2026-11-09 18:04 — decisión: se queda la puerta actual para el corpus (#34 #43)

- El usuario elige la puerta actual (explicit e implicit con sus criterios dentro de la pregunta) en lugar de la intermedia: el ahorro (~$2,3 en el corpus) no justifica el cambio. No se gasta la verificación de $0,33.
- Sigue abierto si same_topic se queda en la puerta (pesa ~8 % del request, ~$0,8 en el corpus filtrado).
- Gastado de los $5 de pruebas: $0,27.

## 2026-11-09 18:06 — corrección: quedan $4,02 de los $5 de pruebas, según el usuario (#34 #43)

- La cifra del usuario manda: quedan $4,02 de los $5 de pruebas ($0,98 gastados). Claude había contado $0,27 desde la decisión del presupuesto; la diferencia sale de contar también las pruebas anteriores de hoy y de que el cálculo de Claude (tokens × $0,042 por millón) puede quedarse corto frente a lo facturado.
- Implicación: si la facturación real sale más alta que las estimaciones por tokens, el corpus (~$12,5 estimado) puede acercarse a los $15. Conviene medir el costo real del filtro por noticia antes de lanzar la puerta.

## 2026-11-09 20:33 — pendiente: cómo medir el gasto real de Jev (llaves por etapa vs. bitácora de requests) (#43)

- Qué hay hoy: `jev_runner` suma `usage.input_tokens` de cada respuesta (el SDK lo define como «billable input tokens»; los output son gratis) × $0,042/M de `config.py`. El conteo de tokens es el de la API, no una estimación propia.
- Por qué puede quedarse corto frente a lo facturado: (1) los scripts sueltos del scratchpad y de results/jev/scripts/ no pasan por el runner; (2) `RetryPolicy(max_retries=4, timeout=300)`: un request que vence del lado del cliente pero el servidor sí procesa se cobraría y se reintenta, sin quedar en el conteo (no verificado); (3) el precio de config puede no ser el vigente.
- Opciones: (A) una API key por etapa (filtro, puerta, detalle, pruebas) y leer el gasto en la consola; (B) bitácora JSONL de cada request en `Jev.ask` (request_id, etapa, tokens, hora), incluidos los fallidos; (C) anotar el saldo de la consola antes y después de cada corrida. Recomendación de Claude: A + C, que no tocan código; B solo si la consola no desglosa por key.

## 2026-11-09 20:39 — pendiente: diseño del filtro de Jev sobre el corpus (primera ronda) (#43 #34)

- Universo: 29.698 noticias con extraction_status Success (177 Partial sin contenido quedan fuera); 191 pasan de 15.000 caracteres y se cortan.
- Costo por tokens: la prueba de 832 noticias dio 1,54 M tokens (~1.850 por noticia) → corpus ≈ 55 M tokens ≈ $2,3 a $0,042/M (más de los ~$1,7 que se habían anotado). Sale del saldo de $15 del corpus.
- Decisiones abiertas propuestas al usuario: (1) dónde vive el código: `Jev.filter(news)` + un runner aparte con su script; (2) la pregunta assembly tal cual se probó, con la noticia anidada bajo `news` en el formato de JevContext (las 832 de la prueba están en el corpus, así que la corrida misma muestra si el cambio mueve algo); (3) agregar o no genre al filtro; (4) guardar la probabilidad de todas y fijar el umbral después (0,2 por defecto); (5) salida en results/jev/corpus_filter/ sin texto; (6) piloto de ~300 noticias con llave propia y saldo antes/después, luego el resto con tope de $3.

## 2026-11-10 01:09 — decisión: diseño del filtro de Jev sobre el corpus, todas las recomendaciones aceptadas (#43 #34)

- `Jev.filter(news)` + `JevFilterRunner` aparte con su script; reanuda desde answers.jsonl.
- Pregunta `assembly` tal cual se probó, con la noticia anidada bajo `news` en el formato de JevContext; sin genre.
- Se guarda la probabilidad de todas las noticias; umbral por defecto 0,2, se revisa la curva antes de fijarlo.
- Salida en results/jev/corpus_filter/ sin texto. Corrida: dry-run, piloto de ~300 con llave propia y saldo antes/después, luego el resto con tope de $3. Para medir el gasto se adopta A + C (llave por etapa y saldo antes/después).

## 2026-11-10 01:10 — Implementado el filtro de Jev para el corpus (run_jev_filter.py); dry-run hecho, sin requests enviados (#43)

- `filter_questions()` en jev_questions.py (assembly, misma redacción de la prueba), `Jev.filter(news)` con estado `{"news": ...}` de JevContext, `JevFilterRunner` en tools/llm_tools/jev_filter_runner.py y `run_jev_filter.py`. `JEV_FILTER_THRESHOLD = 0.2` en config.
- Orden aleatorio fijo (semilla 2026), así que `--limit 300` es un piloto al azar; reanuda desde answers.jsonl. Salida: results/jev/corpus_filter/ (answers.jsonl, filter.csv, run.json; sin texto).
- Dry-run: 29.698 noticias; la estimación por caracteres da 31 M tokens ($1,31), pero la prueba facturó ~1.850 tokens por noticia (≈ 55 M, $2,3): la estimación por caracteres se queda corta, vale la medida. Piloto de 300 ≈ $0,02–0,03.
- Llave: el código sigue leyendo `TYPESAFE_API_KEY` de .env; para la corrida se reemplaza ahí por la llave nueva (nombre sugerido `jev-filter`).

## 2026-11-10 01:21 — Piloto del filtro: 300 noticias al azar, 71 pasan (24 %), 1.261 tokens por noticia, $0,016 por tokens (#43)

- Llave `jev-filter` (según el usuario); saldo de la consola antes del piloto: $4,02. Falta que el usuario lea el saldo después para comparar con los $0,0159 de run.json.
- Modelo jev-1.14.0, sin errores ni reintentos en el log, 2 noticias cortadas. Pasan: 76 con 0,1, 71 con 0,2, 68 con 0,3, 62 con 0,5 (pocas en la zona dudosa).
- Tokens por noticia 1.261, no 1.850: la prueba del 2026-11-08 tenía 2 preguntas. Proyección para el corpus: ~37 M tokens ≈ $1,6 por tokens; ~7.000 noticias pasarían a la puerta.

## 2026-11-10 01:27 — Piloto verificado contra la consola: 378.171 tokens en la llave jev-filter, igual que run.json; se lanza el resto del corpus (#43)

- La consola muestra exactamente los mismos tokens de input que el runner: el conteo de `usage.input_tokens` es el que se factura. El saldo sigue en $4,02 (posible retraso o redondeo con $0,016; el precio por token no se pudo confirmar desde el saldo).
- Se lanza `run_jev_filter.py --cap 3` sobre las 29.398 restantes, con la llave jev-filter.

## 2026-11-10 01:45 — Filtro de Jev sobre el corpus completo: 7.431 de 29.698 pasan (25 %), 36,7 M tokens, $1,54 por tokens (#43)

- results/jev/corpus_filter/ (answers.jsonl, filter.csv, run.json). jev-1.14.0, sin errores ni reintentos, 191 noticias cortadas. Llave jev-filter.
- Pasan por umbral: 8.150 (0,1), 7.431 (0,2), 7.054 (0,3), 6.477 (0,5). Por medio con 0,2: Nación 2.061/9.424, CRHoy 1.602/9.268, Delfino 1.327/5.397, El Mundo 1.481/3.388, Semanario 960/2.221.
- Chequeo gratis contra la prueba del 2026-11-08 (las 832 están en el corpus): diferencia media absoluta 0,01 y 4 decisiones cambian con 0,2; los 102 positivos de la muestra pasan (mínimo 0,56); oro 528/532 (antes 527). Anidar la noticia bajo `news` no movió nada.
- Falta: el usuario compara con la consola; elegir el umbral final (recomendación de Claude: 0,2, como estaba) antes de correr ranker → puerta sobre las que pasan.

## 2026-11-10 01:51 — pendiente: cierre del chat; STATUS tiene «Para retomar» con consola, umbral, commits y la corrida de la puerta (#43 #34)

- El usuario retoma en un chat nuevo. Queda en STATUS: verificar 37.045.780 tokens en la llave jev-filter, confirmar umbral 0,2, tres commits sin hacer y preparar ranker top-50 → puerta sobre las 7.431.
- Costo esperado de la puerta + detalle: la muestra costó $0,46 por 300 noticias (~$0,0015 por noticia) → ~$11 para 7.431; cabe en los ≈ $13,4 que quedan, pero justo. Hace falta separar llaves (jev-gate / jev-details) porque run_jev.py corre las dos etapas juntas.

## 2026-11-10 09:41 — Consola cuadra con run.json: 36.667.609 tokens en jev-filter, saldo $2,48 (#43)

- La consola de la llave jev-filter marca 36.667.609 tokens, igual a `input_tokens` de results/jev/corpus_filter/run.json (incluye el piloto). El 37.045.780 que quedó en STATUS era un error: sumaba el piloto dos veces.
- Saldo de la cuenta después del filtro: $2,48 = $4,02 − $1,54. El costo por tokens cuadra exacto.
- Ojo: con $2,48 no alcanza para la puerta (~$10,6). Antes de correrla hay que cargar el resto del presupuesto del corpus.

## 2026-11-10 09:41 — decisión: umbral del filtro de Jev en 0,2 (#43)

- El usuario confirma 0,2 (recomendación de Claude, ya era el valor por defecto en `Config.JEV_FILTER_THRESHOLD`). Pasan 7.431 de 29.698 noticias (25 %).
- Por qué 0,2: el filtro solo descarta y lo que pierde no se recupera después. Por eso se elige por recall y no por ahorro. Con 0,2 se pierden 4 de las 532 del oro de Delfino (528/532) y 0 de las 102 positivas de la muestra (la más baja da 0,56).
- Descartados: 0,1 (8.150 pasan, +719 noticias, ≈ +$1 de puerta, para recuperar a lo sumo 4 del oro); 0,3 (7.054, −377, ahorra ≈ $0,5) y 0,5 (6.477, −954, ≈ $1,4). Esos ahorros son chicos frente al riesgo de perder positivas que la muestra no alcanza a medir.
- Caveat para el reporte: la probabilidad viene de una sola pregunta ancha (`assembly`). Las 4 del oro que se pierden son el piso conocido de lo que el filtro deja fuera.
