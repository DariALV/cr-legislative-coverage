# Trabajo a futuro

Diario del tema «trabajo a futuro»: ideas para llevar el pipeline más allá del curso (más período, otras fuentes, otras miradas sobre noticias y expedientes, transparencia de datos de Costa Rica). Append-only, como los demás diarios. Cada idea dice en qué se apoya de lo que ya existe.

## 2026-11-10 18:57 — Tema creado a pedido del usuario; punto de partida (#56)

- El usuario quiere llevar el pipeline más lejos para aumentar la transparencia de los datos de Costa Rica: más fuentes con cifras concretas, otras miradas sobre noticias y expedientes (p. ej. cobertura de leyes en vez de expedientes).
- Lo que ya existe y se reutiliza: scrapers de 5 medios (29.698 noticias, mayo–oct 2026), SIL completo (5.898 expedientes, pasos, proponentes, textos), votos de Delfino desde 2018 (9.288 votaciones), diputados y fracciones, ranker evolutivo + unión por número, Jev con captura completa, la muestra de 300 y la revisión de 190 pares.
- Costo de referencia: $13,06 por 6 meses de noticias (filtro $1,54, puerta $10,08, detalle $1,44); la puerta crece casi en proporción a K (general 2026-11-10, «Para el informe: universo…»).

## 2026-11-10 18:57 — Ideas: abaratar el pipeline para cubrir más años (#33 #41 #43)

- Bajar K sin perder recall: reranker cross-encoder sobre el top-50 que mande solo el top-10 a Jev; recall actual en el oro: @10 0,852, @50 0,954. Con @10 ≈ 0,95 la puerta costaría ~5 veces menos (≈ 2 años de noticias por lo que costó medio año).
- Fine-tuning contrastivo de los embeddings con los ~3.400 pares de cobertura sustantiva de esta corrida más el oro de Delfino (el corpus alimenta al siguiente modelo).
- Atajos: confirmar sin LLM las menciones por número (282 de los 283 matches de la unión eran explícitos); puerta en dos pasos (top-10 primero y ampliar a 50 solo si no hay match).
- Calibrar las probabilidades de Jev con la muestra (hoy el umbral implícito 0,75 sale de 190 pares) y medir la deriva entre corridas (±0,03 cerca del umbral).
- Actualización continua: correr el pipeline cada semana sobre las noticias nuevas (≈ $0,50 por semana con el método actual).

## 2026-11-10 18:57 — Ideas: otras miradas sobre los mismos datos (#56)

- Cobertura de leyes vigentes: el falso positivo de «ley vigente» (p. ej. 21372, el reglamento contra el hostigamiento) se vuelve la señal. ¿Qué leyes se citan, aplican o cuestionan en la prensa? La base tiene 10.983 leyes enlazadas a expedientes.
- Dice vs. vota: la posición que la prensa atribuye a cada partido coincide con su voto en el 92 %; el 8 % restante son los casos interesantes (partidos que anuncian una cosa y votan otra, o prensa que se equivoca).
- Retraso y disparadores: cuántos días pasan entre un paso en el SIL y la primera noticia, y qué pasos generan cobertura (dictamen, primer debate, veto). El 60 % de los expedientes con actividad no tiene cobertura sustantiva.
- «Lo que la prensa no ve»: boletín de expedientes que se mueven en comisión sin ninguna noticia; puede ser el producto más útil para periodistas.
- Fijación de agenda: ¿la cobertura precede o sigue al movimiento legislativo? Series semanales por expediente (cobertura frente a pasos y votos).
- Diputados: quién aparece en la prensa frente a lo que hace (expedientes, votos, comisiones). Ojo: el plan del curso deja fuera rankear diputados; pide un análisis ético propio antes de hacerlo.
- Nombramientos, elecciones de magistrados y comisiones investigadoras como estudio aparte (se comportan distinto a los proyectos de ley: mucha cobertura de conflicto).

## 2026-11-10 18:57 — Ideas: nuevas fuentes de datos públicos de Costa Rica (#56)

