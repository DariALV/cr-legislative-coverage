# ranker

## 2026-11-07 13:37 — Qué significan los resultados para el proyecto y si subir K a 100 (#41, #33, #36, #35, #38)

- Pregunta del usuario: si el resultado es malo o bueno, si conviene K = 100, y un análisis más allá de los números.
- Dato nuevo (script en línea, regex "expediente/proyecto ... 2x.xxx" sobre notas con palabras legislativas): cuánto cita cada medio el número del expediente. crhoy 1,9 % (de 1.811 notas), nacion 13,4 % (2.061), elmundo 11,3 % (1.332), semanario 31,2 % (914), delfino 44,7 % (1.173). O sea, fuera de Delfino casi nunca se cita el número, y el caso dominante es el que en el oro rinde peor (hit@50 0,61 sin número vs 0,91 con número, n = 33).
- Lectura dada al usuario:
  - Como filtro en Delfino, el resultado es bueno. Pero es el caso fácil, y los errores no son al azar: se concentran en expedientes muy mediáticos (presupuesto, apodos), en notas tipo lista (que suelen ser menciones de paso, menos graves si Jev pondera la centralidad) y en menciones implícitas. Ese patrón puede sesgar la comparación entre medios, que es la pregunta del proyecto.
  - K = 100 sube el recall por noticia de 0,805 a 0,855. La fusión exposition + subjects con K = 50 da 0,847 sin más candidatos, y con K = 100 (50 + 50) da 0,877. Más allá de 100 el retorno es poco, y ningún K rescata las notas tipo lista (con K = 500, recall por enlace 0,65 en notas con más de 10 enlaces).
  - Recomendación (sin decidir): (1) fusión exposition + subjects; (2) K por costo de Jev, con 100 si alcanza; (3) candidatos por reglas, como el número del expediente (#36), el presupuesto y los apodos; (4) candidatos por chunk para las notas tipo lista, o extracción directa por LLM (#35); (5) decidir K con la muestra manual midiendo recall por medio (#41), no con Delfino.

## 2026-11-07 13:44 — Cobertura por expediente y mejoras al ranking (#33, #41, #36, #38)

- Preocupación del usuario: marcar un expediente "sin cobertura" cuando sí la tiene. Eso pide medir por expediente: si al menos uno de sus enlaces entra al top-K. Scripts del scratchpad `analysis/billlevel.py`, `improve.py` e `improve2.py`; no se tocó código del proyecto.
- Situación actual (qwen/256/exposition/max, K = 50): de los 577 expedientes del oro, se detecta cobertura en el 73,1 %. En los 251 que tienen una sola noticia baja a 61,8 %; con 2–3 noticias es 77,1 % y con 4 o más, 94,4 %. Con K = 100: 78,2 % (67,3 % con una sola noticia).
- Mejoras probadas (K = 50; por noticia / por enlace / por expediente / expedientes de una sola noticia):
  - Base: 0,804 / 0,606 / 0,731 / 0,618.
  - RRF exposition + subjects (k = 60): 0,856 / 0,677 / 0,787 / 0,673.
  - z-score de cada expediente sobre las noticias, contra la hubness: con exposition sola, 0,787 / 0,592 / 0,757 / 0,637 (sube el nivel de expediente y baja el de noticia). CSLS da parecido.
  - BM25 de la noticia contra nombre + materias, solo: 0,671 / 0,570 / 0,733 / 0,649. RRF de z(exposition) + z(subjects) + BM25: 0,863 / 0,719 / 0,842 / 0,765.
  - Prior de actividad: el expediente tuvo un paso en el SIL o una votación entre 3 días después y 14 días antes de la noticia. El 74 % de los enlaces del oro cumplen esto, contra el 3,1 % de un expediente al azar (~183 activos por noticia). RRF3 + 0,02·activo: **0,929 / 0,855 / 0,913 / 0,865**; con K = 100: 0,950 / 0,894 / 0,941 / 0,900. Con peso 0,04 empeora, porque los activos desplazan a todo lo demás.
- Revisiones: en dos mitades al azar de las noticias, 0,924 y 0,934 con peso 0,02 (estable). Usando solo los pasos del SIL, sin las votaciones de Delfino, para descartar circularidad: el 72 % de los enlaces activos, y 0,922 / 0,848 / 0,908 / 0,857, casi lo mismo.
- Caveats: los pesos se eligieron con el mismo oro; el z-score usa como fondo solo las 532 noticias del oro (en producción serían todas); BM25 premia que se cite el nombre, más común en Delfino; el prior de actividad puede perjudicar la cobertura de expedientes "quietos" (reportajes y opinión sobre proyectos que no se mueven) y quizá funcione distinto en otros medios. Todo esto hay que validarlo con la muestra manual, por medio.
- Idea no probada (no hay vectores de noticias fuera del oro): una pasada desde el expediente para los que queden sin cobertura. Para cada uno, rankear todas las noticias por similitud + BM25 con su nombre y que Jev revise las primeras N. Ataca directo el falso "sin cobertura", con un costo acotado. Otra opción: un reranker cross-encoder sobre el top-200.

## 2026-11-07 13:50 — ¿Entrenar una red con pares de embeddings? (#33, #41, #42)

- Pregunta del usuario: entrenar una red neuronal que reciba el vector de la noticia y el del expediente (2 × 1024 entradas) y dé un valor entre 0 y 1. Se entrenaría con el oro de Delfino y se validaría con la muestra manual.
- Respuesta dada: no la recomendé en esa forma.
  - Hay pocos datos para tantos parámetros: 1.423 positivos, 532 noticias y 577 expedientes distintos, contra ~500 mil pesos en una sola capa de 2048 → 256.
  - Concatenar los dos vectores hace difícil aprender la similitud; se necesitarían al menos |u−v| y u·v.
  - La partición debería ir por expediente y por noticia, o el modelo memoriza los vectores. El 90 % de los 5.898 expedientes nunca aparece en el oro.
  - Aprendería el estilo de Delfino, que cita el número en el 94 % de los enlaces. El caso difícil (mención implícita) casi no está en el entrenamiento: 33 notas de un enlace sin número.
  - Usar la muestra manual para validar o para elegir le quita su papel de test (decisión de las 13:18).
- Alternativas propuestas (sin decidir):
  - (a) Learning-to-rank chico (regresión logística o boosting) sobre ~10 rasgos: coseno y z de exposition y subjects, BM25, activo, rangos. Reemplaza los pesos puestos a mano, con validación cruzada agrupada por noticia sobre el oro.
  - (b) Un reranker cross-encoder ya entrenado (p. ej. Qwen3-Reranker-0.6B o bge-reranker-v2-m3) sobre el top-200, sin entrenar.
  - (c) Para después, si hace falta: fine-tuning contrastivo del embedder.

## 2026-11-07 13:53 — Diseño del ranker aprendido (learning-to-rank): decisiones abiertas (#33, #41, #36)

- El usuario eligió la opción A (modelo chico sobre rasgos). Contexto revisado: no hay scikit-learn ni scipy en el .venv; `bills` trae `date_proposed`, `date_expiry`, `status`, `law_number`; solo hay vectores de las 532 noticias del oro (29.875 en total).
- Decisiones presentadas (pendiente), cada una con recomendación:
  - (1) Rasgos: coseno max de exposition, subjects y name; coseno mean de exposition; z por expediente; BM25; actividad del SIL (en la ventana, días al evento más cercano, número de eventos); vigencia del expediente a la fecha; antigüedad.
  - (2) Afuera del modelo: el número citado (pasa a regla aparte, #36), el nombre literal y las votaciones de Delfino.
  - (3) Fondo del z: una muestra fija de ~2.000 noticias legislativas de todos los medios, que hay que embeber.
  - (4) Modelo: regresión logística con scikit-learn como dependencia nueva, más boosting solo como comparación.
  - (5) Datos de entrenamiento: positivos del oro; negativos difíciles (top-300) + 300 al azar por noticia.
  - (6) Validación: 5 folds agrupados por noticia, más un chequeo con expedientes no vistos.
  - (7) Métrica principal: cobertura por expediente @50 y @100, más las otras.
  - (8) Uso: puntúa los 5.898 expedientes por noticia, y se le une la regla del número.
  - (9) Salidas: coeficientes y métricas en `results/retrieval/` (en git).
  - (10) Código: `tools/retrieval_tools/` + `run_ranker.py`.
  - (11) Caveats en #33.

## 2026-11-07 14:03 — Explicación de los rasgos del ranker con un ejemplo real (#33)

- El usuario pidió que se explicara cada input en concreto. Se usó la noticia "Pueblo Soberano revierte votación y aprueba recorte de ₡8.048 millones al FEES" (2026-10-20, 1.262 palabras). Comparación entre el expediente correcto, 25754 (presupuesto 2027), y el que sale primero, 23380 (ley del FEES):
  - Coseno exposition: 0,422 (rango 1.033) vs 0,692 (rango 1).
  - z: 0,48 vs 3,66.
  - Coseno subjects: 0,469 vs 0,449.
  - BM25: 103 ("2027", "presupuesto") vs 69 ("universidad", "fondo").
  - Eventos del SIL en la ventana: 2 el mismo día (votación y dictamen en comisión) vs 3 de archivo 7–14 días antes.
  - Estado: en trámite vs archivado.
- Hallazgo de diseño: el prior de actividad probado a las 13:4x contaba los eventos de archivo como actividad. Hay que excluirlos, o mejor separar "evento de avance" de "archivo". Queda como punto nuevo del rasgo de actividad, a confirmar con el usuario. Las cifras del prior de esa entrada pueden cambiar un poco.

## 2026-11-07 14:14 — Arquitectura del ranker: una neurona vs capas ocultas (#33)

- Pregunta del usuario: cuántas capas y cuántas neuronas, y cómo se diseña la arquitectura.
- Respuesta dada: la regresión logística es exactamente una neurona (12 entradas → 1 salida sigmoide, 13 parámetros). Las capas ocultas sirven para aprender interacciones no lineales ("la actividad importa solo si la similitud es media"). Muchas capas solo se justifican con entradas crudas (píxeles, texto, los 2.048 valores de los embeddings) y millones de ejemplos. Aquí la parte profunda ya es el modelo de embeddings preentrenado (congelado), y lo que se entrena es una "cabeza" chica.
- Propuesto (sin decidir): comparar con la misma validación cruzada (A) 1 neurona, 13 parámetros; (B) 12 → 16 ReLU → 1, 225 parámetros; (C) 12 → 32 → 16 → 1, 961 parámetros. Quedarse con el más simple que no pierda. Con 1.423 positivos, más de ~1.000 parámetros arriesga memorizar.
- Nota sobre la decisión (4): torch ya está en `requirements.txt`, así que las tres opciones se pueden hacer sin sumar scikit-learn.

## 2026-11-07 14:20 — ¿Neuroevolución para el ranker? (#33)

- Idea del usuario: evolucionar la arquitectura (estilo NEAT: poblaciones de redes que compiten, se reproducen y mutan conexiones) en vez de diseñarla.
- Opinión dada:
  - Evolucionar la topología casi seguro no gana. El espacio útil es chico (12 inputs, pocas decenas o cientos de parámetros), y la aptitud es ruidosa: validación sobre 1.423 positivos. Una búsqueda con miles de evaluaciones elige la red que tuvo suerte en la validación (el mismo winner's curse, pero amplificado). Pide CV anidada para medirlo honestamente.
  - Donde la evolución sí tiene una ventaja real aquí: optimizar directo la métrica que importa. La cobertura por expediente @K es escalonada y no tiene gradiente. El descenso de gradiente optimiza un sustituto (entropía cruzada); un algoritmo evolutivo (GA o CMA-ES) puede maximizar la cobertura@K misma, ajustando los pesos de la neurona o de la red chica. También sirve para hiperparámetros discretos: ventana de días, qué rasgos entran, K.
- Propuesto (sin decidir): primero la comparación normal A/B/C como base. Después, como experimento opcional, evolución de pesos e hiperparámetros contra la cobertura@K con CV anidada, comparada contra la base. NEAT completo solo como ejercicio aparte, fuera del pipeline principal.

## 2026-11-07 14:26 — Explicación detallada de la evolución de pesos (#33)

- El usuario pidió aclarar qué evoluciona, cómo y contra qué se evalúa. Explicado paso a paso:
  - Individuo: la lista de pesos de los inputs, más genes discretos (ventana de días, inputs encendidos o apagados).
  - Puntaje: suma ponderada por par; no hace falta sigmoide, porque solo importa el orden.
  - Aptitud: fracción de los expedientes del oro que meten al menos una noticia en el top-K.
  - Ciclo: selección, cruce, mutación con ruido.
  - Validación: evolucionar en 4/5 de las noticias y medir en el 1/5 restante.
- Se usó como ejemplo ilustrativo la noticia del FEES con pesos inventados, para mostrar cómo dos individuos ordenan distinto el presupuesto (25754) y la ley del FEES (23380). Las cifras del ejemplo no son resultados.

## 2026-11-07 14:34 — Costo computacional de la evolución y genes de tiempo (#33)

- Idea del usuario: que el ADN tenga más que pesos, por ejemplo la diferencia en días entre la noticia y la presentación del expediente (negativa si el expediente se presentó después). Pregunta: cuánto cuesta la evolución.
- Medido con un benchmark del scratchpad (`analysis/bench.py`: datos al azar con la forma real, 532 noticias × 5.898 expedientes × 12 inputs, 151 MB en float32): **35 ms por individuo** en numpy en esta compu (12 CPUs). Población 50 × 200 generaciones = 10.000 evaluaciones ≈ 6 min; con CV de 5 folds ≈ 30 min. Población 100 × 300 ≈ 18 min, o 88 min con CV. Aquí `torch.cuda.is_available()` da True, así que en GPU debería bajar bastante (sin medir).
- Diseño para que los genes de tiempo sean baratos: guardar una vez las matrices crudas noticia × expediente (días al evento de avance más cercano, días desde la presentación) y que el gen solo defina la transformación (umbrales de la ventana, vida media de un decaimiento). Cambiar un gen no recalcula rasgos: es una operación por elemento de unos ms.
- El costo real de sumar genes no es el tiempo por evaluación sino que (a) hacen falta más generaciones para explorar el espacio y (b) sube el riesgo de sobreajustar al oro. Con ~15–25 genes sigue siendo manejable.
- Sobre la diferencia de fechas: en el oro ningún enlace apunta a un expediente presentado después de la noticia (entrada 12:44), así que la parte negativa casi no tendrá ejemplos. Solo cubriría proyectos anunciados antes de presentarse, que de todos modos no tienen número todavía.

## 2026-11-07 14:53 — Diseño del núcleo evolutivo: decisiones abiertas (#33)

- Pedido del usuario: `tools/evolution_tools/` como núcleo propio, desligado del proyecto (individuo, iteración, etc., sin saber nada de expedientes). Orientado a objetos en lo alto, sin objetos por neurona o por gen si eso choca con el rendimiento. Preguntó por "arreglo de structs" vs "struct de arreglos" en Python.
- Respuesta sobre rendimiento: la población se guarda como una matriz numpy individuos × genes (struct de arreglos en la práctica: memoria contigua y operaciones vectorizadas en C). Un objeto Python por individuo sería un arreglo de punteros a objetos sueltos, lento. numpy también tiene arreglos estructurados (arreglo de structs real), pero no conviene aquí. Lo caro es el fitness, que vive en el problema y puede usar la GPU evaluando toda la población en un solo producto de matrices; el núcleo (selección, cruce, mutación sobre una matriz de 50 × 25) no necesita GPU.
- Decisiones presentadas (pendiente):
  - (1) Separación: núcleo genérico (`GenomeSpec`, `Population`, `GeneticAlgorithm`, interfaz `Problem.evaluate(matriz) → aptitudes`, `History`) vs adaptador del proyecto (`RankingProblem`) fuera del núcleo.
  - (2) Representación: matriz float con decodificación por tipo de gen (continuo, entero, booleano, escala log).
  - (3) Backend: núcleo en numpy, problema en torch o numpy.
  - (4) Algoritmo: GA (torneo, cruce uniforme o BLX, mutación gaussiana, elitismo), con CMA-ES para después.
  - (5) Valores por defecto y criterio de parada.
  - (6) Genes del problema: pesos de los rasgos estandarizados, ventana antes/después, vida media de la antigüedad, interruptores; K fijo.
  - (7) Aptitud: cobertura por expediente @K + desempate suave.
  - (8) Validación: 5 folds por noticia.
  - (9) Reproducibilidad: semilla e historial por generación.
  - (10) Salidas y runner.
  - (11) Dependencia: el `FeatureBuilder` del ranker (decisiones de las 14:0x, todavía pendientes).
  - (12) Issue nuevo o colgarlo de #33.

## 2026-11-07 15:03 — Núcleo evolutivo: decisiones aceptadas, regla de idioma y nuevas propuestas (#33)

- El usuario aceptó las 12 recomendaciones de la entrada anterior (núcleo genérico en `tools/evolution_tools/`, población como matriz numpy, GA con torneo y elitismo, genes del ranking, aptitud = cobertura por expediente @K + desempate, CV de 5 folds, salidas en `results/evolution/`, `run_evolution.py`, issue nuevo ligado a #33 y #41). Eso incluye cerrar a la vez las 11 decisiones del ranker (rasgos, fondo del z, etc.) y no contar los eventos de archivo como actividad.
- Pedido del usuario: todo lo que va dentro de los archivos de código en inglés, incluso los nombres que se proponen en el chat (le molestó `matriz_de_genes`). Agregada la sección "Code in English (always)" a `CLAUDE.md`.
- Propuestas nuevas (pendiente):
  - (a) Historial: `history.csv` (una fila por generación) + `population.csv` (cada individuo de cada generación con id, padres, origen y genes decodificados; ~15 mil filas, unos MB) + `run.json` + `best.json`.
  - (b) Visor de repetición en `private_visuals/evolution_replay/`, como `embedding_cross`: línea de tiempo con play/pausa/atrás/adelante, curvas de aptitud, población en 2D (PCA), distribución de cada gen por generación, receta del mejor y linaje, y selector de corridas.
  - (c) Exploración: inmigrantes al azar (`immigrant_rate` 0,1 por generación) y mutación de reinicio al azar (`reset_rate` 0,02 por gen) además de la gaussiana; selección por truncamiento ("muere la mitad") como opción, con torneo por defecto.

## 2026-11-07 15:11 — Aceptadas las propuestas de historial, visor y exploración; explicación del torneo (#33)

- El usuario aceptó las propuestas (a) historial (`history.csv`, `population.csv`, `run.json`, `best.json`), (b) visor `private_visuals/evolution_replay/` y (c) inmigrantes (`immigrant_rate` 0,1), mutación de reinicio (`reset_rate` 0,02) y truncamiento como opción con torneo por defecto.
- Pidió que se le explicara la selección por torneo. Explicado: los torneos se sortean con reemplazo sobre la generación actual; los que pierden no mueren, vuelven al bolso y pueden salir sorteados otra vez. Todos los no élites mueren al final de la generación (reemplazo generacional) y solo sobreviven a través de sus hijos. Con 50 individuos, 2 élites, 5 inmigrantes y 43 hijos hay 86 torneos de 3 (dos padres por hijo). Hijos esperados según el puesto: el 1.º ~5, el 25.º ~1,3, el 40.º ~0,2 y el último ~0. El tamaño del torneo regula la presión de selección.

## 2026-11-07 15:26 — Implementación del núcleo evolutivo, rasgos y visor (#68, #33)

- Issue nuevo #68 "Evolutionary tuning of the candidate ranker" (milestone 4, etiqueta enhancement), ligado a #33 y #41.
- `tools/evolution_tools/` (sin `__init__.py`, como las otras carpetas):
  - `genome.py`: `Gene` de tipo float, int, bool o log; `GenomeSpec` codifica todo como float y decodifica por columna.
  - `population.py`: `Population` con arreglos genes, fitness, ids, parents y origin.
  - `genetic_algorithm.py`: interfaz `Problem.evaluate(genes) -> fitness` por lotes. `EvolutionSettings`: torneo o truncamiento, cruce blend o uniforme, mutación gaussiana con volteo de booleanos, `reset_rate`, `immigrant_rate`, elitismo y `patience`. `GeneticAlgorithm`: reemplazo generacional, y solo se evalúan los individuos nuevos (los élites conservan su fitness).
  - `history.py`: `history.csv` y `population.csv`.
- Probado con un problema de juguete (5 genes de los 4 tipos): torneo llegó a −0,0001 en 112 generaciones; truncamiento a −0,0019 en 77. Los padres siempre pertenecen a la generación anterior; cada generación trae 2 élites, 5 inmigrantes y 43 hijos.
- `tools/retrieval_tools/feature_builder.py` (`FeatureBuilder`, caché en `databases/retrieval/features_qwen3-0.6b_256.npz`):
  - 10 rasgos fijos: cosenos max de exposition, subjects y name; coseno mean de exposition; z de exposition y subjects contra el fondo; log1p de BM25; log1p de los días al evento del SIL más cercano; alive; filed_after_news.
  - Cuentas de eventos de avance por cada ancho de ventana: 0–60 días antes y 0–14 después, en uint8. Así la ventana evoluciona sin recalcular, y la cuenta en la ventana también queda exacta.
  - Los pasos del SIL que empiezan con "ARCHIVO" no cuentan como avance y marcan la fecha de archivo. "RECEPCIÓN DEL PROYECTO (ARCHIVO)" sí cuenta: es el departamento de Archivo, no un archivo del expediente. La fecha de ley es "PUBLICACIÓN DE LA LEY". Sin votaciones de Delfino.
- `background_news_ids`: 2.000 noticias con el filtro de palabras de la muestra, sin las del oro ni las de `results/sample/queue.csv` (nacion 620, crhoy 526, elmundo 376, semanario 245, delfino 233). `run_embeddings.py --background` las embebe en `news_256_background.npz` (11.034 chunks, corriendo en la GPU de esta compu).
- `tools/retrieval_tools/ranking_problem.py` (`RankingProblem`):
  - 29 genes: 13 pesos en [−5, 5], 13 interruptores, `window_before_days` 0–60, `window_after_days` 0–14, `age_half_life_days` log 7–3.650.
  - Rasgos dinámicos: active, event_count y age_decay.
  - Rasgos continuos estandarizados sobre todos los pares.
  - Fitness = cobertura por expediente @K + 0,001 × media de K/(K + mejor rango). Corre en torch, en la GPU.
- `run_evolution.py`: CV de 5 folds por noticia más corrida final, salidas en `results/evolution/<name>/` (`run.json`, `summary.json`, y por parte `history.csv`, `population.csv`, `best.json`) y datos del visor en `private_visuals/output/evolution_replay/data.js`. Base de comparación: solo `cos_exposition_max`.
- Visor `private_visuals/evolution_replay/` (textos en inglés): play/pausa/pasos/barra/velocidad y teclado; curvas de fitness; población en PCA 2D (sin los genes booleanos, que partían la nube en grupos); receta del mejor; franjas por gen; línea de descendencia. Puede abrir `history.csv` + `population.csv` (+ `run.json`) de cualquier corrida. Probado con datos de juguete en el navegador, sin errores de consola. En `.claude/launch.json` se agregó el servidor estático "visuals" (puerto 8766).
- Detalles elegidos al implementar, a confirmar con el usuario:
  - La base de comparación es exposition sola, no la mezcla RRF a mano, porque esa no se puede expresar como receta lineal.
  - La primera generación es toda al azar; no se siembra con la base.

## 2026-11-07 15:49 — Primera corrida de la evolución del ranker (#68, #33, #41)

- Fondo: `python run_embeddings.py --model qwen3-0.6b --background` → `news_256_background.npz`, 2.000 noticias, 11.034 chunks, 9 min en la GPU. `FeatureBuilder` arma la caché en 35 s.
- Rasgos, media en enlaces del oro vs todos los pares: cos_exposition_max 0,604 / 0,350; z_subjects 4,69 / 0,51; bm25 4,64 / 3,00; alive 0,853 / 0,267; filed_after_news 0 / 0,028. Activo en [−14, +3] sin eventos de archivo: 71,1 % de los enlaces vs 2,6 % al azar. 0 expedientes sin fecha de presentación.
- Chequeo: la receta "solo cos_exposition_max" da en `RankingProblem` exactamente los números del analizador (cobertura 0,731 @50, 0,782 @100, rango mediano 16). Evaluar 50 individuos tarda 0,6 s en la GPU.
- **Error encontrado y corregido:** en la primera corrida, el fold 2 evolucionó una receta con todos los interruptores apagados y "100 %" de cobertura. Con todos los puntajes en 0, los empates contaban a favor del expediente correcto y todo quedaba en el rango 1. Ahora en `RankingProblem.link_ranks` los empates cuentan en contra; con todo apagado, el fitness queda ≈ 0. Se borró esa corrida y se repitió. El analizador de embeddings sigue con empates a favor, lo que no afecta allí porque los cosenos no empatan.
- Corrida `results/evolution/2026-11-07_tournament` (`logs/run_2026-11-07_153952.log`; población 50, torneo 3, inmigrantes 0,1, reinicio 0,02, K = 100). CV de 5 folds, medida en las noticias de prueba (evolucionado vs base exposition sola):
  - Cobertura por expediente @50: **0,908** vs 0,654; @100: **0,942** vs 0,723.
  - Expedientes de una sola noticia @50: 0,889 vs 0,609; @100: 0,928 vs 0,679.
  - Recall por noticia @50: 0,960 vs 0,804; por enlace @50: 0,899 vs 0,614.
  - Por fold, prueba @100: 0,933, 0,970, 0,967, 0,972, 0,867; entrenamiento 0,956–0,984, así que la brecha de sobreajuste es chica salvo el fold 5. Generaciones: 113, 300, 229, 188, 130.
- Receta final (todo el oro, 300 generaciones; cobertura de entrenamiento 0,948 @50 y 0,976 @100):
  - Prendidos: cos_exposition_max +4,9, bm25 +5,0 (en el tope), z_subjects +2,4, alive +2,4, active +2,5, cos_subjects_max −2,3, cos_exposition_mean −2,6, event_distance −1,1, filed_after_news −5,0, age_decay −1,3.
  - Apagados: cos_name_max, z_exposition, event_count.
  - Ventana 1 día antes / 3 después, vida media 32 días.
- Lo que se repite en los 5 folds: bm25 en +5 (el tope del rango, así que el límite de ±5 se está topando), cos_exposition_max positivo, z_subjects positivo, alive positivo, event_distance negativo (eventos cerca = mejor), filed_after_news negativo y age_decay negativo (con alive prendido, castiga lo recién presentado). La ventana de actividad y el peso de active cambian mucho entre folds (de 0 a 60 días): la señal de actividad la lleva sobre todo event_distance. cos_subjects_max negativo junto con z_subjects positivo es colinealidad; los pesos sueltos no se interpretan uno por uno.
- Caveats: todo medido en el oro de Delfino; la CV evita la fuga entre noticias, pero no la de estilo de medio. La muestra manual sigue sin tocar. Falta compararlo con el ranker entrenado por gradiente (A/B/C).
- Archivos: `databases/retrieval/` agregado a `.gitignore`. Cada corrida ocupa ~15 MB en `results/evolution/`, casi todo `population.csv` (3,6 MB la final), y `data.js` del visor 21 MB. Hay que decidir si los `population.csv` van en git. `tools/embedding_tools/embedding_runner.py` tiene un cambio que no hizo Claude (`all_news_ids`); se deja fuera del commit.
- Visor probado con la corrida real, sin errores de consola.

## 2026-11-07 15:53 — population.csv fuera de git (#68)

- Decisión del usuario: los `population.csv` de las corridas no van a git (se regeneran con la semilla). Regla en `.gitignore`: `results/evolution/**/population.csv`. En git quedan `run.json`, `summary.json` y, por parte, `history.csv` y `best.json`. El visor sigue leyendo el `data.js` local o los CSV de la corrida.

## 2026-11-07 15:53 — Commits del ranker evolutivo y de la regla de idioma (#68, #33)

- Por pedido del usuario, dos commits:
  - `feature: evolutionary tuning of the candidate ranker #68 #33`: núcleo, rasgos, problema, runner, visor, config, `.gitignore`, `launch.json`, resúmenes de la corrida y este log.
  - `feature: code in english rule in claude.md`.
- El cambio ajeno en `tools/embedding_tools/embedding_runner.py` (`all_news_ids`) queda sin commitear. #68 sigue abierto.

## 2026-11-07 20:15 — Recapitulación de lo pendiente del análisis de embeddings y cómo correr la evolución (#68, #33)

- Pregunta del usuario: cómo correr `run_evolution.py` con otros parámetros y cuáles eran las variaciones de una neurona y demás sugerencias pendientes.
- Explicado el CLI (`--generations`, `--patience`, `--population`, `--selection`, `--tournament-size`, `--immigrant-rate`, `--reset-rate`, `--seed`, `--k`, `--folds`, `--no-final`, `--name`, `--device`). Nota: en la primera corrida 4 de 5 folds pararon antes de 300 por `patience` 30 (113, 229, 188, 130 generaciones), así que subir solo `--generations` no cambia esos folds; hay que subir también `--patience`. `elites`, `crossover`, `mutation_scale` y el rango de pesos (±5, `WEIGHT_RANGE`) no tienen flag.
- Pendientes recordados desde el log: comparación A/B/C por gradiente (1 neurona 13 parámetros, 12→16→1, 12→32→16→1) con la misma CV, que es lo que falta para cerrar #68; ampliar el rango de pesos porque bm25 se topa en +5; sembrar la primera generación con la base; CMA-ES como alternativa al GA; probar truncamiento; reranker cross-encoder (opción b de las 13:50) y fine-tuning contrastivo (c) para después; evaluar en la muestra manual cuando cierre la revisión humana, y `--all-news` (#32). Nada decidido ni implementado.

## 2026-11-07 20:17 — Explicación de los folds (#68)

- Pregunta del usuario: qué son los folds. Explicado: validación cruzada de 5 folds por noticia; las 532 noticias del oro se parten en 5 grupos; en cada fold se evoluciona con 4/5 y se mide en el 1/5 restante, que la evolución nunca vio. Los números reportados (0,942 @100) son el promedio en las noticias de prueba; la corrida final usa todo el oro y su número de entrenamiento (0,976) es optimista. Se parte por noticia para que los enlaces de una misma noticia no queden a ambos lados.

## 2026-11-07 20:20 — run_evolution.py falla en la máquina mala (#68)

- El usuario intentó `python run_evolution.py --name 2026-11-07_trunc_s11 --selection truncation --seed 11 --generations 60000 --patience 200` en esta máquina (la mala): ModuleNotFoundError numpy, y `pip install` da "Fatal error in launcher".
- Causa del pip: el .venv se creó en `C:\Users\daria\OneDrive\Documentos\GitHub\cr-legislative-coverage` y el repo se movió; los .exe de Scripts guardan la ruta vieja. `python -m pip` sí funciona (pyvenv.cfg apunta a Python 3.15 del sistema).
- Pero aquí tampoco están torch (lo usa RankingProblem), `databases/embeddings/` ni `databases/retrieval/` (solo hay `private_corpus.db`). La evolución se debe correr en la máquina de la RTX 2060. No se instaló nada.

## 2026-11-07 20:30 — Por qué la evolución tarda 1–3 s por generación (#68)

- El usuario corre una evolución de 600 generaciones en la máquina de la RTX 2060 y ve 1–3 s por generación.
- Tiempos de la primera corrida (`elapsed_seconds` de cada `history.csv`, en cuda): 0,14 s/gen en el fold 1, 0,21, 0,32, 0,45 y 0,50 en los folds 2–5, y 0,63 en la final. Dentro de cada parte el tiempo es casi constante; entre partes crece sin una causa clara (los folds tienen el mismo tamaño, 425 noticias; la final tiene 532). Sin diagnosticar.
- Hipótesis principal para 1–3 s: está corriendo en CPU (torch sin CUDA, p. ej. si se reinstaló el entorno sin el índice cu126). La línea de inicio del log dice `device ...`. Segunda: memoria de la GPU desbordada a la RAM (fallback de memoria compartida de Windows).
- Costo estructural de `RankingProblem.evaluate`: un bucle de Python por individuo, con varias sincronizaciones CPU–GPU por individuo (`if dynamic[0] != 0` sobre un tensor de la GPU, `float(...)`), tensores armados desde listas de Python y una matriz de 1.085 × 5.898 por individuo para los rangos. Propuesto (sin decidir): evaluar la población por lotes (einsum por bloques), sacar las sincronizaciones y medir antes y después. No se tocó código.

## 2026-11-07 20:38 — Fitness del ranker por lotes en la GPU (#68)

- El usuario confirmó que en la máquina de la 2060 torch ve la GPU (`2.14.1+cu126 True`), así que la lentitud no es por correr en CPU. Pidió arreglarlo.
- `RankingProblem.evaluate` ahora puntúa a los individuos por lotes (`batch_size`, 16 por defecto, ~100 MB de GPU cada uno): `einsum` para los rasgos estáticos, ventanas de eventos tomadas con un índice por individuo, rangos y mejor rango por expediente con una dimensión de lote. Qué términos dinámicos hacen falta se decide en la CPU con los genes de numpy, y la única espera a la GPU es al copiar el fitness de toda la población. `set_rows` copia por fold también las cuentas de eventos (antes se indexaban por individuo). `scores`, `link_ranks` y `best_bill_ranks` aceptan un individuo o un lote, así que `metrics` usa el mismo camino.
- `run_evolution.py --batch-size` para bajarlo si se acaba la memoria.
- `run_ranking_benchmark.py`: compara el fitness nuevo contra una copia de la implementación vieja (200 recetas al azar más la base), mide el tiempo de ambas y el de 20 generaciones completas (cuánto es fitness y cuánto lo demás).
- No probado: esta máquina no tiene numpy, torch ni la caché de rasgos. Solo se verificó la sintaxis. Puede haber diferencias mínimas de redondeo entre `einsum` y `tensordot`, así que una corrida con la misma semilla podría no repetir exactamente la trayectoria de la primera.

## 2026-11-07 20:49 — Resultado de run_ranking_benchmark.py en la RTX 2060 (#68)

- Corrida del usuario (cuda, 425 noticias, 29 genes, lote 16):
  - **Equivalencia:** diferencia máxima entre fitness por lotes y el viejo 3,64e-12; 0 de 200 individuos difieren más de 1e-6; base 0,764557 en ambos. La reescritura es correcta, la trayectoria de la evolución no cambia.
  - **Velocidad del fitness:** 200 individuos, viejo 4,18 s (20,9 ms c/u), por lotes 1,94 s (9,7 ms c/u): solo 2,2x más rápido. Pico de memoria de GPU 1,66 GiB.
  - **20 generaciones completas:** 2,085 s por generación, de los cuales 2,081 s son fitness (selección, historial, etc. son despreciables).
- Observación: la población por defecto es 50 y los élites no se reevalúan (solo se evalúan los NaN), así que cada generación evalúa ≤ 50 individuos; a 9,7 ms c/u se esperaban ~0,5 s por generación, pero se miden 2,08 s (≈ 4x más). Sin diagnosticar. Hipótesis: (1) las recetas al azar del benchmark tienen muchos términos dinámicos apagados y las evolucionadas los encienden casi todos, con lo que el costo por individuo sube; (2) lotes pequeños o desiguales (p. ej. 40 individuos = 3 lotes) que no aprovechan la GPU; (3) el cuello de botella no es el cálculo sino algo fijo por llamada. El benchmark mide con recetas al azar, no con una población evolucionada.
- Conclusión: el cuello de botella sigue siendo el fitness, pero la ganancia real fue mucho menor que lo esperado. Pendiente decidir con el usuario si se perfila (por ejemplo cronometrar por etapa con una población evolucionada, o medir el benchmark con genes de `population.csv` de una corrida anterior) antes de tocar código. Nada cambiado.

## 2026-11-07 20:51 — Script de perfilado del fitness (#68)

- El usuario aceptó perfilar. Esta máquina no tiene torch/numpy, así que no se puede correr aquí; se escribió `run_ranking_profile.py` (solo diagnóstico, no cambia el ranker) para correr en la máquina de la RTX 2060. Solo se verificó la sintaxis.
- Hecho relevante leído en el código: cada generación evalúa 48 individuos (50 − 2 élites), así que 2,08 s son ~43 ms por individuo frente a 9,7 ms del benchmark. El script mide: 48 recetas al azar vs 48 evolucionadas (tras 30 generaciones), qué términos dinámicos y ventanas tienen, el tiempo por individuo con lotes de 1 a 64, y una tabla de kernels de torch.profiler (los más caros en CUDA).
- Pendiente: que el usuario corra `python run_ranking_profile.py` y pegue la salida.

## 2026-11-07 20:58 — Resultado del perfilado del fitness (#68)

- Salida de `run_ranking_profile.py` en la RTX 2060 (6 GiB), fold de 425 noticias, 1.106 enlaces, 525 expedientes de oro:
  - 48 recetas al azar: 17,6 ms c/u. 48 evolucionadas (30 generaciones): 42,3 ms c/u, aunque tienen **menos** términos dinámicos activos (5/11/6 contra 20/26/19). Eso descarta la hipótesis 1 (los términos dinámicos no explican la diferencia).
  - Por lote (evolucionadas): lote 1 32,6; 4 36,9; 8 41,7; 16 42,3; 32 46,3; 64 56,6 ms c/u. Más lote es peor, no mejor: el costo escala con la memoria movida y no hay sobrecarga por llamada que amortizar (hipótesis 2 y 3 descartadas).
  - Kernels (CUDA total 2,03 s para 48 individuos): elementwise de la matriz (lote × noticias × 5.898 expedientes) ≈ 49 %, `sum` del rango 21 % (kernel de reducción 60 ms por lote de 16), `copy_`/`to` 20 %, `ge` 7,7 % (51 ms por lote).
- Diagnóstico: la matriz de puntajes es lote × 425 × 5.898 floats (~10 MB por individuo) y la comparación de rangos es lote × 1.106 × 5.898 (~26 MB por individuo en float, 6,5 M de bools). Son ~100–300 MB de tráfico por individuo, que a ~336 GB/s serían ~1 ms; se miden 17–42 ms. El `ge` de un lote (104 M elementos) tarda 51 ms, o sea ~10 GB/s efectivos, unas 30 veces por debajo del ancho de banda de la tarjeta. La GPU rinde muy por debajo de su capacidad: o comparte la GPU con otro proceso (el usuario tenía una evolución de 600 generaciones corriendo), o está estrangulada por temperatura/potencia (las evolucionadas se midieron después de 30 generaciones de carga sostenida y salieron 2,4 veces peores que las al azar), o está en un estado de reloj bajo. Sin confirmar.
- Pendiente: que el usuario mire `nvidia-smi` (procesos en la GPU, relojes, temperatura, razones de estrangulamiento) y repita el perfilado con la GPU libre. Después, si sigue lento, optimizar el trabajo en sí (p. ej. rangos con el puntaje de oro por enlace sin materializar lote × enlaces × expedientes en float, o usar half/bool). Nada cambiado en el ranker.

## 2026-11-07 21:32 — nvidia-smi durante el perfilado: la GPU no está estrangulada (#68)

- Con carga la tarjeta marcó 88–97 % de utilización, SM a 1.665–1.890 MHz, memoria a 5.500 MHz, 60–66 °C y 75–80 W. La razón de estrangulamiento activa fue 0x4 (tope de potencia por software), que es lo normal bajo carga; no hay 0x20/0x40 (térmico). Las filas con 300 MHz o "[Unknown Error]" son de antes y después de la corrida. Conclusión: ni temperatura ni reloj explican la lentitud.
- Queda: otro proceso en la GPU, desborde de VRAM a la RAM del sistema (~10 GB/s efectivos coincide con el ancho de banda de PCIe), o kernels más ineficientes de lo estimado. Siguiente paso propuesto: un microbenchmark de ancho de banda puro (x*2 sobre 40 M floats, sin nuestro código) más `nvidia-smi` simple durante la corrida (procesos y memoria usada). Sin código nuevo.

## 2026-11-07 21:34 — Microbenchmark de ancho de banda: 52 GB/s y VRAM casi llena (#68)

- `x*2` sobre 40 M floats: 6,06–6,21 ms, o sea 52–53 GB/s, contra ~336 GB/s de una 2060. Es 6 veces menos con código que no es nuestro, así que el fitness no es el único culpable: el entorno limita la GPU.
- `torch.cuda.mem_get_info()` después de reservar ~320 MB: 1,80 GB libres de 6,0 GB. Otros procesos tienen ~4,1 GB de VRAM ocupados en el momento de la prueba. Con la VRAM así de llena, el controlador de Windows (WDDM) puede dejar asignaciones en memoria del sistema (accesos por PCIe, ~10 GB/s), que cuadra con lo visto en el perfilado.
- El nvidia-smi en paralelo mostró la GPU casi ociosa (0–15 %, 960 MHz, sin razones de estrangulamiento): la prueba dura ~0,1 s y los relojes apenas subieron, por lo que 52 GB/s tampoco es una cifra limpia. Falta una medida más larga.
- Pendiente: ver qué procesos usan la VRAM (`nvidia-smi` simple), cerrarlos (navegadores, otra evolución, apps con aceleración por GPU) y repetir el microbenchmark con calentamiento y más iteraciones. Sin cambios de código.

## 2026-11-07 21:35 — nvidia-smi simple en reposo (#68)

- RTX 2060 en modo WDDM, tope de 80 W y ventilador "N/A": parece la versión de portátil. En reposo: 0 MiB de 6.144 usados y sin procesos, 63 °C, P0. Así que no hay otro proceso con la VRAM en este momento, y el 1,8 GB libre de la prueba anterior no se explica por otros procesos persistentes (puede que el controlador reserve memoria en esa tarjeta, sin confirmar).
- Pendiente: el microbenchmark largo (100 iteraciones de calentamiento y 300 medidas) con la GPU libre, que es lo que separa entorno de código.

## 2026-11-07 21:37 — Corrección: el microbenchmark de ancho de banda estaba mal hecho (#68)

- Error mío: `[x.mul(2) for _ in range(N)]` guarda las N salidas de 160 MB. Con N = 100 pidió ~16 GB y falló por OOM; con N = 20 (las pruebas anteriores) retuvo ~3,2 GB. Por eso la prueba mostró solo 1,8 GB libres: el "4,1 GB ocupados por otros procesos" y los 52 GB/s de la entrada de las 21:2x **no son válidos** (la medida incluía reservar memoria). Queda sin efecto esa conclusión; el nvidia-smi en reposo (0 MiB, sin procesos) sí era correcto.
- Dato nuevo y real: PyTorch llegó a tener 20,27 GiB asignados en una tarjeta de 6 GiB antes del OOM, es decir, el controlador deja que las asignaciones desborden a la RAM del sistema (fallback de memoria compartida de WDDM). Si en alguna parte del fitness se pasa de ~6 GB, se degrada en silencio. Pero el pico medido por el benchmark fue 1,66 GiB asignados, así que no hay evidencia de que eso ocurra en el fitness real.
- Pendiente: repetir la medida sin retener resultados (`torch.mul(x, 2, out=y)`).

## 2026-11-07 21:40 — Microbenchmark corregido: 233 GB/s; el entorno está bien (#68)

- `torch.mul(x, 2, out=y)` sobre 40 M floats: 1,37 ms, 233 GB/s (la 2060 da ~336 de pico). Así que la GPU rinde bien con código simple, y la lentitud (17–42 ms por individuo, kernels ~15–30 veces peor que ese ancho de banda) está en nuestro fitness, no en el entorno. Quedan descartados: térmico, reloj, otro proceso, VRAM.
- Dtypes revisados en `feature_builder.py`: static, age y ventanas son float32/uint8, así que no hay float64 escondido.
- Se añadió a `run_ranking_profile.py` una tabla por etapa de un lote de 16 (pesos, einsum, ventanas, términos dinámicos, gather de filas por enlace, comparación, suma, mejor rango), con MB y GB/s de cada una, para ver cuál etapa está lejos de los 233 GB/s. Solo se verificó la sintaxis (no hay torch aquí).

## 2026-11-07 21:42 — Perfilado limpio: 2,2 ms por individuo, la lentitud era del entorno (#68)

- Misma máquina, mismo código, GPU libre: 48 recetas al azar 2,4 ms c/u y evolucionadas 2,2 ms c/u (antes 17,6 y 42,3). Lote 1: 1,9; 4: 2,0; 8: 2,2; 16: 2,2; 32: 2,6; 64: 8,4 ms c/u (con 64 se degrada, probable presión de memoria; 16 sigue siendo un buen valor). Una generación de 48 debería tardar ~0,1 s, no 2 s.
- Conclusión: la lentitud de antes (y los 9,7 ms del benchmark) venía de algo que competía por la GPU en ese momento (la causa exacta no se identificó; nvidia-smi en WDDM no lista procesos, y el usuario había tenido una evolución larga corriendo). El fitness por lotes es ~19 veces más rápido que lo medido antes, y el microbenchmark de 233 GB/s confirma que la tarjeta rinde bien.
- Etapas de un lote de 16 (ms): einsum estático 1,6; gather de ventanas 2,2; count float 4,2; términos active+log1p 8,1; edad 4,4; gather de filas por enlace 3,2 (121 GB/s); comparación 2,5 (197 GB/s); suma de rangos 8,1 (12 GB/s, la etapa más ineficiente); mejor rango 0,5. Posibles mejoras si hiciera falta (no se hizo nada): sumar los rangos con `count_nonzero` o en int32 en vez de bool→int64, y fusionar los términos dinámicos. Con 0,1 s por generación no hace falta por ahora.
- Pendiente: repetir `run_ranking_benchmark.py` con la GPU libre para tener la cifra limpia de las 20 generaciones.

## 2026-11-07 21:45 — El benchmark vuelve a salir lento: la conclusión anterior era prematura (#68)

- `run_ranking_benchmark.py` otra vez: equivalencia igual (3,64e-12), pero 200 individuos legacy 9,57 s (47,9 ms c/u), por lotes 3,98 s (19,9 ms c/u), 2,4x; 20 generaciones: 2,163 s por generación (fitness 2,154 s). Es lo mismo que la primera vez (y el doble de lento por individuo que en esa primera corrida: 9,7 ms).
- Mismo código, misma máquina, y el perfilado de hace unos minutos dio 2,2 ms por individuo (random 2,4). Mismas recetas al azar, 10 veces de diferencia entre corridas. Lo que dije ("la lentitud era del entorno, 19x más rápido") queda sin sostener: la velocidad varía entre corridas y no hemos identificado qué la cambia. Lo único sólido: el código es correcto, y cuando la GPU está "buena" rinde ~2 ms por individuo (generación ~0,1 s).
- Hipótesis: algo que cambia entre corridas y compite por la GPU (aplicaciones con aceleración por GPU, p. ej. navegador o esta misma aplicación; otro Python con torch), o un estado de energía de la tarjeta de portátil (con el tope de 80 W y la tarjeta en WDDM). Sin evidencia todavía.
- Siguiente paso: correr perfilado y benchmark seguidos en la misma sesión; si el perfilado sale lento ahora, es del entorno; si sale rápido y el benchmark lento, es del script. Anotar también qué estaba abierto en cada corrida.

## 2026-11-07 21:50 — Perfilado y benchmark seguidos: la velocidad cambia dentro de la misma corrida (#68)

- Perfilado: 48 recetas **al azar 45,1 ms c/u**, y justo después 48 **evolucionadas 2,3 ms c/u**; por lote (evolucionadas) 2,5, 2,1, 5,1 (mediana 17,3), 2,8 (mediana 16,3), 3,7, 8,4. Las etapas de un lote de 16 salieron iguales a las de la corrida rápida anterior (einsum 1,5; count float 4,1; active+log1p 8,2; edad 4,5; gather de filas 3,1; comparación 2,5; suma de rangos 8,2).
- Benchmark inmediatamente después: legacy 5,5 ms c/u, por lotes 15,8 ms c/u ("0,3x"), y 20 generaciones a **0,121 s por generación** (fitness 0,115 s).
- Lectura: el código rinde ~2 ms por individuo, pero en la misma corrida hay tramos de 10–20 veces más lentos, y el tramo lento no sigue a las recetas (al azar vs evolucionadas) ni al tamaño de lote: las medianas del lote 8 y 16 (17 y 16 ms) contra sus mejores (5,1 y 2,8) muestran que los tiempos saltan entre repeticiones del mismo cálculo. Esto es intermitencia externa o de la tarjeta (otro consumidor de la GPU, o estado de energía del portátil), todavía sin identificar. En esta corrida la evolución real sí fue rápida: 0,12 s por generación, frente a 2,1 s de las corridas lentas.
- Consecuencia: la cifra "2,2x / 0,3x más rápido que la versión vieja" no es confiable por esta variación; las comparaciones deberían intercalar y tomar el mejor de varias repeticiones. Lo que sí está firme: equivalencia numérica (3,64e-12) y que el fitness puede rendir ~0,1 s por generación. Nada de código del ranker cambiado.

## 2026-11-07 21:51 — Teoría del usuario: el cargador se desconecta y baja el rendimiento (#68)

- El usuario cuenta que el cargador del portátil hace mal contacto (hay que apretarlo y se desconecta al moverlo), que el equipo está configurado en máximo rendimiento solo cuando carga, y que vio picos de la GPU integrada. Hipótesis: al quedar con batería, el modo de energía baja el rendimiento y la GPU NVIDIA deja de rendir a pleno. Encaja con la intermitencia (la misma corrida alterna tramos de 2 ms y de 20–45 ms por individuo) y con que la última corrida fuera rápida (cargador bien puesto).
- Punto en contra a verificar: en la primera captura de nvidia-smi durante una corrida lenta, la GPU marcaba 1.665–1.890 MHz, 75–80 W y razón 0x4 (tope de potencia), es decir, relojes altos pese a ir lenta. Con batería lo habitual son relojes y potencia más bajos y razones de freno por hardware (0x80/0x8). Así que puede ser la causa solo de parte de los tramos lentos, o actuar por otro camino (p. ej. el límite de CPU/energía de Windows). Sin confirmar.
- Prueba propuesta: un monitor en una segunda terminal que anote cada segundo la hora, si está en corriente alterna (`Win32_Battery.BatteryStatus`; 2 = enchufado), reloj SM, potencia, utilización y razones de estrangulamiento, mientras corre el perfilado/benchmark; luego cruzar los tramos lentos con los momentos sin cargador.

## 2026-11-07 21:55 — Confirmado: la lentitud era el cargador (portátil con batería), no el código (#68)

- Monitor de 1 s durante perfilado y benchmark (`gpu_monitor.csv`, `BatteryStatus` 2 = enchufado, 1 = batería): con **corriente alterna** y carga, la GPU marca 1.620–1.905 MHz y ~78–80 W (razón 0x4, tope de potencia, lo normal). Con **batería** y la GPU al 96–100 % de utilización, queda en **300 MHz y 15–17 W** (razón 0x24). Los cambios 2 ↔ 1 ocurren cada pocos segundos (el cargador hace mal contacto), y coinciden con los tramos rápidos y lentos de las corridas.
- Es decir, en batería la tarjeta pierde ~6 veces de reloj (300 vs ~1.750 MHz) y probablemente algo más por memoria y energía, lo que cuadra con los 10–20x observados. Mi captura anterior de una corrida lenta con relojes altos pasó en un tramo con corriente y no era representativa; la teoría del usuario era la correcta.
- Consecuencias: (1) el código del fitness por lotes no tenía ningún problema; con corriente rinde ~2 ms por individuo y ~0,12 s por generación; (2) todas las cifras de tiempo de hoy mezclan tramos con y sin cargador y no sirven para comparar versiones (la ganancia frente a la versión vieja ronda 2x en los tramos buenos: 2,4 ms contra 5,5 ms, sin medición limpia); (3) para correr evoluciones largas conviene asegurar el cargador (o vigilar `BatteryStatus`), porque cada desconexión baja la velocidad ~6–20x; (4) `history.csv` guarda `elapsed_seconds`, así que el tiempo por generación de una corrida delata los tramos sin cargador.
- `gpu_monitor.csv` es un archivo de diagnóstico del usuario en la raíz del repo, no se commitea.

## 2026-11-07 22:27 — Fold 5 de la corrida larga: lo difícil son 2 noticias de agenda con muchos links (#68)

- Análisis en CPU (script en el scratchpad, no es código del proyecto) del fold 5 de `2026-11-07_long` (semilla 7, folds reconstruidos con `default_rng(7).permutation`). Test: 286 links, 40 fallados @100 (55 @50), 27 de 203 proyectos sin cubrir (todos de una sola noticia).
- **Concentración**: 35 de los 40 links fallados vienen de solo 2 noticias de agenda: la 178 ("Asamblea aprueba en segundo debate crédito para Tren Eléctrico…", 22 fallados de 61 links) y la 341 ("Gobierno convoca 112 proyectos a sesiones extraordinarias…", 13 de 26). Son noticias que listan muchos proyectos, donde el texto no describe cada uno. Solo 6 de las 106 noticias del test tienen algún fallo.
- Los links fallados tienen mediana de rango 285 (baseline 1.209) y 62 % sin eventos SIL en la ventana (contra 19 % de los acertados); ninguno fue radicado después de la noticia; edad no los distingue (mediana 178 contra 271 días).
- **Cruce receta × fold** (cobertura de proyectos @100): el fold 5 es difícil para todas las recetas (0,867–0,897); la receta del propio fold 5 es la peor ahí (0,867) pero la diferencia con las demás (~0,02–0,03) es ruido de unos pocos proyectos. La receta final, sobre todo el conjunto, da 0,976 (con entrenamiento).
- **Las recetas por fold son inestables**: pesos de `w_active`, `w_event_count`, `w_alive`, `w_z_exposition`, las ventanas (60/26/60/60/60 días antes) y la vida media de edad (10 a 263 días) cambian mucho entre folds, mientras `bm25`, `cos_exposition_max`, `z_subjects`, `filed_after_news` y `event_distance` son estables. Es decir, el paisaje es plano en esos genes: sirven poco o nada.
- Conclusión: el fold 5 no es sobreajuste del optimizador sino mala suerte del reparto (dos noticias-agenda en el mismo fold). El promedio de CV depende mucho de en qué fold caen. Ideas sin hacer: reportar la métrica por noticia o excluir/estratificar las noticias con muchos links; medir con varias semillas de reparto (el usuario lanzó una corrida con otra semilla).

## 2026-11-07 22:33 — Corrida con semilla 100 y qué pasa sin las 2 noticias de agenda (#68)

- `2026-11-07_seed_100` (semilla 100, 300 gen., paciencia 30): CV bill_coverage@100 0,942 (0,9417 la larga de semilla 7), @50 0,916 (0,915). Por fold @100: 0,942, 0,917, 0,952, 0,938, 0,962. Mismo promedio con otro reparto; el optimizador no depende de la semilla.
- Las noticias 178 (61 links) y 341 (26 links) cayeron otra vez juntas, ahora en el fold 2, que es el más bajo (0,917). Coincidencia (1 de 5 de probabilidad), pero confirma que son el fold flojo en las dos semillas.
- Quitándolas **solo del test** (misma receta de cada fold, sin reentrenar): semilla 7, fold 5 de 0,867 a 0,966 @100 y promedio CV de 0,9417 a 0,9616; semilla 100, fold 2 de 0,917 a 0,958 y promedio de 0,942 a 0,950. Baseline sin ellas: 0,723 a 0,755 y 0,739 a 0,753, o sea que también mejora, pero menos. Sin ellas el fold peor deja de ser un valor atípico.
- Hay 31 noticias con 10 o más links y 8 con 20 o más (máximos 61, 30, 26, 26, 26, 23); son noticias-agenda en general, no solo esas 2. Pendiente decidir (con el usuario) si se excluyen, se estratifican en los folds o se reportan aparte; no se tocó código.

## 2026-11-07 22:35 — Noticias de agenda: el usuario prefiere excluirlas; decisiones abiertas (#68)

- Distribución de links por noticia en el gold (532 noticias, 1.423 links): mediana 1, media 2,67. Con 2 o más links 186 noticias (35 %); con 10 o más, 31 (5,8 %, 37 % de los links); con 15 o más, 14 (2,6 %, 23 %); con 20 o más, 8 (1,5 %, 16 % de los links); con 25 o más, 5 (0,9 %, 12 %). Las de más links: 61 (tren eléctrico), 30, 26 (convocatoria a extraordinarias), 26 y 16 (resúmenes semanales "¿Qué hizo el congreso esta semana?"), 23, 21, 20…
- El usuario: la noticia típica no tiene un listado así y son los casos más atípicos (Delfino está muy orientado a la Asamblea); prefiere excluirlas y, además, hacer también el reporte aparte. Aún sin acordar: umbral, si se excluyen también del entrenamiento, si se estratifica igual, qué se guarda. No se escribió código.

## 2026-11-07 22:37 — Rendimiento por estrato de links por noticia, para elegir el umbral (#68)

- Pedido del usuario: estratificar para decidir el umbral con datos. Análisis en CPU sobre las predicciones fuera de fold de las corridas `2026-11-07_long` (semilla 7) y `2026-11-07_seed_100`, juntas (cada noticia aparece una vez por semilla; las cifras de links ya están divididas). Link recall por estrato de links de la noticia, evolved (@50, @100, rango mediano) y baseline @100:
  - 1 link (346 noticias): 0,980 / 0,990 / 1,0; baseline 0,925
  - 2 (66): 0,943 / 0,951 / 2,0; 0,833
  - 3–4 (50): 0,948 / 0,953 / 3,0; 0,756
  - 5–9 (39): 0,957 / 0,982 / 4,0; 0,642
  - 10–14 (17): 0,936 / 0,956 / 7,0; 0,631
  - 15–19 (6): 0,864 / 0,904 / 10,0; 0,455
  - 20–29 (6): 0,665 / 0,792 / 21,0; 0,338
  - 30+ (2): 0,577 / 0,714 / 37,0; 0,319
- Hasta 14 links el link recall@100 se mantiene sobre 0,95; el quiebre empieza en 15 y es claro desde 20. Quitando de la evaluación las noticias con N o más links (link recall@100 del resto / links que quedan): N=30 0,947 (94 %), N=25 0,958 (88 %), N=20 0,966 (84 %), N=15 0,972 (77 %), N=10 0,975 (63 %), N=5 0,972 (46 %). Pasar de 20 a 15 gana 0,6 puntos y quita 7 puntos más de links; de 15 a 10 casi no gana (0,3) y quita 14 más.
- Cautelas: el baseline empeora de forma continua con el número de links (la dificultad crece sola), los estratos de 15 o más tienen pocas noticias (14 en total, ruido alto), y elegir el umbral mirando el propio test es una decisión descriptiva, no un parámetro afinado.
- Recomendación dada al usuario: umbral 15 (14 noticias, 23 % de los links), con 20 como alternativa casi equivalente. Pendiente su decisión; no se escribió código.

## 2026-11-07 22:41 — Exclusión de noticias-agenda implementada en run_evolution.py (#68)

- Decisiones del usuario: umbral 15 (noticias con 15 o más links), exclusión también del entrenamiento y de las métricas, sin estratificar folds, reporte aparte.
- `config.py`: `EVOLUTION_MAX_LINKS_PER_NEWS = 15`. `run_evolution.py`: bandera `--max-links` (0 = no excluir); las noticias excluidas no entran a los folds (la permutación es solo de las 518 restantes), a la evolución final ni a las métricas CV/baseline; con `--max-links 0` el reparto de folds es idéntico al de antes (misma permutación). `run.json` guarda `max_links_per_news`. `summary.json` gana la clave `excluded_news` (`max_links`, `n_news`, ids con su número de links, métricas @50/@100 del baseline y de cada receta de fold y de la final sobre esas noticias; ninguna receta las vio al entrenar). La consola imprime una línea con la receta final contra el baseline en ellas.
- Prueba en CPU (2 folds, población 10, 3 generaciones; solo humo, números sin valor): 14 noticias excluidas con 332 links, folds de 259/259, `excluded_news` con fold_1, fold_2 y final. Se borró la carpeta de prueba y se restauró `private_visuals/.../data.js`, que la corrida sobrescribe siempre.
- Las corridas anteriores (`2026-11-07_*`) no tienen `excluded_news` ni exclusión: no son comparables con las nuevas. Pendiente: repetir la evolución (semillas 7 y 100) con el umbral y comentar en #68.

## 2026-11-07 22:49 — Primera corrida con exclusión: `2026-11-07_excl15_seed100` (#68)

- Semilla 100, 300 gen., paciencia 30, umbral 15 (518 noticias, 14 excluidas con 332 links). Generaciones por fold 234, 300, 178, 300, 105; final 173. Folds de test de 103–104 noticias.
- CV evolved (baseline): bill_coverage@50 0,948 (0,754), @100 0,967 (0,812); link_recall@50 0,943 (0,702), @100 0,966 (0,771); single_news @100 0,963 (0,779). Contra la misma semilla sin exclusión (0,9164 y 0,942): +3,2 y +2,5 puntos; el baseline también sube (0,739 a 0,812), así que parte de la mejora es que la tarea es más fácil. Cobertura @100 por fold: 0,982, 0,959, 0,939, 0,975, 0,981 (rango 4,3 puntos; antes 0,917–0,962, 4,5): ya no hay un fold muy por debajo.
- Noticias excluidas (14, nunca vistas al entrenar): baseline cobertura @100 0,439, link recall 0,367; recetas de fold 0,755–0,852 y receta final 0,835 (@50 0,730, link recall 0,774). O sea, el ranker sigue ganando mucho en ellas (casi el doble del baseline) pero queda ~13 puntos por debajo de las noticias típicas. Es la cifra a reportar aparte.
- Falta la corrida de semilla 7 con exclusión para ver si se repite.

## 2026-11-07 23:00 — Corrida con exclusión, semilla 7: `2026-11-07_excl15_seed7` (#68)

- 300 gen., paciencia 30, umbral 15. Generaciones por fold 168, 91, 257, 220, 161; final 300 (llegó al tope). CV evolved (baseline): bill_coverage@50 0,960 (0,748), @100 0,974 (0,807), link_recall@100 0,966 (0,772). Por fold @100: 0,978, 0,982, 0,961, 0,987, 0,960 (rango 2,7 puntos).
- Contra la misma semilla sin exclusión (0,908 @50 y 0,942 @100): +5,2 y +3,2 puntos; el baseline sube 0,723 a 0,807. Promedio de las dos semillas con exclusión: @50 0,954, @100 0,970 (sin exclusión 0,912 y 0,942). Las dos semillas dan casi lo mismo, lo cual confirma que la CV ya es estable.
- Noticias excluidas (14): baseline 0,439 @100; receta final 0,802 (link recall 0,741), recetas de fold 0,806–0,865 (semilla 100: final 0,835, folds 0,755–0,852). O sea, 80–84 % de cobertura en las noticias-agenda contra ~97 % en las típicas; casi el doble del baseline.
- Recetas finales de ambas semillas: coinciden en bm25 (5,0), cos_exposition_max, cos_subjects_max (negativo), z_subjects, event_distance y filed_after_news (negativos), age_decay (negativo) y en usar event_count (pero con signo distinto). Difieren en cos_name_max, cos_exposition_mean, z_exposition, alive, active y en la ventana (1 día antes contra 51). Es el mismo patrón de genes planos de antes.

## 2026-11-07 20:40 — Commit de la fitness por lotes (#68)

- Por pedido del usuario: 3cbf712 `feature: batched gpu fitness for the evolutionary ranker #68` (ranking_problem.py, run_evolution.py, run_ranking_benchmark.py y el log del día). Sin push. Fuera: `results/sample/negatives_review_pilot.csv`.

## 2026-11-07 20:40 — Push de 3cbf712 (#68)

- Por pedido del usuario, push de main a origin (8be8aae..3cbf712), para bajarlo en la máquina de la 2060 y correr `run_ranking_benchmark.py`.

## 2026-11-08 00:10 — Commit of pending evolution runs to switch computers

Committed everything left untracked so the other computer has no differences: evolution runs `2026-11-07_long`, `2026-11-07_seed_100`, `2026-11-07_excl15_seed7`, `2026-11-07_excl15_seed100` (~85 MB in `results/evolution/`), `gpu_monitor.csv` and `run_ranking_profile.py`. Related to #68.

## 2026-11-08 19:29 — Barrido de K con las recetas evolucionadas ya guardadas, sin reentrenar (#41 #68 #34)

- Pedido del usuario: ver qué K balancea mejor el costo de Jev contra el recall. Se reusaron las recetas de cada fold de `2026-11-07_excl15_seed7` y `_seed100`, con las mismas particiones (misma semilla) y evaluadas solo en las noticias de test (518 noticias, 1.091 links, ~805 expedientes por semilla); promedio de las dos semillas. Script desechable en el scratchpad (no está en el repo); tabla en `results/evolution/k_sweep.csv`. Control: @50 y @100 coinciden con summary.json (0,954 y 0,970).
- Cobertura de expedientes (evolved / base cos_exposition_max): @10 0,852/0,608; @20 0,911/0,681; @30 0,927/0,709; @40 0,943/0,731; @50 0,954/0,751; @75 0,966/0,785; @100 0,970/0,809; @150 0,979/0,837; @200 0,983/0,856; @300 0,988/0,873. Noticias-agenda excluidas (receta final): @50 0,658, @100 0,758, @200 0,839, @300 0,890 (link recall).
- Costo marginal en pares de Jev por expediente extra cubierto (en el oro): 10→20 ≈ 110; 20→30 ≈ 430; 30→50 ≈ 500; 50→75 ≈ 1.100; 75→100 ≈ 3.700; 100→200 ≈ 5.000. Rango de pares: ~8.085 noticias del filtro de palabras × K (K = 50: 404 mil; K = 100: 809 mil).
- Rango de rangos de los links: mediana 3, p75 7, p90 21–22, p95 52–57, p99 630–780 (cola larga: unos pocos links caen muy lejos y ningún K razonable los atrapa).
- Caveats: el oro es de Delfino (links explícitos, más fáciles que las menciones implícitas); el recall del pipeline es el del ranker por el de Jev; no se midió en la muestra manual (falta `--all-news`); el costo en dinero de Jev no se midió, solo pares.

## 2026-11-08 21:42 — decisión: evaluar el ranker evolutivo en la muestra manual (solo cobertura en positivas) (#41 #68 #27)
- Decisiones del usuario: verdad = todas las filas con Revisión «Correcto» y «En la muestra» = Sí (189: 62 positivas, 127 negativas; incluye propuestas de Claude que el usuario dio por buenas); medir solo la cobertura del expediente correcto en las positivas (no el positivo/negativo); features solo para esas noticias, con script desechable en el scratchpad (no está en el repo: `eval_sample.py`).
- Método: features de la muestra con los embeddings `news_256_all.npz` y los mismos métodos de FeatureBuilder; se estandariza con la media/desvío del oro; recetas `final` de las semillas 7 y 100. Control: las features recalculadas en 40 noticias del oro coinciden con el caché (dif. ≤ 0,001 en cosenos, 0,01 en z). Ninguna noticia de la muestra está en el oro.
- Cobertura (principal u otros mencionados, n = 62), semilla 7 / semilla 100: @1 0,47/0,55; @10 0,81/0,89; @30 0,95/0,97; @50 0,95/0,97; @100 0,97/0,97. Solo el expediente principal: @30 0,935/0,952. Por tipo @30: Número 1,00, Nombre oficial 0,92, Descripción 0,90/0,95, Apodo y Proponente 1,00. Las recetas se evolucionaron sin ver estas noticias.
- Extra (no pedido): puntaje del top-1 como señal positivo/negativo da AUC 0,64 (semilla 7) y 0,70 (semilla 100): el ranker no sirve para separar, solo para ordenar candidatos; eso le toca a Jev. Medianas del top-1: positivas 21–25; negativas 18–21 (Ley vigente 28).
- Caveat: la verdad incluye propuestas de Claude no distinguibles de las marcas del usuario; las 47 «Pendiente» (casi todas «Sin relación»), 40 «Corregir» y 24 «Dudoso» quedan fuera.

## 2026-11-08 21:44 — decisión: K = 50 para pasar los candidatos a Jev (TypeSafe); el ranker no clasifica positivo/negativo (#41 #68)
- El usuario aclara que el objetivo de la evaluación en la muestra era solo ver si el recall con K = 50 queda alto; positivo/negativo lo decide Jev, no el GA. El AUC del top-1 (0,64–0,70) queda como dato, sin importancia para el diseño.
- Con K = 50 en la muestra (62 positivas): principal 0,935 (sem. 7) / 0,952 (sem. 100); principal u otros mencionados 0,952 / 0,968. Concuerda con el 0,954 del oro. Cierra el pendiente del K final (ranker 2026-11-08 19:29).

## 2026-11-09 12:41 — Revisión de qué entrena el GA y lectura de las recetas de excl15 (#68)
- Genes (29): 13 pesos en [-5, 5], 13 switches on/off, `window_before_days` (0–60), `window_after_days` (0–14), `age_half_life_days` (7–3650, escala log). Los ajustes del GA (población 50, torneo 3, BLX-0.5, etc.) son fijos, no se evolucionan.
- Score = Σ peso·feature (continuas estandarizadas sobre todos los pares; alive/filed_after_news quedan 0/1). Fitness = cobertura de expedientes@100 + 0,001·media de K/(K+mejor rango). Empates cuentan en contra del oro.
- Estable en las 12 recetas (2 semillas × 5 folds + final): bm25 ≈ +5 (topa el rango), z_subjects +2/+3.5, cos_exposition_max +1/+4.8, event_distance −1/−3, filed_after_news ≈ −4/−5, age_decay −1/−5 con vida media 26–213 d (castiga expedientes muy recientes), cos_subjects_max negativo (se compensa con z_subjects: colineales).
- Inestable: ventana de actividad (1–60 días antes, 0–14 después), `active` y `event_count` (cambian de signo o se apagan): señal débil o redundante con event_distance.

## 2026-11-09 13:10 — Interpretación de lo que aprendió el GA (#68)
- Lógica de dos capas: contenido (¿es el tema?) domina; tiempo (¿está vivo y moviéndose en el SIL?) desempata entre expedientes de tema parecido.
- bm25 lo más fuerte (topa +5): las notas nombran términos raros del expediente (instituciones, nombres de leyes) que el embedding diluye entre muchos expedientes del mismo tema.
- z_subjects + / cos_subjects − : vale la similitud inusual para ese expediente, no la absoluta; castiga los expedientes "hub" de materias genéricas.
- event_distance −, alive +, age_decay − (vida media 1–3 meses), filed_after_news −5: la cobertura sigue al trámite y a expedientes ya en discusión, no a los recién presentados (muchos y casi nunca cubiertos).
- Ojo: el peso de bm25 puede estar inflado si Delfino arma sus links buscando por nombre; liga con la idea pendiente del oro enmascarado (embeddings 2026-11-07 12:52). Sin ablación es solo interpretación.

## 2026-11-09 13:23 — Ranker evolutivo en la muestra manual: ~0,95, parecido al CV en Delfino (#68 #41)
- Dato del usuario: probado en la muestra manual, queda "muy parecido, en 0,95". No consta aquí qué métrica, qué receta ni el número de la base; el resultado no está en el repo (se corrió en la otra máquina; git fetch falló por red).
- Lectura: generaliza fuera del oro de Delfino (CV 0,967–0,974). Con ~100 positivas el error estándar es ~±2 pp, así que la diferencia cabe en el ruido.
- Ojo: el pre-etiquetado de la muestra usó TF-IDF sobre nombre + temas, números citados y diputados con actividad ±21 días (sample 2026-11-07 13:35): las mismas señales que más pesan en el ranker (bm25, actividad). Los positivos que no tenían coincidencia léxica pudieron quedar sin etiquetar, lo que inflaría la cobertura. La sospecha de sesgo léxico baja pero no desaparece.
- La revisión humana de la muestra no ha cerrado: el número puede moverse.

## 2026-11-09 13:37 — pendiente: ampliar el rango de pesos es un no-op si se amplía para todos (#68)
- El ranking no cambia si se multiplican todos los pesos por c > 0, y el GA escala igual: población inicial uniforme, mutación = 10 % del rango, BLX, reinicios y clip son todos proporcionales al rango. Cambiar WEIGHT_RANGE de 5 a 20 da las mismas recetas (×4) y la misma fitness, salvo redondeo de float32.
- Que bm25 tope +5 no limita nada: cualquier receta cabe en [-5, 5] reescalándola. El techo solo dice que bm25 es el peso mayor.
- Opciones con efecto real: rango distinto por feature (p. ej. solo bm25 a ±20: cambia la búsqueda, no lo que se puede representar), fijar un peso (bm25 = 1) para quitar la dimensión redundante, o pesos en escala log para afinar los pesos chicos. Recomendación de Claude: no tocarlo.

## 2026-11-09 13:42 — decisión: el rango de pesos se queda en ±5 (#68)
- El usuario decide no ampliarlo, siguiendo la recomendación de Claude (ranker 2026-11-09 13:37): ampliarlo para todos es un no-op y el techo de bm25 no limita. Se quita de STATUS; siguen abiertos los otros ajustes al GA.

## 2026-11-09 13:50 — decisión: la base es exposition sola, la generación 0 al azar, y K final = 50 (#68 #41)

- El usuario confirma los dos detalles que estaban "a confirmar" (ranker 2026-11-07 15:26): la base de comparación es exposition sola (no la mezcla RRF) y la generación 0 del GA es al azar. Así se hicieron las corridas.
- K final del pipeline = 50, no 100. Según el usuario, es un buen punto entre el costo de Jev y el recall (CV @50 ≈ 0,954 en el oro con las semillas 7 y 100). Las corridas usaron K = 100: hay que reportar @50 como la métrica principal.

## 2026-11-09 15:22 — corrección: el resultado del ranker en la muestra sí estaba registrado (#68 #41)

- La entrada 2026-11-09 13:23 decía que no constaba la métrica ni la receta. Estaban en la otra máquina y llegaron con el pull: ranker 2026-11-08 21:42 (cobertura en las 62 positivas «Correcto», semillas 7 y 100) y 21:44 (K = 50). STATUS se mezcló con esa versión.

## 2026-11-09 16:34 — CandidateRanker validado contra el caché del oro; corre sin torch (#68 #33)

- numpy instalado en el .venv de esta máquina (2.5.4), y los embeddings y el caché de features ya están acá. `BINARY_FEATURES` pasó de ranking_problem.py (importa torch) a feature_builder.py, así que aplicar la receta solo necesita numpy.
- Control: features recalculadas para 40 noticias del oro contra el caché del entrenamiento. Cosenos con dif. ≤ 0,0006, z ≤ 0,011, bm25 y fechas idénticos (mismo margen que el control de ranker 2026-11-08 21:42). Links del oro en el top-50: 87/92. Tarda 13 s.
