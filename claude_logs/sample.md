# sample

## 2026-11-07 12:58 — Propuesta de muestra manual de 100–200 noticias (#25–#31, #38)

- Pregunta del usuario: si conviene, además del oro de Delfino, una muestra de 100–200 noticias de varios medios con variaciones en cómo se menciona el expediente (explícito, implícito "un proyecto de ley que busca", mismo tema sin ser el expediente), y qué otros edge cases hay.
- Respuesta: sí; es lo que piden #27 (~50 con expediente), #28 (30–50 sin expediente, con negativos difíciles), #29, #30 y #31, solo que más grande y estratificado por tipo de mención. Corrige el sesgo de selección del oro de Delfino (entrada 12:52).
- Edge cases propuestos además de los tres del usuario: apodo o nombre popular ("ley de jornadas 4x3"), por proponente ("el proyecto del diputado X"), mención de paso, varias leyes en una nota (resúmenes de plenario, convocatorias de extraordinarias), proyecto anunciado aún sin número, ambiguo entre proyectos parecidos o acumulados/texto sustitutivo, ley vigente aplicándose o reglamento, reforma a una ley vigente en trámite, decreto o política del Ejecutivo, control político o comisión investigadora (actividad de la Asamblea sin expediente), préstamos/tratados descritos sin decir "proyecto", veto o consulta a la Sala IV, leyes de otros países, número citado mal, opinión/editorial, la misma nota en varios medios, expediente fuera de la base o de otro período.
- Decisiones presentadas (pendiente): tamaño y reparto, cómo muestrear (no usar el embedding para elegir, por circularidad), unidad y esquema de etiqueta (tipo de mención, centralidad, ambiguos), si entra Delfino, uso como test y no para elegir configuración, y el doble etiquetado de #30. No se escribió código.

## 2026-11-07 13:18 — Rol de la muestra manual y propuesta de muestreo (#27, #28, #29, #30, #26, #33, #41)

