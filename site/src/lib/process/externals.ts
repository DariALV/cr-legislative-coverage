/**
 * Every external work the project used: data sources, libraries, models, services and references. The links in
 * the chapters' text and the cards of the last chapter ("Herramientas externas") both read this list, so a name
 * and its link are written once. Each text says what the work gave the project (at most 100 words).
 */

export type ExternalGroup = 'sources' | 'collect' | 'models' | 'analysis' | 'web' | 'work';

export interface External {
  name: string;
  /** Empty when the card only lists the links in more (the outlets). */
  url: string;
  group: ExternalGroup;
  /** What it gave the project, in Spanish (at most 100 words). */
  text: string;
  /** More links shown inside the card (other outlets, the docs of a model). */
  more?: { name: string; url: string }[];
}

export const GROUPS: { key: ExternalGroup; label: string; text: string }[] = [
  { key: 'sources', label: 'Fuentes de datos', text: 'De dónde salen los expedientes, las noticias y las votaciones.' },
  { key: 'collect', label: 'Recolección y almacenamiento', text: 'Lo que trae, lee y guarda los datos.' },
  { key: 'models', label: 'Modelos y aprendizaje', text: 'Lo que relaciona noticias con expedientes.' },
  { key: 'analysis', label: 'Análisis y reproducción', text: 'Lo que permite revisar y repetir las cifras.' },
  { key: 'web', label: 'Sitio y visualización', text: 'Lo que publica y dibuja los resultados.' },
  { key: 'work', label: 'Referencias y herramientas de trabajo', text: 'Lo que guió el diseño o acompañó el trabajo.' },
];

