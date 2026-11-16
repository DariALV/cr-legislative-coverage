// Chapter 3: one generation of the genetic algorithm, step by step. The operators and their parameters are the
// real ones (tools/evolution_tools/genetic_algorithm.py with the settings of the run): tournament selection, blend
// crossover, mutation with resets, elites and random immigrants. The individuals are simulated: eight genes and a
// toy fitness (closeness to a hidden target), because the real fitness needs the whole feature matrix.
import { h, onTheme, readData, reducedMotion, seededRandom, sequential, whenVisible } from './core';
import { dec } from '../../lib/process/format';

interface Settings {
  population_size: number; elites: number; immigrant_rate: number; tournament_size: number; crossover_rate: number;
  blend_alpha: number; mutation_scale: number; reset_rate: number; max_generations: number;
}
type Origin = 'random' | 'elite' | 'immigrant' | 'child';
interface Individual { genes: number[]; fitness: number; origin: Origin }
interface Scenario {
  picks: [number[], number[]];          // the two tournaments: indexes into the population
  winners: [number, number];
  crossed: number[];                    // the child right after the crossover
  mutated: number[];                    // and after the mutation
  moved: boolean[];                     // genes changed by the mutation
  reset: boolean[];                     // genes drawn again at random
}
interface Generation { population: Individual[]; scenario: Scenario }

const { settings, weightRange } = readData<{ settings: Settings; weightRange: [number, number] }>('data-ranker');
const GENES = 8, STEPS = 6, PLAY_MS = 1500, MAX_GENERATIONS = 40;
const [LOW, HIGH] = weightRange, SPAN = HIGH - LOW;
const MUTATION_RATE = 1 / GENES;        // the real default: one gene per individual on average (1 / genome size)
const immigrants = Math.round(settings.immigrant_rate * settings.population_size);

