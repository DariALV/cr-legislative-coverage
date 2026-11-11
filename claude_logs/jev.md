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

## 2026-11-10 09:51 — pendiente: guardar todo lo que entrega Jev y prueba de puerta + detalle en un set chico antes del corpus (#43 #34)

- El usuario pide guardar TODO lo que devuelve Jev y probar puerta + detalle en un set antes de correr las 7.431.
- Qué se guarda hoy: answers.jsonl tiene el model_dump de cada respuesta, con noul, choice, confidence, score, legend y probabilities. **El confidence sí se guardó** en las corridas de la muestra (choice y score; noul no trae confidence).
- Qué se pierde: usage.output_tokens; el cuerpo crudo de la API (el SDK usa extra="ignore" y borra los tipos de respuesta que no conoce, aunque quedan en response.raw_http_response); los headers de la respuesta; la latencia; la hora de cada request. En los CSV (gate/details) se pierden confidence y choice: answer_rows solo escribe probability, score y score_01.
- Corridas pasadas: no se puede recuperar el output_tokens ni los headers. En el filtro solo hubo noul, así que no se perdió ningún confidence.
- Propuesta de Claude (sin respuesta todavía): guardar el JSON crudo + headers + latencia + timestamp por request; preguntas una vez por corrida; columnas confidence/choice en los CSV; flag --stage gate|details; prueba con 100 noticias al azar de las 7.431.

## 2026-11-10 09:59 — decisión: guardar la respuesta cruda + metadatos por request, confidence/choice en los CSV, prueba con 100 al azar de las 7.431 (#43 #34)

- Aceptado: answers.jsonl suma raw (JSON de la API sin pasar por el SDK), output_tokens, headers, elapsed_s y requested_at; las respuestas parseadas se quedan. Columnas confidence y choice en gate.csv y details.csv. Prueba: 100 noticias al azar (con semilla) de las que pasan el filtro.
- El usuario: todas estas columnas terminan en la base pública. Falta decidir si van como columnas extra o en una tabla relacional (news_id, bill, pregunta, ...).
- Antes de la prueba, el usuario quiere revisar las preguntas y ver cuáles se pueden agregar, con su costo estimado.
- Llaves: el usuario creía que solo se puede tener una en .env porque el SDK lee TYPESAFE_API_KEY. Propuesta de Claude: variables con nombre por etapa, pasadas al cliente con api_key=.

## 2026-11-10 09:59 — Costo por pregunta medido en la muestra: ~4 caracteres de la pregunta por token; detalle = 3.294 + 2.599 por expediente (#43 #34)

- Ajuste lineal sobre las 104 requests del detalle: 3.294 tokens de base (noticia + diputados) + 2.599 por expediente (21 preguntas ≈ 7.570 caracteres + la tarjeta). Puerta: 34.319 por noticia con 50 candidatos.
- Proyección para las 7.431, suponiendo que ~45 % tienen match y 1,47 expedientes por noticia (la muestra; la prueba de 100 lo mide): puerta ≈ 255 M tokens ≈ $10,7; detalle ≈ 24 M ≈ $1,0. Total ≈ $11,7 de los ≈ $13,5 que quedan.
- Costo marginal por cada 100 tokens de pregunta: en el detalle (por expediente con match) ≈ $0,02; a nivel noticia (como genre) ≈ $0,03; en la puerta (por candidato, ×50) ≈ $1,56.

## 2026-11-10 10:10 — decisión: preguntas nuevas solo después del match; se aprueban las 6 primeras; llaves por etapa en .env (#34 #43)

- Las preguntas nuevas van en la request del detalle (después del match), nunca en la puerta por candidato. Las de nivel noticia (p. ej. press_release) se hacen una vez por noticia dentro de esa request, solo si la noticia tiene match.
- Aprobadas: press_release (noticia), in_headline, names_proponent, explains_procedure, background, deputy_quoted.
- La prueba de 100 sirve para probar muchas preguntas: en la prueba, el detalle cuesta centavos; casi todo el costo es la puerta (100 × 34k ≈ 3,4 M tokens ≈ $0,14).
- Llaves: el usuario puso en .env TYPESAFE_API_KEY_TESTS, _FILTER, _GATE y _DETAILS (ya no hay TYPESAFE_API_KEY suelta: run_jev_filter.py hay que adaptarlo). Claude elige: la etapa decide la llave; la prueba de 100 usa TESTS (es exploración), y el corpus usa GATE y DETAILS.
- Pendiente: el usuario pide más preguntas extra para la prueba; Claude propone una segunda lista.

## 2026-11-10 10:22 — Implementado: 22 preguntas nuevas post-match, guardado completo, llaves por etapa; set test100 armado; la llave TESTS da 401 (#34 #43)

- Preguntas: 4 a nivel noticia dentro de la request del detalle (press_release, main_frame, assembly_image, headline_misleading; nombres news_<pregunta>, con bill vacío en details.csv) y 18 por expediente (independents + 17 de PROCESS). El detalle queda en 39 preguntas por expediente. Lista para el usuario: results/jev/test100/questions.md.
- jev.py: Jev(key) lee TYPESAFE_API_KEY_<KEY>; JevResponse guarda output_tokens, key, requested_at (UTC), elapsed_s, headers (sin set-cookie) y raw (el JSON de la API). jev_runner: --stage both|gate|details y --key; questions.json por corrida; confidence/choice en details.csv y genre_confidence en news.csv; run.json con output_tokens y tokens_by_key. El filtro usa Jev("filter").
- Probado sin requests: se reconstruyeron las tablas a partir de una copia de results/jev/sample.
- Set: 100 al azar (random.Random(2026).sample sobre las 7.431 que pasan, sin la de CRHoy) + la nota de CRHoy «Comisión avala proyecto para combatir asociaciones narco» (baca9733…, filtro 1,0). Por medio: Nación 31, CRHoy 21, El Mundo 19, Delfino 16, Semanario 13. Candidatos top-50 en results/jev/test100/candidates.csv.
- Primer intento (--limit 3, --key tests): 401 de autenticación, sin cobro. TYPESAFE_API_KEY_TESTS mide 109 caracteres y las otras 108: puede tener un carácter de más al pegarla. Espera al usuario.

## 2026-11-10 10:28 — Prueba test100 corrida: 46 de 101 noticias con match (83 pares), 3,92 M tokens, $0,1645 con la llave TESTS (#34 #43)

- El 401 venía de la llave: el usuario pegó otra en TYPESAFE_API_KEY_TESTS y una request mínima pasó (285 tokens). Corrida con 3 noticias y después el resto, sin errores.
- El campo raw es idéntico a lo que parsea el SDK en las 147 requests: el SDK no estaba descartando nada. Lo que antes sí se perdía: output_tokens (480.556 en esta corrida), headers (x-typesafe-request-id, cf-ray, etc.), latencia y hora.
- Consola esperada en la llave tests: 3.916.403 + 285 = 3.916.688 tokens; saldo ≈ $2,48 − $0,165 ≈ $2,32.
- Tokens: puerta 34.170 por noticia; detalle 3.469 + 3.683 por expediente (antes 3.294 + 2.599), con 1,8 expedientes por noticia con match.
- Proyección al corpus (46 % con match): puerta ≈ $10,7 + detalle ≈ $1,45 = ≈ $12,1. Las 22 preguntas nuevas suman ≈ $0,35.
- Señales para revisar: independents da not_mentioned en las 83; fast_track, pressure_groups, public_opinion y voice_business casi nunca llegan a 0,5; fact_check da sí en 19 % (sospechoso); press_release en 37 %.

## 2026-11-10 11:14 — Comparación usuario vs. Jev en la nota de CRHoy (25615): coinciden en casi todo; difieren en main_frame, votes_outlook y stance (#34 #39)

- Nota baca9733… «Comisión avala proyecto para combatir asociaciones narco» → match 25615 (implicit 0,93; explicit 0,19). El usuario respondió las 47 a mano antes de ver a Jev.
- Coinciden (la mayoría por mucho): genre, explicit/implicit, press_release (sí / 0,64), headline_misleading, centrality 2, author_judges, new_development, los 4 partidos a favor + Agenda e independientes sin mención, Ejecutivo a favor (Jev: strongly), las voces, explains_content/impact, gives_figures, conflict_frame y las 17 nuevas salvo votes_outlook.
- Difieren: main_frame (usuario: human_interest o responsibility, sin seguridad; Jev: policy 1,0); votes_outlook (usuario sí por la unanimidad; Jev 0,22); stance (usuario 3–4; Jev 2,63, entre neutral y algo favorable). assembly_image: usuario «no habla de la Asamblea» = 2; Jev 2,64.
- Ambiguas en las dos partes: stage (dictaminado, pasa al Plenario: el usuario duda entre committee y first_debate; Jev first_debate 0,72 / committee 0,27); voice_institutions (¿la comisión cuenta? Jev 0,27); gives_figures con años de prisión.
- El usuario no entendió fast_track ni executive_agenda: el texto de la pregunta (y de la lista) no se entiende.
- same_topic: el usuario creía que se había removido. Sigue en la puerta; la decisión está abierta desde jev 2026-11-09 18:04 (pesa ~8 % de la puerta, ≈ $0,8 en el corpus).

