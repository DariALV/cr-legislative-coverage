/**
 * Settings of the similarity graph at the end of bill and news pages (#71), shared by the component
 * (build time) and its script (browser). Similarities are cosines x 100, as in public/grafos/.
 *
 * Bands (five colors, closest first). For bills they come from the blind test in results/item_graph/:
 * 7 of 8 pairs at 0.75 or more were judged related, 4 of 8 between 0.65 and 0.75, mostly "same broad area"
 * between 0.55 and 0.65, at most 1 of 8 between 0.45 and 0.55, and random pairs (median 0.37) none.
 * News were not tested: their cuts are the cosines that are as rare among news pairs as the bills' cuts are
 * among bill pairs (0.45, 0.55, 0.65 and 0.75 are the top 21 %, 4 %, 0.5 % and 0.07 %).
 * The default minimum (0.50 for bills) is about the top 10 % of all pairs, and its news counterpart.
 */
export type ItemGraphKind = 'bills' | 'news';

export interface ItemGraphConfig {
  /** Lower bounds of the first four bands, closest first; below the last one is the fifth band. */
  bands: [number, number, number, number];
  /** Minimum similarity to the page's item: slider range and default. */
  minSim: { min: number; max: number; value: number };
  /** Nodes shown by default (the slider goes up to the tree's length, at most 150). */
  nodes: number;
}

export const ITEM_GRAPH: Record<ItemGraphKind, ItemGraphConfig> = {
  bills: { bands: [75, 65, 55, 45], minSim: { min: 30, max: 90, value: 50 }, nodes: 15 },
  news: { bands: [88, 79, 61, 50], minSim: { min: 40, max: 95, value: 55 }, nodes: 15 },
};

/** Names of the five bands, closest first (the colors are --sim-1 to --sim-5 in ItemGraph.astro). */
export const ITEM_GRAPH_BANDS = ['muy parecido', 'parecido', 'misma área', 'poco parecido', 'sin relación clara'] as const;

export const ITEM_GRAPH_MAX_NODES = 150;

/** "0,75" from 75. */
export const similarityLabel = (cosine100: number) => (cosine100 / 100).toFixed(2).replace('.', ',');
