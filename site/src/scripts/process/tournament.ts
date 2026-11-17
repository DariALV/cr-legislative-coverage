// Chapter 3: one generation of the genetic algorithm, step by step, with robots. The operators and their
// parameters are the real ones (tools/evolution_tools/genetic_algorithm.py with the settings of the run):
// tournament selection, blend crossover, mutation with resets, elites and random immigrants, over genomes of the
// real size. The individuals are simulated, with a toy fitness (closeness to a hidden target), because the real
// fitness needs the whole feature matrix. Four genes are drawn: the color (red to blue), the arm length, the eye
// size and the leg length; the robots start with the standard shape, so only mutations change it.
import { h, onTheme, readData, reducedMotion, seededRandom, whenVisible } from './core';
import { heart, robot, UNIT_H, UNIT_W, type Face, type RobotLook } from './robots';
import { dec, int } from '../../lib/process/format';

interface Settings {
  population_size: number; elites: number; immigrant_rate: number; tournament_size: number; crossover_rate: number;
  blend_alpha: number; mutation_scale: number; reset_rate: number; max_generations: number;
}
type Origin = 'random' | 'elite' | 'immigrant' | 'child';
interface Individual { genes: number[]; fitness: number; origin: Origin; survivor: boolean }
interface Scenario {
  picks: [number[], number[]];          // the two tournaments: indexes into the population
  winners: [number, number];
  crossed: number[][];                  // three children of the two winners, right after the crossover
  mutated: number[][];                  // the same three after the mutation
}
interface Generation { population: Individual[]; scenario: Scenario }

const { settings, weightRange, nGenes } = readData<{ settings: Settings; weightRange: [number, number]; nGenes: number }>('data-ranker');
// Seed 258: the first two parents are a blue and a red robot, so the crossover shows the colors mixing.
const GENES = nGenes, STEPS = 7, MAX_GENERATIONS = 200, SEED = 258;
// Playback speeds (the slider, 1 to 10): milliseconds per frame. Up to 2, every step of the first generation is
// shown; from 3 on, each frame is a whole new generation.
const SPEED_MS = [1600, 950, 520, 320, 200, 130, 85, 55, 35, 22];
const STEP_BY_STEP = 2;
const [LOW, HIGH] = weightRange, SPAN = HIGH - LOW;
const COLOR = 0, ARM = 1, EYE = 2, LEG = 3;
const SHAPE = [ARM, EYE, LEG];
const MUTATION_RATE = 1 / GENES;        // the real default: one gene per individual on average (1 / genome size)
const immigrants = Math.round(settings.immigrant_rate * settings.population_size);
const childrenCount = settings.population_size - settings.elites - immigrants;
// The three showcased children each get one visible mutation of their shape.
const SHOWCASE: { gene: number; step: number; label: string }[] = [
  { gene: ARM, step: 2.6, label: 'Brazos más largos' },
  { gene: EYE, step: -2.8, label: 'Ojos más pequeños' },
  { gene: LEG, step: -2.8, label: 'Piernas más cortas, torso más largo' },
];