## 2026-11-10 11:27 — decisión: se saca same_topic de la puerta; stage, gives_figures y executive_agenda reescritas; fast_track se queda (#34 #43)

- Sobre la comparación de CRHoy, el usuario acepta que Jev tenía razón en main_frame (no había leído las definiciones), votes_outlook (se dejó llevar por «votaron a favor») y stance (la nota es descriptiva). voice_institutions: cuenta citar, no mencionar.
- same_topic sale de la puerta (cierra el pendiente de jev 2026-11-09 18:04): GATE_QUESTIONS = explicit, implicit. run_jev_eval lee same_topic como opcional.
- stage: committee ahora incluye «la comisión dictaminó y espera al Plenario»; first_debate queda para cuando el Plenario lo discute o lo votó en primer debate (caso CRHoy 25615).
- gives_figures: las penas (años de prisión, multas) cuentan.
- fast_track se queda como está: el usuario dice que no la entendió por falta de contexto político, no porque esté mal redactada. executive_agenda se reescribe: explica qué son las sesiones extraordinarias y convocar/desconvocar, y aclara que haber propuesto el proyecto no cuenta.
- Casos dudosos para revisión manual: results/jev/test100/review_dubious.md (fact_check ≥ 0,5: 16 pares; press_release ≥ 0,5: 17 noticias). A primera vista, press_release marca columnas de opinión y entrevistas (Garnier, Kattia Calvo) y fact_check marca la nota de Nación que verifica a Fernández con 35 votaciones (esa parece correcta).

## 2026-11-10 11:31 — ver ranker.md: el ranker deja fuera expedientes nombrados por número; 3 de 34 en test100

## 2026-11-10 11:37 — ver ranker.md: candidatos = top-50 ∪ expedientes nombrados por número (2 agregados en test100)

## 2026-11-10 11:43 — pendiente: fact_check capta disputas entre fuentes (5 aciertos de 16) y press_release confunde resúmenes de proyectos (11 de 17 bien); redacciones nuevas propuestas (#34 #39)

- Dos subagentes leyeron los textos completos (casos ≥ 0,5 más contraste < 0,2). Detalle: results/jev/test100/review_fact_check_press_release.md. Las citas clave se verificaron contra el texto.
- fact_check: 5 aciertos, 3 dudosos, 8 falsos positivos. Jev responde «¿alguien disputa una afirmación?» en vez de «¿el medio verifica?». Errores: fuente contra fuente 4, contagio entre expedientes 3, institución que corrige 1, crítica opositora 1, justificación del propio voto 1, columna 1. La probabilidad no separa (el más alto, 0,88, es falso). Posibles falsos negativos en el resumen semanal de Delfino.
- press_release: 9 sí + 2 casi sí, 3 dudosas, 3 no. Errores: resumen/explicación de proyectos (plantilla de Delfino, Nación) 3, nota con contexto propio 2, columna 1. Filtrar por genre = news_report saca la columna sin perder aciertos.
- Propuesto (sin respuesta): redacciones nuevas de las dos, la regla genre + ≥ 0,6, decidir si un resumen de un proyecto recién presentado cuenta (recomendación: no) y si un editorial sin firma es la voz del medio (recomendación: sí). Validación: repetir solo el detalle sobre estas 28 noticias con la llave tests (≈ centavos).

## 2026-11-10 11:56 — Redacciones nuevas de fact_check y press_release medidas con Jev: 0 falsos positivos en las dos; fact_check pierde 2 de 5 aciertos (#34 #39)

- Aplicadas en jev_questions.py (fact_check_question con criterios, press_release nueva; un resumen de un proyecto no cuenta, y un editorial sin firma sí cuenta como voz del medio). La regla del género queda para el análisis, no en la pregunta.
- Medición: results/jev/scripts/jev_rewrite_check.py → results/jev/test100_rewrite/. Vieja y nueva en la misma request, 46 noticias con match, llave tests, 219.125 tokens ≈ $0,009. La vieja reproduce la corrida original (±0,03).
- press_release: de 11 aciertos / 6 falsos a 9 / 0. Se pierden las 2 «casi sí» (Delfino con cita de la diputada 0,23; OES-UNA 0,44).
- fact_check: de 5 aciertos / 8 falsos a 3 / 0. Se pierden la corrección a Ariel Mora (22623, de 0,85 a 0,25) y Crucitas (24717, de 0,57 a 0,17). Gana 2 probables aciertos en el resumen de Delfino (25796 y 25798) y 2 falsos en columnas de opinión, que se descartan si se ignora fact_check cuando genre = opinion. El contagio sigue en el límite (24625 0,51; 25291 0,49).
- Detalle: results/jev/test100/review_fact_check_press_release.md, «Validación».

## 2026-11-10 12:00 — pendiente: ¿tiene sentido fact_check? Es rara (~6 % de los pares), con recall no medible y recall ~3/5 (#34 #39)

- El usuario pregunta si la pregunta tiene sentido. Opinión de Claude: el concepto vale (verificación propia como indicador de calidad), pero es rara (5 aciertos en 83 pares) y difícil de definir (hasta la revisión tuvo 3 dudosos). Con 5 positivos no se puede medir el recall; lo visto es ~3/5. Atrapa más el estilo explícito («La Nación revisó»), lo que puede sesgar la comparación entre medios.
- Opciones: (a) sacarla; (b) dejarla solo como cota inferior descriptiva, sin comparar medios; (c) cambiarla por una pregunta más observable de trabajo propio (own_evidence: la nota usa documentos o datos que el medio consultó —votaciones, texto del proyecto, presupuestos— además de declaraciones). Recomendación: (c), o (b) si el reporte necesita hablar de verificación. Sin respuesta.

## 2026-11-10 12:03 — decisión: se quita fact_check; pendiente: qué otras preguntas quitar, arreglar o agregar (#34 #39)

- El usuario elige quitar fact_check. Quedó fuera de jev_questions.py (38 preguntas por expediente); jev_rewrite_check.py guarda su propia copia de la versión medida.
- Revisión de test100 (83 pares): casi sin variación fast_track, pressure_groups, voice_business, public_opinion e independents (desvío < 0,07), y también executive_agenda, deadline y funding (≤ 5 % de sí). Muy correlacionadas: explains_content–explains_impact 0,83, centrality–in_headline 0,82, vote_reported–votes_outlook 0,71, voice_civil_society–voice_labor–pressure_groups ~0,7.
- voice_affected está rota: de 24 sí, 17 tienen deputy_quoted ≥ 0,5. Se activa con diputados, la Contraloría y Conare, no con personas afectadas.
- Propuesta de Claude (sin respuesta): quitar fast_track, pressure_groups, public_opinion, independents, executive_agenda, deadline y funding; reescribir voice_affected (personas comunes, no diputados, funcionarios ni organizaciones); agregar own_evidence, next_step y source_count.

## 2026-11-10 12:09 — Tercera ronda en test100: se quitan 7 preguntas, voice_affected reescrita funciona, next_step funciona, own_evidence a medias, source_count falla (#34 #39)

- Aplicado en jev_questions.py: se quitan fast_track, pressure_groups, public_opinion, independents, executive_agenda, deadline y funding; voice_affected se reescribe con criterios; se agregan own_evidence y next_step (por expediente) y source_count (choice por noticia). El detalle queda en 33 preguntas por expediente + 5 por noticia.
- Medición: results/jev/scripts/jev_round3_check.py → results/jev/test100_round3/ (46 noticias, llave tests, 209.475 tokens ≈ $0,009). Revisión por 2 subagentes: results/jev/test100_round3/review.md.
- voice_affected: la vieja coincide en 59/83 (24 falsos sí: diputados e instituciones); la nueva en 82/83 (1 manifestante). En la muestra no hay ningún afectado de verdad, así que no se sabe si los detectaría.
- next_step: 81/83. own_evidence: 64/83, con 16 falsos no cerca del umbral (no reconoce una descripción breve de disposiciones ni el texto citado en una columna). source_count: 27/46, siempre cuenta de más («tres o más» en 38/46).
- Pendiente: reescribir source_count y own_evidence (redacciones en review.md) y decidir si los documentos cuentan como fuente en source_count (recomendación: no, porque eso lo mide own_evidence). Nota del matcher: 562eae9d hizo match con 25648 y 21769, que tienen el mismo título (expedientes hermanos).

## 2026-11-10 12:32 — Modelo de costo de Jev C(n, p, m) ajustado con el filtro y test100; corpus ≈ $12,6 con las 32 preguntas actuales (#43 #34)