- Aclaración del usuario sobre el pipeline: los embeddings solo filtran (top-K, pensado K = 50) y Jev juzga cada candidato (si habla del expediente, intensidad, si es tema central, tono). Al embedding se le pide recall, no precisión. Menciones de paso, varios expedientes por nota y ambigüedad entre proyectos parecidos los resuelve Jev; en la muestra se aceptan listas de candidatos.
- Consecuencia: la muestra sirve sobre todo para medir recall@50 de los embeddings por tipo de mención. Los negativos (decretos, leyes vigentes) no afectan ese recall; importan para la exactitud de "ninguno" de Jev (#39). Propuesto etiquetarlos "ninguno" con su tipo.
- Caso "por proponente": Jev puede resolverlo con el contexto del expediente (proponentes, fechas, votaciones), pero solo si el embedding lo mete al top-50; los vectores de expedientes no incluyen proponentes. Idea para después (no decidida): sumar candidatos baratos por diputado nombrado + actividad cercana a la fecha (#33, #36).
- El usuario aceptó: 150 noticias (100 positivas, 50 negativas), muestreo en dos grupos, esquema de etiqueta ampliado, ~15 de Delfino para medir el ruido del oro, muestra solo como test, 20 doblemente etiquetadas y estratificadas.
- Datos revisados: 29.875 noticias (crhoy 9.442, nacion 9.424, delfino 5.399, elmundo 3.388, semanario 2.222), mayo–oct 2026. Pasan un filtro amplio de palabras (proyecto de ley, expediente, Asamblea Legislativa, diputad, plenario, comisión legislativa, primer/segundo debate): crhoy 1.998, nacion 2.301, elmundo 1.466, semanario 1.013, delfino 1.307.
- Propuesta al usuario (pendiente): Claude hace el muestreo con script y semilla y pre-etiqueta leyendo cada noticia y buscando en la base por texto (nombres, temas, proponentes, pasos y votaciones cerca de la fecha), sin usar vectores ni top-K del embedding; el usuario revisa. Las 20 de #30 se etiquetan a ciegas antes de ver la propuesta. Una tanda dirigida por regex para tipos implícitos, reportada aparte por no ser aleatoria. Pendiente decidir dónde vive la hoja (#26).

## 2026-11-07 13:35 — Cola del sorteo, hoja de revisión y primera tanda pre-etiquetada (#27, #28, #26, #31, #29)

- Decisiones del usuario: Claude pre-etiqueta todo y el usuario revisa fila por fila; la hoja vive en Google Sheets, con buen formato y enlaces a la noticia; las 15 de Delfino van aparte; la muestra se usa como test de los embeddings ya corridos. Lo de las "20 a ciegas" (#30) quedó por explicar (son el usuario y su compañero).
- `tools/sample_tools/sample_builder.py` + `run_sample.py` + constantes `SAMPLE_*` en `config.py`: cola de sorteo con semilla 20261107 en `results/sample/queue.csv` (solo ids, urls, fechas, sección, sin texto). Por medio general, cola barajada con 80 % del filtro de palabras (pool A) y 20 % del resto (pool B), intercaladas por turnos entre los 4 medios; títulos casi iguales se saltan. Delfino: 15 noticias con enlaces de oro, aparte. Solo noticias `Success` con ≥ 300 caracteres. Salen 415 filas (100 por medio + 15).
- Pre-etiquetado con scripts del scratchpad (no del proyecto): texto de la noticia, números citados, diputados nombrados con sus expedientes con actividad ±21 días, y TF-IDF sobre nombre + temas de los expedientes. Sin embeddings.
- Hoja: "Muestra etiquetada: cobertura legislativa" (Google Sheets, id 1kOWLXD9nFzYwSpYwZFYrQ_GV1eD02gGO3qxo4QVjaBU), pestañas Etiquetas, Guía y Resumen (conteos con fórmulas). Columnas: expediente con enlace a delfino.cr/asamblea/proyecto/N, tipo de expediente, otros mencionados, alternativos, tipo de mención (5 positivos, 6 negativos), centralidad, confianza, evidencia, nota, revisión (Pendiente/Correcto/Corregir/Dudoso) y comentario del revisor.
- Primera tanda: sorteos 1–24 (6 por medio). 8 positivas (3 por número, 1 nombre oficial, 1 apodo "4×3", 3 descripción) y 16 negativas. Tasa de positivas ~1/3: para 100 positivas harían falta ~300 sorteos.
- Hallazgos: (1) el SIL numera con la misma serie cosas que no son proyectos de ley (253 comisiones investigadoras, 93 nombramientos, 138 reformas al Reglamento, etc.); 3 de las 8 positivas son de ese tipo (elección de suplentes de la Sala IV 25258 dos veces, comisión investigadora 25400). Se marcan con "Tipo de expediente" para filtrarlas después; falta decidir si cuentan. (2) Anuncios que después se vuelven expediente (presupuesto extraordinario → 25803): se dejan como negativo "Anunciado sin expediente" con el expediente posterior en "alternativos"; falta decidir. (3) "Expediente" judicial cae en el filtro de palabras (caso Petro Coca). (4) Números con coma ("25,400") no los atrapa una regex de punto.
- Pendiente para medir: los embeddings de noticias solo existen para las del oro de Delfino (`EmbeddingRunner` toma `news_bill_links`); para evaluar con esta muestra hay que embeber sus noticias.

## 2026-11-07 13:49 — Segunda tanda pre-etiquetada (#27, #28, #29)

- Sorteos 25–48 escritos en la hoja (filas 26–49). Tanda: 9 positivas y 15 negativas; acumulado 48 noticias, 17 positivas y 31 negativas (Resumen de la hoja, verificado).
- Casos nuevos: 23414 (armonización eléctrica) aparece tres veces, por número, por nombre abreviado («armonización eléctrica») y con apodo («ley del apagón»); reforma constitucional de reelección (25867) solo por el artículo que reforma; 24282 identificado por partido proponente («el proyecto del Frente Amplio») con confianza media; la comisión investigadora 25400 otra vez, ahora implícita («archivando un caso de violencia sexual»).
- Observaciones: (1) el estado del SIL es el de hoy, no el de la fecha de la noticia (23414 figura archivado porque se rechazó en segundo debate el 19/10, después de varias notas que lo cubren). (2) La búsqueda por número da falsos positivos con montos («₡25.000 millones» → 25000). (3) «Expediente» judicial o de contratación aparece de nuevo (alias Diablo, Open English).
- A este ritmo las 50 negativas se completan antes que las 100 positivas (31 vs 17). Queda por decidir con el usuario qué hacer con las negativas que sobren.

## 2026-11-07 13:55 — Negativas de más se etiquetan y se quedan (#28, #31)

- Decisión del usuario: cuando se pasen las 50 negativas, se siguen etiquetando y se quedan en la muestra. Así el sorteo sigue en orden y aleatorio, y sirven para la exactitud de «ninguno» de Jev (#39). Lo descartado: saltarlas una vez completa la cuota.

## 2026-11-07 13:58 — Tercera tanda pre-etiquetada (#27, #28, #29)

- Sorteos 49–72 en la hoja (filas 50–73). Tanda: 8 positivas y 16 negativas. Acumulado: 72 noticias, 25 positivas, 47 negativas (Resumen de la hoja, verificado). Tasa de positivas estable en ~1/3; para 100 positivas harían falta ~290 sorteos (la cola tiene 400 de medios generales).
- Casos nuevos: proyecto de colegiatura (25747) y proyecto de tabaco del Ejecutivo (25668) identificados solo por proponente o descripción; presupuesto 2027 (25754) aludido como «ese presupuesto para seguridad y escoltas»; 23414 de nuevo como «su proyecto de reforma eléctrica».
- El pool B (fuera del filtro de palabras) va 0 de 12 en positivas hasta ahora.
- «Expediente» no legislativo (judicial, disciplinario, Sicop, policial, administrativo) apareció en 7 de las 24 noticias de esta tanda: el filtro de palabras atrapa mucho ruido por esa palabra.

## 2026-11-07 14:24 — Cuarta tanda pre-etiquetada (#27, #28, #29)

- Sorteos 73–96 en la hoja (filas 74–97). Tanda: 8 positivas y 16 negativas. Acumulado: 96 noticias, 33 positivas, 63 negativas (verificado en Resumen); la cuota de 50 negativas ya se pasó y, como se decidió, las que sobran se quedan.
- Casos nuevos: presupuestos nombrados por nombre corto («primer presupuesto extraordinario de 2026» = 25589, «presupuesto ordinario de 2027» = 25754, «segundo presupuesto extraordinario» = 25803); comisión investigadora del caso Obaldía inferida como 25800 por la fecha de la moción (7/9), con 25839 como gemela; reforma a la Ley de Armas 25533 con trámite de consulta a la Corte.
- Observación: hay expedientes con el mismo nombre exacto (25400, 25800 y 25839 se llaman todos «Comisión especial investigadora por denuncia de hostigamiento sexual»). El embedding no puede distinguirlos por el texto; solo la fecha o el contexto (a quién se investiga) los separa. Bueno para Jev, malo para medir recall con un solo expediente correcto.

## 2026-11-07 14:29 — Quinta tanda pre-etiquetada (#27, #28, #29)

- Sorteos 97–120 en la hoja (filas 98–121). Tanda: 9 positivas y 15 negativas. Acumulado: 120 noticias, 42 positivas, 78 negativas (verificado en Resumen).
- Casos nuevos: paquete de seguridad del Ejecutivo con seis proyectos descritos sin número (25672–25676 del 27/7 y 25686 del 3/8); «proyecto de eurobonos» (25363, por apodo; el SIL no le registra pasos desde mayo, por confirmar); ratificación de Coprocom (25613) y reelección de la magistrada Varela (25657), ambos expedientes de nombramiento identificados por los nombres de las personas.
- El pool B sigue sin positivas (0 de 20 hasta ahora).

## 2026-11-07 14:37 — Sexta tanda pre-etiquetada (#27, #28, #29)

- Sorteos 121–144 en la hoja (filas 122–145). Tanda: 9 positivas y 15 negativas. Acumulado: 144 noticias, 51 positivas, 93 negativas (verificado en Resumen).
- Casos nuevos: proyecto de propaganda en centros educativos (25720) y Ciudad Gobierno (25725) por proponente o nombre; liquidación presupuestaria 2025 (25592, tipo «comisión ad hoc» en el SIL); nombramientos de la Corte (suplentes 25258 y 25180, reelecciones abiertas después).
- Caso límite nuevo: Día Nacional de la Miel (25859). La nota (7/10) cita el título literal de un proyecto que una asociación «presentó formalmente», pero el expediente se abrió el 22/10 cuando una diputada lo firmó. Lo dejé como positivo con confianza media y nota; es la misma decisión abierta de «anuncio que después se vuelve expediente».
- El pool B sigue en 0 positivas de 24.

## 2026-11-07 14:52 — Séptima tanda pre-etiquetada (#27, #28, #29)

- Sorteos 145–168 en la hoja (filas 146–169). Tanda: 9 positivas y 15 negativas. Acumulado: 168 noticias, 60 positivas, 108 negativas (verificado en Resumen).
- Primer caso de número mal citado por el medio: Semanario escribe «24.753» para el proyecto del FA sobre pensiones de expresidentes; 24753 es una desafectación de calle y el correcto es 24793. Quedó en «otros expedientes»; el principal de la nota es el proyecto del Ejecutivo 25703, presentado ese mismo día.
- Otros: comisión investigadora de APM (24548) citada por su informe; crónica de plenario con seis expedientes por número (25024 y otros); 25400 otra vez por el caso del exdiputado.
- El pool B sigue en 0 positivas de 28.

## 2026-11-07 14:56 — Octava tanda pre-etiquetada (#27, #28, #29)

- Sorteos 169–192 en la hoja (filas 170–193). Tanda: 8 positivas y 16 negativas. Acumulado: 192 noticias, 68 positivas, 124 negativas (verificado en Resumen).
- Casos nuevos: proyecto contra terapias de conversión (25776) mencionado de paso un día después de presentado; reforma al Reglamento para crear la comisión de infraestructura (25640); dictamen sobre la gasolina de diputados (25259); columna que cita por número expedientes viejos de protección de datos (22388, archivado, y 23667). La nota de Crucitas del 24/5 confirma el número 24717 que usé por inferencia en tres notas anteriores.
- El pool B sigue en 0 positivas de 32.

## 2026-11-07 14:58 — Novena tanda pre-etiquetada (#27, #28, #29)

- Sorteos 193–216 en la hoja (filas 194–217). Tanda: 5 positivas y 19 negativas (la más baja hasta ahora). Acumulado: 216 noticias, 73 positivas, 143 negativas (verificado en Resumen); tasa acumulada 34 %.
- Casos nuevos: reforma de delitos fiscales (25650) por número en una columna; «Ley Gerson Rosales» de protección policial (25614) aludida como «un proyecto que da vía libre a la policía para disparar»; eurobonos (25363) por apodo otra vez.
- El pool B sigue en 0 positivas de 36.

## 2026-11-07 15:05 — Décima tanda pre-etiquetada (#27, #28, #29)

- Sorteos 217–240 en la hoja (filas 218–241). Tanda: 6 positivas y 18 negativas. Acumulado: 240 noticias, 79 positivas, 161 negativas (verificado en Resumen).
- Segundo número mal citado: una columna de El Mundo transcribe el proyecto de secretos de Estado como «23.347»; en el SIL 23347 es una reforma a la ley de registro de documentos y el proyecto con ese nombre es 23437. Quedó 23437 como principal (secundario; el tema central es un decreto ejecutivo).
- Otros: proyecto de redes sociales para menores (25336) por número en un editorial; propuesta de Esquivel sobre elección de magistrados (25693 o 25694, presentadas el 4/8); 25258 dos veces más.
- El pool B sigue en 0 positivas de 40.

## 2026-11-07 15:10 — Undécima tanda pre-etiquetada (#27, #28, #29)

- Sorteos 241–264 en la hoja (filas 242–265). Tanda: 8 positivas y 16 negativas. Acumulado: 264 noticias, 87 positivas, 177 negativas (verificado en Resumen).
- La nota del 26/8 sobre la comparecencia del rector de la UCR cita «expediente 25.699» y confirma la inferencia del sorteo 4 (la comisión investigadora de universidades).
- Eurobonos: CRHoy (1/9) dice que el proyecto está en Hacendarios con plazo al 11/9, pero 25363 no tiene pasos en el SIL desde mayo. Puede que el expediente vigente no esté en la base o que la tabla de pasos esté incompleta; 4 notas de la muestra dependen de esto. Revisar antes de evaluar.
- Otros: transporte por plataformas (23736), dólar para pagar impuestos (24877), primer presupuesto extraordinario (25589) dos veces.
- Falsos positivos de la búsqueda por número en 4 notas de esta tanda (montos y cifras de encuestas).
- El pool B sigue en 0 positivas de 44.

## 2026-11-07 15:10 — Eurobonos: 25363 es el único candidato

- Revisado en la base: no hay otro expediente de 2026 sobre títulos valores o mercado internacional. 25363 entró al orden del día de su comisión el 28/1 y no tiene pasos posteriores, lo que calza con una negociación informal en Hacendarios sin trámites nuevos. Las 4 notas de eurobonos quedan con 25363; se mantiene la confianza media por si la tabla de pasos está incompleta.

## 2026-11-07 15:14 — Duodécima tanda pre-etiquetada (#27, #28, #29)

- Sorteos 265–288 en la hoja (filas 266–289). Tanda: 5 positivas y 19 negativas. Acumulado: 288 noticias, 92 positivas, 196 negativas (verificado en Resumen); faltan 8 positivas.
- Casos nuevos: proyecto de ROP identificado por trámite (dispensa rechazada el 18/8 = 25003); TLC con Israel (25542); proyecto de Camareno sobre magistrados suplentes (25632) por número; mesa técnica de Crucitas con el proyecto del Gobierno (24717) y uno del FA sobre sanciones (25565).
- El pool B sigue en 0 positivas de 48.

## 2026-11-07 15:20 — Decimotercera tanda pre-etiquetada (#27, #28, #29)

- Sorteos 289–312 en la hoja (filas 290–313). Tanda: 6 positivas y 18 negativas. Acumulado: 312 noticias (78 por medio), 98 positivas, 214 negativas (verificado en Resumen); faltan 2 positivas.
- Reparto de positivas por tipo de mención (Resumen): descripción 41, número 31, nombre oficial 15, proponente o trámite 6, apodo 5. Solo un tercio de las positivas cita el número; la mención implícita (descripción) es la más común. Por medio, el número lo usan sobre todo Semanario (13) y El Mundo (9); CRHoy casi nunca (1).
- Negativas: sin relación 123, actividad legislativa sin expediente 36, decreto o Ejecutivo 25, mismo tema sin expediente 13, anunciado sin expediente 10, ley vigente 7.
- Casos nuevos: «Ley mano firme ante la reincidencia» (25616), segundo presupuesto extraordinario (25803), reforma a la Contraloría (25722) comparada con la Ley Jaguar (24364), veto a la pensión de agentes del OIJ (22817).
- El pool B sigue en 0 positivas de 52.

## 2026-11-07 15:25 — Muestra cerrada en 100 positivas y 200 negativas (#27, #28, #31)

- Decisión del usuario: cerrar la muestra en 100 positivas y 200 negativas (reemplaza la decisión anterior de quedarse con todas las negativas extra).
- Regla aplicada: primeras 100 positivas y primeras 200 negativas en el orden del sorteo. Se etiquetó hasta el sorteo 316 (positivas 99 y 100: 24461 y 23216). La negativa 200 cae en el sorteo 295; las 16 negativas sorteadas después (296–303, 305–307, 310–314) quedan etiquetadas pero fuera de la muestra. Ninguna fila se borró.
- Hoja: columna nueva «En la muestra» (Sí/No); las filas fuera se ven en gris tachado. El Resumen ahora cuenta solo «Sí»: 300 noticias (CRHoy 75, La Nación 75, El Mundo 74, Semanario 76), 100 positivas, 200 negativas (verificado). La Guía explica la regla.
- Composición final (en la muestra): positivas por tipo: descripción 41, número 33, nombre oficial 15, proponente o trámite 6, apodo 5. Negativas: sin relación 113, actividad legislativa sin expediente 33, decreto o Ejecutivo 24, mismo tema sin expediente 13, anunciado sin expediente 10, ley vigente 7.
- Caveat: por el corte, en los sorteos 296–316 entran solo las positivas, así que la proporción de positivas en la muestra (1/3) no es exactamente la del sorteo (98 de 312 antes del corte, 31 %); para estimar la tasa base hay que usar los 316 sorteos, no los 300.
- El pool B terminó con 0 positivas de 53 sorteos.
- Pendiente: las 15 noticias de Delfino (cola aparte), las 20 a ciegas de #30, la revisión del usuario, exportar a CSV y embeber las 300 noticias para medir recall.

## 2026-11-07 15:25 — Corrección: pool B

- En la entrada anterior escribí «0 positivas de 53»; contado sobre la cola, son 60 sorteos del pool B hasta el 316 y ninguno es positivo. Las cifras de las tandas anteriores (36, 40, 44, 48, 52) también eran estimadas a mano; el dato verificado es 0 de 60.

## 2026-11-07 15:31 — Commit de las entradas de la muestra (#27, #28)

- Por pedido del usuario, commit `feature: hand-labeled sample closed at 100/200 #27 #28` solo con las entradas de este log sobre la muestra (13:35 a 15:25). Las entradas de la otra sesión (ranker y núcleo evolutivo, #33 y #68) se dejaron fuera: se armó una versión del archivo con el último commit más estas entradas y se puso en el índice sin tocar el archivo de trabajo. Esta entrada queda sin commit.

## 2026-11-07 16:51 — Qué revisar en la muestra etiquetada (#27, #28)

- Pregunta del usuario: qué verificar en las positivas (contrastar noticia y expediente) y sobre todo en las negativas.
- Recomendado: en las negativas, la pregunta es si se escapó un expediente (falso negativo). Revisar por riesgo según el subtipo, no todas por igual: primero «mismo tema sin expediente» (13), «anunciado sin expediente» (10), «decreto o Ejecutivo» (24) y «actividad legislativa sin expediente» (33, las comisiones investigadoras sí tienen número), luego «ley vigente» (7); en «sin relación» (113) basta un vistazo al título. En las positivas: número correcto entre parecidos, otros expedientes mencionados que falten, centralidad y tipo de mención.
- Ofrecido como ayuda opcional: listar los mejores candidatos del ranker para cada negativa, con el caveat de que sesga la revisión hacia lo que el modelo ya encuentra.

## 2026-11-07 17:00 — Qué significa «mismo tema sin expediente» (#28)

- Aclarado al usuario: es una negativa difícil. Sí existe en el SIL un expediente sobre el tema, pero la noticia no habla de él (trata el tema por otro lado: un fallo, una política, una protesta). El embedding lo va a poner arriba igual. Al revisar, lo que se verifica es que la noticia de verdad no aluda al proyecto, ni siquiera de forma implícita; si alude, pasa a positiva de tipo «descripción».

## 2026-11-07 18:52 — Revisión de las negativas por Claude: en espera del conector de Sheets (#27, #28)

- Pedido del usuario: que Claude revise con cuidado las negativas que faltan (las más cansadas); el usuario se queda con las positivas.
- Estado de la hoja (leída con Drive): 300 en la muestra, 16 revisadas (9 Correcto, 7 Dudoso), 284 pendientes; las filas ya no están en el orden del sorteo (el usuario las reordenó).
- Bloqueo: en esta sesión solo está el conector de Drive (lee la hoja, no la edita); falta el de Google Sheets para escribir «Revisión» y el comentario. `databases/private_corpus.db` sí está en esta compu, así que la revisión (texto de la noticia + búsqueda en expedientes) se puede hacer local.
- Propuesto al usuario: Claude pone Correcto/Corregir/Dudoso y deja en «Comentario del revisor» una nota que empieza con «Claude:», para distinguirla de la revisión humana; caveat: es Claude revisando su propio pre-etiquetado, con riesgo de repetir los mismos errores.

## 2026-11-07 18:55 — Revisión detallada de negativas: costo y plan propuesto (#27, #28)

- El usuario aclara: el pre-etiquetado fue una búsqueda de relación poco cuidadosa (TF-IDF, diputados, números); quiere una revisión con el mayor detalle, noticia por noticia, y pregunta si eso consume muchos tokens.
- Estimado dado: ~190 negativas pendientes. Por noticia: leer el texto completo, buscar en expedientes por temas, nombres, diputados y fechas (incluidos los presentados después de la nota), y razonar; ~10–20 mil tokens cada una. En total, del orden de 2–4 millones de tokens procesados, la mayoría en caché. Se reparte en subagentes por tandas, así no se llena el contexto principal.
- Propuesto: un piloto de 10 negativas de los subtipos de más riesgo, para medir costo y calidad reales antes de seguir. Sigue pendiente el conector de Google Sheets para escribir en la hoja (sin él, sale a CSV).

## 2026-11-07 19:01 — Piloto de revisión detallada de negativas: 10 noticias (#27, #28)

- Decidido por el usuario: las negativas «Sin relación» no las revisa Claude (las hace el usuario); primero las de confianza baja o media. Quedan 34 pendientes de ese tipo (1 baja, 33 media) y 47 de confianza alta.
- Método: hoja exportada a CSV con Drive (sigue sin conector de Sheets); texto completo de cada noticia desde `private_corpus.db`; helper de búsqueda en el scratchpad (`review/search.py`: expedientes por palabras en nombre, temas y exposición, ficha completa, diputados con sus proyectos, pasos y votaciones por ventana). Dos subagentes de 5 noticias cada uno, con el criterio de la Guía.
- Resultado: 6 Correcto, 3 Dudoso, 1 Corregir. Los tres dudosos giran en torno a alusiones al trámite: filas 154 y 184 aluden a «la elección de magistrados suplentes» (25258) y la 13, a la marcha a la Asamblea el mismo día del dictamen del presupuesto 2027 (25754). En la fila 133 (Corregir) se mantiene negativa, pero se corrigen los alternativos: el paquete de mano dura se presentó como 25614–25619 (15/6) y 25672, 25673, 25675 (27/7); 25674 es minería ilegal. En la fila 10 sobra el alternativo 25775. Números verificados en la base.
- Costo real: 91,5 mil + 103,9 mil tokens, ~20 mil por noticia, ~1–2,5 min por tanda. Proyección: 24 baja/media restantes ≈ 0,5 M; las 47 de alta ≈ 0,95 M.
- Salida: `results/sample/negatives_review_pilot.csv` (sin commitear), para pegar en la hoja cuando haya conector o a mano.

## 2026-11-07 19:16 — Revisión detallada de las 34 negativas de confianza baja/media, escrita en la hoja (#27, #28)

- El usuario dio el visto bueno para seguir tras el piloto y activó el conector de Google Sheets (el permiso de `update_file` de Drive no servía: solo cambia metadatos).
- Las 24 restantes se revisaron con 4 subagentes de 6 noticias, con un brief común (`scratchpad/review/BRIEF.md`) que incluía los criterios del piloto. Costo: 115,9 + 147,8 + 154,4 + 137,5 mil tokens (~23 mil por noticia).
- Todos los números citados se verificaron en la base. Se revisó a mano 22817: tiene número de ley 10706 en `laws`, pero la tabla lo marca «(VETO)» y el Plenario aceptó el veto el 9/4/2026, así que calza con la nota.
- Fila 226 (Crucitas): el subagente la dio por Correcto pero pedía quitar el alternativo 25775; se pasó a Corregir.
- Escrito en la hoja: «Revisión» y «Comentario del revisor» (empieza con «Claude:»; si es Corregir o Dudoso, trae «Propuesta:» y «Evidencia:»), solo en filas Pendiente sin comentario, buscando cada fila por `news_id`. No se tocaron las columnas de la etiqueta: esas cambian cuando el usuario confirme. Verificado releyendo: 34 de 34 en la fila correcta. Hoja: 28 Correcto, 12 Dudoso, 10 Corregir, 266 Pendiente.
- Resultado de las 34: 19 Correcto, 10 Corregir, 5 Dudoso. Pasan a positivas 24738 (Ovsicori), 25363 (eurobonos), 22817 (veto pensiones OIJ), 25699 (rector UTN en la comisión investigadora) y 25291 (tren, con 25183); la 24375 (cantón de Guanacaste) queda en Dudoso. Cambian alternativos 24, 263 (añadir 25754), 133 (paquete de mano dura) y 10 (quitar 25775); 272 pasa a «Anunciado sin expediente».
- El usuario ya había dejado comentarios propios en otras filas (p. ej. «Mismo tema con qué expediente? No pusiste ninguno.»): no se tocaron.
- Comentario con los caveats en #28. Faltan las 47 negativas de confianza alta que no son «Sin relación» (~1 M de tokens estimado).

## 2026-11-08 00:37 — pendiente: revisión detallada de toda la muestra pendiente, por partes (#27, #28)

- Pedido del usuario: que Claude revise con cuidado (no como el pre-etiquetado rápido) las noticias de la hoja que siguen sin revisar: contenido de la noticia, expedientes recomendados y otros posibles, centralidad.
- Estado leído de la hoja: buena parte ya la revisó el usuario (Correcto); quedan Pendiente sobre todo positivas, negativas de confianza alta y «Sin relación», más ~15 Dudoso con comentarios del usuario dirigidos a Claude («Es de pago», 25800 vs 25839, secretos de Estado 18639/23437, centralidad con varios expedientes, Crucitas/Cutris).
- Propuesto por partes: (1) los Dudoso con pregunta del usuario; (2) positivas pendientes; (3) negativas de alta que no son «Sin relación»; (4) opcional, «Sin relación» con pasada liviana. Mismo método que antes (subagentes de 6, «Claude:» + Propuesta/Evidencia, sin tocar las columnas de la etiqueta). ~23 mil tokens por noticia. El helper `search.py` y el BRIEF del scratchpad anterior ya no existen: hay que rehacerlos.
- Esperando la respuesta del usuario sobre el alcance.

## 2026-11-08 00:43 — decisión: revisión detallada de las partes 1 a 3 (131 noticias) (#27, #28)

- El usuario eligió las partes 1 a 3; «Sin relación» queda fuera. Filas ubicadas leyendo la hoja (K y P a S): parte 1, 17 Dudoso/Correcto con pregunta del usuario (5, 7, 10, 79, 83, 97, 102, 107, 109, 115, 118, 126, 129, 133, 142, 154, 270); parte 2, 67 positivas Pendiente; parte 3, las 47 negativas de confianza alta que no son «Sin relación» (calza con el conteo de STATUS).
- Rehechos en el scratchpad `review/search.py` (news, bill, find, deputy, steps, votes, similar) y `review/BRIEF.md`. Novedades del brief: centralidad y tipo de mención por cada expediente, revisar calcos (`similar`) y expedientes posteriores a la nota.
- Criterio de escritura elegido por Claude: los subagentes escriben ellos mismos fila por fila, verificando el news_id justo antes. En la parte 1 (filas ya revisadas por el usuario) no se toca su «Revisión» y el comentario de Claude se agrega debajo del texto del usuario, sin borrarlo. Respaldo en `review/out/*.jsonl`.

## 2026-11-08 00:49 — Parte 1 escrita en la hoja: 17 filas con pregunta del usuario (#27, #28)

- 3 subagentes (138–161 mil tokens cada uno, ~25 mil por noticia). Los 17 news_id coincidieron; P sin tocar, comentario «Claude:» debajo del texto del usuario. Respaldo en `review/out/p1{a,b,c}.jsonl`.
- Recomendaciones: Correcto 5, 10, 102, 109, 118 (más 23952 secundario), 133, 142. Corregir: 7 (otros 25803, 25754), 79 (sacar 25803 → Decreto o Ejecutivo, como dijo el usuario), 83 (no hay expediente → Sin relación o Anunciado), 97 (→ positiva 25258, trámite, de paso), 107 (→ positiva 24717, secundario; Crucitas está en Cutris), 115 (centralidades: 25506 central, 25864 y 25332 secundarios, 25808 y 23414 de paso), 126 (más 24290 y 24717 por apodo, de paso), 129 (25800/25839 no son calcos: dos comisiones investigadoras con el mismo nombre genérico; Anunciado, alternativo 25862), 154 (→ Anunciado, alternativo 25803), 270 (23437 secundario; 18639 y 25634 de paso; 25752 es posterior).
- Hallazgo de datos: la exposición guardada para 25699 es el texto de otro expediente (CCSS, gastos médicos), un error de scraping. 18639 no está en la base (es anterior a 20000).
- Partes 2 (11 tandas) y 3 (8 tandas) lanzadas en paralelo.

## 2026-11-08 00:59 — Revisión detallada de las partes 2 y 3 escrita en la hoja; 131 de 131 verificadas (#27, #28)

- 19 subagentes (11 de positivas, 8 de negativas), ~86–174 mil tokens cada uno. En total, unos 2,8 M de tokens con la parte 1 (~21 mil por noticia). Todas en Modo A, con el news_id verificado antes de escribir. Respaldo en `review/out/p2*.jsonl` y `p3*.jsonl`.
- Verificación de Claude: 131 filas en los jsonl, todas con revisión en la hoja; los news_id de P2:R270 coinciden con el orden previo; todos los números 20000–25999 citados en los comentarios existen en `bills`.
- Parte 2 (67 positivas): 38 Correcto, 28 Corregir, 1 Dudoso (91: no se sabe qué presupuesto). Las correcciones son sobre todo de otros mencionados que faltaban (17, 24, 41, 59, 60, 68, 71, 75, 81, 82, 93), centralidad (2, 19, 42, 45, 66, 90) y alternativos posteriores a la nota que sobraban (16, 48). 101 pasa a negativa «Anunciado sin expediente» (25859 se presentó después de la nota). Errores del medio: la 32 cita 24738 por 24878 y la 78 cita 24753 por 24793.
- Parte 3 (47 negativas de alta): 41 Correcto, 4 Corregir, 2 Dudoso. Falso negativo real en la 195: cita «24.482» y «23.572» por número y el pre-etiquetado no los vio. 122 → «Mismo tema» (alternativos 25847 y 25803); 144 → alternativo 25736; 172 → «Mismo tema» (24564). Dudosos: 123 (FEES de un presupuesto ya aprobado, 24535 o 25177) y 127 («los proyectos de seguridad», 25672–25676).
- Inconsistencias que quedan para decidir con el usuario: las filas 160, 172 y 185 tratan el mismo hecho de la CCSS con subtipos distintos, y no hay regla para el trámite ya concluido de una ley (23, 62). Las dos quedaron en STATUS.
- Datos: la base no registra pasos de 25363 desde el 28/1/2026, aunque se tramitaba en Hacendarios en agosto (posible hueco del scraping).