export const EXTERNALS = {
  // ---------- Sources ----------
  sil: {
    name: 'SIL de la Asamblea Legislativa', url: 'https://produccion.asamblea.go.cr/SILConsulta/', group: 'sources',
    text: 'El Sistema de Información Legislativa es la fuente oficial de los expedientes: número, nombre, proponentes, materias, texto base con la exposición de motivos y cada paso del trámite con su fecha. Las variables del ranker que no salen de la noticia vienen de aquí, y el sitio publica cada expediente con su enlace al SIL.',
  },
  delfino: {
    name: 'Delfino.cr', url: 'https://delfino.cr/', group: 'sources',
    text: 'Uno de los cinco medios. Sus notas enlazan a su propia página de cada expediente, y de esos enlaces salió el dataset con el que se midieron los embeddings y se entrenó el algoritmo evolutivo. También aporta las votaciones por diputación que muestra el sitio, con crédito a Delfino.',
    more: [{ name: 'Términos y condiciones', url: 'https://delfino.cr/terminos-y-condiciones' }],
  },
  outlets: {
    name: 'Los otros cuatro medios', url: '', group: 'sources',
    text: 'Junto con Delfino, son las fuentes de las 29.875 noticias de mayo a octubre de 2026. De cada nota el sitio publica solo los campos públicos (título, medio, fecha, sección y enlace al original), nunca el texto.',
    more: [
      { name: 'CRHoy', url: 'https://www.crhoy.com/' },
      { name: 'La Nación', url: 'https://www.nacion.com/' },
      { name: 'Semanario Universidad', url: 'https://semanariouniversidad.com/' },
      { name: 'El Mundo', url: 'https://www.elmundo.cr/' },
    ],
  },

  // ---------- Collection and storage ----------
  python: {
    name: 'Python', url: 'https://www.python.org/', group: 'collect',
    text: 'El lenguaje de todo el pipeline: scrapers, base de datos, embeddings, algoritmo evolutivo, llamadas a Jev, exportadores del sitio y scripts de análisis.',
  },
  requests: {
    name: 'requests', url: 'https://requests.readthedocs.io/', group: 'collect',
    text: 'Hace los pedidos HTTP de los scrapers: trae los sitemaps de los medios, el HTML de cada noticia y las páginas de cada expediente en el SIL.',
  },
  beautifulsoup: {
    name: 'Beautiful Soup', url: 'https://www.crummy.com/software/BeautifulSoup/bs4/doc/', group: 'collect',
    text: 'Lee el HTML que trae requests y saca los campos de cada nota (título, fecha, autor, sección y texto) y de cada expediente, después de quitar scripts, estilos y anuncios.',
  },
  lxml: {
    name: 'lxml', url: 'https://lxml.de/', group: 'collect',
    text: 'El parser rápido que usa Beautiful Soup por debajo para leer el HTML de los medios.',
  },
  sqlite: {
    name: 'SQLite', url: 'https://www.sqlite.org/', group: 'collect',
    text: 'La base del proyecto: un solo archivo con noticias, expedientes, pasos del trámite, diputados, votaciones y vínculos. El corpus público también se publica como una base SQLite.',
  },
  dotenv: {
    name: 'python-dotenv', url: 'https://github.com/theskumar/python-dotenv', group: 'collect',
    text: 'Carga la llave de la API de Jev desde un archivo .env que nunca entra al repositorio.',
  },
  rich: {
    name: 'Rich', url: 'https://rich.readthedocs.io/', group: 'collect',
    text: 'Barras de progreso y bitácoras legibles en la consola durante las corridas largas: scrapers, embeddings, algoritmo evolutivo y Jev.',
  },

  // ---------- Models and learning ----------
  qwen: {
    name: 'Qwen3-Embedding-0.6B', url: 'https://huggingface.co/Qwen/Qwen3-Embedding-0.6B', group: 'models',
    text: 'Modelo de embeddings del equipo Qwen. Con fragmentos de 256 tokens, el máximo y la exposición de motivos fue la mejor de las 78 combinaciones, y sus similitudes son la base semántica del ranker evolucionado.',
  },
  bge: {
    name: 'BGE-M3', url: 'https://huggingface.co/BAAI/bge-m3', group: 'models',
    text: 'Modelo de embeddings multilingüe de BAAI. Se comparó con Qwen3 en las mismas 39 combinaciones de fragmentos, formas de comparar y textos del expediente.',
  },
  sentenceTransformers: {
    name: 'Sentence Transformers', url: 'https://www.sbert.net/', group: 'models',
    text: 'Carga los dos modelos de embeddings y convierte cada fragmento de noticia y cada texto de expediente en un vector.',
  },
  transformers: {
    name: 'Hugging Face Transformers', url: 'https://huggingface.co/docs/transformers', group: 'models',
    text: 'La librería sobre la que corre Sentence Transformers; Qwen3-Embedding necesita su versión 4.51 o más nueva.',
  },
  pytorch: {
    name: 'PyTorch', url: 'https://pytorch.org/', group: 'models',
    text: 'Corre los modelos de embeddings en la GPU, y también el fitness del algoritmo evolutivo: cada generación se evalúa por lotes en la GPU.',
  },
  jev: {
    name: 'Jev (TypeSafe)', url: 'https://typesafe.ai/', group: 'models',
    text: 'El modelo de lenguaje que lee cada par noticia-expediente y contesta las preguntas del filtro, la puerta y el detalle, con probabilidades (sí o no), opciones o escalas. Se usó la versión jev-1.14.0 con su SDK de Python (typesafe-sdk). Su documentación define la certeza de las respuestas sí o no que reporta esta página.',
    more: [{ name: 'Documentación de las preguntas sí o no', url: 'https://docs.typesafe.ai/go/noul' }],
  },
  bm25: {
    name: 'Okapi BM25', url: 'https://en.wikipedia.org/wiki/Okapi_BM25', group: 'models',
    text: 'La fórmula clásica de los buscadores para puntuar palabras en común. La implementamos para comparar las palabras de la noticia con el nombre y las materias del expediente; es una de las entradas del ranker.',
  },
  numpy: {
    name: 'NumPy', url: 'https://numpy.org/', group: 'models',
    text: 'Matrices de similitud, entradas del ranker y operadores del algoritmo evolutivo (selección, cruce y mutación) aplicados a toda la población a la vez.',
  },
  networkx: {
    name: 'NetworkX', url: 'https://networkx.org/', group: 'models',
    text: 'Arma los grafos de las vistas locales y encuentra las 26 comunidades (temas) de expedientes con el método de Louvain.',
  },

  // ---------- Analysis and reproduction ----------
  jupyter: {
    name: 'Jupyter', url: 'https://jupyter.org/', group: 'analysis',
    text: 'El cuaderno que acompaña al corpus público recalcula las cifras publicadas. Se arma y se ejecuta con nbformat, nbclient e ipykernel.',
  },
  pandas: {
    name: 'pandas', url: 'https://pandas.pydata.org/', group: 'analysis',
    text: 'Las tablas del cuaderno de reproducción del corpus.',
  },
  matplotlib: {
    name: 'Matplotlib', url: 'https://matplotlib.org/', group: 'analysis',
    text: 'Los gráficos del cuaderno de reproducción del corpus.',
  },
  sheets: {
    name: 'Google Sheets', url: 'https://www.google.com/sheets/about/', group: 'analysis',
    text: 'Ahí se etiquetó a mano la muestra de 300 noticias con la que se probaron el ranker y Jev.',
  },

  // ---------- Site and visualization ----------
  astro: {
    name: 'Astro', url: 'https://astro.build/', group: 'web',
    text: 'Genera el sitio estático: una página por expediente, la metodología, los datos y esta página. Las cifras se calculan al compilar, así que el navegador no consulta ninguna base.',
  },
  typescript: {
    name: 'TypeScript', url: 'https://www.typescriptlang.org/', group: 'web',
    text: 'Los scripts del sitio y de esta página: gráficos, simulaciones y controles.',
  },
  echarts: {
    name: 'Apache ECharts', url: 'https://echarts.apache.org/', group: 'web',
    text: 'Los gráficos de barras y líneas de esta página: noticias por mes, fitness por generación, cobertura según K y costo de Jev.',
  },
  d3: {
    name: 'D3 y d3-force', url: 'https://d3js.org/d3-force', group: 'web',
    text: 'd3-force mueve los nodos de los grafos locales y del grafo de prueba de esta página. Las vistas locales usan además D3 completo.',
  },
  katex: {
    name: 'KaTeX', url: 'https://katex.org/', group: 'web',
    text: 'Escribe las fórmulas de esta página al compilar el sitio, sin JavaScript en el navegador.',
  },
  minisearch: {
    name: 'MiniSearch', url: 'https://lucaong.github.io/minisearch/', group: 'web',
    text: 'El buscador del sitio, que corre en el navegador sin servidor.',
  },
  webApis: {
    name: 'Canvas y Web Workers', url: 'https://developer.mozilla.org/es/docs/Web/API/Canvas_API', group: 'web',
    text: 'Dos APIs del navegador. Canvas pinta miles de nodos por cuadro en los grafos; un Web Worker corre la física del modelo «Obsidian» sin trabar la página.',
    more: [{ name: 'Web Workers', url: 'https://developer.mozilla.org/es/docs/Web/API/Web_Workers_API' }],
  },
  poppins: {
    name: 'Poppins', url: 'https://fonts.google.com/specimen/Poppins', group: 'web',
    text: 'La tipografía de las páginas locales y de esta página, con licencia SIL Open Font License.',
  },
  github: {
    name: 'GitHub y GitHub Pages', url: 'https://pages.github.com/', group: 'web',
    text: 'El repositorio y sus issues ordenaron el trabajo; Pages hospeda el sitio, que se publica desde el repositorio.',
  },

  // ---------- References and work tools ----------
  obsidian: {
    name: 'Obsidian', url: 'https://obsidian.md/', group: 'work',
    text: 'Su vista de grafo fue la referencia visual de los mapas locales. El modelo de fuerzas «Obsidian» imita cómo se repelen sus nodos: todos contra todos, lo que abre más los grupos.',
  },
  claude: {
    name: 'Claude (Anthropic)', url: 'https://www.anthropic.com/claude', group: 'work',
    text: 'Asistente de programación durante el proyecto. Además revisó y pre-etiquetó parte de la muestra manual, y contestó la evaluación a ciegas de Jev como tercer lector, junto a una persona.',
  },
} satisfies Record<string, External>;

export type ExternalKey = keyof typeof EXTERNALS;
