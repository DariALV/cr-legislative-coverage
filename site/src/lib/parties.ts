/**
 * Display colour and short name of each legislative faction, in display order.
 * The colours identify the faction only; they carry no judgement.
 */
export const PARTIES: { name: string; short: string; color: string }[] = [
  { name: 'Partido Liberación Nacional', short: 'PLN', color: '#2e9e4f' },
  { name: 'Partido Pueblo Soberano', short: 'PPSO', color: '#5bc0eb' },
  { name: 'Partido Unidad Social Cristiana', short: 'PUSC', color: '#1f4fbf' },
  { name: 'Partido Frente Amplio', short: 'FA', color: '#f2c200' },
  { name: 'Coalición Agenda Ciudadana', short: 'CAC', color: '#d93025' },
  // Factions of earlier legislatures, which appear in older votes.
  { name: 'Partido Progreso Social Democrático', short: 'PPSD', color: '#8e6bbf' },
  { name: 'Partido Nueva República', short: 'PNR', color: '#0d7a7a' },
  { name: 'Partido Liberal Progresista', short: 'PLP', color: '#f08a24' },
  { name: 'Partido Acción Ciudadana', short: 'PAC', color: '#c2185b' },
  { name: 'Partido Restauración Nacional', short: 'PRN', color: '#8d6e63' },
  { name: 'Partido Integración Nacional', short: 'PIN', color: '#607d8b' },
  { name: 'Partido Republicano Social Cristiano', short: 'PRSC', color: '#37474f' },
  { name: 'Independiente', short: 'Ind.', color: '#b0aea6' },
];

const UNKNOWN_COLOR = '#b0aea6';
const index = new Map(PARTIES.map((p, i) => [p.name, i]));

export const partyColor = (name: string) => PARTIES[index.get(name) ?? -1]?.color ?? UNKNOWN_COLOR;
export const partyShort = (name: string) => PARTIES[index.get(name) ?? -1]?.short ?? name;
/** Position in the display order; unknown factions go last. */
export const partyRank = (name: string) => index.get(name) ?? PARTIES.length;