- C = P·n·[(T_all + q_f) + r_f·(T_pass + q_g + K·c_g) + r_f·r_m·(T_pass + D + q_N + b·(c_d + p·m))], P = $0,042/M. Numérico: n·(9.632 + 0,205·p·m) tokens.
- Constantes: T_all 1.130, T_pass 1.385, r_f 0,25, c_g 597 por candidato (sin same_topic), r_m 0,455, b 1,80, D 1.930, q_N 480, c_d 613; hoy p = 32, m ≈ 75.
- Lo que falta (7.431 que pasaron): puerta ≈ $9,78 + detalle ≈ $1,31 ≈ $11,1 (la proyección de $12,1 tenía same_topic y 39 preguntas). La puerta es el 88 % del resto; una pregunta más de 75 tokens en el detalle cuesta ≈ $0,02 en el corpus.
- Por medio: CRHoy tiene las notas más cortas (831 tokens) y Semanario/El Mundo pasan el filtro el 43 % → cuestan ≈ 2,4× por noticia que CRHoy. Tablas por medio y mes en results/jev/cost_model.md.

## 2026-11-10 12:34 — decisión: se quitan own_evidence y source_count; corrida del corpus lista en un comando (run_jev_corpus.py) (#43 #34)

- El usuario: borrar las que no funcionaron. Salen own_evidence y source_count. Quedan voice_affected (reescrita) y next_step. El detalle tiene 32 preguntas por expediente + 4 por noticia (press_release, main_frame, assembly_image, headline_misleading); la puerta, explicit + implicit + genre.
- Consola según el usuario: jev-filter 36.667.609 tokens (cuadra con run.json); jev-tests 27.115.160 tokens en total (incluye pruebas anteriores; las de hoy suman ≈ 4,35 M: test100 3.916.688, reescritura 219.125, ronda 3 209.475). Saldo $2,32; el usuario carga $15 → ≈ $17,32. Después, Claude gastó 58.300 tokens más en tests (≈ $0,002) probando la puerta con 90 candidatos.
- run_jev_corpus.py: toma las 7.431 de corpus_filter/filter.csv, arma los candidatos una vez (top-50 ∪ nombrados por número), corre la puerta con la llave GATE (tope $12) y el detalle con la llave DETAILS (tope $3). Todo se reanuda. Salida: results/jev/corpus/.
- Candidatos ya armados: 371.876 filas (50,04 por noticia, máximo 90); 2.589 expedientes nombrados por número, 326 agregados fuera del top-50 (mediana del rank 177). Se excluyen los números redondos (20.000, 21.000: «20.000 entradas»), que eran 6 falsos.
- Prueba de la noticia con 90 candidatos con la llave tests: 58.300 tokens, sin error (no hay límite de contexto que la frene).
- Estimación: puerta ≈ 235 M tokens ≈ $9,85; detalle ≈ 30 M ≈ $1,3; total ≈ $11,2 de ≈ $17,3.

## 2026-11-10 12:38 — Barras de progreso en las corridas de Jev (ProgressBoard): etapa, matches, centavos del tope y avisos (#43)

- El usuario pide ver cuánto falta y si hay problemas. JevRunner recibe board=ProgressBoard. Filas: gate y details (noticias hechas / por hacer, velocidad y ETA), matches (contador) y «¢ of cap» (centavos gastados contra el tope). Las conectan run_jev_corpus.py (un tablero por etapa, con la llave y el tope en el título) y run_jev.py.
- Errores: una noticia que falla después de los reintentos del SDK suma un aviso (⚠ en la barra, con el mensaje arriba y en el log) y las demás siguen. Antes, un error ya dejaba correr a las demás, pero la corrida terminaba en excepción sin escribir las tablas. Ahora run.json trae failed_this_run y left_by_cap_this_run, y al volver a correr se reintenta lo que faltó.
- Probado con un Jev falso sobre test100 (sin API): 1 falla simulada contada, el tope de $0,10 cortó a 19 noticias, y el detalle siguió con las que tenían match. Sin terminal interactiva imprime una línea cada 10 %.

## 2026-11-10 12:40 — Saldo antes de la corrida del corpus: $17,32 (#43)

- El usuario cargó $15: el saldo queda en $17,32 justo antes de correr run_jev_corpus.py. Incluye los 58.300 tokens de tests de la prueba de 90 candidatos (≈ $0,002, quizás todavía sin reflejar).
- Esperado al terminar: ≈ $17,32 − $11,2 ≈ $6,1. jev-gate y jev-details deben cuadrar con tokens_by_key de results/jev/corpus/run.json.

## 2026-11-10 15:07 — Corrida del corpus hecha: 3.662 de 7.431 noticias con match (6.329 pares), $11,47; 8 detalles fallaron por max_tokens_exceeded (#43 #34)

- run_jev_corpus.py (logs/run_2026-11-10_124210.log). Puerta: 7.431 requests en 12 min, 239.917.863 tokens ($10,08, llave gate), 0 fallas, 126 noticias cortadas a 15.000 caracteres. Detalle: 3.654 requests en 3 min, 33.227.400 tokens ($1,40, llave details). Total $11,47 (estimado $11,2). Saldo esperado ≈ $17,32 − $11,47 ≈ $5,85.
- Matches por noticia: 1 → 2.587, 2 → 612, 3 → 192, 4–9 → 227, 10 o más → 44.
- Fallaron 8 detalles con 400 max_tokens_exceeded: son noticias con 21–70 matches (listas de convocatorias). El detalle más grande que pasó tuvo 19 expedientes y 64.320 tokens, así que el límite de Jev ronda los 64k tokens por request. Arreglo pendiente: partir el detalle en tandas de expedientes.
- Tamaños: answers.jsonl 133 MB (pasa el límite de 100 MB de GitHub), details.csv 55 MB, candidates.csv 33 MB, gate.csv 31 MB. answers.jsonl no trae el texto de las noticias (solo respuestas, uso, headers y raw = answers/model/usage).

## 2026-11-10 15:07 — pendiente: cómo recuperar los 8 detalles fallidos y cómo guardar en git los resultados del corpus (#43)

- (1) 8 detalles fallidos: partir Jev.details en tandas de hasta 15 expedientes, con las preguntas por noticia solo en la primera tanda, y unir las respuestas en un único registro de detalle (tokens sumados, raw como lista). Costo ≈ $0,04. Recomendación de Claude: sí, con 15.
- (2) Git: answers.jsonl pesa 133 MB y comprimido 6,8 MB. Recomendación: commitear answers.jsonl.gz y candidates.csv.gz, más run.json, news.csv, questions.json y candidates_report.json; poner en .gitignore los CSV grandes y el jsonl sin comprimir, porque se regeneran desde answers. Sin respuesta.

## 2026-11-10 15:11 — Detalle partido en tandas de 15 expedientes; las 8 noticias que faltaban ya tienen detalle; corpus completo, $11,51 en total (#43)

- Jev.details manda una request por tanda de Config.JEV_DETAILS_BATCH = 15 expedientes. Las preguntas por noticia van solo en la primera tanda, y merge_responses une las tandas en un solo registro (tokens y tiempo sumados; raw y headers como {"batches": [...]}). Así las tablas no cambian.
- Se volvió a correr run_jev_corpus.py (logs/run_2026-11-10_151017.log): la puerta no tenía pendientes; el detalle corrió las 8 sin fallas, con 986.769 tokens ($0,04, llave details).
- Totales finales en results/jev/corpus/run.json: 11.093 registros, 274.132.032 tokens, $11,51; gate 239.917.863 y details 34.214.169 tokens. Las 3.662 noticias con match tienen detalle. Saldo esperado ≈ $17,32 − $11,51 ≈ $5,81.

## 2026-11-10 15:16 — decisión: visor de respuestas de Jev en private_visuals (#69)
- El usuario pidió una página para ver las respuestas de Jev sobre los pares del corpus. Issue #69 creado (milestone Private visuals).
- Decidido: se cargan los pares con max(explícito, implícito) ≥ 0,1 (36.941), umbral móvil de 0,1 a 1 (por defecto 0,5); debajo de 0,5 no hay detalle.
- Dos vistas (por noticia y por expediente) con panel lateral; filtros por respuestas del detalle, explícito vs implícito, cruce con los enlaces de Delfino; resumen con gráficos.
- `build_data.py` → `private_visuals/output/jev_answers/data.js` (ignorado por git), sin cuerpos de noticia.

## 2026-11-10 15:23 — visor de respuestas de Jev hecho; 25258 junta 389 noticias casi todas implícitas (#69)
- `private_visuals/jev_answers/`: build_data.py (lee results/jev/corpus + la base en solo lectura) → output/jev_answers/data.js (8,9 MB, ignorado por git); index.html, app.js, labels.js, styles.css. Se abre con el launch `visuals`: http://localhost:8766/jev_answers/index.html
- Datos: 6.645 noticias, 3.547 expedientes, 37.006 pares (36.941 ≥ 0,1 + 65 enlaces de Delfino por debajo), 6.329 con detalle, 1.421 enlaces de Delfino en la corrida.
- Verificado en el navegador: con 0,5 da 3.662 noticias y 6.329 pares (igual que run.json); el 94 % de los enlaces de Delfino (1.336/1.421) pasa el umbral; «Delfino sí, Jev no» = 85 pares; «Jev sí, Delfino no» (solo noticias de Delfino) = 564.
- Hallazgo: 25258 (magistrados suplentes de la Sala IV) tiene 389 matches y 372 son solo implícitos (explícito < 0,5): la pregunta implícita pega cualquier nota sobre la Sala IV o los jueces a ese expediente. Revisar al analizar el corpus.

