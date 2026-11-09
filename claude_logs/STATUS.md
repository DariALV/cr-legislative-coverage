# STATUS

Estado actual del proyecto. Se reescribe, no se agrega: lo que deja de ser cierto se borra (la historia queda en los diarios por tema). Las referencias `tema fecha hora` apuntan a la entrada del diario `claude_logs/<tema>.md`.

Última actualización: 2026-11-09 (tema jev creado; decisiones rápidas del ranker, los embeddings, los datos y la muestra).

## Pendiente: decisiones abiertas

Decisiones que se discutieron y nunca se tomaron. Cualquier chat puede retomarlas con el usuario.

### ranker
- **Arquitectura por gradiente (A/B/C)**: (A) 1 neurona / 13 parámetros, (B) 12→16→1, (C) 12→32→16→1, misma CV. Recomendación: la más simple que no pierda. Es lo que falta para cerrar #68. (ranker 2026-11-07 14:14, 20:15)
- **Ajustes al GA**: sembrar la generación 0 con la base, CMA-ES, selección por truncamiento. Ninguno decidido. El rango de pesos se queda en ±5 (ranker 2026-11-09 13:42). (ranker 2026-11-07 20:15; #68)
- **Fuentes extra de candidatos**: diputado nombrado + actividad cercana; reglas para presupuesto y apodos; por chunk o con LLM para notas tipo lista (#35); pasada desde el expediente para los "sin cobertura"; reranker cross-encoder sobre el top-200; fine-tuning contrastivo (para después). (ranker 2026-11-07 13:37–13:50; #33 #36 #41)

### datos
- **`status` con pasos de archivo**: ¿se marcan como archivados los 255 "in progress" que tienen un paso "ARCHIVO…" (165 como último paso; 195 con el plazo cuatrienal vencido)? Bloquea el cierre de #66, junto con marcar los expedientes vivos en el período. (data 2026-11-07 01:05)
- **Duplicados de noticias**: 80 pares url / url-2 de Delfino (la -2 es un resumen) y 101 republicaciones de Nación. (data 2026-11-07 01:05; #16)
- **Boilerplate antes de embeber**: avisos de opinión de Delfino (~1.200), avisos de IA de Nación (788), data line de El Mundo (2.749/3.388). Los embeddings ya se corrieron sin limpiar. (data 2026-11-07 01:05; #16 #32)

### muestra
- **Trámite ya concluido de una ley vigente**: aprobado que no cuenta si la ley solo se nombra como antecedente (va en «Otros mencionados»). Falta decidir si cuenta una nota sobre los efectos o la aplicación de la ley, porque eso choca con #25 («una ley vigente que se aplica no cuenta»). Recomendación: mantener #25 y contarla solo si informa un paso del trámite (aprobación, firma, veto, publicación). Filas 23 (24259), 62 (24789), PAACUME (23003). (sample 2026-11-09, «pendiente: … choca con #25»)
- **Usar los candidatos del ranker para revisar negativas**: ayuda, pero sesga la revisión. Sin respuesta. (sample 2026-11-07 16:51)
- **Oro con número y nombre enmascarados** para medir el sesgo del oro de Delfino. Propuesto, nunca decidido. (embeddings 2026-11-07 12:52; #38)

### jev (evaluador TypeSafe; diario `claude_logs/jev.md`, las pruebas del 2026-11-08 están indexadas allí y escritas en general.md)
- **Prueba de Jev contra etiquetas: Choice de tipo 75 % de acuerdo en 187 Correcto, desacuerdos sobre todo por expedientes que no son proyectos de ley (general 2026-11-08 21:21). Prueba de Jev (2026-11-08)**: puerta de 3 Nouls funciona (19/20 oro, 0/21 al azar); falla en expedientes hermanos (3/84 falsos match). Un request por noticia con 50 candidatos y ficha corta (v2): igual de exacto, 25,5k tokens y $0,001 por noticia; todo el corpus ≈ $35 (≈ $10 con el filtro de palabras estrictas, que deja 8.081 noticias y pasa el 98 % del oro). La ficha con exposición no cabe (límite ~32k tokens por pregunta). Filtro de palabras: el estricto conserva 102/102 positivos de la muestra (el permisivo, 58 % del corpus, tampoco gana nada: ver general 2026-11-08 20:18). Filtro de Jev por noticia probado en 832 noticias (general 2026-11-08 20:52): pregunta ancha assembly pasa 102/102 positivos y 99 % del oro, mejor que el estricto (98 %) al mismo costo (~$8); pendiente elegir filtro y umbral. Faltan: desambiguación entre hermanos, más noticias (de paso, decreto, anunciado, ley vigente), medir el filtro de palabras con la muestra manual, elegir K, tope de largo de noticia,  (general 2026-11-08 20:05)
- **Diseño de las preguntas a Jev**: puerta con 3 `Noul` (explícito / implícito / mismo tema) y segunda ráfaga solo para los que pasan (centralidad, postura, voz, evento del trámite, guardas contra los negativos de la muestra). Faltan: si «mismo tema» abre la puerta, un request por par o por noticia, tablas para guardar probabilidades, permiso para probar la API. (general 2026-11-08 19:22; #34 #39)

## Decisiones vigentes

- **Expedientes que no son proyectos de ley** (comisiones investigadoras, nombramientos, reformas al Reglamento) **cuentan como positivos**; se marcan en «Tipo de expediente». (general 2026-11-08; #27 #29)
- **Filtro de Jev por noticia en inglés** (pregunta ancha `assembly`); el español no mejora. (general 2026-11-08)
- **No se amplía la muestra manual**: queda poco tiempo (trabajo universitario) y la prioridad pasa a ser probar Jev. (jev 2026-11-09)
- **K = 50 candidatos por noticia para Jev**; el ranker solo propone candidatos y Jev decide positivo/negativo. Recall @50: 0,954 en el oro y 0,95–0,97 en las 62 positivas «Correcto» de la muestra. Las corridas del GA usaron 100, así que se reporta @50. (ranker 2026-11-08, «decisión: K = 50»; ranker 2026-11-09 13:50; #41)
- **ranker**: la base de comparación es exposition sola y la generación 0 es al azar; el rango de pesos se queda en ±5. (ranker 2026-11-09 13:42, 13:50)
- **embeddings**: se confirman las opciones de `EmbeddingRunner` y del analizador. El overlap es 0 y no se corre el control con overlap. (embeddings 2026-11-09 13:50)
- **datos**: lo de Semanario sin autor no se toca, porque es un metadato irrelevante. (data 2026-11-09 13:50)
- **muestra**: un anuncio que después se vuelve expediente cuenta como **positiva**, porque el medio ya está hablando del proyecto (la fila 101, 25859, pasa a positiva; falta reclasificar en Etiquetas las «Anunciado sin expediente» que tienen expediente, y la Guía ya está actualizada). Los subtipos de positiva se conservan; los de negativa dejan de usarse y no se corrigen (filas 160, 172, 185). (sample 2026-11-09 14:04)
- **Adjudicación de la muestra**: se corre el ranker una vez y se guarda la métrica; se revisan solo los desacuerdos modelo–etiqueta con las reglas de la Guía; cada cambio queda registrado y se reportan las métricas antes y después. El doble etiquetado (#30) es opcional. Arranca cuando el usuario avise que terminó la revisión. (sample 2026-11-09, «decisión: protocolo de adjudicación»)

## En espera: acciones pendientes

- **Prueba de punta a punta ranker → Jev en la muestra**: código listo y probado con 3 noticias (jev 2026-11-09, «Implementada la clase Jev»). Faltan: (1) descargar la pestaña Etiquetas como CSV; (2) en la máquina con embeddings, `python run_candidates.py --name sample --labels Etiquetas.csv` (sin probar todavía); (3) `python run_jev.py --name sample` (~$0,40); (4) `python run_jev_eval.py --name sample --labels Etiquetas.csv`. (#34 #39 #10)
- **Evaluar embeddings y ranker en la muestra manual**: el ranker ya se evaluó en las 189 «Correcto» (cobertura @30 ≈ 0,95–0,97; ranker 2026-11-08, entrada «decisión: evaluar el ranker…»). Falta repetirlo cuando cierre la revisión humana y evaluar los embeddings solos. (#41 #68)
- **Revisión humana de la muestra**: el usuario revisa las "Sin relación" y confirma las propuestas "Corregir"/"Dudoso" de Claude (las 131 nuevas incluidas); después Claude aplica las correcciones confirmadas a las columnas de la etiqueta. Después: las 15 de Delfino (cola aparte), el doble etiquetado a ciegas de 20 noticias (#30) y exportar a CSV.
- **Comentario en #68** con los resultados de las corridas con exclusión.
- **Fuera de git** (se copian a mano): la base, `databases/embeddings/`, `databases/retrieval/`, `.env`, `raw/`.
- **Datos crudos de Jev**: respuestas de la API y scripts en `results/jev/answers/` y `results/jev/scripts/` (jev 2026-11-09 10:00); los scripts leen `TYPESAFE_API_KEY` de `.env`.

## Estado por tema

**datos** (#16 #66 abiertos; #22 #65 cerrados)
- 5.898 expedientes (20000–25897). `bill_texts`: 5.411 ok, 264 no_exposition, 223 no_text. Texto en `raw/text/asamblea/bills/`.
- Votos de la lista de Delfino: 9.285 votaciones (8.876 plenary, 409 full_committee) y 513.432 votos. El matcher cruza todos menos 5.
- 235 diputados, 1.880 órganos. 29.875 noticias (mayo–oct 2026).

**explorador** (#67 cerrado): `private_visuals/db_explorer/server.py`, de solo lectura, en localhost:8765 (`db-explorer` en launch.json). Fotos de 168/230 diputados.

**embeddings** (#6 #32 #38 cerrados)
- bge-m3 y qwen3-0.6b embebidos en el oro y en los 5.898 expedientes (3 variantes).
- Mejor configuración: **qwen3-0.6b / 256 / exposition / max** (recall@30 0,773 y @50 0,805).
- Corpus completo embebido: `news_256_all.npz`, 128.748 chunks (corrida del 2026-11-07 19:57, verificada 2026-11-08; embeddings 2026-11-08 19:40).

**muestra** (#27–#31 abiertos; #25 #26 cerrados)
- 300 noticias (100 positivas / 200 negativas) de 316 sorteos, en Google Sheets (columna "En la muestra"). Solo se usa como test.
- Claude revisó las 34 negativas de confianza baja/media: 19 Correcto, 10 Corregir, 5 Dudoso, escritas con el prefijo "Claude:".
- Claude revisó además 131 en detalle (2026-11-08): 17 Dudoso con pregunta del usuario (comentario agregado debajo del suyo), 67 positivas pendientes (38 Correcto, 28 Corregir, 1 Dudoso) y las 47 negativas de confianza alta (41 Correcto, 4 Corregir, 2 Dudoso). Solo quedan en Pendiente las «Sin relación». (sample 2026-11-08)

**ranker** (#33 #41 #68 abiertos)
- GA en `tools/evolution_tools/`, 29 genes, fitness por lotes en la GPU (~0,12 s por generación con el cargador conectado; con batería es mucho más lenta).
- Se excluyen las noticias-agenda (≥ 15 links: 14 noticias), con reporte aparte.
- Semillas 7 y 100: CV @50 0,954 y @100 0,970, contra una base de ~0,81, en el oro de Delfino.
- En la muestra manual (62 positivas «Correcto»): cobertura @50 0,95–0,97 (ranker 2026-11-08 21:42). Caveat: el pre-etiquetado usó TF-IDF + actividad, las mismas señales del ranker. (ranker 2026-11-09 13:23)

**general**
- Usar `.venv/Scripts/python.exe` (el `python` suelto puede no tener torch). Si el pip del `.venv` falla, usar `python -m pip`.
- Memoria de Claude: este STATUS más los diarios por tema (desde 2026-11-08). Los logs diarios viejos quedan en `claude_logs/archive/`.