const root = document.getElementById('tournament');
const part = (name: string) => root?.querySelector<HTMLElement>(`[data-tour="${name}"]`) ?? null;
const random = seededRandom(SEED);
const clip = (value: number) => Math.max(LOW, Math.min(HIGH, value));
const randomGene = () => LOW + random() * SPAN;
function normal(): number {   // Box-Muller
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

// ---------- Toy fitness: weighted closeness to a hidden target ----------
const target = Array.from({ length: GENES }, randomGene);
target[COLOR] = LOW + 0.62 * SPAN;      // a blue-leaning purple wins in the long run
target[ARM] = 2; target[EYE] = 0; target[LEG] = 0;
const weight = Array.from({ length: GENES }, (_, index) => (index === COLOR ? 6 : SHAPE.includes(index) ? 1.5 : 1));
const weightSum = weight.reduce((sum, value) => sum + value, 0);
function fitness(genes: number[]): number {
  const squared = genes.reduce((sum, gene, index) => sum + weight[index] * (gene - target[index]) ** 2, 0);
  return 1 - Math.sqrt(squared / weightSum) / SPAN;
}
const individual = (genes: number[], origin: Origin, survivor = false): Individual => ({ genes, fitness: fitness(genes), origin, survivor });
function randomGenes(): number[] {
  const genes = Array.from({ length: GENES }, randomGene);
  for (const index of SHAPE) genes[index] = 0;   // the standard shape
  return genes;
}

// ---------- The real operators ----------
function tournament(population: Individual[]): { picks: number[]; winner: number } {
  const picks: number[] = [];
  while (picks.length < settings.tournament_size) {
    const index = Math.floor(random() * population.length);
    if (!picks.includes(index)) picks.push(index);
  }
  return { picks, winner: picks.reduce((best, index) => (population[index].fitness > population[best].fitness ? index : best)) };
}

function crossover(first: number[], second: number[], always = false): number[] {
  if (!always && random() >= settings.crossover_rate) return [...first];
  return first.map((gene, index) => {
    const low = Math.min(gene, second[index]), high = Math.max(gene, second[index]);
    const extra = settings.blend_alpha * (high - low);
    return clip(low - extra + random() * (high - low + 2 * extra));
  });
}

function mutate(genes: number[]): number[] {
  return genes.map((gene) => {
    if (random() < settings.reset_rate) return randomGene();
    return random() < MUTATION_RATE ? clip(gene + normal() * settings.mutation_scale * SPAN) : gene;
  });
}

/** The two tournaments and three children of the generation, kept step by step for the drawing. */
function plan(population: Individual[]): Scenario {
  const first = tournament(population);
  let second = tournament(population);
  while (second.winner === first.winner) second = tournament(population);   // two different parents
  const [a, b] = [population[first.winner].genes, population[second.winner].genes];
  const crossed = SHOWCASE.map(() => crossover(a, b, true));
  const mutated = crossed.map((genes, index) => {
    const result = mutate(genes);
    const { gene, step } = SHOWCASE[index];
    result[gene] = clip(genes[gene] + step);
    return result;
  });
  return { picks: [first.picks, second.picks], winners: [first.winner, second.winner], crossed, mutated };
}

const ranking = (population: Individual[]) => population.map((_, index) => index).sort((a, b) => population[b].fitness - population[a].fitness);
const elitesOf = (population: Individual[]) => ranking(population).slice(0, settings.elites);

function nextPopulation({ population, scenario }: Generation): Individual[] {
  const next: Individual[] = elitesOf(population).map((index) => individual(population[index].genes, 'elite', true));
  for (let index = 0; index < immigrants; index += 1) next.push(individual(randomGenes(), 'immigrant'));
  scenario.mutated.forEach((genes) => next.push(individual(genes, 'child')));
  while (next.length < settings.population_size) {
    const first = tournament(population).winner, second = tournament(population).winner;
    next.push(individual(mutate(crossover(population[first].genes, population[second].genes)), 'child'));
  }
  return next;
}

function firstGeneration(): Generation {
  const population = Array.from({ length: settings.population_size }, () => individual(randomGenes(), 'random'));
  return { population, scenario: plan(population) };
}

const generations: Generation[] = [firstGeneration()];
let generation = 0, step = 0, timer = 0;

const best = (population: Individual[]) => Math.max(...population.map((item) => item.fitness));
const mean = (population: Individual[]) => population.reduce((sum, item) => sum + item.fitness, 0) / population.length;
const shaped = (genes: number[]) => SHAPE.some((index) => Math.abs(genes[index]) > 0.35);

function ensureNext(): Generation {
  if (!generations[generation + 1]) {
    const population = nextPopulation(generations[generation]);
    generations.push({ population, scenario: plan(population) });
  }
  return generations[generation + 1];
}

// ---------- Looks ----------
const share = (gene: number) => (gene - LOW) / SPAN;
const geneColor = (gene: number) => `color-mix(in oklch, var(--robot-blue) ${(100 * share(gene)).toFixed(1)}%, var(--robot-red))`;
/** Color of any other gene on the diverging scale of the weights: -5 red, 0 gray, +5 green. */
function weightColor(gene: number): string {
  const t = Math.min(1, Math.abs(gene) / HIGH);
  return `color-mix(in oklab, var(${gene < 0 ? '--div-neg' : '--div-pos'}) ${(100 * t).toFixed(0)}%, var(--div-mid))`;
}
const ROLE_COLOR: Partial<Record<Origin, string>> = { elite: 'var(--robot-gold)', immigrant: 'var(--robot-green)' };
const score = (value: number) => dec(value, 2);
function look(item: Individual, extra: Partial<RobotLook> = {}, byRole = false): RobotLook {
  const g = item.genes;
  return {
    color: (byRole && ROLE_COLOR[item.origin]) || geneColor(g[COLOR]),
    arm: Math.max(0.55, Math.min(1.6, 1 + 0.22 * g[ARM])),
    eye: Math.max(0.42, Math.min(1.42, 1 + 0.21 * g[EYE])),
    torso: Math.max(-12, Math.min(12, -4.2 * g[LEG])),
    face: (item.survivor ? 'tired' : 'smile') as Face,
    screen: score(item.fitness),
    ...extra,
  };
}

// ---------- Stage ----------
const VIEW_W = 1000, VIEW_H = 712, COLUMNS = 10, CELL_W = VIEW_W / COLUMNS, ROW_H = 141, TOP = 4, GRID_SCALE = 0.96;
const cell = (index: number) => ({
  x: (index % COLUMNS) * CELL_W + (CELL_W - UNIT_W * GRID_SCALE) / 2,
  y: TOP + Math.floor(index / COLUMNS) * ROW_H,
});

function grid(items: Individual[], lookOf: (item: Individual, index: number) => RobotLook): string {
  return items.map((item, index) => { const { x, y } = cell(index); return robot(lookOf(item, index), x, y, GRID_SCALE); }).join('');
}

const label = (x: number, y: number, text: string, cls = 'st-label', anchor = 'middle') =>
  `<text class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${text}</text>`;
const centered = (cx: number, top: number, scale: number) => ({ x: cx - (UNIT_W * scale) / 2, y: top });

// The genomes as they really are: one cell per gene, colored by its value. The first four are the drawn ones.
const STRIP_X = 150, STRIP_W = VIEW_W - STRIP_X - 6, GENE_W = STRIP_W / GENES, ROW = 30;
const DRAWN = ['color', 'brazos', 'ojos', 'piernas'];
const geneCell = (gene: number, index: number) => (index === COLOR ? geneColor(gene) : weightColor(gene));
interface StripRow { name: string; genes: number[]; before?: number[]; strong?: boolean }

/** Rows of genomes under a title at y. A row with before boxes the genes that differ from it. */
function strips(y: number, title: string, rows: StripRow[]): string {
  const out: string[] = [label(6, y, title, 'st-label strong', 'start')];
  // Scale of the values, drawn rather than named: the diverging colors change with the style.
  const scaleX = VIEW_W - 110;
  out.push(`<defs><linearGradient id="st-scale" x1="0" x2="1" y1="0" y2="0"><stop offset="0" style="stop-color:var(--div-neg)"/><stop offset=".5" style="stop-color:var(--div-mid)"/><stop offset="1" style="stop-color:var(--div-pos)"/></linearGradient></defs>`);
  out.push(label(scaleX - 8, y, 'valor del gen: −5', 'st-label tiny', 'end'));
  out.push(`<rect x="${scaleX}" y="${y - 11}" width="80" height="12" rx="6" fill="url(#st-scale)"/>`);
  out.push(label(scaleX + 86, y, '+5', 'st-label tiny', 'start'));
  const head = y + 48;
  DRAWN.forEach((name, index) => out.push(`<text class="st-label tiny" transform="translate(${(STRIP_X + (index + 0.35) * GENE_W).toFixed(1)} ${head}) rotate(-38)">${name}</text>`));
  out.push(`<path class="st-brace" d="M ${(STRIP_X + 4 * GENE_W + 4).toFixed(1)} ${head - 4} H ${VIEW_W - 8}"/>`);
  out.push(label((STRIP_X + 4 * GENE_W + VIEW_W) / 2, head - 10, `los otros ${GENES - DRAWN.length} genes, que no se dibujan`, 'st-label tiny'));
  rows.forEach((row, r) => {
    const top = head + 8 + r * ROW;
    out.push(label(STRIP_X - 12, top + ROW / 2 + 5, row.name, row.strong ? 'st-label small strong' : 'st-label small', 'end'));
    row.genes.forEach((gene, index) => {
      const x = STRIP_X + index * GENE_W + 1.5, w = GENE_W - 3, height = ROW - 6;
      const changed = row.before !== undefined && Math.abs(row.before[index] - gene) > 1e-9;
      out.push(`<rect class="st-gene${changed ? ' changed' : ''}" x="${x.toFixed(1)}" y="${top + 3}" width="${w.toFixed(1)}" height="${height}" rx="3" style="fill:${geneCell(gene, index)}"/>`);
      if (changed && row.before) {
        out.push(`<rect class="st-gene-old" x="${(x + w / 4).toFixed(1)}" y="${top + 3 + height / 4}" width="${(w / 2).toFixed(1)}" height="${height / 2}" rx="2" style="fill:${geneCell(row.before[index], index)}"/>`);
      }
    });
  });
  return out.join('');
}

/** The two parents, a heart and the tree down to their three children, over the genomes of all five. */
function crossoverView(a: Individual, b: Individual, children: number[][]): string {
  const out: string[] = [];
  const PARENT = 1.2, top = 4, bottom = top + UNIT_H * PARENT;
  ([[330, a, 'A'], [670, b, 'B']] as const).forEach(([cx, item, letter]) => {
    const { x, y } = centered(cx, top, PARENT);
    out.push(robot(look(item, { badge: letter }), x, y, PARENT));
    out.push(label(cx, bottom + 20, `Padre ${letter}`));
  });
  out.push(heart(500, 64, 56));
  const CHILD = 0.92, childTop = 262, xs = [230, 500, 770], bar = 240;
  out.push(`<path class="st-tree" d="M 330 ${(bottom + 30).toFixed(1)} V 222 H 670 V ${(bottom + 30).toFixed(1)} M 500 222 V ${bar} M ${xs[0]} ${bar} H ${xs[2]} ${xs.map((cx) => `M ${cx} ${bar} V ${childTop - 4}`).join(' ')}"/>`);
  children.forEach((genes, index) => {
    const { x, y } = centered(xs[index], childTop, CHILD);
    out.push(robot(look(individual(genes, 'child')), x, y, CHILD));
    out.push(label(xs[index], childTop + UNIT_H * CHILD + 20, `Hijo ${index + 1}`));
  });
  out.push(strips(452, `Los ${GENES} genes de cada uno`, [
    { name: 'Padre A', genes: a.genes, strong: true }, { name: 'Padre B', genes: b.genes, strong: true },
    ...children.map((genes, index) => ({ name: `Hijo ${index + 1}`, genes })),
  ]));
  return out.join('');
}

/** Each child before (small, faded) and after its mutation (large), over their genomes with the changes boxed. */
function mutationView(before: number[][], after: number[][]): string {
  const out: string[] = [];
  const BEFORE = 0.88, AFTER = 1.7, top = 40, xs = [167, 500, 833];
  after.forEach((genes, index) => {
    const cx = xs[index];
    const old = centered(cx - 88, top + UNIT_H * (AFTER - BEFORE), BEFORE);
    const now = centered(cx + 44, top, AFTER);
    out.push(label(cx, top - 14, SHOWCASE[index].label, 'st-label strong'));
    out.push(robot(look(individual(before[index], 'child'), { faded: true }), old.x, old.y, BEFORE));
    out.push(label(cx - 88, top + UNIT_H * AFTER + 22, 'antes', 'st-label small'));
    out.push(`<path class="st-arrow" d="M ${cx - 46} ${(top + UNIT_H * AFTER - 60).toFixed(1)} h 18 m -7 -6 l 7 6 l -7 6"/>`);
    out.push(robot(look(individual(genes, 'child')), now.x, now.y, AFTER));
    out.push(label(cx + 44, top + UNIT_H * AFTER + 22, `Hijo ${index + 1}`));
  });
  out.push(strips(360, `Los ${GENES} genes, antes y después: con borde, los que mutaron (adentro, el valor de antes)`, after.flatMap((genes, index) => [
    { name: `Hijo ${index + 1} antes`, genes: before[index] },
    { name: 'después', genes, before: before[index], strong: true },
  ])));
  return out.join('');
}

function stage(): string {
  const { population, scenario } = generations[generation];
  const [a, b] = scenario.winners;
  switch (step) {
    case 0:
      return grid(population, (item) => look(item));
    case 1:
    case 2: {
      const picks = scenario.picks[step - 1], winner = scenario.winners[step - 1];
      return grid(population, (item, index) => look(item, {
        ring: picks.includes(index),
        dim: !picks.includes(index) && !(step === 2 && index === a),
        badge: index === a ? 'A' : step === 2 && index === b ? 'B' : index === winner ? (step === 1 ? 'A' : 'B') : undefined,
      }));
    }
    case 3:
      return crossoverView(population[a], population[b], scenario.crossed);
    case 4:
      return mutationView(scenario.crossed, scenario.mutated);
    case 5: {
      const elites = elitesOf(population);
      return grid(population, (item, index) => elites.includes(index)
        ? look({ ...item, origin: 'elite' }, { face: elites.indexOf(index) === 0 ? 'sideways' : 'worried' }, true)
        : look(item, { dead: true }));
    }
    default:
      return grid(ensureNext().population, (item) => look(item, {}, true));
  }
}

// ---------- Explanation of each step ----------
const tile = (tone: string, name: string, value: string, foot = '') =>
  h('div', { class: `stat ${tone}` }, h('dt', {}, name), h('dd', {}, value), foot ? h('span', { class: 'stat-foot' }, foot) : null);

function candidates(population: Individual[], picks: number[], winner: number, letter: string): HTMLElement {
  return h('div', { class: 'tour-cards' }, ...picks.map((index) => h('div', { class: index === winner ? 'tour-card win' : 'tour-card' },
    h('b', {}, dec(population[index].fitness, 3)),
    h('span', {}, index === winner ? `gana: padre ${letter}` : 'pierde'))));
}

function panels(): { title: string; text: string; detail?: HTMLElement }[] {
  const { population, scenario } = generations[generation];
  const next = ensureNext().population;
  const mutatedChildren = next.filter((item) => item.origin === 'child' && shaped(item.genes)).length;
  const changed = scenario.mutated.map((genes, index) => genes.filter((gene, g) => Math.abs(gene - scenario.crossed[index][g]) > 1e-9).length);
  return [
    {
      title: 'Población evaluada',
      text: `Cada robot es un evaluador con ${GENES} genes, como los reales. Dibujamos cuatro: el color (de rojo a azul), el largo de los brazos, el tamaño de los ojos y el largo de las piernas. La pantalla de cada uno muestra su fitness.`,
      detail: h('dl', { class: 'stats cols-2' }, tile('sky', 'Mejor fitness', dec(best(population), 3)), tile('lavender', 'Fitness promedio', dec(mean(population), 3))),
    },
    {
      title: 'Primer torneo',
      text: `Se sacan ${settings.tournament_size} robots al azar y gana el de mejor fitness: es el padre A. Los robots con mejor fitness ganan más torneos, pero cualquiera puede ganar si le tocan rivales peores.`,
      detail: candidates(population, scenario.picks[0], scenario.winners[0], 'A'),
    },
    {
      title: 'Segundo torneo',
      text: `Otros ${settings.tournament_size} al azar, y el ganador es el padre B.`,
      detail: candidates(population, scenario.picks[1], scenario.winners[1], 'B'),
    },
    {
      title: 'Cruce',
      text: `Arriba, lo ilustrativo: los hijos salen con colores entre los de sus padres. Abajo, lo real: cada uno de los ${GENES} genes del hijo cae al azar en el tramo entre el gen del padre A y el del padre B, alargado un ${dec(settings.blend_alpha * 100, 0)} % hacia cada lado. En la corrida real cada pareja tiene un hijo (aquí dibujamos tres posibles) y los genes son 13 pesos, 13 interruptores y 3 perillas; aquí todos van de −5 a 5.`,
    },
    {
      title: 'Mutación',
      text: `Cada gen tiene una probabilidad de 1 en ${GENES} de correrse un poco (escala ${dec(settings.mutation_scale, 1)} del rango) y un ${dec(settings.reset_rate * 100, 0)} % se reinicia al azar. Para que se note, a cada hijo le tocó además una mutación de forma. En la tira, con borde, los genes que cambiaron: ${changed.map((count, index) => `${count} en el hijo ${index + 1}`).join(', ')}.`,
    },
    {
      title: 'Purga',
      text: `La generación vieja desaparece y solo sobreviven los élite: los ${settings.elites} robots con mejor fitness. Pasan intactos a la siguiente generación, sin cruzarse ni mutar, así el mejor fitness nunca baja de una generación a otra. De los demás solo quedan sus genes, en los hijos.`,
      detail: h('dl', { class: 'stats cols-2' }, tile('mint', 'Sobreviven', String(settings.elites), 'élite'), tile('rose', 'Eliminados', String(population.length - settings.elites))),
    },
    {
      title: 'Nueva generación',
      text: `Entran los ${settings.elites} élite (dorados), ${immigrants} inmigrantes con genes al azar (verdes) para no perder variedad y ${childrenCount} hijos, hechos con torneos, cruce y mutación. Los colores de los hijos vienen de sus padres; solo unos pocos muestran una mutación de forma.`,
      detail: h('dl', { class: 'stats cols-4' }, tile('peach', 'Élite', String(settings.elites)), tile('mint', 'Inmigrantes', String(immigrants)),
        tile('sky', 'Hijos', String(childrenCount)), tile('lavender', 'Con forma mutada', int(mutatedChildren))),
    },
  ];
}

// ---------- Best fitness so far, as a sparkline next to the counter ----------
function sparkline(upTo: number): void {
  const svg = root?.querySelector<SVGSVGElement>('[data-tour="spark"]');
  if (!svg) return;
  const values = generations.slice(0, upTo + 1).map((item) => best(item.population));
  if (values.length < 2) { svg.innerHTML = ''; return; }
  const low = Math.min(...values) - 0.005, high = Math.max(...values) + 0.005;
  const x = (i: number) => (120 * i) / (values.length - 1);
  const y = (value: number) => 22 - (20 * (value - low)) / (high - low);
  const points = values.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  svg.innerHTML = `<polyline class="tour-spark-line" points="${points}"/><circle class="tour-spark-dot" cx="${x(last).toFixed(1)}" cy="${y(values[last]).toFixed(1)}" r="2.5"/>`;
}

// ---------- Drawing ----------
function draw(): void {
  const svg = root?.querySelector<SVGSVGElement>('[data-tour="stage"]');
  if (svg) {
    svg.innerHTML = stage();
    svg.setAttribute('aria-label', `Paso ${step + 1} de ${STEPS}`);
  }
  const views = panels();
  part('panels')?.replaceChildren(...views.map((view, index) => h('div', { class: index === step ? 'tour-panel is-active' : 'tour-panel', 'aria-hidden': index === step ? 'false' : 'true' },
    h('span', { class: 'tour-count' }, `Paso ${index + 1} de ${STEPS}`),
    h('h5', {}, view.title),
    h('p', {}, view.text),
    view.detail ?? null)));
  const shownGeneration = step === STEPS - 1 ? generation + 1 : generation;
  const set = (name: string, text: string) => { const element = part(name); if (element) element.textContent = text; };
  set('generation', String(shownGeneration));
  set('best', dec(best(generations[shownGeneration].population), 3));
  sparkline(shownGeneration);
  const back = part('back') as HTMLButtonElement | null;
  if (back) back.disabled = generation === 0 && step === 0;
}

// ---------- Controls ----------
function forward(): void {
  if (step < STEPS - 1) step += 1;
  else { ensureNext(); generation += 1; step = 0; }
  draw();
}
function backward(): void {
  if (step > 0) step -= 1;
  else if (generation > 0) { generation -= 1; step = STEPS - 1; }
  draw();
}

const speedInput = root?.querySelector<HTMLInputElement>('[data-tour="speed"]') ?? null;
const speed = () => Math.max(1, Math.min(SPEED_MS.length, Math.round(Number(speedInput?.value ?? 1))));
let playing = false;

function tick(): void {
  if (generation >= MAX_GENERATIONS) { setPlaying(false); return; }
  if (speed() > STEP_BY_STEP) {
    // Fast: one whole generation per frame, always shown as the evaluated population.
    ensureNext(); generation += 1; step = 0; draw();
  } else if (generation >= 1 && step === 0) {
    // After the first full cycle, slow play still goes a generation at a time.
    step = STEPS - 1; draw();
  } else forward();
}
function schedule(): void {
  clearInterval(timer);
  if (playing) timer = window.setInterval(tick, SPEED_MS[speed() - 1] * (reducedMotion() ? 1.5 : 1));
}
function setPlaying(on: boolean): void {
  playing = on;
  const button = part('play');
  button?.setAttribute('aria-pressed', String(on));
  const text = button?.querySelector('span');
  if (text) text.textContent = on ? 'Pausar' : 'Reproducir';
  schedule();
}
function showSpeed(): void {
  const output = part('speed-value');
  if (output) output.textContent = `×${speed()}`;
}

if (root) {
  part('next')?.addEventListener('click', () => { setPlaying(false); forward(); });
  part('back')?.addEventListener('click', () => { setPlaying(false); backward(); });
  part('play')?.addEventListener('click', () => setPlaying(!playing));
  part('reset')?.addEventListener('click', () => { setPlaying(false); generation = 0; step = 0; draw(); });
  speedInput?.addEventListener('input', () => { showSpeed(); schedule(); });
  showSpeed();
  root.querySelector('[data-tour="stage"]')?.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
  whenVisible(root, draw);
  onTheme(draw);
}