- Actas del Plenario y de comisiones: lo que los diputados dicen en el Plenario frente a lo que la prensa reporta que dijeron.
- Comunicados oficiales (prensa de la Asamblea, ministerios, fracciones): medir el «copiar y pegar» de forma objetiva por similitud de texto, en vez de la pregunta press_release de Jev.
- La Gaceta: publicación de leyes y decretos, para cerrar el ciclo expediente → ley → aplicación → cobertura.
- Sala Constitucional: consultas legislativas y resoluciones enlazadas a expedientes (la Sala aparece mucho en la cobertura).
- Contraloría y presupuesto (ejecución, informes de auditoría): contrastar las cifras que dan las noticias (gives_figures) con los datos oficiales, como verificación automática.
- Compras públicas y financiamiento de partidos (TSE): cruzar con las noticias por entidad y monto.
- Más medios: regionales, transcripciones de radio y TV, y las cuentas oficiales de diputados y fracciones en redes.
- Antes de cada fuente: términos de uso, derechos de autor y datos personales (Ley 8968), como se hizo con las noticias.

## 2026-11-10 18:57 — Ideas: productos para el público (#56)

- API pública del corpus y descargas periódicas (datasheet versionado).
- Página por expediente con la línea de tiempo: pasos del SIL, votaciones y noticias, en un solo lugar.
- Alertas por expediente o por tema (correo o RSS) cuando hay movimiento o cobertura nueva.
- Extensión de navegador: al leer una noticia, muestra los expedientes que menciona, su estado en el SIL y cómo votó cada partido.
- Panel de calidad del dato, visible en el sitio: precisión medida, límites y fecha de la última revisión humana.

## 2026-11-10 19:51 — Idea del usuario: modelar la posición de cada diputado con sus intervenciones en las actas del Plenario (experimento privado)

- El usuario propone hacer fine-tuning de un modelo con lo que cada diputado dice públicamente en el Plenario, para ver qué «opinaría» ante noticias, comentarios o expedientes. Sería privado y con fines de prueba, no para argumentar con eso.
- Sugerencia de Claude: plantearlo como predicción de posición o de voto, no como imitación de la voz del diputado. La verdad para evaluar ya existe: los votos de Delfino desde 2018 (9.288 votaciones). Empezar con recuperación de sus intervenciones + Jev o un LLM, antes de hacer fine-tuning; comparar contra la línea base de «vota como su fracción».
- Cuidados: no generar citas en primera persona atribuidas a personas reales; mantener las salidas privadas y marcadas como simuladas; las actas son públicas y la intervención en el Plenario es un acto oficial, pero un modelo que «habla como» alguien es otro producto.

## 2026-11-11 18:35 — pendiente: idea del usuario, lazo Jev ↔ GA que se reentrena con noticias nuevas; análisis con la corrida del corpus y versión segura (#68 #33 #34)

- Idea: en cada tanda nueva, Jev califica el top-50 del GA, el GA se reentrena con esas etiquetas y se mide en qué puesto quedó el expediente correcto. Lectura de Claude: no es entrenamiento mutuo. Jev (jev-1.14.0 por API) no aprende; el GA aprende de Jev y decide qué ve Jev. Hace falta un ancla fuera del lazo (oro de Delfino, muestra, evaluación a ciegas) que nunca entre al entrenamiento.
- Medido en results/jev/corpus/ (6.329 pares con match): puesto 1 31,5 %, ≤ 5 59,3 %, ≤ 10 71,2 %, ≤ 20 82,5 %, ≤ 50 95,5 %. Los 283 restantes (4,5 %) quedaron fuera del top-50 y solo entraron por número: están en 114 noticias, 204 de ellos en 45 noticias tipo lista. Con «mención»: ≤ 10 74,3 %, ≤ 20 84,0 %, fuera 6,0 %. Hoy K = 20 perdería ~13 % de los pares (puestos 21–50).
- El ruido de Jev está justo donde el lazo aprendería: los positivos solo implícitos < 0,75 son el 16 % en el puesto 1 y el 43 % en los puestos 21–50.
- Conclusión: el lazo sirve para reordenar dentro del top-K (bajar K y abaratar: la puerta es 1 llamada por noticia con todos los candidatos, ~32 mil tokens), no para encontrar lo que el GA deja fuera. Para lo que no se cita por número, el recall@50 medido con etiquetas de Jev es 100 % por construcción, así que la fitness tiene que ser de posición (MRR, @10, @20). Casi toda la ganancia está en la primera vuelta.
- Riesgos: punto ciego estable e invisible; errores sistemáticos de Jev tomados como verdad (posible: con los falsos positivos de ley vigente, el GA bajaría alive/age_decay y subiría leyes viejas, donde Jev vuelve a fallar); evaluación circular; deriva (temas nuevos, cambio de versión de Jev, ±0,03 entre corridas).
- Versión segura propuesta: top-100 en un 5–10 % de noticias al azar (+5–10 % de costo) para estimar el hueco; reentrenar solo con etiquetas confiadas y ventana de tandas, sembrando con las recetas anteriores; ~20 desacuerdos GA–Jev por tanda a un humano (página de la evaluación a ciegas); umbral de Jev según el puesto, ajustado contra el humano; bajar K solo si el ancla sigue ≥ ~0,95; validación temporal (meses ≤ t, medir en t+1).
- Primera vuelta gratis: reentrenar el GA con las etiquetas del corpus (sin las noticias del oro ni de la muestra) y ver si @10 (hoy 0,852 en el oro) y @20 suben. Solo GPU.
- Pendiente: ¿va al informe como trabajo futuro, con el piloto para después del 15? Recomendación de Claude: sí, un párrafo en el informe; el piloto después del informe; nada de código ahora.

