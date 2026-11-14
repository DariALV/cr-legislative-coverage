# STATUS

Estado actual del proyecto. Se reescribe, no se agrega: lo que deja de ser cierto se borra (la historia queda en los diarios por tema). Las referencias `tema fecha hora` apuntan a la entrada del diario `claude_logs/<tema>.md`.

Última actualización: 2026-11-13 18:50 (README del sitio con el flujo de actualización; commits de la tanda del 13 nov hechos en main. Antes, 2026-11-13 18:44: página de evaluación con enlace al cuestionario, sin commitear. Antes, 2026-11-13 18:07: lista de fechas como línea de tiempo vertical y período de estudio como un palito, sin commitear. Antes, 2026-11-13 16:15: gráfico de cobertura rediseñado, sin commitear y sin ver renderizado. Antes, 2026-11-13 16:00: noticias vinculadas al final de la ficha, sin commitear. Antes, 2026-11-13 15:50: fechas del trámite plegadas bajo el gráfico de cobertura, sin commitear. Antes, 2026-11-13 15:33: votaciones como círculos por fracción, sin commitear. Antes, 2026-11-13 15:12: texto del proyecto movido arriba en la ficha y aclaraciones pasadas a metodología, sin commitear. Antes, 2026-11-13 12:20: texto base del proyecto en la ficha del expediente, sin commitear. Antes, 2026-11-11 20:22: hosting decidido, formulario y licencia ocultos, commits en siteV1. Antes, 19:21: mociones resumidas en tabla, hecho sin commitear. Antes, 19:12: lista de lo que falta para el sitio y el reporte final, y pendiente de las mociones. Antes, 18:29: sitio conectado a los datos reales con export_public.py, sin commitear. Antes, 16:46: piloto de la evaluación a ciegas de Jev listo: sorteo de 50 y página local probada, sin commitear; el usuario contesta las 6 del piloto. Antes, 16:41: opacidad de los nodos y «Ocultar la red» hechos y verificados; commiteados en c60c7b4 con sus logs; antes, «Agrupar por», figuras y apariencia commiteados y pusheados hasta c4ef6f5. Antes, 16:11: propuesto el rediseño de la muestra para evaluar a Jev a ciegas, esperando respuesta del usuario; 15:55: repaso de lo que falta para cerrar los milestones 1–5).

## Para retomar