## 2026-11-10 15:26 — Primer análisis del corpus: 12,3 % de las noticias cubren un expediente; 100 % de lo aprobado en el Plenario tiene cobertura; las posiciones que reporta la prensa coinciden con el voto en 95 % (#43 #56)

- results/jev/corpus_analysis/ (analysis.py, README.md, CSVs). Exploratorio; sí = probabilidad ≥ 0,5.
- Cobertura: Semanario 25 % de sus noticias, El Mundo 17 %, Delfino 15 %, Nación 10 %, CRHoy 9 %. 1.039 expedientes distintos; el top 10 se lleva el 25 % de los pares. Los más cubiertos: 25258 magistrados suplentes (389), 23414 armonización eléctrica (320), 25754 presupuesto 2027 (249).
- Actividad: 100 % de los aprobados en 1.° y 2.° debate tienen cobertura; el 39 % de los expedientes con actividad en el SIL no tiene ninguna. Los 10 con más mociones: mediana de 44,5 noticias.
- Proponentes (presentados de mayo a octubre): el Ejecutivo tiene 22,9 noticias por expediente, Pueblo Soberano 3,9, PLN 2,7 y FA 2,8.
- Posición atribuida frente al voto en 1.°/2.° debate: 93 de 98 combinaciones partido–expediente con posición clara coinciden (94,9 %). Es una validación externa de las preguntas de posición.
- Estilo: El Mundo tiene un 55 % de notas tipo comunicado y el tono más favorable (0,63); Semanario, el encuadre de conflicto más alto (48 %) y la imagen de la Asamblea más crítica; Delfino, el encuadre de política pública más alto (56 %). En el 63 % de los pares no hay ninguna voz externa.
- Caveat nuevo: 21372 (Reglamento contra el hostigamiento sexual de la Asamblea) tiene 57 noticias, solo 1 como tema principal; son casos Alvarado/Obaldía que lo nombran como norma vigente.

## 2026-11-10 15:40 — decisión: pestaña de análisis en el visor de Jev (#69)
- El usuario pidió mucho más análisis: partido vs partido, votos vs prensa, rankings por medio/partido, cruces de variables, expedientes polémicos y línea temporal por expediente.
- Decidido (todo lo recomendado): agregación ponderada por probabilidad (valor esperado, mínimo de noticias ajustable para rankings, 5 por defecto); votos vs prensa solo con votaciones de fondo (primer/segundo debate, ratificación, acuerdo; 38 expedientes con match), las 1.714 mociones solo para la cohesión partido vs partido por votos; se agregan partido proponente (bill_proponents + deputy_factions), comisiones (organ_bills), pasos del SIL y votaciones en la línea temporal; va como tercera pestaña «Análisis» del visor, con los mismos filtros.

## 2026-11-10 15:52 — pendiente: los matches solo implícitos (49 % de los pares) aciertan ~50 %; propuesta de exigir implicit ≥ 0,75 si no hay explícito (#43 #34)

- 3.071 de los 6.329 pares son solo implícitos (explicit < 0,5). La centralidad de Jev no los separa: tienen centralidad igual o más alta que los explícitos.
- Muestra de 50 implícitos (10 de 25258, 6 de 25754, 34 al azar), revisada por 2 subagentes contra el texto: 24 sí, 11 dudosos, 15 no (precisión 48 % estricta, 70 % contando los dudosos). En 25258: 4 sí, 3 dudosos, 3 no. Errores: otro proyecto del mismo tema (clase b, el principal), menciones de fondo, leyes vigentes.
- Precisión por umbral de implicit en la muestra: ≥ 0,65 → 62 %/79 % (34 de 50); ≥ 0,75 → 73 %/81 % (26); ≥ 0,8 → 80 %/90 % (20); ≥ 0,9 → 100 % (7). Con centralidad ≥ 0,5: 72 %/86 % (29).
- En el corpus, explicit ≥ 0,5 o implicit ≥ 0,75 deja 4.671 de 6.329 pares (2.788 noticias; 25258 baja de 389 a 176); con ≥ 0,65 quedan 5.242 pares.
- Propuesta de Claude (sin respuesta): cobertura = explicit ≥ 0,5 o implicit ≥ 0,75; cobertura sustantiva = además centralidad ≥ 0,5; reportar los dos y la sensibilidad. La muestra es chica (±14 puntos).

## 2026-11-10 15:54 — pestaña de análisis hecha; la prensa coincide con el voto de cada partido en 94–100 % (#69)
- `analysis.js` + `analysis.css`; build_data.py ahora agrega proponentes (partido del primer firmante a la fecha de presentación), comisiones del período (organ_bills), pasos del SIL y las 1.955 votaciones del período con el conteo por fracción (data.js 10,3 MB).
- Ocho secciones: Partidos (matrices de bandos opuestos según noticias y según votos, clic → expedientes donde chocan/coinciden), Votos vs prensa, Medios (perfil completo con todas las preguntas, sesgo relativo, noticias por semana), Expedientes (rankings por medio y por actor), Proponentes y comisiones, Cruces (dispersión con ejes a elección + matriz Spearman), Polémicos (bandos), Línea temporal (postura, actores, comisiones, pasos, votaciones, cobertura semanal).
- Resultados con umbral 0,5: votos vs prensa en 44 expedientes con votación de fondo: PPSO 97 % (37/38), PLN 100 % (32/32), FA 94 % (31/33), PUSC 95 % (20/21), CAC 100 % (18/18). PPSO vs FA: 67 % en bandos opuestos según las noticias y 85 % según los votos; PPSO con el Ejecutivo solo 14 %.
- Sesgo relativo por medio (postura frente a los otros en los mismos expedientes): El Mundo +0,27, Semanario −0,10, CRHoy −0,04, Delfino −0,05, Nación −0,02. Noticias (log) vs postura: r = −0,19 (los más cubiertos salen algo más criticados).
- Caveats: las votaciones de fondo incluyen reformas al Reglamento y acuerdos; el partido proponente de expedientes viejos es el del período anterior (Acción Ciudadana, PSD, Nueva República…); 25258 sigue inflado por menciones implícitas.

## 2026-11-10 16:04 — pendiente: revisión de 190 matches; propuesta de dos niveles: mención (explícito o implícito ≥ 0,75) y cobertura sustantiva (además centralidad ≥ 0,25) (#43 #34)

- Ronda 2: 140 pares (25 por franja implícita + 40 explícitos), 6 revisores en paralelo (workflow) que no veían la probabilidad de Jev. Junto con la ronda 1 (50) suman 190: results/jev/corpus_analysis/match_review.csv y el anexo del README.
- Precisión estricta / con dudosos: implícito < 0,65 24 %/51 %; 0,65–0,75 39 %/67 %; 0,75–0,85 66 %/76 %; ≥ 0,85 82 %/92 %; explícito 75 %/82 %. Los 6 explícitos marcados «no» porque el número estaba después de los 8.000 caracteres que vieron los revisores se corrigieron a «sí».
- La centralidad < 0,25 marca las menciones de paso (28 % de sí). Corpus estimado: A todo 66 %/78 %; B mención 4.671 pares 78 %/85 % (conserva ~88 % de los correctos); C sustantiva 3.462 pares 88 %/91 % (~73 %); D con centralidad ≥ 0,5 no mejora la precisión y conserva ~48 %.
- Contraste con los enlaces de Delfino: el 95 % de los explícitos de Delfino están en sus enlaces; los implícitos casi no (cota inferior).
- Propuesta de Claude (sin respuesta): reportar «mención» (B) para cuántos expedientes se nombran, y «cobertura sustantiva» (C) para los rankings, el estilo por medio y las posiciones.

## 2026-11-10 16:11 — decisión: el análisis cuenta en dos niveles, mención (explícito ≥ 0,5 o implícito ≥ 0,75) y cobertura sustantiva (además centralidad ≥ 0,25) (#43 #56)

- El usuario acepta los dos niveles propuestos (jev 2026-11-10, «pendiente: revisión de 190 matches»). No hace falta volver a correr Jev; solo se rehace analysis.py con los filtros.
- El usuario comparte el plan del entregable 1 (21 de octubre) y pregunta si el análisis responde algo. El plan deja fuera valorar, comparar o rankear medios, diputados o partidos, y pide presentar la cobertura de forma descriptiva.

## 2026-11-10 16:16 — Análisis del corpus rehecho con los dos niveles: 8,8 % de las noticias con cobertura sustantiva; 570 expedientes; 95,8 % de coincidencia con el voto (#43 #56)

