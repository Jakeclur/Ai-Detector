// Training-time augmentation (v12): rewrites an AI text the way humaniser tools and light editing do,
// so the model learns signals that survive those edits. Used for AI training texts only.
// Deliberately NOT added: typos, slang, missing apostrophes or lowercase "i" (those stay human-only signals).
const SWAP = {
  "utilize": "use", "utilise": "use", "additionally": "also", "furthermore": "also", "moreover": "plus", "however": "but", "therefore": "so",
  "significant": "big", "significantly": "a lot", "numerous": "many", "individuals": "people", "demonstrate": "show", "demonstrates": "shows",
  "obtain": "get", "require": "need", "requires": "needs", "assist": "help", "commence": "start", "approximately": "about", "sufficient": "enough",
  "crucial": "key", "essential": "needed", "enhance": "improve", "various": "different", "consequently": "so", "regarding": "about",
  "big": "large", "show": "display", "help": "aid", "important": "vital", "many": "lots of", "people": "folks", "good": "fine", "use": "employ"
};
function rng(seed) { let s = seed % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function augment(text, seed) {
  const r = rng(seed);
  let t = text;
  // 1) drop about half of the commas
  if (r() < 0.7) t = t.replace(/,(?=\s)/g, () => r() < 0.5 ? "" : ",");
  // 2) swap words (both ways: formal -> plain and plain -> odd synonyms, like humaniser tools)
  if (r() < 0.8) t = t.replace(/\b[A-Za-z]+\b/g, w => { const k = w.toLowerCase(); if (!SWAP[k] || r() > 0.5) return w; const s = SWAP[k]; return w[0] === w[0].toUpperCase() ? s[0].toUpperCase() + s.slice(1) : s; });
  // 3) merge some neighbouring sentences, or split long ones at ", and" / ", but"
  if (r() < 0.6) t = t.replace(/([a-z])\. ([A-Z])([a-z])/g, (m, a, b, c) => r() < 0.25 ? `${a} and ${b.toLowerCase()}${c}` : m);
  if (r() < 0.5) t = t.replace(/, (and|but) ([a-z])/g, (m, conj, c) => r() < 0.5 ? `. ${conj[0].toUpperCase()}${conj.slice(1)} ${c}` : m);
  return t;
}
module.exports = { augment };
