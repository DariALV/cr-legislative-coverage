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