- analysis.py corre por nivel y escribe en mention/ y substantive/; la primera pasada queda en first_pass/. README reescrito: las secciones 1–4 son descriptivas (validación, volumen, expedientes, actividad) y la 5 (estilo por medio) es exploratoria y no va al sitio, por el alcance del entregable 1.
- Mención: 2.788 noticias (9,4 %), 4.671 pares, 820 expedientes. Sustantiva: 2.620 noticias (8,8 %), 3.462 pares, 570 expedientes; el top 10 se lleva el 31 %. Los más cubiertos: 23414 (278), 25754 (182), 25258 (172).
- Actividad (sustantiva): el 40 % de los expedientes con actividad en el SIL tienen cobertura; aprobados en 1.° debate 92 %, en 2.° debate 89 %. Sin cobertura sustantiva quedan tres convenios aéreos aprobados (25080, 25302, 25207), que solo aparecen en listas. Ejecutivo: ~17 noticias por expediente; los diputados, 2–3.
- Posiciones contra votos: 92/96 = 95,8 % (sustantiva). Arreglo: party_positions y positions_vs_votes no filtraban por nivel en la primera versión del script; ya filtran.

## 2026-11-10 16:05 — decisión: línea temporal con expedientes sin cobertura y navegación nueva (#69)
- Pedido del usuario: la línea temporal es difícil de manejar y solo muestra expedientes con cobertura.
- Decidido: el universo suma los expedientes con actividad en el período (paso del SIL o votación desde mayo: 954, de los que 381 no tienen cobertura a 0,5 y 116 no estaban en data.js); lista lateral con búsqueda, orden y chips con/sin cobertura/con votaciones; hitos del SIL con etiqueta y cronología mezclada (pasos, votaciones, noticias); gráfico separado (cobertura y postura arriba, partidos aparte y plegable); candidatos debajo del umbral en gris; y un botón en cada expediente de la página (listas, panel, análisis) para ir directo a su gráfico. Sin zoom.

## 2026-11-10 16:40 — línea temporal rehecha: 1.420 expedientes, 381 sin cobertura (#69)
- build_data.py agrega `active` (expedientes con paso del SIL o votación desde el inicio del período) y sus datos: 3.663 expedientes en data.js (116 nuevos sin candidatos), 10,4 MB.
- Línea temporal: lista lateral (búsqueda, chips todos/con cobertura/sin cobertura/con votaciones, orden, mini barras por semana, ↑↓), gráfico de cobertura y trámite (postura, candidatas bajo el umbral en gris, noticias por semana, hitos del SIL con etiqueta, comisiones, votaciones), partidos en un bloque plegable y cronología mezclada. Botón de línea temporal en cada expediente (filas, tarjetas, panel lateral, listas del análisis).
- Con umbral 0,5: 1.420 expedientes en la lista (1.039 con cobertura + 381 activos sin cobertura). Ejemplo: 23986 (prisión preventiva) no tiene ninguna noticia ≥ 0,5 pero sí 135 candidatas bajo el umbral, probablemente por expedientes hermanos.
- Verificado en el navegador (expediente con y sin cobertura, flechas, botón desde el panel).

## 2026-11-10 16:33 — corrección: la entrada «línea temporal rehecha» es de las 16:32, no de las 16:40 (#69)
- La hora del título se escribió antes de leer el reloj. El contenido no cambia.

## 2026-11-10 16:52 — pendiente: visualizaciones gráficas (mapa de expedientes, red de co-votación, partido × tema) (#69)
- El usuario pide visualizaciones más vistosas que gráficos (fuerzas, clustering). Claude propone:
  1. Mapa de los 5.898 expedientes: UMAP sobre embeddings qwen3 + clustering (HDBSCAN o k-means), temas nombrados con los descriptores de `bill_subjects`; tamaño = cobertura de Jev.
  2. Red de fuerzas de diputados por co-votación (arista = % de votos iguales); los partidos se separan solos y se ven los que cruzan.
  3. Heatmap partido × tema (% a favor), que necesita los temas de 1.
  4. Extras: red de co-mención de expedientes, flujo medio → tema → etapa, streamgraph por tema en el tiempo.
- Hallazgos: `bill_subjects` son descriptores de tesauro (3.141 distintos, 'LEY', 'REFORMA'...), no categorías: hay que agrupar. `votes` en private_corpus.db: 1.955 votaciones sobre solo 87 expedientes (2026-06-10 a 2026-11-05), así que partido × tema queda flaco.
- Recomendación: 1 + 2, como pestaña nueva del visor privado; no en el sitio público hasta decidir el alcance de partidos. Sin respuesta.

## 2026-11-10 17:05 — decisión: grafos estilo Obsidian, página nueva y de a poco (#69)
- El usuario quiere todas las visualizaciones propuestas, de a pocas, muy interactivas (deslizadores de fuerzas como Obsidian) y con colores por tipo de nodo (partidos: FA amarillo, PPSO celeste, etc.).
- Página nueva `private_visuals/graph/` con su propio build; D3-force + canvas.
- Primera vista: los 5.898 expedientes, aristas a los 5 vecinos por embedding qwen3, temas = comunidades Louvain nombradas por descriptores.
- Color «cobertura»: gris sin cobertura; casi negro si tiene > 4 años y no tiene cobertura; con cobertura, rojo→verde según el promedio de stance de Jev en notas sustantivas.
- Votos: recargar primero los de Delfino (data 2026-11-10 16:56) antes de la red de co-votación de diputados.

## 2026-11-10 17:20 — decisión: el análisis del corpus usa solo votos de mayo–octubre; rehecho con la base recargada (#22 #43)

- El usuario eligió filtrar al período (PERIOD, mayo–oct) en vez de usar el período con un mes de margen. `analysis.py`: las tres consultas a `votes` (actividad, posiciones vs. votos, weekly) llevan `date BETWEEN` PERIOD; el grupo pasa a llamarse «plenary votes (May–Oct)».
- Cambian solo activity_vs_coverage, positions_vs_votes y weekly en los dos niveles. Antes (base parcial, jun–nov) → ahora: votados 87 → 110 (sustantiva 74 % igual; mención 89 → 85 %); 1.er debate 26 → 35; 2.º debate 27 → 39; 4+ mociones 10 → 13 (mediana sustantiva 27 → 15).
- Posiciones vs. votos: 185 → 249 pares partido–expediente con voto final. Sustantiva: 130 de 141 coinciden (92,2 %; antes 92 de 96, 95,8 %). Mención: 131 de 143 (91,6 %).
- Las tres leyes de 2.º debate sin cobertura sustantiva siguen siendo 25080, 25302 y 25207. README actualizado con estas cifras.

## 2026-11-10 17:27 — Grafo de expedientes estilo Obsidian hecho y verificado (private_visuals/graph) (#69)
- `build_graph.py` → `private_visuals/output/graph/bills.js` (1,7 MB, fuera de git): 5.898 expedientes, 22.094 enlaces (5 vecinos por coseno, embeddings qwen3 / exposition), 26 temas Louvain (resolución 0,6, semilla 7, modularidad 0,81) nombrados con 3 descriptores del SIL por c-TF-IDF. Cobertura con los mismos niveles que analysis.py: cuadra con el README (4.671 / 3.462 pares; 820 / 570 expedientes).
- Página `private_visuals/graph/` (index.html, engine.js genérico, app.js, styles.css; D3 7.9 por CDN, canvas). Colores: Tema (8 tonos repartidos para que temas vecinos no repitan), Cobertura (rojo→gris claro→verde por stance 15–85; gris sin cobertura; casi negro sin cobertura y > 4 años) y Estado. Tamaño = noticias sustantivas. Panel: búsqueda, filtros, leyenda clicable, deslizadores de fuerzas y apariencia, física on/off. Ficha con enlaces al visor (`jev_answers/#bill=N`, deep link nuevo en app.js del visor) y al explorador.
- Rendimiento: d3.forceManyBody tardaba 90–130 ms por tick con 5.898 nodos. Se reemplazó por una repulsión propia de corto alcance en grilla (con colisión entre círculos) y resortes con tope de estiramiento: ~17 ms por tick en esta máquina (lenta en ese momento).
- Conteos en modo Cobertura: 90 en contra, 281 neutral, 199 a favor, 1.988 sin cobertura, 3.340 sin cobertura y > 4 años.
- Caveats: nombres de temas automáticos y sin validar; 487 expedientes sin exposición usan el texto de respaldo; 250 expedientes con solo menciones de paso se pintan como sin cobertura; stance de 1 sola noticia en muchos expedientes; «> 4 años» es fecha de presentación contra la extracción (2026-11-07), no el plazo cuatrienal del SIL.
- Nuevo: `networkx` en requirements.txt; config `visuals-alt` (puerto 8768) en launch.json porque el 8766 lo usa el servidor de otro chat. Sin commitear.
- Siguiente (de a pocos): red de co-votación de diputados con colores de partido (los votos ya se recargaron: 9.288 votaciones, 1.991 expedientes), luego partido × tema y los extras.

