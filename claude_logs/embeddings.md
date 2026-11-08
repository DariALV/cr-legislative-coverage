# embeddings

## 2026-11-06 22:38 — Diseño del experimento de embeddings: factores y costos (#32, #6, #38, #41)

- Pedido del usuario: discutir todas las formas de medir los embeddings (tokens por chunk, promedio, máximo, promedio de los 3 chunks más cercanos, modelo, K) y estimar cuántas veces hay que re-embeber, peso, duración y tamaño de muestra.
- Observación clave: solo el modelo y el tamaño de chunk (y overlap) obligan a re-embeber. Promedio / máximo / top-3 y K se calculan en numpy sobre los vectores de chunk guardados, sin volver a la GPU. Promedio de vectores y promedio de scores dan el mismo ranking por noticia (los vectores están normalizados).
- Set de oro (`news_bill_links`): 532 noticias, todas de Delfino, 1.425 enlaces a 579 expedientes (1.423 existen en `bills`), mayo–oct 2026. 345 noticias tienen 1 enlace; 26 tienen más de 10 (máx. 61). 111 enlaces apuntan a expedientes marcados (79 administrativos, 32 honoríficos).
- Tamaños (estimado con ~4 caracteres/token, falta confirmar con `count_tokens`): oro ~0,9 M tokens (mediana ~1.400 por noticia); corpus completo ~26 M tokens; nombres de expedientes ~0,26 M tokens.
- Chunks en oro: 3.818 (256), 2.045 (512), 1.142 (1024), 687 (2048), 534 (8192). En el corpus completo: 116 k (256), 66 k (512), 41 k (1024), 31 k (2048), 30 k (8192).
- Propuesta presentada (pendiente de decisión del usuario): 2 modelos × 5 tamaños = 10 corridas de embedding sobre el oro (~0,9 M tokens c/u, minutos cada una en la RTX 2060), 26 configuraciones evaluadas con recall@K para K ∈ {1,5,10,20,30,50,100}. Usar las 532 noticias del oro (±3,4 pp de IC 95 % para recall ~0,8); validar después con la muestra etiquetada a mano de otros medios (#27, #29).

## 2026-11-06 22:45 — ¿Aporta el overlap? (#32, #6)

- Pregunta del usuario: si el overlap entre chunks aporta algo relevante.
- Respuesta dada: poco para esta tarea. Las noticias hablan del expediente a lo largo del texto (similitud temática), así que un corte de chunk rara vez pierde la señal. Con promedio casi no cambia nada (solo duplica texto); podría ayudar algo con máximo / top-3 en chunks chicos, sobre todo en notas tipo resumen que mencionan muchos expedientes en una línea cada uno.
- Irrelevante desde 2048 tokens: 75 % de las noticias del oro caben en un chunk de 2048 y 100 % en uno de 8192.
- Costo: overlap o sobre tamaño s agrega ~o/(s−o) tokens (p. ej. 32 sobre 256 ≈ +14 %, 64 sobre 512 ≈ +14 %).
- Recomendación (pendiente de decisión): overlap 0 en el grid principal y una sola corrida de control con ~12 % de overlap en el tamaño chico que gane con máximo o top-3. Alternativa mencionada: cortar por párrafos en vez de por tokens, que quita la mayor parte de la razón del overlap (cambiaría `chunk_by_size`).

## 2026-11-06 22:55 — Clase para correr las 10 configuraciones de embedding: decisiones abiertas (#32, #6)

- Pedido del usuario: una clase en `tools/embedding_tools/` que llame al Embedder en las 10 configuraciones (2 modelos × 5 tamaños de chunk) y guarde los vectores, para llevar el repo a la máquina de la RTX 2060, instalar, configurar y correr primero el embedding y luego el análisis.
- Se aclaró el esquema: embeber = modelo × tamaño de chunk (10 corridas); analizar = modelo × tamaño × método (26 rankings); K solo corta cada ranking (26 curvas de recall@K).
- Observaciones: `databases/private_corpus.db` pesa 212 MB y está en .gitignore, así que hay que copiarlo a mano a la otra máquina. Ninguna de las 532 noticias del oro tiene el contenido vacío. `bill_subjects` tiene las columnas (number, subject_code, subject).
- Por regla de "design before code", se presentaron las decisiones abiertas con recomendación (formato y lugar de guardado, texto de noticias y expedientes, título por chunk, tamaños, batch por tamaño, reanudación, punto de entrada, metadatos). No se escribió código; se espera la respuesta del usuario.

## 2026-11-06 23:30 — Respuestas del usuario sobre EmbeddingRunner y variantes de expedientes (#32, #6, #66)

- Decidido: (1) `.npz` por corrida en `databases/embeddings/<modelo>/`; (2) oro por defecto, ids como parámetro; (3) título + contenido, con el título en cada chunk; (5) tamaños 256/512/1024/2048/entero (8000), overlap 0 como parámetro; (7) un modelo a la vez y saltar corridas ya hechas; (8) metadatos de todo lo que se pueda registrar; (9) script `run_embeddings.py` con una barra por combinación; (10) `EmbeddingRunner` primero, el análisis después, cuando se vea que el embedding funciona.
- Los datos que no van a git (base de datos, raw, vectores) se pasan entre máquinas con una llave maya.
- Pedido nuevo (4): embeber los expedientes en tres variantes: nombre, nombre + materias, nombre + texto base. Se discute el costo antes de decidir.
- Observación: hoy `bill_subjects` y `bill_steps` cubren solo 30 expedientes (20000–20029), y ninguno del oro. Pero `raw/csv/asamblea/bills` tiene 21.234 exportaciones en caché (carpeta modificada 23:22), así que probablemente hay una corrida completa del SIL sin guardar todavía en la base. Falta confirmarlo con el usuario.
- Observación: el texto base no está descargado (no hay .docx ni código que lo baje). Es un trabajo de scraping aparte, con la decisión pendiente desde las 21:57 sobre qué guardar.
- Estimado para nombre + texto base: 1.900–5.900 palabras por expediente (muestra de 13) → ~20–40 M tokens para todo el texto, más que el corpus completo de noticias. Opciones presentadas: texto completo truncado a 8000, solo la exposición de motivos hasta 2048 tokens (~12 M, recomendado), primeros 512 tokens (~3 M), o chunks del expediente (no recomendado: duplica las agregaciones).
- Se explicó el batch: textos procesados a la vez en la GPU; la memoria crece con batch × largo. Propuesta: ~8.000 tokens por batch (32/16/8/4/1) y bajar a la mitad si se acaba la memoria.

## 2026-11-07 02:58 — ¿Qué archivo corre todos los embeddings? (#32, #6)

- Pregunta del usuario: qué archivo correr para guardar todas las variaciones de embeddings.
- Respuesta: todavía no existe. Solo está `tools/embedding_tools/embedder.py` (`Embedder`); `pipeline.apply_embeddings()` es un `pass`. `EmbeddingRunner` y `run_embeddings.py` quedaron diseñados el 2026-11-06 23:30 pero sin implementar. Falta cerrar las variantes de expedientes (nombre / nombre + materias / nombre + exposición) antes de escribirlos.

## 2026-11-07 03:01 — Diseño de las variantes de expedientes para EmbeddingRunner: decisiones abiertas (#32, #6, #66)

- Datos actuales: `bill_texts` 5.411 ok, 264 no_exposition, 223 no_text (oro: 561 / 1 / 15 de 577). Exposición: mediana 1.328 palabras, p90 3.584, 216 pasan de 5.500 (32 en el oro); total ~11 M palabras.
- `bill_subjects` ya cubre 5.842 expedientes (103.102 filas; mediana 13 materias, p90 34, máx. 378; 567 del oro). Son descriptores en mayúscula y orden alfabético con sufijos de género (p. ej. "EDUCATIV,-O/-A", "REGULADOR,-A").
- Decisiones presentadas al usuario (pendiente): candidatos (todos los expedientes vs. solo oro), texto de cada variante, recorte de exposiciones largas, respaldo sin exposición, limpieza de materias, marcados (administrativos/honoríficos), el vector del expediente independiente del tamaño de chunk de la noticia, y nombres de archivos / CLI.

## 2026-11-07 03:05 — Decisiones del usuario sobre las variantes de expedientes (#32, #6)

- Aceptadas todas las recomendaciones de la entrada 03:01: (1) candidatos = los 5.898 expedientes; (2) variantes `name`, `subjects` ("<nombre>. Materias: a, b"), `exposition` ("<nombre>. <exposición>"); (3) recortar al límite del modelo; (4) sin exposición → solo nombre, marcado en metadatos; (5) materias en minúscula con la primera forma de género; (6) marcados se embeben y la marca va en metadatos; (7) vector de expediente independiente del chunk, 6 corridas de expedientes + 10 de noticias; (8) `databases/embeddings/<modelo>/news_<tamaño>.npz` y `bills_<variante>.npz`, `run_embeddings.py --model` con `--only` y `--sizes`.

## 2026-11-07 03:10 — EmbeddingRunner y run_embeddings.py implementados (#32, #6)

- `tools/embedding_tools/embedding_runner.py`: `EmbeddingRunner(model_key)` con `run_news(size, overlap)`, `run_bills(variant)` y `run_all`. Guarda `databases/embeddings/<modelo>/news_<tamaño>[_o<overlap>].npz` y `bills_<variante>.npz` con `vectors`, `tokens`, ids (`news_ids` + `chunk_index`, o `numbers` + `fallback` + `flags`) y un `meta` JSON (modelo, tamaños, prompt, conteos, truncados, divisiones por OOM, tiempos, versiones de paquetes, GPU, fecha de la base). Se escribe a `.partial.npz` y se renombra al terminar; si el archivo existe, la corrida se salta.
- `run_embeddings.py --model <clave> [--only news|bills] [--sizes ...] [--overlap N] [--variants ...] [--tokens-per-batch N]`, con una barra por corrida y log en `logs/`.
- Detalles de implementación elegidos sin preguntar (a confirmar con el usuario): el tamaño de chunk cuenta el título + separador ("\n\n"), así que el cuerpo de cada chunk es tamaño − tokens del título (mínimo 64); expedientes sin materias en `subjects` caen al nombre y quedan con `fallback = True` (56); en la limpieza de materias los números sueltos se descartan (16 filas) y "SALVADOR (EL)" → "el salvador"; batches agrupados por largo (largo recortado al límite del modelo) con ~8.192 tokens por batch y división a la mitad si la GPU se queda sin memoria.
- `Embedder.embed` acepta `batch_size` por llamada. `Config`: `EMBEDDINGS_DIR`, `EMBEDDING_CHUNK_SIZES`, `EMBEDDING_TOKENS_PER_BATCH`. `.gitignore`: `databases/embeddings/` (no estaba cubierto).
- Probado con un embedder falso (tokens = palabras, vectores aleatorios) sobre la base real: news_256 → 2.535 chunks de 532 noticias; news_8000 → 532; bills × 3 → 5.898 cada uno; exposition con 487 de respaldo; re-correr no embebe nada; la división por OOM y los batches funcionan. Falta la corrida real con el modelo en la RTX 2060 (aquí no hay GPU).

## 2026-11-07 03:31 — Commit del runner de embeddings (#32, #6)

- Commit 06df45b `feature: embedding runner #32 #6` (runner, run_embeddings.py, config, embedder, .gitignore y este log). Pendiente: corrida real en la RTX 2060.

## 2026-11-07 08:42 — Revisión de la corrida de bge-m3 tras el apagón de la compu (#32, #6)

- La compu se descargó durante la noche. Corrida `logs/run_2026-11-07_033152.log` (03:31–03:49): terminaron 7 de 8 archivos en `databases/embeddings/bge-m3/`: news_256 (3.541 vectores), news_512 (1.834), news_1024 (1.018), news_2048 (648), news_8000 (534), todos de 532 noticias del oro; bills_name y bills_subjects (5.898 cada uno, 56 con respaldo al nombre en subjects). 0 truncados, 0 divisiones por OOM.
- Revisados con un script del scratchpad: los 7 abren bien, 1024 dimensiones, sin NaN, normas = 1.
- Falta `bills_exposition.npz`: el log no lo registra y no quedó `.partial.npz` (el runner solo escribe al final). Para completarlo basta volver a correr; los archivos existentes se saltan.

## 2026-11-07 08:58 — Por qué la barra de bills_exposition dice ~7 horas (#32)

- Pregunta del usuario. La barra cuenta expedientes, pero `batches()` los ordena del más largo al más corto, así que el ETA se calcula con los textos más lentos (1 por batch a 8.190 tokens, atención cuadrática) y sobreestima mucho.
- Tokens de la variante exposition (tokenizer de bge-m3, script del scratchpad): 13,3 M tokens en total (recortados), mediana 1.730, 2.464 pasan de 2.048, 840 de 4.096 y 189 llegan al tope de 8.190. Es ~17 veces el volumen de news_8000 (785 mil tokens, 260 s).
- Estimado con un ajuste tiempo ≈ a·Σtokens + b·Σtokens² sobre las 7 corridas de anoche: ~1,5 h, más probable entre 1,5 y 3 h (el ajuste es flojo). El ETA debería ir bajando conforme avanza a los textos cortos.
- Ya está optimizado lo razonable (fp16, batches por largo). Lo único que bajaría mucho el tiempo es recortar las exposiciones a menos tokens, que cambia la decisión 03:05 (3); no se propuso cambiar.

## 2026-11-07 08:57 — ¿Se guarda el avance si se muere el proceso? (#32)

- Pregunta del usuario. No: `embed_and_save` junta todos los vectores en memoria y escribe el `.partial.npz` solo al final. Si el proceso muere a mitad de una corrida, se pierde todo el avance de ese archivo (sin dejar un archivo corrupto); los archivos ya terminados quedan bien. A diferencia de los raws, que se guardan uno por uno.
- Propuesto al usuario (pendiente): checkpoint periódico al `.partial.npz` con los vectores hechos + máscara de listos + huella de los ítems (ids, tokens, modelo, fecha de la base), y reanudar desde ahí si la huella calza. Recomendado cada ~5 min. No se cambió código; la corrida actual sigue con el código viejo.

## 2026-11-07 09:48 — bills_exposition terminado y checkpoints en el runner (#32, #6)

- `bills_exposition.npz` de bge-m3 terminó (`logs/run_2026-11-07_084402.log`): 5.898 vectores, 16,2 M tokens antes del recorte, 189 recortados a 8.190, 487 con respaldo al nombre, 0 divisiones por OOM, 3.500 s (58 min; el ETA de la barra decía ~7 h). Sin NaN, normas ≈ 1. Con esto bge-m3 tiene sus 8 archivos.
- Pedido del usuario: guardar avance cada 5 minutos. `EmbeddingRunner.embed_and_save` guarda cada `Config.EMBEDDING_CHECKPOINT_SECONDS` (300) un `<nombre>.checkpoint.npz` con los vectores hechos, la máscara `done` y un `state` (huella, divisiones por OOM, inicio y tiempo acumulado). Se escribe a `.checkpoint.tmp.npz` y se renombra, así que un corte al guardar deja el checkpoint anterior.
- Al arrancar, si hay checkpoint y la huella calza (sha256 del nombre del modelo, prompt, límite y cada key + chunk_index + texto en orden), embebe solo lo que falta; si no calza o no se puede leer, empieza de cero con un warning. Al escribir el .npz final se borra el checkpoint. `meta` gana `resumed_from_checkpoint`; `elapsed_seconds` y `started` suman las dos corridas.
- La huella usa el texto y no la fecha de la base, para que cambios a otras tablas no invaliden el checkpoint. `tokens_per_batch` no entra: cambiarlo entre corridas no invalida lo hecho.
- Probado con un embedder falso (script del scratchpad, salida en el scratchpad): corte tras 666 de 5.898 → al reanudar embebe 5.232, vectores idénticos a una corrida sin corte; checkpoint con otra huella → empieza de cero; con 300 s un corte rápido no deja nada. Sin probar con el modelo real.

## 2026-11-07 09:49 — Commit de los checkpoints (#32)

- Por pedido del usuario: commit `feature: embedding checkpoints every 5 minutes #32` con `embedding_runner.py`, `config.py` y este log (que también lleva la limpieza previa de entradas duplicadas del merge).

## 2026-11-07 09:51 — Comandos para correr los embeddings de cada modelo (#32, #6)

- Pedido del usuario: dejar anotados los comandos. Desde la raíz del repo, con el `.venv` activado:
  - bge-m3: `python run_embeddings.py --model bge-m3` (ya completo: sus 8 archivos en `databases/embeddings/bge-m3/`).
  - Qwen3-Embedding-0.6B: `python run_embeddings.py --model qwen3-0.6b` (pendiente).
- Cada uno corre las 5 corridas de noticias y las 3 de expedientes. Los archivos que ya existen se saltan y, dentro de una corrida, se retoma desde el checkpoint, así que tras un corte basta repetir el mismo comando.
- Para una sola parte: `--only news|bills`, `--sizes 256 512`, `--variants exposition` (p. ej. `python run_embeddings.py --model bge-m3 --only bills --variants exposition`, que fue lo que se usó para terminar exposition).

## 2026-11-07 12:44 — Analizador de embeddings: datos revisados y decisiones abiertas (#38, #33, #41, #6, #32)

- Pedido del usuario: construir el analizador que diga qué variante de embedding da el mejor recall y, en general, los mejores datos, mientras termina qwen3-0.6b.
- Estado de los vectores: bge-m3 tiene sus 8 archivos; qwen3-0.6b tiene 7 y `bills_exposition` va en checkpoint. qwen parte más chunks que bge-m3 con el mismo tamaño (news_256: 4.302 vs 3.541) porque su tokenizer da más tokens. Todos los `.npz` traen `vectors`, `tokens`, ids y `meta`; expedientes con `numbers`, `fallback`, `flags`.
- Observación sobre el oro: en 1.343 de 1.425 enlaces (94 %) la noticia de Delfino cita el número del expediente, y en 624 (44 %) trae los primeros 60 caracteres del nombre tal cual. El número no ayuda al embedding (los vectores de expedientes no lo incluyen), pero el nombre literal sí: el oro probablemente es más fácil que las noticias de otros medios. Se propone estratificar por "nombre citado" y validar luego con #27/#29.
- Filtro por fecha: ningún enlace apunta a un expediente presentado después de la noticia; filtrar candidatos por `date_proposed <= date_published` deja en promedio 5.732 de 5.898, así que casi no cambia nada.
- Decisiones presentadas (pendiente): grid de configuraciones y agregaciones, definición de recall con varios enlaces por noticia, métricas extra, candidatos (marcados, fecha), intervalos de confianza, estratos, salidas y dónde se guardan, y qué hacer con archivos faltantes. No se escribió código.

## 2026-11-07 12:52 — Decisiones del analizador de embeddings (#38, #33, #6)

- El usuario aceptó todas las recomendaciones: (1) 2 modelos × 5 tamaños × 3 variantes × agregación (promedio de vectores, máximo, promedio top-3; solo una en 8000), combinación entre variantes para después; (2) recall por noticia promediado como principal, más acierto@K y recall por enlace, K ∈ {1,5,10,20,30,50,100}; (3) MRR, rango mediano y AUC correctos vs no correctos; (4) 5.898 candidatos como principal, secundarios sin marcados y con filtro de fecha, se descartan enlaces a expedientes inexistentes; (5) bootstrap por noticia IC 95 %, emparejado entre las mejores; (6) estratos: nombre citado, número de enlaces (1, 2–10, >10), expediente con respaldo; (7) `tools/embedding_tools/embedding_analyzer.py` + `run_analysis.py`, métricas en `results/embeddings/` (en git), top-K de la mejor a `private_visuals/output/embedding_cross/data.js`, gráficas PNG opcionales; (8) saltar configuraciones sin `.npz` y avisar; (9) caveats en el log y en #38.

## 2026-11-07 12:52 — Problemas de usar el oro de Delfino (#38, #27, #29)

- Pregunta del usuario: qué problema real hay en usar el set de oro de Delfino.
- Respuesta dada: el problema central es de selección. Una noticia entra al oro solo si Delfino puso un enlace al expediente, y casi siempre cita el número (94 %) y muchas veces el nombre literal (44 %). O sea, el oro está condicionado a la mención explícita, que es justo la señal que el embedding aprovecha; las noticias que hablan de un expediente sin nombrarlo (el caso difícil, y el común en otros medios) no pueden estar. El recall medido es una cota superior.
- Otros: un solo medio especializado (estilo distinto a CRHoy/Nación/El Mundo/Semanario); etiquetas incompletas (Delfino no enlaza todo lo que menciona) y ruidosas (resúmenes con hasta 61 enlaces de mención de paso, no de tema); solo mayo–oct 2026, inicio de legislatura; elegir la mejor entre muchas configuraciones y reportar el número del mismo oro infla el resultado (winner's curse); si en el análisis final Delfino se mide por enlaces y los otros medios por embedding, las diferencias de cobertura entre medios serían en parte del método.
- Mitigaciones propuestas (sin decidir): estratificar por "nombre citado" (ya acordado), una variante del oro con número y nombre enmascarados, y validar la configuración ganadora con la muestra a mano de otros medios (#27, #29).

## 2026-11-07 12:59 — Analizador de embeddings implementado y primera corrida (#38, #33, #6)

- `tools/embedding_tools/embedding_analyzer.py` (`EmbeddingAnalyzer`) y `run_analysis.py` (`python run_analysis.py [--models ...] [--bootstrap N] [--rank-by recall@30|hit@K|mrr] [--top 50] [--no-export]`). Config: `EMBEDDING_RESULTS_DIR = results/embeddings`, `EMBEDDING_CROSS_DATA`, `EMBEDDING_KS`, `EMBEDDING_BOOTSTRAP = 1000`, `EMBEDDING_RANK_BY = recall@30`.
- Salidas en `results/embeddings/` (solo números, ~140 KB): `metrics.csv` (una fila por configuración × candidatos), `strata.csv`, `comparison.csv` (bootstrap emparejado contra la mejor), `summary.json`. El top-50 de la mejor va a `private_visuals/output/embedding_cross/data.js` (1,9 MB, fuera de git).
- Detalles elegidos al implementar, sin preguntar antes (reversibles; el CSV trae todas las métricas): la mejor se elige por recall@30, porque K = 30 es el K inicial de #33; los empates de puntaje cuentan a favor del expediente correcto; "mean" es el coseno con el vector promedio renormalizado; los estratos se miden sobre enlaces (micro), no por noticia; la AUC solo se calcula con todos los candidatos; no hay gráficas PNG porque matplotlib no está en el .venv.
- Verificado contra cálculo a fuerza bruta (argsort) en bge-m3/512/subjects: top3, mean y recall@10 coinciden. 2 enlaces del oro apuntan a expedientes inexistentes y se descartan (quedan 1.423). Sin marcados: 518 noticias y 1.312 enlaces.
- Corrida (`logs/run_2026-11-07_125736.log`, 98 s, 69 configuraciones; falta qwen3-0.6b/bills_exposition): la mejor es **qwen3-0.6b / news_256 / bills_subjects / max**: recall@1 0,33, @10 0,66, @30 0,76 (IC 0,73–0,79), @100 0,85, hit@30 0,87, MRR 0,59, AUC 0,963. Segunda: la misma con bills_name (0,743, la mejor queda adelante en el 96 % de los remuestreos). La mejor de bge-m3 es 256 / exposition / max (0,692). Sin marcados o con filtro por fecha casi no cambia (0,761 / 0,762).
- Patrones: max > top3 > mean en todos los modelos; chunks chicos (256) ganan; en bge-m3 la exposición ayuda, en qwen todavía no se sabe.
- Corrección a la entrada 12:4x sobre el oro "fácil": citar el nombre literal pasa sobre todo en notas con varios expedientes (solo 33 de 346 enlaces de noticias con un único expediente). Con bge-m3/256/exposition/max, recall@30: 1 enlace 0,76 citado / 0,80 no; 2–10: 0,31 / 0,61; >10: 0,19 / 0,23. O sea, el nombre citado no infla el recall; lo que lo baja son las notas tipo lista. Con la mejor de qwen: 1 enlace 0,82, 2–10 0,65, >10 0,34.

## 2026-11-07 13:25 — Segunda corrida del analizador, ya con qwen3-0.6b completo (#38, #33, #6)

- Corrida `logs/run_2026-11-07_131842.log`: 78 configuraciones, sin archivos faltantes (qwen3-0.6b ya tiene sus 8 `.npz`). 532 noticias, 1.423 enlaces, 5.898 candidatos.
- Mejor por recall@30: **qwen3-0.6b / news_256 / bills_exposition / max** = 0,773 (IC 95 % 0,741–0,804); recall@1 0,358, @10 0,674, @50 0,805, @100 0,855; hit@30 0,887; MRR 0,610; rango mediano 16; AUC 0,963. Sin marcados 0,770, con filtro de fecha 0,775.
- Segunda: misma con bills_subjects, 0,760 (diferencia 0,013, IC emparejado −0,017 a 0,044; la mejor va adelante en el 82 % de los remuestreos): no hay diferencia clara entre exposition y subjects. bills_name 0,743 (98 %). Las demás están claramente detrás (≥ 99,4 %).
- Cambia la mejor respecto a la corrida de las 12:59 (subjects, 0,76), solo porque faltaba exposition. Se mantienen los patrones: max > top3 > mean, 256 gana, qwen > bge-m3 (mejor de bge-m3: 256 / exposition / max, 0,692).
- Para el uso real (K = 50 como filtro para Jev, entrada 13:18): recall@50 ≈ 0,80, o sea ~1 de cada 5 enlaces del oro no llega al top-50. Como el oro es cota superior (entrada 12:52), en otros medios será menor.

## 2026-11-07 13:29 — Análisis más a fondo de los resultados de embeddings (#38, #33, #41, #6)

- Pedido del usuario. Scripts del scratchpad (`analysis/deep.py`, `stats.py`, `fail.py`, `more.py`) que usan `EmbeddingAnalyzer` para sacar el rango de cada enlace en 7 configuraciones (qwen y bge-m3 × 256 × 3 variantes × max, y qwen 8000 mean). No se tocó código del proyecto.
- Efectos (recall@30 por noticia, promedio sobre la grilla): modelo qwen 0,676 vs bge-m3 0,587; tamaño 256 0,651 → 8000 0,616, monótono; variante exposition 0,674, subjects 0,620, name 0,601; agregación max 0,666, top3 0,626, mean 0,610. Con chunks grandes las agregaciones convergen (qwen 2048: 0,72 / 0,70 / 0,70) y con 256 max saca ~10 puntos sobre mean.
- La métrica ganadora depende de cómo se promedie. Por noticia gana exposition (recall@50 0,805); por enlace gana subjects (link_recall@50 0,645 vs 0,607), porque rinde mejor en las notas tipo lista. La AUC es casi igual en las tres (0,962–0,963).
- El promedio por noticia esconde las notas tipo lista: 26 noticias con más de 10 enlaces tienen 477 de los 1.423 enlaces. Recall@50 por enlace con la mejor: 1 enlace 0,88 (346 enlaces), 2–10 0,64 (600), >10 0,36 (477). En notas de un solo enlace, la mitad del oro está en el rango ≤ 2 y el 90 % en ≤ 66.
- Combinar variantes ayuda con el mismo presupuesto de candidatos: la unión del top-25 de exposition y el top-25 de subjects (≤ 50 candidatos) da recall@50 por noticia 0,847 vs 0,804 de exposition sola (por enlace 0,656 vs 0,606). Agregar name (17+17+16) da menos (0,826). Unir con bge-m3 aporta poco: el máximo teórico de top-50 + top-50 es 0,838 vs 0,877 con subjects. De los fallos en top-50, 402 fallan en las dos variantes, 103 solo en subjects y 158 solo en exposition.
- Qué falla (40 notas de un enlace fuera del top-50, revisadas a mano en una muestra de 14):
  - Expedientes "paraguas" que la nota no nombra: el presupuesto 2027 (25754) está en 26 enlaces y entra al top-50 solo en el 15 %. Las notas hablan del recorte al FEES y el top-1 es la ley del FEES (23380), tema correcto pero expediente equivocado.
  - Expedientes conocidos por apodo: el "proyecto de Crucita" (23952, delitos ambientales) entra en 17 % de 12 enlaces.
  - Columnas y opinión con enlaces de contexto (p. ej. una columna sobre comunismo enlazada a la ley del sistema eléctrico).
  - Notas largas: en el cuartil de más de 1.046 palabras, hit@50 es 0,77; en los otros tres, ~0,92.
- Proxy de mención implícita dentro del oro: en notas de un enlace donde el número del expediente no aparece en el texto, hit@50 es 0,61 (n = 33) vs 0,91 cuando sí aparece (313). El vector no lleva el número, así que la diferencia viene de que esas notas hablan del expediente sin nombrarlo: es un anticipo de cómo irá en otros medios (#27–#29), con n chico.
- Lo que no explica los fallos: que el nombre del expediente arranque con "Reforma/Adición/Derogatoria" no baja el recall (0,93 vs 0,87 en notas de un enlace). La "hubness" es moderada: el expediente que más aparece en top-10 (25216, energías renovables) sale en 40 de 532 noticias, y los 6 primeros son de energía o de la elección de magistrados, los temas del período.
- Ideas que salen de aquí, sin decidir: fusionar exposition + subjects en el filtro; un K mayor o un tratamiento aparte para notas tipo lista; candidatos extra por reglas para el presupuesto y los expedientes con apodo (conecta con la idea de candidatos por diputado, entrada 13:18).

## 2026-11-07 13:30 — Commits del analizador y de la cola de la muestra (#38, #33, #6, #27, #28, #31)

- Por pedido del usuario se separó el árbol en dos commits: 4d23600 `feature: embedding analyzer #38 #33 #6` (analizador, run_analysis.py, results/embeddings, bloque de análisis en config.py y el log) y ffbd865 `feature: sample draw queue #27 #28 #31` (SampleBuilder, run_sample.py, results/sample/queue.csv y bloque de muestra en config.py). Ningún issue se cerró.

## 2026-11-07 13:35 — Commit de los hallazgos del análisis (#38)

- El analizador ya lo había commiteado el usuario a las 13:30 (4d23600 `feature: embedding analyzer #38 #33 #6`). Por pedido del usuario: commit solo del log con las entradas 13:25 y 13:29, `feature: embedding analysis findings #38`, sin cerrar #38.

## 2026-11-07 15:19 — Qué configuración de embedding usar para el resto de las noticias (#32, #38, #6)

- Pregunta del usuario: qué se decidió para terminar de embeber las otras noticias.
- Resumen dado: la mejor según el analizador (entrada 13:25) es qwen3-0.6b / news_256 (overlap 0) / max, con exposition y subjects empatados (diferencia no significativa). Los vectores de los 5.898 expedientes ya existen en las dos variantes, así que solo faltan las noticias.
- No hay una decisión formal registrada de "usar esto para el corpus completo"; quedaron sin decidir la fusión exposition + subjects y el K (entrada 13:30), que no afectan qué embeber.
- `run_embeddings.py` solo embebe el oro: `EmbeddingRunner.run_news` acepta `news_ids` + `tag`, pero el CLI no lo expone. Para las ~29.343 noticias restantes hace falta un cambio de código (por acordar antes).

## 2026-11-07 15:30 — Chunks de 256 por noticia y por medio: el oro es atípico (#32, #6)

- Pedido del usuario: ver si los 4.302 chunks del oro son lo normal o un caso atípico de Delfino. Script del scratchpad `analysis/chunk_counts.py`: usa `EmbeddingRunner.news_items` con solo el tokenizer de qwen3-0.6b (sin cargar el modelo), tamaño 256, overlap 0. Reproduce exacto los 4.302 chunks del oro. No se tocó código del proyecto.
- Corpus completo: 29.875 noticias → 128.748 chunks (media 4,31, mediana 4, p90 7, p99 16, máx. 126; mediana de 834 tokens). Las 29.343 que no son oro → 124.446 chunks (media 4,24, mediana 4).
- El oro es atípico: media 8,09, mediana 7, p90 15 (mediana de 1.572 tokens), casi el doble del resto. Ni siquiera es lo normal de Delfino: el resto de Delfino da media 5,17, mediana 4. Las notas que Delfino enlaza a expedientes son las más largas.
- Por medio (media / mediana / p90): crhoy 2,82 / 2 / 5 (25 % en un solo chunk); nacion 4,70 / 4 / 8; elmundo 4,62 / 4 / 7 (cola larga: máx. 126, 121, 75); delfino 5,46 / 5 / 9; semanario 5,71 / 5 / 9.
- 283 noticias con menos de 60 tokens (278 de crhoy), probablemente solo título; 177 noticias con `extraction_status = 'Partial'`.
- Costo estimado: news_256 del oro tardó 149 s (34,7 ms por chunk) → ~72 min para las 124.446 restantes en la RTX 2060; ~0,5 GB de vectores (1.024 dims, float32). Antes se había estimado ~240 mil chunks escalando con el oro, que es casi el doble de lo real.

## 2026-11-07 15:54 — `--all-news` para embeber el corpus completo (#32)

- Decidido por el usuario (todas las recomendadas de la entrada 15:30): (1) las 29.875 noticias, oro incluido, en un solo `news_256_all.npz`; (2) un flag en `run_embeddings.py`; (3) las cortas (278 de crhoy con solo título) y las 177 `Partial` se embeben igual y se marcan en el análisis; (4) solo qwen3-0.6b, 256, overlap 0.
- Cambio respecto a lo propuesto: el flag es `--all-news` y no `--news-set gold|all`, porque mientras tanto `run_embeddings.py` ganó `--background` (#68, cambios sin commit de otra línea de trabajo) y se siguió ese mismo patrón. Los dos flags se excluyen entre sí; sin `--sizes`, los dos usan `Config.RETRIEVAL_CHUNK_SIZE` (256) y no tocan expedientes.
- `EmbeddingRunner.all_news_ids()`: todas las noticias ordenadas por id. El archivo queda con `tag = "all"`, `ids_source = "custom"`.
- Probado con un embedder falso (tokenizer real de qwen, vectores aleatorios; script `analysis/test_all_news.py` del scratchpad): 128.748 vectores de 29.875 noticias, como el conteo de la entrada 15:30; la segunda corrida se salta. Pasar `--all-news` y `--background` juntos da error. Falta la corrida real en la RTX 2060 (~75 min): `python run_embeddings.py --model qwen3-0.6b --all-news`.

## 2026-11-07 15:57 — Commit de `--all-news` en espera (#32, #68)

- Decidido por el usuario: no commitear `--all-news` hasta que se commitee el trabajo de #68 (`--background` y `tools/retrieval_tools/`), porque comparten el mismo bloque de `run_embeddings.py`. Mensaje propuesto para después: `feature: full news corpus embedding flag #32`.

## 2026-11-07 16:02 — Commit de `all_news_ids` y cambio de máquina (#32)

- La parte de `run_embeddings.py` con `--all-news` ya entró en el commit de #68 (`ae60e78`), porque compartía bloque con `--background`. Solo quedaba `EmbeddingRunner.all_news_ids()`; se commitea con el mensaje acordado a las 15:57: `feature: full news corpus embedding flag #32`. #32 sigue abierto hasta tener la corrida real y su análisis.
- El usuario se pasa de la compu con la RTX 2060 a la otra, después de que termine `--all-news`. Lo que no viaja por git (ignorado): `databases/private_corpus.db` (259 MB), `databases/embeddings/` (255 MB + el `news_256_all.npz` nuevo), `databases/retrieval/` (360 MB, regenerable con `FeatureBuilder` en ~35 s), `results/evolution/**/population.csv` (~15 MB, regenerable desde la semilla), `private_visuals/output/` (28 MB), `.env` y `raw/` (3,5 GB, solo si se va a re-extraer). Los modelos de Hugging Face se bajan solos en la otra compu.
