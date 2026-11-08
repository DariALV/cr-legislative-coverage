# STATUS

Estado actual del proyecto. Se reescribe, no se agrega: lo que deja de ser cierto se borra (la historia queda en los diarios por tema). Las referencias `tema fecha hora` apuntan a la entrada del diario `claude_logs/<tema>.md`.

Última actualización: 2026-11-08.

## Pendiente: decisiones abiertas

Decisiones que se discutieron y nunca se tomaron. Cualquier chat puede retomarlas con el usuario.

### ranker
- **Arquitectura por gradiente (A/B/C)**: (A) 1 neurona / 13 parámetros, (B) 12→16→1, (C) 12→32→16→1, misma CV. Recomendación: la más simple que no pierda. Es lo que falta para cerrar #68. (ranker 2026-11-07 14:14, 20:15)
- **Ajustes al GA**: ampliar el rango de pesos (bm25 topa en +5), sembrar la generación 0 con la base, CMA-ES, selección por truncamiento. Ninguno decidido. (ranker 2026-11-07 20:15; #68)
- **Detalles "a confirmar" nunca confirmados**: la base de comparación es exposition sola (no la mezcla RRF), y la generación 0 es al azar. (ranker 2026-11-07 15:26; #68)
- **K final del pipeline**: recomendación de Claude: según el costo de Jev (100 si alcanza), decidido con la muestra manual y por medio. Las corridas usan K = 100. (ranker 2026-11-07 13:37; #41)
- **Fuentes extra de candidatos**: diputado nombrado + actividad cercana; reglas para presupuesto y apodos; por chunk o con LLM para notas tipo lista (#35); pasada desde el expediente para los "sin cobertura"; reranker cross-encoder sobre el top-200; fine-tuning contrastivo (para después). (ranker 2026-11-07 13:37–13:50; #33 #36 #41)

### datos
- **`status` con pasos de archivo**: ¿se marcan como archivados los 255 "in progress" que tienen un paso "ARCHIVO…" (165 como último paso; 195 con el plazo cuatrienal vencido)? Bloquea el cierre de #66, junto con marcar los expedientes vivos en el período. (data 2026-11-07 01:05)
- **Duplicados de noticias**: 80 pares url / url-2 de Delfino (la -2 es un resumen) y 101 republicaciones de Nación. (data 2026-11-07 01:05; #16)
- **Boilerplate antes de embeber**: avisos de opinión de Delfino (~1.200), avisos de IA de Nación (788), data line de El Mundo (2.749/3.388). Los embeddings ya se corrieron sin limpiar. (data 2026-11-07 01:05; #16 #32)
- **Semanario sin autor**: las 2.222 notas tienen `author` vacío. (data 2026-11-07 01:05; #16/#18)

### muestra
- **Expedientes que no son proyectos de ley** (comisiones investigadoras, nombramientos, reformas al Reglamento): ¿cuentan como positivas? Hoy se marcan en "Tipo de expediente". (sample 2026-11-07 13:35; #27 #29)
- **Anuncio que después se vuelve expediente**: hoy es negativa "Anunciado sin expediente", con el expediente en "alternativos". Hay un caso (25859) que quedó como positivo de confianza media. (sample 2026-11-07 13:35, 14:37; #27 #28)
- **Las 47 negativas de confianza alta**: ¿las revisa Claude en detalle? Costo ~1 M de tokens. (sample 2026-11-07 19:16)
- **Usar los candidatos del ranker para revisar negativas**: ayuda, pero sesga la revisión. Sin respuesta. (sample 2026-11-07 16:51)
- **Oro con número y nombre enmascarados** para medir el sesgo del oro de Delfino. Propuesto, nunca decidido. (embeddings 2026-11-07 12:52; #38)

### embeddings (elegidos por Claude sin confirmar; reversibles, prioridad baja)
- **`EmbeddingRunner`**: el tamaño de chunk incluye el título (cuerpo mínimo de 64 tokens); los 56 expedientes sin materias caen al nombre; se descartan los números sueltos en materias; batches de ~8.192 tokens. (embeddings 2026-11-07 03:10)
- **Analizador**: se elige por recall@30, los empates cuentan a favor, "mean" renormalizado, estratos micro. (embeddings 2026-11-07 12:59)
- **Control con ~12 % de overlap**: lo recomendó Claude y nunca se corrió. (embeddings 2026-11-06 22:45)

## En espera: acciones pendientes

- **Corrida `--all-news`** en la RTX 2060: `python run_embeddings.py --model qwen3-0.6b --all-news` (~75 min, 128.748 chunks). No consta que se haya corrido. #32 sigue abierto hasta tener esa corrida y su análisis.
- **Evaluar embeddings y ranker en la muestra manual** cuando cierre la revisión humana. Requiere `--all-news`. (#41 #68)
- **Revisión humana de la muestra**: el usuario revisa las positivas y las "Sin relación", y confirma las propuestas "Corregir"/"Dudoso" de Claude. Después: las 15 de Delfino (cola aparte), el doble etiquetado a ciegas de 20 noticias (#30) y exportar a CSV.
- **Comentario en #68** con los resultados de las corridas con exclusión.
- **Sin commitear**: `results/sample/negatives_review_pilot.csv`.
- **Entre máquinas a mano** (no van en git): la base, `databases/embeddings/`, `databases/retrieval/`, `.env`, `raw/`.

## Estado por tema

**datos** (#16 #66 abiertos; #22 #65 cerrados)
- 5.898 expedientes (20000–25897). `bill_texts`: 5.411 ok, 264 no_exposition, 223 no_text. Texto en `raw/text/asamblea/bills/`.
- Votos de la lista de Delfino: 9.285 votaciones (8.876 plenary, 409 full_committee) y 513.432 votos. El matcher cruza todos menos 5.
- 235 diputados, 1.880 órganos. 29.875 noticias (mayo–oct 2026).

**explorador** (#67 cerrado): `private_visuals/db_explorer/server.py`, de solo lectura, en localhost:8765 (`db-explorer` en launch.json). Fotos de 168/230 diputados.

**embeddings** (#32 abierto; #6 #38 cerrados)
- bge-m3 y qwen3-0.6b embebidos en el oro y en los 5.898 expedientes (3 variantes).
- Mejor configuración: **qwen3-0.6b / 256 / exposition / max** (recall@30 0,773 y @50 0,805).
- Hay 2.000 noticias de fondo embebidas. El flag `--all-news` está commiteado.

**muestra** (#27–#31 abiertos; #25 #26 cerrados)
- 300 noticias (100 positivas / 200 negativas) de 316 sorteos, en Google Sheets (columna "En la muestra"). Solo se usa como test.
- Claude revisó las 34 negativas de confianza baja/media: 19 Correcto, 10 Corregir, 5 Dudoso, escritas con el prefijo "Claude:".

**ranker** (#33 #41 #68 abiertos)
- GA en `tools/evolution_tools/`, 29 genes, fitness por lotes en la GPU (~0,12 s por generación con el cargador conectado; con batería es mucho más lenta).
- Se excluyen las noticias-agenda (≥ 15 links: 14 noticias), con reporte aparte.
- Semillas 7 y 100: CV @50 0,954 y @100 0,970, contra una base de ~0,81. Medido solo en el oro de Delfino.

**general**
- Esta máquina es la "mala": no tiene numpy ni torch, y el pip del `.venv` está roto (usar `python -m pip`). Embeddings y evolución corren en el portátil con la RTX 2060.
- Memoria de Claude: este STATUS más los diarios por tema (desde 2026-11-08). Los logs diarios viejos quedan en `claude_logs/archive/`.
