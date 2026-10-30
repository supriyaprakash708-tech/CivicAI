/**
 * Local text similarity helpers. These are deterministic, offline and used for
 * duplicate detection. They are deliberately described as lexical/embedding
 * similarity, NOT as a hosted semantic model.
 */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was',
  'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now',
  'old', 'see', 'two', 'who', 'boy', 'did', 'she', 'use', 'way', 'too', 'has', 'have', 'this',
  'that', 'with', 'from', 'they', 'will', 'been', 'near', 'there', 'here', 'into', 'over',
  'very', 'also', 'just', 'some', 'more', 'than', 'then', 'when', 'what', 'which', 'would',
  'could', 'should', 'about', 'after', 'before', 'around', 'because', 'been', 'being', 'please',
  'kindly', 'request', 'requesting', 'inform', 'informing', 'reported', 'report', 'problem',
  'issue', 'issues', 'civic', 'public', 'area', 'place', 'please', 'sir', 'madam', 'today',
  'yesterday', 'last', 'past', 'since', 'does', 'doing', 'make', 'made', 'like', 'need', 'needs',
]);

/** Map related civic vocabulary to a canonical token so paraphrases match. */
const SYNONYMS = [
  [/\b(potholes?|crater|trench|road holes?)\b/gi, ' pothole '],
  [/\b(road|roads|street|streets|pavement|carriageway|lane)\b/gi, ' road '],
  [/\b(garbage|trash|rubbish|litter|solid waste|waste)\b/gi, ' garbage '],
  [/\b(bin|bins|dumpster|container|dustbin)\b/gi, ' bin '],
  [/\b(drain|drains|drainage|sewer|sewers|gutter|gutters|stormwater|storm water)\b/gi, ' drain '],
  [/\b(flood|flooded|flooding|waterlog(?:ged|ging)?|standing water|stagnant water)\b/gi, ' flood '],
  [/\b(street ?lights?|streetlamps?|lamps?|lantern|lighting)\b/gi, ' streetlight '],
  [/\b(live wire|electric wire|power line|electrical wire|cable|wire)\b/gi, ' livewire '],
  [/\b(electric(?:al)?|power|voltage|sparking|spark)\b/gi, ' electrical '],
  [/\b(water supply|water line|water pipeline|pipeline|pipe burst|pipe)\b/gi, ' waterpipe '],
  [/\b(no water|water shortage|water cut|dry tap|interruption)\b/gi, ' nowater '],
  [/\b(manhole|man hole|drain cover|sewer cover)\b/gi, ' manhole '],
  [/\b(broken|damaged?|collapsed?|cracked?|dilapidated)\b/gi, ' damaged '],
  [/\b(overflow(?:ing|ed)?|spilling|spill)\b/gi, ' overflow '],
  [/\b(smell|smelly|stench|stink|odou?r)\b/gi, ' smell '],
  [/\b(mosquito(?:es)?|insects?|flies|fly|pests?|rodents?|rats?)\b/gi, ' pests '],
  [/\b(danger(?:ous)?|hazard(?:ous)?|unsafe|risk)\b/gi, ' hazard '],
  [/\b(accident|injur(?:y|ed|ies)|hurt|electrocut(?:e|ed|ion))\b/gi, ' injury '],
  [/\b(child(?:ren)?|kids?|school|students?)\b/gi, ' children '],
  [/\b(hospital|clinic|patient)\b/gi, ' hospital '],
  [/\b(apartment|flat|residents?|families|households?|neighbou?rs?)\b/gi, ' residents '],
  [/\b(refuse|waste collection|collection)\b/gi, ' collection '],
  [/\b(footpath|sidewalk|pedestrian)\b/gi, ' footpath '],
  [/\b(park|playground|bench)\b/gi, ' park '],
];

export function normalizeText(text) {
  let s = ` ${String(text || '').toLowerCase()} `;
  for (const [re, replacement] of SYNONYMS) s = s.replace(re, replacement);
  return s
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(token) {
  if (token.length <= 4) return token;
  return token
    .replace(/(ations|ation|ings|ing|ies|ied|ers|er|ed|es|s)$/i, (m) => (token.length - m.length >= 3 ? '' : m));
}

export function tokenize(text) {
  return normalizeText(text)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map(stem)
    .filter(Boolean);
}

export function tokenSet(text) {
  return new Set(tokenize(text));
}

/** Hashed bag-of-words + character trigram vector (256 dimensions), L2-normalised. */
const DIM = 256;

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function embed(text) {
  const vec = new Float64Array(DIM);
  const tokens = tokenize(text);
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  for (const [tok, count] of counts) {
    const weight = 1 + Math.log(count);
    const idx = hash32(`w:${tok}`) % DIM;
    vec[idx] += weight;
    const idx2 = hash32(`w2:${tok}`) % DIM;
    vec[idx2] += weight * 0.5;
  }
  const normalized = normalizeText(text);
  const grams = normalized.replace(/\s+/g, ' ');
  for (let i = 0; i < grams.length - 2; i += 1) {
    const gram = grams.slice(i, i + 3);
    const idx = hash32(`g:${gram}`) % DIM;
    vec[idx] += 0.35;
  }
  let norm = 0;
  for (let i = 0; i < DIM; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array(DIM);
  for (let i = 0; i < DIM; i += 1) out[i] = Number((vec[i] / norm).toFixed(5));
  return out;
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}

/** Overlap coefficient: robust when one report is much shorter than the other. */
export function containment(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  return intersection / Math.min(setA.size, setB.size);
}

export function addressSimilarity(a, b) {
  return jaccard(tokenSet(a || ''), tokenSet(b || ''));
}

export function textSimilarity(textA, textB, embedA = null, embedB = null) {
  const a = embedA || embed(textA);
  const b = embedB || embed(textB);
  const cos = cosine(a, b);
  const jac = jaccard(tokenSet(textA), tokenSet(textB));
  return Math.max(0, Math.min(1, 0.6 * cos + 0.4 * jac));
}

/** Haversine distance in metres. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null || !Number.isFinite(Number(v)))) return null;
  const R = 6371000;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
