/**
 * Settings of the similarity graph at the end of bill and news pages (#71), shared by the component
 * (build time) and its script (browser). Similarities are cosines x 100, as in public/grafos/.
 *
 * Bands: for bills they come from the blind test in results/item_graph/ (7 of 8 pairs at 0.75 or more
 * were judged related, 4 of 8 between 0.65 and 0.75). News were not tested: their cuts are the cosines
 * that are as rare among news pairs as 0.65 and 0.75 are among bill pairs (top 0.5 % and 0.07 %).
 * The default minimum (0.50 for bills) is about the top 10 % of all pairs, and its news counterpart.
 */
export type ItemGraphKind = 'bills' | 'news';

export interface ItemGraphConfig {
  /** [close, very close]: lower bounds of the "parecido" and "muy parecido" bands. */
  bands: [number, number];
  /** Similarities mapped to the smallest and the largest circle. */
  size: [number, number];
  /** Minimum similarity to the page's item: slider range and default. */
  minSim: { min: number; max: number; value: number };
  /** Nodes shown by default (the slider goes up to the tree's length, at most 150). */
  nodes: number;
}

export const ITEM_GRAPH: Record<ItemGraphKind, ItemGraphConfig> = {
  bills: { bands: [65, 75], size: [45, 85], minSim: { min: 30, max: 90, value: 50 }, nodes: 15 },
  news: { bands: [79, 88], size: [55, 95], minSim: { min: 40, max: 95, value: 55 }, nodes: 15 },
};

export const ITEM_GRAPH_MAX_NODES = 150;

/** "0,75" from 75. */
export const similarityLabel = (cosine100: number) => (cosine100 / 100).toFixed(2).replace('.', ',');