## 2026-11-11 18:36 — corrección: con la unión por número, K = 20 perdería ~10 % de los pares, no ~13 % (#41)

- La entrada de las 18:35 contó todos los pares de los puestos 21–50 (822). Pero los citados por número entran igual por la unión, así que con K = 20 solo se pierden los no citados de esos puestos: 647 de 6.329 (10,2 %).

## 2026-11-11 18:51 — pendiente: alternativas para subir el recall (apodos de prensa, reranker local, fine-tuning del encoder, más inputs o neuronas en el GA) y lecturas con links (#33 #41 #68)

- Pregunta del usuario: otras alternativas al lazo Jev ↔ GA. Él propone más inputs y neuronas en el GA, o probar encoders, que no sabe bien cómo funcionan. Se le explicó el bi-encoder (lo que ya se usa: qwen3, y bge-m3 solo en modo denso), el cross-encoder (reranker) y Jev como un cross-encoder grande y pago.
- Distinción clave: más neuronas reordenan (suben @10/@20 y dejan bajar K), pero no suben el techo. Más inputs sí pueden subir @50/@100, porque ninguna combinación rescata un expediente que puntúa bajo en todas las features. Las neuronas ya están pendientes como A/B/C (#68); se suma LambdaMART (LightGBM) como opción D.
- Medido con results/jev/corpus/ y las fechas de la base: 637 expedientes con match se citan por número. De los 3.831 pares con match sin número, el 71,4 % es de un expediente que otra noticia cita por número, y el 56,7 % de uno citado en una noticia anterior. En los puestos 21–50: 57,0 % y 42,7 %. Los apodos tendrían material para cerca de la mitad de los casos difíciles, aunque tener apodos no garantiza encontrarlos.
- Orden recomendado: (1) apodos de prensa como campo nuevo del expediente, con la etiqueta de la regex (independiente del GA y de Jev); (2) reranker local (bge-reranker-v2-m3) sobre el top-100, para bajar K; (3) fine-tuning del encoder con las etiquetas de Jev, como RocketQA y GPL; (4) neuronas o LambdaMART. Otros inputs posibles: diputado proponente nombrado, comisión nombrada, cobertura de los últimos 7–30 días (ojo: el rico se hace más rico).
- Lecturas en arXiv: SBERT 1908.10084, DPR 2004.04906, ANCE 2007.00808, RocketQA 2010.08191, GPL 2112.07577, BLINK 1911.03814, BGE-M3 2402.03216, doc2query 1904.08375, Kuzi et al. 2010.01195, RocketQAv2 2110.07367, AR2 2110.03611, CMA-ES 1604.00772. Otras: RRF plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf; CAL cormack.uwaterloo.ca/calstudy/; TREC Total Recall 2015 trec.nist.gov/pubs/trec24/papers/Overview-TR.pdf; LambdaMART MSR-TR-2010-82; NEAT nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf; anchor text doi 10.1145/383952.383999; huggingface.co/BAAI/bge-reranker-v2-m3.
- Pendiente: cuándo medir en el oro cuánto rescatan los apodos. Recomendación de Claude: después del informe.

## 2026-11-11 20:43 — Ranker por gradiente (A/B/C) como trabajo futuro (#68)

- Pasa aquí desde #68 (decisión del usuario): (A) 1 neurona / 13 parámetros, (B) 12→16→1, (C) 12→32→16→1, con la misma CV de 5 folds y la exclusión de noticias-agenda (≥ 15 links). Pregunta: ¿el GA (CV @50 0,954) le gana a algo entrenado por gradiente con los mismos rasgos? Criterio propuesto: la más simple que no pierda. Local y gratis.
- Se junta con las alternativas para subir el recall (future 2026-11-11 18:51): las neuronas eran el último escalón de esa lista.
