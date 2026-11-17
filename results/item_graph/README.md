# Grafo propio por ficha: parámetros y calidad de la similitud (#71)

Análisis para el grafo chico que muestra cada ficha del sitio: expedientes parecidos en la ficha de un expediente y noticias parecidas en la de una noticia. El árbol se arma desde el ítem de la ficha (A): entra primero el candidato con mejor `w·sim(arista) + (1−w)·sim(Y, A)`, y cada nodo cuelga del nodo P ya presente que maximiza `a^profundidad(P)·sim(Y, P)`. Las aristas salen de los 10 vecinos más parecidos de cada ítem, solo entre lo publicado y sobre un piso de similitud.

Embeddings: expedientes con la exposición de motivos entera (qwen3-0.6b, `bills_exposition.npz`; el nombre cuando no hay exposición); noticias con el promedio de sus fragmentos sin texto repetido (`news_pooled.npz`, de `private_visuals/graph/build_news.py`).

## Archivos

- `analyze_params.py` → `params.csv` (métricas por tipo, grupo, piso, a y w) y `similarity.json` (distribución de cosenos y pares más cercanos). También escribe `examples.json` (fuera de git).
- `trees_page.py` → `trees.html`: árboles de ejemplo lado a lado. Se sirve con la config `item-graph` de `.claude/launch.json` (http://localhost:8772/trees.html).
- `relatedness_pairs.py` y `relatedness_test.csv`: prueba a ciegas de si el coseno refleja una relación real entre expedientes (sin los textos).

## Resultados

**a y w** (tope 50, todas las fichas publicadas: 1.126 expedientes y 2.620 noticias): w decide qué nodos entran y a solo la forma. Con w 0,5 el parecido medio con A es 0,54 en expedientes y 0,69 en noticias, cerca del techo (0,56 y 0,70: los 50 más parecidos sin mirar aristas). Con w 1,0 el nodo más lejano de un expediente se parece a A menos que dos expedientes al azar. Con a 0,9 el árbol tiene unos pocos centros alrededor de A (profundidad media ~3); con a 1,0 se vuelve una cadena de 12 niveles. **Decidido: w = 0,5 y a = 0,9.**

**Piso**: un piso alto no sirve dentro de lo publicado (con 0,8 quedan 842 de 1.126 expedientes sin vecinos). Con 0,55 en expedientes y 0,65 en noticias, el 97 % de las fichas llega a 50 nodos; quedan sin grafo 28 expedientes y 50 noticias.

**Calidad de la similitud** (40 pares de expedientes, 8 por franja, calificados a ciegas por dos instancias de Claude con el nombre y el inicio de la exposición):

| Coseno | Se mostraría como relacionado | Puntaje medio (0–3) |
|---|---|---|
| 0,75–0,93 | 7 de 8 | 2,6 |
| 0,65–0,75 | 4 de 8 | 1,6 |
| 0,55–0,65 | 2 de 8 | 1,1 |
| 0,45–0,55 | 0–1 de 8 | 0,8 |
| al azar | 0 de 8 | 0,1 |

- Las fallas son de parecido de forma, no de tema: dos préstamos para fines distintos (0,69), «solidaridad» en dos leyes sin relación (0,67).
- El nombre y los descriptores del SIL separan peor que la exposición (AUC 0,80 y 0,82 contra 0,93), y mezclarlos no mejora.
- En los árboles, ~90 % de las aristas dibujadas tienen coseno ≥ 0,65. Pero la ficha mediana tiene solo 3 expedientes publicados con coseno ≥ 0,65: un grafo de 50 nodos es sobre todo vecindario. Por eso el grafo arranca con 15 nodos, colorea por parecido con A y engrosa las aristas fuertes.

**Cuidados**: 8 pares por franja dan porcentajes aproximados; los dos lectores son el mismo modelo (su acuerdo del 97 % dice poco de si aciertan); vieron solo los primeros 2.500 caracteres de cada exposición; las noticias no se probaron.