## 2026-11-10 17:44 — decisión: red de diputados por co-votación (períodos, medida, colores, fotos) (#69)
- Commit del grafo de expedientes: 361b255.
- Selector de las 3 legislaturas con votos (2018–2022, 2022–2026, 2026–2030); arranca en la actual.
- Coincidencia: solo votaciones disputadas (minoría ≥ 10 % de los presentes), promedio dentro de cada expediente y cada expediente pesa igual. Motivo: en 2026–2030, 1.700 de 2.109 votaciones son mociones del 24290. Descartadas: porcentaje simple por votación; solo primer y segundo debate (84 en la actual).
- Colores reales de partido solo en el grafo (PPSO celeste, PLN verde, FA amarillo, PUSC rojo, CAC naranja, independientes gris; anteriores: PAC naranja oscuro, PRN azul, PNR morado, PLP rosado, PPSD turquesa). El visor queda con los suyos.
- Nodo = foto con anillo del color del partido (fotos de Delfino copiadas a private_visuals/output/, fuera de git); tamaño = expedientes firmados en la legislatura.

## 2026-11-10 17:49 — Red de diputados por co-votación hecha y verificada (private_visuals/graph/deputies.html) (#69)
- Nota: la entrada anterior («decisión: red de diputados…») lleva una hora estimada (17:44), no leída del reloj.
- `build_deputies.py` → `private_visuals/output/graph/deputies.js` (112 KB) y `photos/` (173 fotos copiadas de raw/, fuera de git). Una red por legislatura: 2018–2022 (59 diputados, 279 votaciones disputadas en 168 expedientes), 2022–2026 (58; 2.839 en 407), 2026–2030 (57; 1.355 en 57). Pares con menos de 5 expedientes en común quedan sin dato.
- Resultado 2026–2030: coincidencia mediana 100 % dentro del partido y 24 % entre partidos. Por pares: PPSO–FA 8 %, PPSO–PLN 23 %, PLN–FA 69 %, PLN–PUSC 83 %, CAC–PLN 86 %. Con umbral 75 % salen tres bloques: PPSO, FA, y PLN + PUSC + CAC. En 2018–2022 y 2022–2026: 87–90 % dentro y 61–65 % entre partidos.
- Página: selector de legislatura, deslizador «Coincidencia mínima» (rehace los enlaces en vivo; por defecto 75 %), color por partido (colores reales) o provincia, foto con anillo, tamaño = expedientes firmados, grosor del enlace según coincidencia (≥ 85 y ≥ 95). Ficha: con quién vota más y menos, coincidencia con su partido y con el resto. Al pasar por otro diputado con uno seleccionado, el tooltip da la coincidencia entre ambos.
- Refactor: `app.js` → `bills.js`; lo común del panel pasó a `controls.js`; `engine.js` ahora acepta fotos, niveles de grosor, `setLinks` y valores por defecto por página; pestañas Expedientes | Diputados arriba. El grafo se encuadra en el espacio que deja el panel.
- Caveats: el partido es el que Delfino le pone más veces en la legislatura (13 «Independiente» en 2018–2022: no se ve de qué fracción salieron); ausencias y abstenciones no cuentan; el umbral de disputada (10 %) y el mínimo de 5 expedientes son parámetros; el tamaño por expedientes firmados no es una medida de calidad.
- Sin commitear. Siguiente: partido × tema (usa los 26 temas del grafo de expedientes y los votos), luego los extras.

## 2026-11-10 18:02 — decisión: partido × tema con la posición según la prensa; red de fuerzas y color en el mapa (#69)
- Hallazgo: en primer y segundo debate todos los partidos votan a favor el 90–100 % de las veces en todos los temas (2018–2022: 1.290 de 1.300 aprobados; 2022–2026: 1.467 de 1.528; 2026–2030: 80 de 84, solo 51 expedientes). «% a favor por tema» no discrimina.
- Medida elegida: posición que la prensa le atribuye a cada partido y al Ejecutivo (preguntas de Jev por partido), en pares con cobertura sustantiva; a favor = +1, en contra = −1, neutral = 0, promedio por expediente y luego por tema (cada expediente pesa igual). Con posición: PPSO 251 expedientes, PLN 218, FA 194, Ejecutivo 184, PUSC 108, CAC 73. Descartado por ahora: votos en contra en debates.
- Formas elegidas: (1) red de fuerzas partidos–temas, tercera pestaña; (2) modo de color «posición de un partido» en el mapa de expedientes. La matriz de calor no se pidió.

## 2026-11-10 18:07 — Partidos y temas: red de fuerzas y modo «Partidos» en el mapa, hechos y verificados (#69)
- Datos: `build_graph.py` ahora agrega a cada expediente la posición de cada actor (PPSO, PLN, FA, PUSC, CAC, Ejecutivo): promedio de +1 / 0 / −1 sobre sus noticias sustantivas que le atribuyen posición, y cuántas son. Sin build nuevo: las dos vistas leen `bills.js`.
- `parties.html` / `parties.js` (tercera pestaña): 6 actores y los temas con enlaces; enlace = promedio por tema (cada expediente pesa igual), color rojo→verde, grosor por cantidad de expedientes (≥ 5, ≥ 10); solo el apoyo tira del resorte. Controles: mínimo de expedientes por enlace (3 por defecto) e interruptores a favor / dividido / en contra. Fichas de tema y de actor.
- Resultado con mínimo 3: 101 enlaces en 21 temas: 85 a favor, 13 divididos y 3 en contra, los tres del FA (Deporte −0,60 en 5 expedientes; Municipal −0,50 en 4; Propiedad −0,33 en 3). PLN queda en −0,17 en ARESEP/eléctrico (12 expedientes) y el Ejecutivo en +0,78 (14).
- Mapa de expedientes: modo de color «Partidos» con selector de actor, leyenda (FA: 46 en contra, 4 dividido, 144 a favor, 376 cubiertos sin posición) y resumen por tema clicable; la ficha del expediente lista la posición de cada actor.
- Motor: enlaces con color propio. `controls.js`: colores de partido, actores y escala de posición compartidos.
- Caveats: la prensa atribuye sobre todo apoyos (casi todos los promedios son positivos), así que la red sale mayormente verde; es lo que dicen las noticias, no el voto; promedios con 3–5 expedientes son frágiles; un actor no mencionado no cuenta (no es neutral).
- Sin commitear (junto con la red de diputados). Quedan los extras: co-mención, medio → tema → etapa, streamgraph.

## 2026-11-10 18:32 — Muestra de 300 repetida con el sistema final: en las Correcto, recall 0,866 y precisión 0,806; con «mención», 0,687/0,902; con «sustantiva», 0,672/0,918 (#39 #34 #41)

- results/jev/sample_final/: candidatos top-50 ∪ nombrados por número (7 agregados de 48 nombrados), puerta sin same_topic, detalle final. Llave tests, 10.571.510 tokens, $0,444. Etiquetas: el export de Descargas del 2026-11-09 16:48 (el mismo de la corrida anterior, así que la comparación es directa).
- Contra la corrida del 2026-11-09 (umbral 0,5 sobre max(explícito, implícito)): recall del ranker 0,940 → 0,955 (Correcto) y 0,871 → 0,909 (todas); recall 0,866 → 0,866; precisión 0,841 → 0,806 (3 falsos positivos más, todos con probabilidad entre 0,50 y 0,53: es ruido de Jev en el límite; uno es un expediente agregado por número, 24753, rank 2242); «ninguno» 0,969 → 0,969.
- Con los dos niveles (Correcto): mención, recall 0,687 / precisión 0,902 / ninguno 0,984; sustantiva, 0,672 / 0,918 / 0,984. Todas las noticias: mención 0,674 / 0,832; sustantiva 0,599 / 0,859. Subir el umbral cambia recall por precisión, como se estimó en el corpus.

## 2026-11-10 18:39 — pendiente: el análisis del corpus usó la tabla de votos incompleta (1.955 votaciones, jun–nov); hay que rehacerlo filtrando al período (#43 #56)

- La base se había reemplazado por una copia vieja (data 2026-11-10 16:56). Otro chat recargó los votos de Delfino (9.288 desde 2018) y dejó el respaldo databases/private_corpus.backup_2026-11-10.db (data 2026-11-10 17:04). Claude vio los 1.955 votos al empezar el análisis y no los contrastó con los 9.285 del STATUS.
- Afecta solo las cifras que usan votos: «votados en el Plenario», aprobados en 1.° y 2.° debate, «4+ mociones» y posiciones contra votos. El resto del análisis no usa votos.
- Propuesta de Claude (sin respuesta): filtrar los votos a mayo–octubre de 2026 y volver a correr analysis.py (no hace falta Jev).

## 2026-11-10 18:40 — corrección: el análisis ya estaba rehecho con los votos de mayo–octubre (otro chat, 17:20) y entró en el commit a726792 (#43 #56)

