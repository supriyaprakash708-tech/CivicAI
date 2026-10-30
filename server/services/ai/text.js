/** Small text-extraction helpers shared by the fallback engine. */

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
};

export function extractDuration(text) {
  const lower = String(text || '').toLowerCase();
  const words = lower.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)\b/g,
    (m) => String(WORD_NUMBERS[m]));
  const patterns = [
    { re: /(\d+)\s*(?:days?|d)\b/, mult: 1, unit: 'day' },
    { re: /(\d+)\s*(?:weeks?|wks?)\b/, mult: 7, unit: 'week' },
    { re: /(\d+)\s*(?:months?|mos?)\b/, mult: 30, unit: 'month' },
    { re: /(\d+)\s*(?:hours?|hrs?)\b/, mult: 1 / 24, unit: 'hour' },
  ];
  for (const p of patterns) {
    const m = words.match(p.re);
    if (m) return { value: Number(m[1]), unit: p.unit, days: Number(m[1]) * p.mult, text: m[0] };
  }
  if (/\b(yesterday|last night|since last night)\b/.test(lower)) return { value: 1, unit: 'day', days: 1, text: 'since yesterday' };
  return null;
}

export function extractAffected(text) {
  const lower = String(text || '');
  const patterns = [
    /(\d[\d,]*)\s+(?:people|persons?|residents?|families|households|students?|patients?)/i,
    /(?:about|around|nearly|over|more than)\s+(\d[\d,]*)\s+(?:people|residents?|families)/i,
  ];
  for (const re of patterns) {
    const m = lower.match(re);
    if (m) return Number(m[1].replace(/,/g, ''));
  }
  return null;
}
