const { normalizeSearch } = require('./catalog-utils');

// Adjacent swaps count as one typo, as do missing/extra/replaced letters.
function typoDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let beforePrevious;
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1,
        previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], beforePrevious[j - 2] + 1);
      }
    }
    beforePrevious = previous;
    previous = current;
  }
  return previous[b.length];
}

function createSearchRanker(query) {
  const normalized = normalizeSearch(query).slice(0, 160);
  const tokens = normalized.split(' ').filter(Boolean).slice(0, 12);
  const wordScores = new Map();
  function scoreWord(token, word) {
    const key = `${token}|${word}`;
    if (wordScores.has(key)) return wordScores.get(key);
    let score = 0;
    if (word === token) score = 100;
    else if (word.startsWith(token)) score = 85;
    else if (word.includes(token)) score = 70;
    else if (token.length >= 4 && word.length >= 4) {
      const limit = token.length >= 8 ? 2 : 1;
      const distance = typoDistance(token, word, limit);
      if (distance <= limit) score = 50 - distance * 10;
    }
    wordScores.set(key, score);
    return score;
  }
  return (artist, title) => {
    if (!tokens.length) return 0;
    const fields = [normalizeSearch(artist), normalizeSearch(title)];
    const words = [...new Set(fields.join(' ').split(' ').filter(Boolean))];
    let score = 0;
    let fuzzy = false;
    for (const token of tokens) {
      const best = Math.max(0, ...words.map(word => scoreWord(token, word)));
      if (!best) return 0; // Never drop an unmatched query word silently.
      if (best < 70) fuzzy = true;
      score += best;
    }
    // Every literal match sorts above suggestions requiring typo correction.
    if (!fuzzy) score += 10000;
    if (fields.includes(normalized)) score += 1000;
    else if (fields.some(field => field.startsWith(normalized))) score += 500;
    return score;
  };
}
module.exports = { createSearchRanker };