- La entrada «pendiente: el análisis del corpus usó la tabla de votos incompleta» estaba desactualizada: otro chat ya había filtrado las tres consultas a votes al período y actualizado el README (jev 2026-11-10 17:20, «decisión: el análisis del corpus usa solo votos de mayo–octubre»). Esa versión es la que se commiteó en a726792.
- Cifras vigentes: posiciones contra votos 130/141 = 92,2 % (sustantiva) y 131/143 = 91,6 % (mención); 110 expedientes votados en el Plenario; 35 aprobados en 1.er debate y 39 en 2.º; sin cobertura sustantiva quedan los mismos 3 convenios aéreos.

## 2026-11-10 22:39 — pendiente: diseño de los tres extras de grafos (co-mención, medio → tema → etapa, streamgraph) (#69)
- El usuario pide seguir con los extras; las tres vistas principales ya están commiteadas. Conteos con los niveles de siempre (results/jev/corpus, temas de bills.js):
- **Co-mención** (expedientes en la misma noticia). Sustantiva: 431 noticias con ≥ 2 expedientes, 1.175 pares, 393 expedientes; 192 pares con ≥ 2 noticias en común; 73 % de los pares cruza temas; máximo 11 expedientes por noticia. Mención: 643 noticias, 7.149 pares, 686 expedientes, pero dominada por notas-lista (59 noticias con ≥ 8 expedientes; una con 70 y otra con 59); sin las de > 8 quedan 1.501 pares. Pares más repetidos: 25754–25803 (20), 24761–25228 (16).
- **Medio → tema → etapa**: los 3.462 pares sustantivos tienen respuesta de `stage` (etapa según la noticia): no se dice 1.010 (29 %), presentado 797, comisión 575, primer debate 367, segundo debate 224, archivado 205, sanción o veto 182, Sala IV 102. Probabilidad de la opción elegida: mediana 0,83; 11 % por debajo de 0,5. Por medio: Delfino 994, Nación 805, CRHoy 661, Semanario 585, El Mundo 417. 23 temas con cobertura; los 10 primeros suman 85 %.
- **Streamgraph**: 27 semanas ISO (2026-W18 a W44), 35–236 pares por semana. Los picos son de un expediente: 23414 es el 64 % de la semana 22 (tema ARESEP/eléctrico, 100 pares); 25754 el 34 % de la semana 36.
- Propuesta de Claude: tres pestañas nuevas en `private_visuals/graph/`; datos en bills.js como tabla de pares sustantivos (noticia anónima, expediente, medio, día, etapa) para filtrar en la página. Co-mención sustantiva con deslizador de noticias en común; etapa según Jev; 10 temas + «Otros»; semanas. Falta la respuesta del usuario.

## 2026-11-10 22:44 — decisión: diseño de los tres extras de grafos (#69)
- El usuario aceptó las cuatro recomendaciones (conteos en la entrada anterior):
- **Co-mención**: solo cobertura sustantiva (431 noticias, 1.175 pares, 393 expedientes), con deslizador de noticias en común. Descartado: toda mención sin notas-lista; las dos con interruptor.
- **Etapa del flujo**: la que dice la noticia (pregunta `stage` de Jev). Descartado: la etapa del SIL a la fecha de la noticia (heurística nueva) y el selector entre ambas.
- **Temas** en el flujo y en el streamgraph: los 10 más cubiertos + «Otros». Descartado: los 23; deslizador.
- **Streamgraph**: semanal, con tres formas animadas (río, apilado, porcentaje) y, al pasar el mouse, los expedientes que explican la semana. Descartado: diario suavizado; solo río.
- Van como tres pestañas nuevas de `private_visuals/graph/` y leen bills.js (se le agrega la tabla de pares sustantivos).

## 2026-11-10 22:59 — Extras de grafos hechos y verificados: co-mención, flujo medio → tema → etapa y cobertura en el tiempo (#69)
- **Datos**: `build_graph.py` agrega `press` a bills.js (1,9 MB): los 3.462 pares sustantivos en 2.620 noticias (431 con dos o más expedientes), cada noticia numerada y solo con fecha y medio, y la etapa según la noticia. Nodos, enlaces y temas quedaron idénticos (comparado campo a campo con el archivo anterior).
- **Co-mención** (`comentions.html`, motor de fuerzas): 393 expedientes y 1.175 pares; arranca en 2 noticias en común (143 expedientes, 192 pares, 55 % entre temas distintos; con 1 es 73 %). Deslizador de noticias en común, interruptores de enlaces dentro de un tema y entre temas, filtro por medio (noticias con 2+ expedientes: Delfino 147, Nación 94, Semanario 93, CRHoy 66, El Mundo 31), color por tema o tono, ficha con «sale en la misma noticia que».
- **Flujo** (`flow.html`, SVG a mano, sin d3-sankey): medio → tema → etapa. Una columna da el color (tema por defecto, medio o etapa) y parte las franjas del otro lado, así se sigue un medio hasta las etapas. Clic en un bloque deja solo lo que pasa por ahí (Delfino: 994 pares; sin «no se dice»: 763) y lista sus expedientes; puntos animados sobre las franjas (se apagan con un interruptor o con prefers-reduced-motion).
- **En el tiempo** (`stream.html`): 27 semanas de lunes a domingo, 10 temas + «Otros 13 temas» (508 pares); río, apilado y porcentaje con transición; al pasar el mouse, los expedientes de esa semana y tema; un clic los fija en el panel; filtros de temas y medios.
- Compartido: `press.js` (tabla de pares, semanas, grupos de temas) y, en `controls.js`, PALETTE, stanceBin, showTip, isolateList y bindPanelToggle (bills.js y deputies.js usan la paleta común). Seis pestañas en las seis páginas.
- Elegido por Claude (detalle, se cambia fácil): mínimo 2 en co-mención; color por tema en el flujo; orden de las capas siguiendo la paleta para que los dos tonos repetidos (rojo: MUNICIPAL y TRIBUTARIO; azul: AMBIENTE y SALUD) queden lejos; medios con el tono del visor en su versión oscura. Paletas validadas con el validador del skill dataviz (todas pasan).
- Caveats: una noticia con dos expedientes cuenta dos veces en flujo y streamgraph; co-mención no es relación entre expedientes (con mínimo 1, 983 de 1.175 pares vienen de una sola noticia); etapa = lo que dice la noticia, 29 % «no se dice», 11 % con probabilidad < 0,5; primera semana de 3 días; picos de un solo expediente (23414 = 64 % de la semana del 25 al 31 de mayo); compara medios, así que se queda en lo privado.
- Verificado en el navegador (sin errores de consola; las tres pestañas viejas dan los mismos conteos). Sin commitear.

## 2026-11-10 23:13 — decisión: selector de conexiones por vista y ventana por fecha de presentación; por qué el mapa queda pegado (#69)
- El usuario pregunta por qué el mapa de expedientes no forma clusters, y pide ventana de tiempo, menos lag, varias formas de generar las conexiones en todas las vistas y más visualizaciones.
- **Diagnóstico medido** (mapa asentado, 5.898 nodos): solo el 63 % de los expedientes queda más cerca del centro de su tema que del de otro; distancia media al centro propio 163 contra 203 entre centros vecinos. El 15 % de los enlaces cruza temas (3.322 de 22.094) y miden 350 contra 119 de media: amarran todo en una sola masa. Causas en el motor: la repulsión solo actúa a menos de 80 px (nada separa grupos que no se tocan), la fuerza central tira de todo hacia el mismo punto y todos los enlaces tiran igual sin importar el parecido.
- **Lag medido** en esta máquina enchufada: 5–6 ms por tick y 3,8 ms por dibujo con el mapa encuadrado (2,1 sin enlaces). El 17:27 se midieron ~17 ms por tick con la máquina lenta.
- **Decisiones**: (1) selector de tipo de conexión en cada vista. Expedientes: exposición, nombre, descriptores del SIL, mismos firmantes. Diputados: co-votación, co-firma, comisiones compartidas. Partidos y temas: posición según la prensa, autoría. Co-mención: sustantiva o con menciones de paso. Flujo y tiempo: elegir columnas o capas (medio, tema, etapa, género, encuadre). Descartado: solo afinar las reglas actuales; las dos cosas. (2) Ventana de tiempo por fecha de presentación (2016-06-13 a 2026-11-05, ninguna vacía), con atajos por legislatura. Descartado: «con trámite en la ventana»; selector entre ambas. (3) Commit de los extras antes de tocar el motor: eb54531.
- Datos para las conexiones nuevas: firmantes en 5.490 expedientes (3.202 con uno solo, 569 con 12 o más; 542 son del Poder Ejecutivo y 29 del Plenario, sin deputy_id); `organ_memberships` llega hasta la legislatura 2025–2026, así que no hay comisiones del período 2026–2030; embeddings qwen3 de nombre y de descriptores ya calculados.