La corrida de Jev sobre el corpus está completa: 3.662 de 7.431 noticias con match (6.329 pares), todas con detalle; $11,51 (puerta $10,08 + detalle $1,44) (jev 2026-11-10, «Corrida del corpus hecha» y «Detalle partido en tandas»). Resultados en results/jev/corpus/. Falta:
1. **Consola**: saldo esperado ≈ $5,81 (antes $17,32); jev-gate debería marcar 239.917.863 tokens y jev-details 34.214.169.
2. **Análisis del corpus hecho con los dos niveles** en results/jev/corpus_analysis/ (README.md, mention/, substantive/, match_review.csv; jev 2026-11-10, «Análisis del corpus rehecho»): mención = explícito ≥ 0,5 o implícito ≥ 0,75 (4.671 pares, ~78–85 %); cobertura sustantiva = además centralidad ≥ 0,25 (3.462 pares, ~88–91 %). Votos filtrados a mayo–octubre y tablas rehechas con la base recargada: posición atribuida vs. voto 92,2 % (130/141) (jev 2026-11-10 17:20). Sin commitear. **Pendiente de alcance:** el plan del entregable 1 deja fuera comparar o rankear medios, diputados o partidos (general 2026-11-10, «pendiente: el análisis por medio…»). Recomendación: validación + descripción por expediente; lo de medios y partidos, solo descriptivo o fuera del sitio. **Prioridad:** corpus público (#44 #45 #46), sitio (#48–#51, viernes 13) e informe (domingo 15). Visor: `private_visuals/jev_answers/` (#69).
3. **Git**: answers.jsonl pesa 133 MB (6,8 MB comprimido). Propuesta: commitear los .gz y dejar fuera los CSV grandes, que se regeneran. El usuario lo deja para después; hasta entonces, results/jev/corpus/ no se commitea.
3. **Formato en la base pública**: columnas extra o tabla relacional (news_id, bill, pregunta, opción, probabilidad, confidence, ...). Lo decide el usuario.
4. **Commits**: todo lo de Jev, grafos (#69), visor de respuestas (#69), modelo de costos (#43) y logs está commiteado y pusheado (general 2026-11-10 21:10). Los extras de grafos (eb54531), la segunda ronda (deab287) y la pestaña de noticias con el arreglo del motor (8d1505b) están commiteados y pusheados (2026-11-11 11:04, hasta 8208a5b). «Agrupar por», figuras y apariencia de los grafos (271c594) y sus logs (c4ef6f5) están commiteados y pusheados (2026-11-11 16:24). Esta nota de STATUS va en el próximo commit de logs. En el árbol quedan claude_logs/general.md y sample.md, de otro chat (cierre de milestones y rediseño de la muestra), sin commitear. Del mismo chat, también sin commitear: la evaluación a ciegas (config.py, run_human_eval.py, tools/sample_tools/human_eval_draw.py, results/jev/human_eval/draw.csv, private_visuals/jev_eval/ y la entrada `jev-eval` de .claude/launch.json); no llevan texto de noticias. Sin commitear solo results/jev/corpus/ y results/jev/jev_corpus.zip (decisión pendiente del punto 3). El respaldo databases/private_corpus.backup_2026-11-10.db ya está en el .gitignore. En main está también `site/` (scaffold Astro de andrik, 18d064b).

## Pendiente: decisiones abiertas

Decisiones que se discutieron y nunca se tomaron. Cualquier chat puede retomarlas con el usuario.

### cierre de los milestones 1–5 (general 2026-11-11 15:55)
- **Cerrar ya #27 #28 #33 #34**, cada uno con su comentario de cierre (#34 explica que no hay temperatura y que hay varios expedientes por noticia). Esperando el visto bueno.
- **Alcance, con la recomendación entre paréntesis**: #35 (not planned); #36 → #37 #40 (baseline mínimo de número + nombre oficial en las 300, local y gratis); #68 (solo la variante A, o la comparación a future.md); #30 (con Andrik si puede, si no not planned); #16 (documentar sin limpiar y cerrar: los duplicados son 6 de 6.329 pares); #19 (leer los términos de Delfino y decidir qué se publica); cola de 15 de Delfino de #27 (dejarla como limitación).
- **Docs #18 #31 #42**: docs/news.md, docs/sample.md y docs/matching.md, en inglés como bills.md (propuesto).
- **Camino crítico**: cambió con el rediseño aprobado (sample 2026-11-11 16:46). La muestra de 300 se congela como está y ya no espera la revisión humana. Ahora el camino crítico es la evaluación a ciegas: piloto de 6, después las 50 y la corrida de Claude. Los cambios en GitHub a #27–#31 (cerrar, re-enfocar #30, issue nuevo en M5) esperan el visto bueno del usuario.

### grafos (#69; jev 2026-11-11 10:14, 10:55)
- **Siguientes conexiones**: en noticias, «misma historia» (cada noticia con la más parecida de los 7 días anteriores) y «mismo autor» (cadena por fecha); en expedientes, comisión como color y grupo (solo 1.094 con comisión); en diputados, mencionados juntos en noticias (hay que buscar nombres). Ninguna arrancada.
- **Si al mover la cámara el mapa de noticias se siente lento** (80–110 ms por cuadro con todo a la vista): guardar el último cuadro como imagen y moverla durante el gesto, o la física en un Web Worker. WebGL solo para 100k nodos o más.

### ranker
- **Arquitectura por gradiente (A/B/C)**: (A) 1 neurona / 13 parámetros, (B) 12→16→1, (C) 12→32→16→1, misma CV. Recomendación: la más simple que no pierda. Es lo que falta para cerrar #68. (ranker 2026-11-07 14:14, 20:15)
- **Ajustes al GA**: sembrar la generación 0 con la base, CMA-ES, selección por truncamiento. Ninguno decidido. El rango de pesos se queda en ±5 (ranker 2026-11-09 13:42). (ranker 2026-11-07 20:15; #68)
- **Fuentes extra de candidatos**: diputado nombrado + actividad cercana; reglas para presupuesto y apodos; por chunk o con LLM para notas tipo lista (#35); pasada desde el expediente para los "sin cobertura"; reranker cross-encoder sobre el top-200; fine-tuning contrastivo (para después). (ranker 2026-11-07 13:37–13:50; #33 #36 #41)

### datos
- **`status` con pasos de archivo**: ¿se marcan como archivados los 255 "in progress" que tienen un paso "ARCHIVO…" (165 como último paso; 195 con el plazo cuatrienal vencido)? Bloquea el cierre de #66, junto con marcar los expedientes vivos en el período. (data 2026-11-07 01:05)
- **Duplicados de noticias**: 80 pares url / url-2 de Delfino (la -2 es un resumen) y 101 republicaciones de Nación. (data 2026-11-07 01:05; #16)
- **Boilerplate antes de embeber**: avisos de opinión de Delfino (~1.200), avisos de IA de Nación (788), data line de El Mundo (2.749/3.388). Los embeddings ya se corrieron sin limpiar, y a nivel de fragmento no se pueden quitar: solo 187 fragmentos salen repetidos (jev 2026-11-11 10:55, «hallazgo: el boilerplate…»). (data 2026-11-07 01:05; #16 #32)

### muestra
- **Evaluación a ciegas, lo que queda por decidir** (sample 2026-11-11 16:11, 16:46): (1) cuándo lanzar el piloto de Claude con 20 (Opus 5.5 con effort high; gasta uso del plan): no se lanzó, espera el visto bueno. (2) Después del piloto humano: 50 o 30 noticias, según el tiempo medido. (3) Los cambios en GitHub (cerrar #27 #28, #29 con la advertencia, #30 como acuerdo humano–Claude–Jev, #31 con las dos muestras, issue nuevo en M5).
- **Trámite ya concluido de una ley vigente** (ahora pesa: es la principal fuente de falsos positivos de Jev en la muestra, jev 2026-11-09): aprobado que no cuenta si la ley solo se nombra como antecedente (va en «Otros mencionados»). Falta decidir si cuenta una nota sobre los efectos o la aplicación de la ley, porque eso choca con #25 («una ley vigente que se aplica no cuenta»). Recomendación: mantener #25 y contarla solo si informa un paso del trámite (aprobación, firma, veto, publicación). Filas 23 (24259), 62 (24789), PAACUME (23003). (sample 2026-11-09, «pendiente: … choca con #25»)
- **Usar los candidatos del ranker para revisar negativas**: ayuda, pero sesga la revisión. Sin respuesta. (sample 2026-11-07 16:51)
- **Oro con número y nombre enmascarados** para medir el sesgo del oro de Delfino. Propuesto, nunca decidido. (embeddings 2026-11-07 12:52; #38)

### jev

### jev (pendientes viejos del diseño; diario `claude_logs/jev.md`)
- Siguen abiertos de las pruebas del 2026-11-08: desambiguación entre expedientes hermanos (25400/25800), y probar más noticias de paso, decreto, anunciado y ley vigente. (general 2026-11-08 20:05)
- **Separar llaves en run_jev.py** (puerta → `jev-gate`, detalle → `jev-details`): hoy corre las dos etapas juntas con una sola llave. Ver «Para retomar» 4.

## Decisiones vigentes

- **Evaluación a ciegas de Jev** (aprobada; sample 2026-11-11 16:11, 16:46): 25 noticias con match y 25 sin match (5 por medio en cada grupo, sin las 1.167 ya usadas con Jev, sin noticias con más de 3 matches), contestadas a mano con todas las preguntas de Jev en la página local `private_visuals/jev_eval/` (puerto 8770, `jev-eval`), sin ver nada de Jev. Claude contesta las mismas 50 más ~500 nuevas como segundo evaluador. Se mide la puerta por par y por noticia, el acuerdo por pregunta y Claude contra el humano. La muestra de 300 queda congelada para el match y el ranker.
- **Grafos: «Agrupar por» y apariencia** (hecho, verificado y commiteado en 271c594; jev 2026-11-11 15:41, 15:58, 16:20; opacidad de los nodos y «Ocultar la red», jev 16:39, 16:41, en c60c7b4): selector «Agrupar por» aparte del color, con «Juntar los grupos» (se prende solo al agrupar en Noticias) y «Figuras» (densidad que encierra ~80 % de los nodos, difuminada hacia afuera y mezclando colores; gris si se agrupa por algo distinto del color), en Noticias, Expedientes y Diputados. Controles de apariencia por pestaña: opacidad de enlaces (en 0 quedan solo los del nodo bajo el puntero o seleccionado), de fotos y de figuras; tamaño y opacidad de los nombres de grupos y de nodos; cuántos nombres. Se recuerdan en el navegador; las fuerzas no. Entre visitas se recuerda solo el mapa sin juntar. La composición por grupo queda para después. (#69)
- **Pestaña de noticias y motor** (jev 2026-11-11 10:55): las 29.875 noticias con filtros Asamblea / con expediente (cobertura sustantiva, como las otras vistas de prensa); conexiones por contenido (6 vecinos por subconjunto, coseno ≥ 0,6, embeddings qwen3 promediados sin fragmentos repetidos) y por mismo expediente (cadenas por fecha); color por medio, tema, género, mes y tono; «Separar por color» (reemplazado por «Agrupar por», ver arriba); posición inicial por PCA. En el motor, enlaces finos a 0,95 px físicos, nodos diminutos como cuadrados y como mucho 40.000 enlaces por cuadro. (#69)
- **Grafos, segunda ronda** (en curso; jev 2026-11-10 23:13): selector de tipo de conexión en cada vista (expedientes: exposición, nombre, descriptores, firmantes; diputados: co-votación, co-firma, comisiones; partidos y temas: prensa, autoría; co-mención: sustantiva o con menciones de paso; flujo y tiempo: columnas o capas a elegir) y ventana de tiempo por fecha de presentación con atajos por legislatura. (#69)
- **Visualizaciones gráficas**: todas las propuestas, de a pocas, en la página nueva `private_visuals/graph/` (grafo de fuerzas estilo Obsidian, D3 + canvas). Color «cobertura»: gris sin cobertura, casi negro sin cobertura y > 4 años, rojo→verde por stance de Jev. Co-votación: solo votaciones disputadas (minoría ≥ 10 %), promedio por expediente; colores reales de partido solo en el grafo. Partido × tema usa la posición según la prensa, no los votos (en debates todos votan a favor 90–100 %). Extras: co-mención solo con cobertura sustantiva; la etapa del flujo es la que dice la noticia (`stage` de Jev), no la del SIL; 10 temas + «Otros» en flujo y streamgraph; streamgraph semanal con río, apilado y porcentaje. (jev 2026-11-10 17:05, 17:44, 18:02, «decisión: diseño de los tres extras»; #69)
- **El análisis del corpus usa solo los votos de mayo–octubre** (PERIOD), aunque la base tenga votos desde 2018; el visor usa un mes de margen. (jev 2026-11-10 17:20)
- **Antes de cada commit se revisa privacidad y ética** (nada de cuerpos de noticias, .env, llaves ni datos personales; se avisa siempre que haya riesgo). Regla en CLAUDE.md. (general 2026-11-10 12:39)
- **Candidatos = top-50 del ranker ∪ expedientes nombrados por número**, sin reentrenar. Se reporta en candidates.csv (source, named, rank real) y en candidates_report.json; caveat comentado en #33. (ranker 2026-11-10, «decisión e implementación: candidatos»)

- **Filtro de Jev sobre el corpus**: `run_jev_filter.py` (pregunta assembly, noticia bajo `news`, sin genre); se guardan todas las probabilidades y el **umbral es 0,2**, confirmado por el usuario (jev 2026-11-10 09:41). Gasto medido con una llave por etapa + saldo antes/después de cada corrida. (jev 2026-11-10 01:09, 01:10; #43)
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

- **Sitio con datos reales: hecho, sin commitear** (general 2026-11-11 18:14, 18:29, 19:00): ver la sección «Sitio y reporte final: lo que falta».

- **Piloto de la evaluación a ciegas: lo contesta el usuario** (sample 2026-11-11 16:46). Son 6 noticias en http://localhost:8770 (`jev-eval` en launch.json, o `python private_visuals/jev_eval/server.py`). Al terminar, la página muestra los minutos activos. Con eso se decide 50 o 30, y se pasa a `--set all`. Las respuestas van a results/jev/human_eval/answers.json. Mientras tanto no se abre el visor de Jev ni los grafos.
- **Filtro de Jev: hecho y commiteado** (7.431 de 29.698 pasan con 0,2; 36.667.609 tokens, igual en la consola; $1,54; jev 2026-11-10 09:41). Siguiente: ranker top-50 → puerta (llave jev-gate) sobre las que pasan. (#43)
- **Presupuesto de Jev**: $20 en total: $5 de pruebas y $15 para el corpus. Gastado del corpus: filtro $1,54 (incluye el piloto). **Saldo en la consola: $2,48** (jev 2026-11-10 09:41): falta cargar el resto antes de la puerta; quedan ≈ $13,5 del presupuesto para puerta y detalle. Antes de cada corrida de Jev: recordarle al usuario revisar que la llave activa sea la de la etapa (tests/filter/gate/details) y anotar el saldo. (jev 2026-11-09 «decisión: presupuesto»; jev 2026-11-10 01:09)
- **Prueba en la muestra repetida con el sistema final** (results/jev/sample_final/, $0,44; jev 2026-11-10, «Muestra de 300 repetida»). En las Correcto: recall del ranker 0,955; umbral 0,5 → recall 0,866, precisión 0,806, «ninguno» 0,969; mención → 0,687 / 0,902 / 0,984; sustantiva → 0,672 / 0,918 / 0,984. Con la muestra congelada: exportar la pestaña Etiquetas a CSV y correr `run_jev_eval.py --name sample_final` (no hace falta volver a correr Jev). (#34 #39)
- **Evaluar embeddings y ranker en la muestra manual**: el ranker ya se evaluó en las 189 «Correcto» (cobertura @30 ≈ 0,95–0,97; ranker 2026-11-08, entrada «decisión: evaluar el ranker…»). Falta repetirlo cuando cierre la revisión humana y evaluar los embeddings solos. (#41 #68)
- **Muestra de 300 congelada** (sample 2026-11-11 16:46): ya no espera la revisión humana. Se usa con las etiquetas que tiene (pre-etiquetado y revisión de Claude, más la revisión parcial del usuario), y eso va como advertencia en el informe. La cola de 15 de Delfino y el doble etiquetado de 20 (#30) quedan fuera; el acuerdo se mide en la evaluación a ciegas.
- **Comentario en #68** con los resultados de las corridas con exclusión.
- **Fuera de git** (se copian a mano): la base, `databases/embeddings/`, `databases/retrieval/`, `.env`, `raw/`.
- **Datos crudos de Jev**: respuestas de la API y scripts en `results/jev/answers/` y `results/jev/scripts/` (jev 2026-11-09 10:00); los scripts leen `TYPESAFE_API_KEY` de `.env`.

## Sitio y reporte final: lo que falta (#48–#51, #56)

Máquina del usuario (la del sitio); los datos están en `databasesV1/`, `rawV1/`, `resultsV1/` (ya en el `.gitignore`). Diario: general 2026-11-11 18:14, 18:29, 19:00, 19:12, 19:21. En los logs no se escribe el nombre del usuario ni el del compañero («el usuario», «el compañero»).

**Hecho, commiteado y mezclado a `main` (PR #70, 2026-11-13):** `export_public.py` (correr con `--database databasesV1/private_corpus.db --jev-dir resultsV1/jev/corpus`), vocabulario del sitio en español, metodología sin relleno, `IS_DUMMY_DATA = false`. El sitio compila: 3.751 páginas.

**Cifras para el reporte** (cobertura sustantiva: explícito ≥ 0,5 o implícito ≥ 0,75, y centralidad ≥ 0,25):
- Recolectado: 5.898 expedientes, 29.875 noticias (29.698 con texto), 9.288 votaciones, 5 medios, mayo–octubre 2026.
- Pipeline: 7.431 noticias pasan el filtro; 50 candidatos por noticia; 6.329 pares con match; 4.671 de mención; 3.462 sustantivos.
- Publicado: 3.462 vínculos (751 `enlace`, 2.711 `modelo`), 2.620 noticias, 1.126 expedientes (570 con cobertura, 556 solo con actividad), 617 votaciones en detalle y 4.106 mociones resumidas en tabla (decisión del usuario, general 19:21).
- Evaluación (preliminar): candidatos 95 %; precisión 88–91 % (190 pares) y 92 % en la muestra; exhaustividad 67 %; noticias sin expediente sin vínculo 98 %. Costo de Jev: $11,51 + $1,54 del filtro.

**Decisiones abiertas del usuario:**
2. Temas = descriptores del SIL (1.965 distintos, hasta 144 por expediente). Recomendación: mostrar 5–6.
3. Mayúsculas del SIL en nombres, títulos y fracciones.
5. Actualizar o borrar `site/scripts/make_dummy_data.mjs` (desfasado).
6. Confirmar lo que Claude eligió: «actividad» (presentado, paso o votación en el período), confianza = máx(explícito, implícito), y que 674 de los 1.425 enlaces de Delfino quedan fuera por no ser sustantivos.

**Hosting (decidido, general 2026-11-11 «decisión: hosting en GitHub Pages»):** GitHub Pages desde este repo; workflow en `.github/workflows/deploy.yml` con `path: site`, base `/cr-legislative-coverage`. Commiteado en la rama `siteV1`, sin push. Falta: push, mezclar a `main` y que el compañero active Pages (Source: GitHub Actions). El sitio no necesita hostear la base.

**Texto del proyecto en la ficha (hecho y commiteado el 2026-11-13; general 2026-11-13 10:53 y «decisión: el texto base…»):** `export_public.py` copia 1.053 textos base a `site/public/textos/` (33 cortados a 150.000 caracteres, 73 sin texto) y la ficha los muestra en un recuadro con scroll (`BillText.astro`), con enlace a la entrada del SIL. Correr el exportador con `--texts-dir rawV1/text/asamblea/bills` en la máquina del usuario. La sección va arriba, después de las tarjetas; las aclaraciones del texto y la nota de fuentes están en metodología (Fuentes), y el aviso de origen de los vínculos ya no lleva recuadro gris (general 2026-11-13 15:12). A confirmar por el usuario: la línea corta de fuente que quedó bajo el texto (el pie con enlace a Metodología se quitó).

**Fechas del trámite plegadas (hecho y commiteado el 2026-11-13; general 2026-11-13 15:50):** la lista de eventos de «Cobertura y trámite» va en un desplegable cerrado (`Timeline.astro`).

**Orden de la ficha (commiteado el 2026-11-13; general 2026-11-13 16:00):** Texto del proyecto, Cobertura y trámite, Votaciones, Proponentes, Noticias vinculadas.

**Gráfico de cobertura rediseñado (hecho y commiteado el 2026-11-13; general 2026-11-13 16:15):** noticias sobre un eje con un círculo por mes, trámite debajo, período de estudio como un palito en su inicio; lista de fechas como línea de tiempo vertical (general 2026-11-13 18:07). Nadie lo ha visto renderizado todavía: el usuario debe revisarlo en `astro dev`. A confirmar: marcas agrupadas por rango cuando hay varios eventos el mismo día.

**Página «Evaluación de la página» (hecho y commiteado el 2026-11-13; general 2026-11-13 18:44):** `evaluacion.astro`, enlazada en el pie, con el objetivo y el botón al cuestionario (`EVALUATION_FORM_URL`). A confirmar por el usuario: el texto del objetivo, redactado por Claude.

**Votaciones como círculos por fracción (hecho y commiteado el 2026-11-13; general 2026-11-13 15:33):** un círculo por diputación coloreado por fracción (`site/src/lib/parties.ts`), tabla por fracción en un desplegable. Vista anterior recuperable con `layout="table"` en `VotesTable`. A confirmar por el usuario: los colores de las ocho fracciones de legislaturas anteriores, elegidos por Claude. Falta probarlo en el navegador. Falta: probarlo en el navegador; correr `download_bill_documents.py` (sin probar, necesita la caché del SIL del compañero) y decidir dónde alojar los .docx (~225 MB) si se quieren ofrecer.

**Confirmar con el compañero:** que el recorte de notas largas (15.000 caracteres) deja el inicio; que «Jev 1.14» se puede nombrar en público; que no se publican fotos de diputados (la metodología lo afirma).

**Falta para publicar:** URL del formulario de reporte y licencia de los datos (ocultos mientras `REPORT_FORM_URL` y `DATA_LICENSE` sean `null` en `site/src/lib/config.ts`); recalcular las cifras de la constante `RUN` de metodología con el CSV final de la muestra.

**Problemas conocidos:** 157 proponentes sin fracción (Poder Ejecutivo y sin cruce); 17 expedientes sin temas; dist pesa 103 MB; la línea de tiempo ya no marca las mociones; un expediente (25894) presentado después del período entra por cobertura o por un paso; republicaciones de notas (80 pares de Delfino, 101 de Nación) no se depuraron.

## Para redactar el reporte: cuidados con los números (#56)

- Margen: en la muestra hay 62 positivas «Correcto», así que el recall 0,87 de ranker → Jev es ~0,79–0,95. Por medio hay 12–19 positivas: no alcanza para afirmar que un medio sale mejor que otro.
- Etiquetas: las «Correcto» incluyen propuestas de Claude aceptadas por el usuario, y la revisión humana no ha cerrado. Los números se recalculan con el CSV final.
- Recall optimista: el pre-etiquetado usó las mismas señales que el ranker (TF-IDF, actividad en el SIL). Las positivas que se escaparon al etiquetar se parecen a las que se le escapan al ranker.
- Test limpio: las preguntas de Jev se ajustaron mirando la muestra (oficialismo, cifras, ley vigente, mismo tema). Hay que decirlo en el reporte, o validar los cambios con el oro de Delfino.
- Leyes vigentes: Jev cuenta como match las menciones de fondo a leyes ya aprobadas. Es la principal fuente de falsos positivos (decisión 8).
- Expedientes hermanos con el mismo nombre (25400 / 25800) se confunden: queda como limitación.
- Centralidad: usar el valor continuo. Ordena bien las etiquetas (De paso 0,70, Secundario 0,90, Central 1,78 en la escala 0–2), pero sobreestima las menciones de paso.

## Estado por tema

**trabajo a futuro** (diario nuevo `future.md`, 2026-11-10): ideas por tema (abaratar el pipeline bajando K, otras miradas como leyes vigentes o «dice frente a vota», nuevas fuentes públicas, productos). Solo ideas, nada decidido.

**datos** (#16 #66 abiertos; #22 #65 cerrados)
- 5.898 expedientes (20000–25897). `bill_texts`: 5.411 ok, 264 no_exposition, 223 no_text. Texto en `raw/text/asamblea/bills/`.
- Votos de Delfino: 9.288 votaciones (8.879 plenary, 409 full_committee; 2018-05-17 a 2026-11-09) y 513.660 votos, recargados el 2026-11-10 porque la base se había reemplazado por una copia vieja. Sin cruce solo «Cynthia Córdoba Serrano». Respaldo de la base parcial: `databases/private_corpus.backup_2026-11-10.db` (ignorado en git; borrar cuando no haga falta). (data 2026-11-10 16:56, 17:04)
- 235 diputados, 1.880 órganos. 29.875 noticias (mayo–oct 2026).

**explorador** (#67 cerrado): `private_visuals/db_explorer/server.py`, de solo lectura, en localhost:8765 (`db-explorer` en launch.json). Fotos de 168/230 diputados.

**visor de Jev** (#69, cerrado en GitHub el 2026-11-11 11:04; los commits de grafos lo siguen citando): `private_visuals/jev_answers/`, página estática en localhost:8766/jev_answers/ (`visuals` en launch.json). Vistas por noticia y por expediente + pestaña «Análisis» (partidos, votos vs prensa, medios, rankings, proponentes y comisiones, cruces, polémicos, línea temporal). Línea temporal con los 1.420 expedientes (381 activos sin cobertura) y botón en cada expediente. Hecho, verificado y commiteado (jev 2026-11-10 15:23, 15:54, 16:32). Prensa vs voto: 94–100 % de coincidencia por partido.

**grafos** (#69): `private_visuals/graph/`, en localhost:8766/graph/ (o `visuals-alt`, 8768, si el 8766 está ocupado). Tres pestañas: (1) **Expedientes** (`index.html`, datos con `build_graph.py`, necesita `networkx`): 5.898 expedientes, 26 temas Louvain; color por tema, cobertura, estado o posición de un partido. Commiteado (361b255) salvo el modo «Partidos». (2) **Diputados** (`deputies.html`, `build_deputies.py`): co-votación por legislatura, umbral ajustable, fotos. En 2026–2030: PPSO vota 8–23 % igual que la oposición; PLN–FA 69 %. (3) **Partidos y temas** (`parties.html`): posición que la prensa le atribuye a cada partido por tema; 101 enlaces, solo 3 en contra (FA). (2) y (3) hechos, verificados y commiteados. Extras hechos, verificados y commiteados (eb54531; jev 2026-11-10, «Extras de grafos hechos»), sobre la tabla de 3.462 pares sustantivos que `build_graph.py` deja en bills.js: (4) **Co-mención** (`comentions.html`): expedientes que salen en la misma noticia; 393 expedientes y 1.175 pares, arranca en 2 noticias en común (143 y 192). (5) **Flujo** (`flow.html`): medio → tema → etapa según la noticia, con color por columna, filtro al hacer clic y puntos animados. (6) **En el tiempo** (`stream.html`): pares por semana y tema (27 semanas), río / apilado / porcentaje. Caveats comentados en #69. (jev 2026-11-10 17:27, 17:49, 18:07). **Segunda ronda** (commiteada en deab287; el trabajo de 23:13 a 04:15 no dejó entradas en el diario): selector de conexiones en Expedientes (exposición, nombre, descriptores, firmantes; lee `output/graph/neighbors.js`; carga sin errores, no se probó a fondo) y en Diputados (co-votación, co-firma, comisiones; verificado), ventana por fecha de presentación en Expedientes y cambios en engine.js que no se revisaron. Falta el selector en Partidos y temas, Co-mención, Flujo y En el tiempo. La vista de diputados había quedado en blanco por el HTML a medias: arreglada (jev 2026-11-11 09:57). Si una página no cambia después de un arreglo, recargar con Ctrl+F5 (http.server no manda Cache-Control). (7) **Noticias** (`news.html`, datos con `build_news.py`, caché de promedios en `databases/embeddings/qwen3-0.6b/news_pooled.npz`): hecha, verificada y commiteada (8d1505b; caveats en #69; jev 2026-11-11 10:55). Primera carga del mapa completo ~12 s, después abre armado. El 44 % de los enlaces por contenido queda dentro de un medio (25 % por azar). El lag del mapa de expedientes venía de rasterizar enlaces de ≥ 1 px físico: arreglado en el motor (~215 → 25–45 ms por cuadro). (8) **«Agrupar por» y apariencia** en Noticias, Expedientes y Diputados (jev 2026-11-11 16:20): sección «Grupos» con selector, «Juntar los grupos» (ahora también empuja entre grupos solapados) y «Figuras» difusas por densidad; controles de apariencia en las 5 pestañas de fuerzas, guardados por pestaña en el navegador. Hecho, verificado, commiteado y pusheado (271c594); caveats comentados en #69. Después: «Opacidad de los nodos» (se recuerda; las fotos la siguen) e interruptor «Ocultar la red» en Grupos (no se recuerda; el nodo bajo el puntero se sigue viendo), hechos, verificados y commiteados (c60c7b4; jev 2026-11-11 16:41). En Diputados, juntar por provincia casi no separa.

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
