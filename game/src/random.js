// Deterministic randomness so a ?seed=N world always builds the same city
// and the same shot staging. mulberry32: a tiny, fast, well-tested PRNG.

// Returns a function next() -> [0, 1) seeded by `seed`.
export function createRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer in [min, max] inclusive, from a seeded stream.
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Float in [min, max), from a seeded stream.
export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

// One element of `items`, from a seeded stream.
export function randPick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}