## 2026-11-11 09:57 — Vista de diputados en blanco: a deputies.html le faltaban los elementos del selector de conexiones; arreglado y verificado (#69)
- Síntoma: la página de diputados no dibujaba nada. Causa: el cambio sin commitear de la segunda ronda (deputies.js editado el 2026-11-11 a las 04:15, sin entrada en el diario) usa `#links`, `#links-note`, `#heading` y `#threshold-label`, que deputies.html no tenía; `$("links").addEventListener` tiraba un TypeError antes de `loadTerm`. Los datos (`output/graph/deputies.js`, 23:27) ya venían con `links.votes/signatures/committees`, así que volver al deputies.js commiteado tampoco servía.
- Arreglo: sección «Conexiones» en deputies.html (igual que en index.html, después de «Filtros») e ids en el título y en la etiqueta del deslizador.
- Segundo error del mismo cambio: el deslizador empezaba en 40, pero los umbrales por defecto de co-firma (21–43) y comisiones (21–33) quedan debajo, igual que casi todos sus pares (1.667 de 1.702 en co-firma 2018–2022). Ahora el mínimo va por tipo: 40 en co-votación, 0 en co-firma y comisiones.
- Verificado en el navegador (8768): los tres tipos en las tres legislaturas, con título, subtítulo, nota y tarjeta propios; cada tipo y legislatura arranca en su umbral y el que se mueve a mano se conserva. Las otras cinco vistas cargan sin errores.
- Ojo: http.server no manda Cache-Control y el navegador siguió mostrando el HTML viejo después del arreglo; hay que recargar con Ctrl+F5.

## 2026-11-11 09:57 — corrección: organ_memberships sí tiene el período 2026–2030 (#69)
- La entrada del 2026-11-10 23:13 decía que `organ_memberships` llega hasta la legislatura 2025–2026. En la base hay 304 membresías de 57 diputados en la legislatura 2026–2027 (desde 2026-05-01), así que la red por comisiones de 2026–2030 sí tiene datos (27 comisiones).
- Cada deputy_id pertenece a un solo período (ninguno se repite), como supone build_deputies.py al tomar las firmas y comisiones sin filtrar por fecha.

## 2026-11-11 10:14 — pendiente: más conexiones por pestaña, pestaña de noticias y escala; medido: la física ya es lineal y lo caro es dibujar los enlaces (#69)
- Pedido: más tipos de conexión en cada pestaña; una pestaña de noticias (embeddings, separación entre medios) y que el motor aguante ~30k nodos sin O(n²).
- Física medida con grafos sintéticos (6 enlaces por nodo, parámetros del mapa): 5,1 / 13,2 / 28,3 ms por tick con 6k / 15k / 30k nodos, o sea lineal (a 30k: repulsión 13,6, resortes 9,5, malla lejana 4,1). La grilla de repulsión y la malla de 28×28 ya la dejan en O(n + enlaces); Barnes-Hut sería peor.
- Dibujo (medido con el panel oculto: valen las proporciones): una línea de ≥ 1 px físico va por el camino lento de Skia. Los 22.094 enlaces del mapa de expedientes tardan ~190 ms en rasterizarse y a 0,999 px tardan 9 ms; con 180k enlaces, 3,4 s contra 70 ms. El grosor 1/k·k da 1,0000000329 px y cae en el lento: es muy probablemente el lag del mapa (la medición de las 23:13, 3,8 ms, solo contaba el JS). Círculos con 30k nodos: arcos 60–125 ms, cuadrados 35–45 ms, píxeles directos 15–20 ms.
- Datos para noticias: 29.875 (crhoy 9.442, nacion 9.424, delfino 5.399, elmundo 3.388, semanario 2.222), autor en 27.650 (1.659 autores), 251 secciones sin normalizar; qwen3 `news_256_all.npz` con 128.748 fragmentos y su news_id; de Jev, género en las 7.431 filtradas y expediente en 3.662. En el .venv no hay umap, sklearn, torch ni faiss: numpy alcanza para vecinos y PCA.
- Opciones planteadas en el chat: motor (enlaces finos por debajo de 1 px físico, nodos según el zoom, física en un Web Worker opcional, WebGL solo para 100k o más); noticias (todas con filtros, conexiones por contenido, mismo expediente encadenado por fecha, misma historia y mismo autor; color por medio; separar por medio con la fuerza de grupo; PCA como posición inicial; quitar fragmentos repetidos antes de promediar); otras pestañas (comisión como color en expedientes; diputados mencionados juntos, después). Recomendación: el arreglo del motor ya, y noticias con contenido + mismo expediente primero.

## 2026-11-11 10:55 — decisión: arreglo del motor y pestaña de noticias como se recomendó (#69)
- El usuario aprueba «como recomendás» las decisiones de la entrada de las 10:14: enlaces finos por debajo de 1 px físico y nodos según el zoom; pestaña de noticias con las 29.875 y filtros (Asamblea, con expediente), conexiones por contenido y por mismo expediente primero (misma historia y mismo autor quedan para después), color por medio, separar por color con la fuerza de grupo, posición inicial por PCA y quitar los fragmentos repetidos antes de promediar.
- Detalles resueltos al implementar, dentro de lo aprobado: «con expediente» usa la cobertura sustantiva, como las otras vistas de prensa (2.620 noticias, no las 3.662 con algún match); los vecinos se calculan por subconjunto, para que al filtrar cada noticia se una a sus parecidas visibles; «Mismo expediente» fuerza el filtro «con expediente».

## 2026-11-11 10:55 — Motor: enlaces finos, nodos chicos como cuadrados y tope de enlaces por cuadro; el mapa de expedientes pasa de ~215 a ~25–45 ms por cuadro (#69)
- engine.js: los enlaces de menos de 2 px físicos se dibujan a 0,95 px (camino de hairline de Skia) con el alfa compensado; los anillos de los nodos también. Los nodos de menos de 1,75 px de radio en pantalla son cuadrados de la misma área. Un cuadro dibuja como mucho 40.000 enlaces de los que están en pantalla (6.000 mientras se mueve), estimados por la fracción de nodos visibles, con la muestra pareja y más opaca. Si un cuadro tarda, los ticks por cuadro suben hasta 50 ms para asentar en menos cuadros.
- Medido (panel oculto, lectura de un píxel para forzar el rasterizado): mapa de expedientes asentado 25–45 ms (antes ~215), moviéndose ~17 ms (antes ~81). Noticias, 29.875 nodos y 132.706 enlaces: 80–110 ms con todo a la vista, ~55 ms moviéndose, ~32 ms con zoom ×12; la física, 28 ms por tick.
- Verificado sin errores en expedientes, diputados (fotos y enlaces gruesos), co-mención y partidos.

## 2026-11-11 10:55 — Pestaña de noticias hecha y verificada (news.html, build_news.py) (#69)
- build_news.py: promedio de los fragmentos qwen3 por noticia, ponderado por tokens y sin los repetidos (coseno ≥ 0,95 en 5 noticias o más), en caché en `databases/embeddings/qwen3-0.6b/news_pooled.npz` (3 min la primera vez, 18 s después). 6 vecinos por noticia dentro de cada subconjunto, desde coseno 0,6 (se cae el 1 % de los enlaces; 56 noticias quedan sin vecinas). Posición inicial por PCA. Escribe `output/graph/news.js` (11,5 MB: id, URL, título, medio, fecha, autor, sección, género, expedientes; nada de texto).
- Página: filtros Todas / Asamblea (7.431) / Con expediente (2.620); conexiones Contenido / Mismo expediente (cadenas por fecha: 337 expedientes, 2.698 enlaces); color por medio, tema (del expediente principal), género, mes y tono; interruptor «Separar por color»; tarjeta con expedientes, tono y enlaces a la noticia, al explorador y al visor de Jev; búsqueda por título, autor, medio o expediente.
- Tiempos: la primera carga del mapa completo se asienta en ~12 s (decaimiento 0,035); las siguientes abren ya armadas (localStorage); volver a un estado ya visto es instantáneo. Asamblea se asienta en 2,6 s y mismo expediente en 3,4 s.
- Hallazgo: el 44 % de los enlaces por contenido quedan dentro de un mismo medio (25 % por azar). Con «Separar por color», Delfino queda como región aparte; La Nación y CRHoy se mezclan más.

## 2026-11-11 10:55 — hallazgo: el boilerplate no forma fragmentos aparte y los embeddings de noticias son consultas de búsqueda de expedientes (#69 #32)
- Solo 187 de 128.748 fragmentos (0,1 % de los tokens, en 161 noticias) tienen un casi idéntico en 5 noticias o más: los avisos de Delfino (~1.200) y de La Nación (788) quedan mezclados con texto de la nota dentro de fragmentos de 256 tokens, así que no se pueden quitar a nivel de fragmento. Limpiarlos de verdad pide sacar el texto antes de embeber (la corrida tomó 3,9 h de GPU).
- La metadata de `news_256_all.npz` muestra que los fragmentos se embebieron con la instrucción «Given a Costa Rican news article, retrieve the legislative bills it discusses»: el parecido entre noticias tira a «sobre el mismo asunto legislativo». Parte de la separación por medio puede venir del formato o de los avisos.