const root = document.getElementById('tournament');
const part = (name: string) => root?.querySelector<HTMLElement>(`[data-tour="${name}"]`) ?? null;
const random = seededRandom(7);
const clip = (value: number) => Math.max(LOW, Math.min(HIGH, value));
const randomGene = () => LOW + random() * SPAN;
function normal(): number {   // Box-Muller
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

const target = Array.from({ length: GENES }, randomGene);
function fitness(genes: number[]): number {
  const distance = Math.sqrt(genes.reduce((sum, gene, index) => sum + (gene - target[index]) ** 2, 0) / GENES);
  return 1 - distance / SPAN;
}
const individual = (genes: number[], origin: Origin): Individual => ({ genes, fitness: fitness(genes), origin });
const randomIndividual = (origin: Origin) => individual(Array.from({ length: GENES }, randomGene), origin);

function tournament(population: Individual[]): { picks: number[]; winner: number } {
  const picks = Array.from({ length: settings.tournament_size }, () => Math.floor(random() * population.length));
  return { picks, winner: picks.reduce((best, index) => (population[index].fitness > population[best].fitness ? index : best)) };
}

function crossover(first: number[], second: number[]): number[] {
  if (random() >= settings.crossover_rate) return [...first];
  return first.map((gene, index) => {
    const low = Math.min(gene, second[index]), high = Math.max(gene, second[index]);
    const extra = settings.blend_alpha * (high - low);
    return clip(low - extra + random() * (high - low + 2 * extra));
  });
}

function mutate(genes: number[]): { genes: number[]; moved: boolean[]; reset: boolean[] } {
  const moved = genes.map(() => random() < MUTATION_RATE);
  const reset = genes.map(() => random() < settings.reset_rate);
  const result = genes.map((gene, index) => {
    if (reset[index]) return randomGene();
    return moved[index] ? clip(gene + normal() * settings.mutation_scale * SPAN) : gene;
  });
  return { genes: result, moved, reset };
}

/** The first child of the generation, kept step by step for the animation. */
function plan(population: Individual[]): Scenario {
  const first = tournament(population);
  let second = tournament(population);
  while (second.winner === first.winner) second = tournament(population);   // two different parents, so the crossover shows
  let crossed = crossover(population[first.winner].genes, population[second.winner].genes);
  if (crossed.every((gene, index) => gene === population[first.winner].genes[index])) {
    crossed = crossed.map((gene, index) => clip((gene + population[second.winner].genes[index]) / 2));
  }
  const mutation = mutate(crossed);
  if (!mutation.moved.some(Boolean)) {   // make sure the mutation step has something to show
    const index = Math.floor(random() * GENES);
    mutation.moved[index] = true;
    mutation.genes[index] = clip(mutation.genes[index] + normal() * settings.mutation_scale * SPAN);
  }
  return { picks: [first.picks, second.picks], winners: [first.winner, second.winner], crossed, mutated: mutation.genes, moved: mutation.moved, reset: mutation.reset };
}

function nextPopulation({ population, scenario }: Generation): Individual[] {
  const ranking = [...population].sort((a, b) => b.fitness - a.fitness);
  const next: Individual[] = ranking.slice(0, settings.elites).map((elite) => ({ ...elite, origin: 'elite' as Origin }));
  for (let index = 0; index < immigrants; index += 1) next.push(randomIndividual('immigrant'));
  next.push(individual(scenario.mutated, 'child'));
  while (next.length < settings.population_size) {
    const first = tournament(population).winner, second = tournament(population).winner;
    next.push(individual(mutate(crossover(population[first].genes, population[second].genes)).genes, 'child'));
  }
  return next;
}

function firstGeneration(): Generation {
  const population = Array.from({ length: settings.population_size }, () => randomIndividual('random'));
  return { population, scenario: plan(population) };
}

const generations: Generation[] = [firstGeneration()];
let generation = 0, step = 0, timer = 0;

const best = (population: Individual[]) => Math.max(...population.map((item) => item.fitness));
const shade = (value: number) => sequential((value - 0.45) / 0.55);
const share = (gene: number) => `${(100 * (gene - LOW)) / SPAN}%`;

// ---------- Drawing ----------
function drawGrid(): void {
  const grid = part('grid');
  if (!grid) return;
  const { population, scenario } = generations[generation];
  const showNext = step === STEPS - 1;
  const shown = showNext ? ensureNext().population : population;
  grid.replaceChildren(...shown.map((item, index) => {
    const classes = ['tour-ind'];
    if (showNext) {
      if (item.origin !== 'random') classes.push(item.origin);
    } else {
      const picked = step === 1 ? scenario.picks[0] : step === 2 ? scenario.picks[1] : [];
      if (picked.includes(index)) classes.push('picked');
      if (step >= 1 && index === scenario.winners[0]) classes.push('parent', 'a');
      if (step >= 2 && index === scenario.winners[1]) classes.push('parent', 'b');
    }
    return h('span', { class: classes.join(' '), style: `background:${shade(item.fitness)}`, title: `fitness ${dec(item.fitness, 3)}` });
  }));
}

function geneRows(rows: { label: string; genes: number[]; cls: string }[], extra?: (index: number) => HTMLElement | null): HTMLElement {
  return h('div', { class: 'tour-genes' },
    h('div', { class: 'tour-genes-head' }, h('span', {}, `gen`), h('span', {}, String(LOW)), h('span', {}, '0'), h('span', {}, `+${HIGH}`)),
    ...Array.from({ length: GENES }, (_, index) => h('div', { class: 'tour-gene' },
      h('span', { class: 'tour-gene-name' }, `g${index + 1}`),
      h('span', { class: 'tour-gene-track' },
        extra?.(index),
        ...rows.map((row) => h('i', { class: `tour-mark ${row.cls}`, style: `left:${share(row.genes[index])}`, title: `${row.label}: ${dec(row.genes[index], 2)}` }))))),
    h('div', { class: 'legend' }, ...rows.map((row) => h('span', {}, h('i', { class: `tour-mark key ${row.cls}` }), row.label))));
}

function candidates(indexes: number[], winner: number, population: Individual[], letter: string): HTMLElement {
  return h('div', { class: 'tour-cards' }, ...indexes.map((index) => h('div', { class: index === winner ? 'tour-card win' : 'tour-card' },
    h('i', { style: `background:${shade(population[index].fitness)}` }),
    h('b', {}, dec(population[index].fitness, 3)),
    h('span', {}, index === winner ? `gana: padre ${letter}` : 'fitness'))));
}

function drawStep(): void {
  const { population, scenario } = generations[generation];
  const [a, b] = scenario.winners.map((index) => population[index]);
  const fitnesses = population.map((item) => item.fitness);
  const mean = fitnesses.reduce((sum, value) => sum + value, 0) / fitnesses.length;
  const views: { title: string; text: string; detail: HTMLElement }[] = [
    {
      title: 'Población evaluada',
      text: `Los ${settings.population_size} evaluadores ya tienen su fitness: cada punto es uno, y su color dice qué tan bueno es.`,
      detail: h('dl', { class: 'stats cols-2' },
        h('div', { class: 'stat sky' }, h('dt', {}, 'Mejor fitness'), h('dd', {}, dec(best(population), 3))),
        h('div', { class: 'stat lavender' }, h('dt', {}, 'Fitness promedio'), h('dd', {}, dec(mean, 3)))),
    },
    {
      title: 'Primer torneo',
      text: `Se sacan ${settings.tournament_size} al azar y gana el de mejor fitness: es el padre A.`,
      detail: candidates(scenario.picks[0], scenario.winners[0], population, 'A'),
    },
    {
      title: 'Segundo torneo',
      text: `Otros ${settings.tournament_size} al azar, y el ganador es el padre B.`,
      detail: candidates(scenario.picks[1], scenario.winners[1], population, 'B'),
    },
    {
      title: 'Cruce',
      text: `Cada gen del hijo cae al azar en el tramo entre A y B, alargado un ${dec(settings.blend_alpha * 100, 0)} % hacia cada lado.`,
      detail: geneRows([{ label: 'padre A', genes: a.genes, cls: 'a' }, { label: 'padre B', genes: b.genes, cls: 'b' }, { label: 'hijo', genes: scenario.crossed, cls: 'child' }],
        (index) => {
          const low = Math.min(a.genes[index], b.genes[index]), high = Math.max(a.genes[index], b.genes[index]);
          const extra = settings.blend_alpha * (high - low);
          return h('em', { class: 'tour-span', style: `left:${share(clip(low - extra))}; width:calc(${share(clip(high + extra))} - ${share(clip(low - extra))})` });
        }),
    },
    {
      title: 'Mutación',
      text: `Algunos genes del hijo se corren un poco (escala ${dec(settings.mutation_scale, 1)} del rango) y un ${dec(settings.reset_rate * 100, 0)} % se reinicia al azar.`,
      detail: geneRows([{ label: 'antes', genes: scenario.crossed, cls: 'ghost' }, { label: 'hijo mutado', genes: scenario.mutated, cls: 'child' }],
        (index) => {
          if (!scenario.moved[index] && !scenario.reset[index]) return null;
          const from = Math.min(scenario.crossed[index], scenario.mutated[index]), to = Math.max(scenario.crossed[index], scenario.mutated[index]);
          return h('em', { class: 'tour-shift', style: `left:${share(from)}; width:calc(${share(to)} - ${share(from)})` });
        }),
    },
    {
      title: 'Nueva generación',
      text: `Pasan intactos los ${settings.elites} mejores, entran ${immigrants} inmigrantes al azar y el resto son hijos hechos igual que este.`,
      detail: h('dl', { class: 'stats cols-3' },
        h('div', { class: 'stat mint' }, h('dt', {}, 'Élites'), h('dd', {}, String(settings.elites))),
        h('div', { class: 'stat peach' }, h('dt', {}, 'Inmigrantes'), h('dd', {}, String(immigrants))),
        h('div', { class: 'stat sky' }, h('dt', {}, 'Hijos'), h('dd', {}, String(settings.population_size - settings.elites - immigrants)))),
    },
  ];
  const view = views[step];
  const set = (name: string, text: string) => { const element = part(name); if (element) element.textContent = text; };
  set('count', `Paso ${step + 1} de ${STEPS}`);
  set('title', view.title);
  set('text', view.text);
  part('detail')?.replaceChildren(view.detail);
  const shownGeneration = step === STEPS - 1 ? generation + 1 : generation;
  set('generation', String(shownGeneration));
  set('best', dec(best(step === STEPS - 1 ? ensureNext().population : population), 3));
  const back = part('back') as HTMLButtonElement | null;
  if (back) back.disabled = generation === 0 && step === 0;
}

function ensureNext(): Generation {
  if (!generations[generation + 1]) {
    const population = nextPopulation(generations[generation]);
    generations.push({ population, scenario: plan(population) });
  }
  return generations[generation + 1];
}

function draw(): void { drawGrid(); drawStep(); }

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
function setPlaying(on: boolean): void {
  clearInterval(timer);
  const button = part('play');
  button?.setAttribute('aria-pressed', String(on));
  const text = button?.querySelector('span');
  if (text) text.textContent = on ? 'Pausar' : 'Reproducir';
  if (!on) return;
  timer = window.setInterval(() => {
    if (generation >= MAX_GENERATIONS) { setPlaying(false); return; }
    // After the first full cycle, play whole generations at a time.
    if (generation >= 1 && step === 0) { step = STEPS - 1; draw(); } else forward();
  }, reducedMotion() ? PLAY_MS * 1.5 : PLAY_MS);
}

if (root) {
  part('next')?.addEventListener('click', () => { setPlaying(false); forward(); });
  part('back')?.addEventListener('click', () => { setPlaying(false); backward(); });
  part('play')?.addEventListener('click', () => setPlaying(part('play')?.getAttribute('aria-pressed') !== 'true'));
  part('reset')?.addEventListener('click', () => { setPlaying(false); generation = 0; step = 0; draw(); });
  whenVisible(root, draw);
  onTheme(draw);
}
