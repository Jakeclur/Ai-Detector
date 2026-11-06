// ==CORE==
/* =====================================================================
   AI Text Detector engine (v8). Rules only: no trained text model, no network.
   Evidence sources (see the page's "research" section):
   - Kobak et al. 2024/25 (excess vocabulary in 15M abstracts)
   - Reinhart et al., PNAS 2025 (participial clauses etc.)
   - Sun et al., "Idiosyncrasies in LLMs", ICML 2025 (ChatGPT vs Claude fingerprints)
   - Pangram, Opus 5.5 vs Opus 5 (Sep 2026); Graphite tells study (Sep 2026)
   - Wikipedia: Signs of AI writing
   ===================================================================== */

// ---------- 1. Cleaning ----------
const HIDDEN_RE = /[​-‍⁠-⁤﻿­᠎]/g;
const SPACE_RE = /[  -   　]/g;
const HOMO = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ӏ": "l", "һ": "h", "ԛ": "q", "ԝ": "w",
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "У": "Y", "І": "I", "Ј": "J", "Ѕ": "S",
  "ο": "o", "α": "a", "ν": "v", "ρ": "p", "ι": "i", "Ο": "O", "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ρ": "P", "Τ": "T", "Χ": "X", "Υ": "Y" };
const HOMO_CHARS = new RegExp("[" + Object.keys(HOMO).join("") + "]");
function cleanText(raw) {
  const notes = { hidden: 0, homoglyphs: 0, quotes: 0, spaces: 0, fullwidth: 0 };
  let t = raw.replace(/\r\n?/g, "\n");
  t = t.replace(HIDDEN_RE, () => { notes.hidden++; return ""; });
  t = t.replace(SPACE_RE, () => { notes.spaces++; return " "; });
  t = t.replace(/[！-～]/g, c => { notes.fullwidth++; return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  // fold look-alike letters only inside words that also contain Latin letters (leaves real Russian/Greek alone)
  t = t.replace(/[\p{L}\p{M}]+/gu, w => {
    if (!HOMO_CHARS.test(w) || !/[A-Za-z]/.test(w)) return w;
    return w.replace(/./gu, c => { if (HOMO[c]) { notes.homoglyphs++; return HOMO[c]; } return c; });
  });
  t = t.replace(/[‘’‚‛′]/g, () => { notes.quotes++; return "'"; }).replace(/[“”„‟″]/g, () => { notes.quotes++; return '"'; });
  return { text: t, notes };
}

// ---------- 2. Word and phrase lists ----------
// Words with MEASURED over-use vs human writing (not blog lists). weight ~ strength.
const AI_WORDS = {
  3: ["delve", "delves", "delved", "delving", "tapestry", "camaraderie", "intricate", "intricacies", "underscores", "underscored", "underscoring", "showcasing", "showcases", "testament", "meticulous", "meticulously", "interplay", "unwavering", "multifaceted", "ever-evolving", "dependable"],
  2: ["pivotal", "fostering", "fosters", "vibrant", "enduring", "garnered", "bolstered", "seamless", "seamlessly", "invaluable", "transformative", "resonate", "resonates", "grappling", "nuanced", "notably", "commendable", "palpable", "bustling", "nestled", "realm", "embark", "embarking", "thoughtful", "meaningful", "steady", "solace", "newfound", "embarked", "resilience"],
  1: ["additionally", "furthermore", "moreover", "crucial", "comprehensive", "enhance", "enhancing", "landscape", "navigate", "navigating", "leverage", "leveraging", "valuable", "insights", "profound", "ultimately", "showcase", "underscore", "significant", "essential", "unique", "overall", "amidst"]
};
// [regex, weight, label]
const AI_PHRASES = [
  ["it(?:'s| is) (?:important|worth|crucial|essential) to (?:note|mention|remember|recognize|consider|understand)", 3, "filler hedge"],
  ["it(?:'s| is) worth noting", 2.5, "filler hedge"],
  ["in today's (?:fast-paced|digital|modern|ever-changing|interconnected|world|society)", 3, "stock opener"],
  ["plays? (?:a |an )?(?:crucial|vital|pivotal|key|significant|important|central) role", 3, "importance puffery"],
  ["(?:rich|vibrant) (?:cultural )?(?:heritage|history|tapestry|culture)", 3, "promotional cliché"],
  ["(?:serves|stands) as (?:a|an|the)", 2, "\"serves as\" phrasing"],
  ["(?:is|as|remains|stands as) a (?:testament|reminder) (?:to|of|that)", 3, "importance puffery"],
  ["(?:in summary|to sum up|in essence|all in all)\\b", 2, "summary signpost"],
  ["whether you(?:'re| are) (?:a |an |looking|here|new|just)", 2, "marketing address"],
  ["(?:excited|thrilled|delighted) to (?:share|announce|welcome)", 3, "announcement cliché"],
  ["(?:embark on|begin|start) (?:a|this) (?:new )?(?:chapter|journey)", 2, "announcement cliché"],
  ["what the future holds", 2, "stock phrase"],
  ["a (?:wide|broad|diverse) (?:range|array|variety|spectrum) of", 2, "stock phrase"],
  ["strik(?:e|ing) (?:a|the right) balance", 2, "stock phrase"],
  ["(?:this|that) (?:really )?matters\\b", 3, "\"this matters\" (116× human rate, Opus 5.5)"],
  ["why [\\w'-]+(?: [\\w'-]+){0,3} matters\\b", 3, "\"why X matters\""],
  ["looking ahead\\b", 2.5, "\"looking ahead\""],
  ["adds? (?:another|an extra|a new) layer", 2.5, "\"adds another layer\""],
  ["what comes next", 2, "\"what comes next\""],
  ["rather than simply", 2.5, "\"rather than simply\""],
  ["is (?:more than|not just) (?:a |an |just )?[\\w'-]+(?: [\\w'-]+){0,3}[;,—–]\\s*it(?:'s| is)?\\b", 3, "\"is more than a X, it…\""],
  ["here's (?:the (?:thing|short version|catch)|what(?:'s)? (?:actually )?(?:going on|happening|matters))", 2, "assistant opener"],
  ["(?:short answer|the short version)\\b", 2, "assistant opener"],
  ["let's (?:break (?:this|it) down|dive in|dive into)", 3, "assistant opener"],
  ["the (?:catch|upshot|bottom line|real (?:lesson|question|point)|practical takeaway|key takeaway) (?:is|here)", 2, "assistant framing"],
  ["for (?:generations|years) to come|future generations", 2, "stock phrase"],
  ["the human (?:condition|experience|spirit)", 2, "stock phrase"],
  ["(?:shed(?:s|ding)? light on|pav(?:e|es|ed|ing) the way|set(?:s|ting)? the stage)", 2, "stock phrase"],
  ["(?:deeper|valuable|unique) (?:insights?|understanding)", 2, "stock phrase"],
  ["a (?:sense|feeling) of (?:community|belonging|purpose|unity|wonder|accomplishment)", 2, "stock phrase"],
  ["(?:harness|unlock|unleash)(?:es|ing)? (?:the|its|their|your) (?:full )?(?:power|potential)", 3, "stock phrase"],
  ["navigat(?:e|es|ing) (?:the|these|this) (?:complexit|challeng|landscape|world)", 3, "stock phrase"],
  ["(?:despite|amid) (?:these|the|its|such) challenges", 2, "challenges formula"],
  ["(?:memories|experience) (?:to cherish|that will last)|unforgettable experience|must-visit", 3, "promotional cliché"],
  ["(?:has|have) never been more (?:important|relevant|crucial)", 3, "stock phrase"],
  ["(?:profound|lasting|far-reaching) (?:impact|effects?|implications?)", 2, "importance puffery"],
  ["moral imperative|timeless (?:exploration|tale|story|classic)", 3, "importance puffery"],
  ["may provide|not necessarily|does not (?:establish|guarantee)", 1.5, "hedge phrase (GPT-6 era)"],
  ["perhaps the most|one of the (?:most|best) [\\w'-]+ (?:about|in|of)", 1.5, "superlative framing"],
  ["i hope this (?:helps|was helpful|gives you)|hope that helps\\b", 2.5, "chatbot-style sign-off (people say it too)"],
  ["if you (?:paste|share|send|post|give me|tell me)\\b[^.?!\\n]{0,80}\\bi(?:'ll| can| could)\\b", 2.5, "assistant offer (\"if you paste…, I can…\")"],
  ["the good news is|the (?:downside|upside|trade-off|tradeoff) is (?:that )?", 1.5, "assistant framing (\"the good news is\")"]
];
// Fiction habits (Pangram: "for a long moment", "said quietly", "felt something", "paused", "stared" rose in Opus 5.5)
const FICTION = [
  "for a long moment", "for a moment,? (?:neither|nobody|no one)", "said quietly", "(?:she|he|they|i) said softly", "felt something (?:shift|loosen|settle|break|crack)",
  "something (?:shifted|loosened|settled|cracked) (?:in|inside)", "let out a (?:breath|shaky breath|slow breath)", "(?:a )?breath (?:she|he|i|they) didn't know", "the silence (?:stretched|settled|hung)",
  "(?:heart|pulse) (?:pounding|hammering|racing)", "couldn't quite (?:name|place|explain|shake)", "neither of them (?:moved|spoke)", "something about [^.!?]{1,25} felt (?:wrong|off|different)",
  "the weight of (?:it|the|his|her|their)", "for the first time in (?:years|a long time|weeks|months)", "(?:she|he|i|they) (?:paused|stared)\\b", "a small smile", "the ghost of a smile", "in that moment", "(?:weathered|trembling) hands", "a (?:warm|soft|golden|gentle) (?:glow|light|smile|breeze)", "(?:she|he) whispered", "trembling slightly", "never truly", "(?:she|he|they) realized (?:that )?"
];
const EMAIL_OPEN = ["(?:i )?hope (?:this (?:email|message|note) finds you well|you(?:'re| are) (?:doing )?well|you(?:'ve| have) been well|your week is going well)", "i (?:wanted|am writing) to (?:reach out|follow up|touch base|let you know)", "just (?:wanted to )?(?:following|follow) up", "thank you for (?:reaching out|your (?:email|message|patience))", "i trust this"];
const EMAIL_CLOSE = ["(?:please )?(?:don't|do not) hesitate to (?:reach out|contact|let me know)", "(?:please )?let me know if you have any (?:questions|concerns)", "thank you for your (?:time|consideration|understanding)(?: and (?:consideration|attention|understanding))?", "i look forward to (?:hearing|working|your)", "happy to (?:discuss|help|jump on|chat)", "feel free to reach out"];
const HEDGES = ["may", "might", "could potentially", "can help", "often", "typically", "generally", "tends? to", "it depends", "in many cases", "to some extent", "arguably", "not necessarily", "in some cases", "can vary", "likely"];
const VAGUE = ["(?:some|many|most) (?:experts|researchers|scientists|critics|people|observers|scholars|analysts) (?:say|argue|believe|suggest|agree|note|point out|have noted)",
  "(?:studies|research|evidence|experts) (?:show|shows|suggest|suggests|indicate|indicates|has shown|have shown)", "it is (?:widely|often|generally|commonly) (?:believed|accepted|said|thought|agreed)",
  "(?:critics|observers|commentators) (?:argue|say|have argued)", "according to (?:experts|many|some|research)", "(?:industry|recent) reports (?:suggest|show)"];
const PRAISE = ["amazing", "incredible", "wonderful", "fantastic", "remarkable", "exceptional", "outstanding", "powerful", "innovative", "vibrant", "stunning", "invaluable", "seamless", "impressive", "inspiring", "rewarding", "exciting", "thoughtful", "meaningful", "engaging", "dynamic", "robust", "transformative", "unparalleled", "unforgettable", "breathtaking"];
const TRANSITIONS = ["moreover", "furthermore", "additionally", "in addition", "ultimately", "overall", "in conclusion", "consequently", "notably", "importantly", "in essence", "first and foremost", "crucially"];
const SLANG = ["lol", "lmao", "ngl", "tbh", "idk", "imo", "omg", "btw", "gonna", "wanna", "gotta", "kinda", "sorta", "yeah", "nah", "yep", "dunno", "ya", "haha", "ugh", "meh", "u", "ur", "pls", "thx", "cos", "cuz", "bro", "lowkey", "highkey", "fr", "deadass", "rn", "smh", "istg", "bc"];
const NO_APOS = ["dont", "cant", "wont", "im", "ive", "didnt", "doesnt", "isnt", "wasnt", "thats", "youre", "theyre", "shouldnt", "couldnt", "wouldnt", "havent", "whats", "id", "ill"];
const NOT_PARTICIPLES = new Set(["nothing", "something", "anything", "everything", "morning", "evening", "during", "thing", "things", "king", "string", "spring", "ceiling", "building", "according", "including", "regarding", "concerning", "pending", "following", "notwithstanding", "bring", "sing", "ring", "wing", "sibling", "darling", "pudding", "wedding", "meaning", "feeling", "beginning", "ending", "setting", "settings", "learning", "training", "reading", "writing", "painting", "warning", "padding", "heading", "missing", "opening", "rating", "funding", "housing", "clothing", "lightning", "being"]);

// Near-certain giveaways: text a chatbot leaves behind when its answer is pasted unedited.
const HARD = [
  ["as an ai(?: language)? model|i(?:'m| am) (?:just )?an ai\\b|as a (?:large )?language model", "chatbot self-reference"],
  ["as of my (?:last |latest )?(?:knowledge )?(?:cutoff|cut-off|update|training)", "knowledge-cutoff disclaimer"],
  ["(?:let me know|feel free to (?:ask|let me know)) if you(?:'d| would)? (?:like|want) me to", "chatbot sign-off"],
  ["would you like me to (?:expand|elaborate|revise|adjust|make|add|write|tailor|help|turn|draft|create)", "chatbot offer"],
  ["if you(?:'d)? (?:want|like),? i can (?:also )?(?:turn|make|write|draft|expand|tailor|create|give|help|put)", "chatbot offer (ChatGPT-style)"],
  ["(?:^|\\n|[.!?]\\s+)(?:certainly|absolutely|of course)! ", "chatbot opener"],
  ["great question[!.]", "chatbot opener"],
  ["here(?:'s| is) (?:a |an |the |your )?(?:revised|rewritten|polished|improved|refined|updated|reworded|shorter|longer) (?:version|draft|essay|paragraph)", "chatbot hand-off"],
  ["\\[(?:your |insert |recipient|company name|student name|teacher|name of|date of|today)[^\\]]{0,30}\\]", "unfilled placeholder"],
  ["oaicite|contentreference|turn0(?:search|news|view)\\d*|utm_source=chatgpt\\.com|【\\d+[^】]{0,20}】", "chatbot citation code"],
  ["regenerate response|(?:^|\\n)[ \\t]*copy code[ \\t]*(?=\\n|$)", "pasted chat interface text"]
];

// ---------- 3. Attribution fingerprints ----------
// [regex, weight, label]. Claude: Opus 5.5 / Sonnet 5 and earlier. ChatGPT: GPT-4o → GPT-5.x / 6.
const CLAUDE_FP = [
  ["\\b(?:this|that) (?:really )?matters\\b", 2, "\"this matters\""],
  ["\\bwhy [\\w'-]+(?: [\\w'-]+){0,3} matters\\b", 2, "\"why X matters\""],
  ["\\blooking ahead\\b", 1.5, "\"looking ahead\""],
  ["\\badds? (?:another|an extra) layer", 2, "\"adds another layer\""],
  ["\\bwhat comes next\\b", 1.5, "\"what comes next\""],
  ["\\brather than simply\\b", 2, "\"rather than simply\""],
  ["\\bis more than (?:a |an |just )?[\\w'-]+(?: [\\w'-]+){0,3}[;,—–]\\s*it", 2, "\"is more than a X, it…\""],
  ["\\bin short\\b", 1.5, "\"in short\" (11× more in Opus 5.5)"],
  ["\\bthe core idea\\b", 1.5, "\"the core idea\""],
  ["\\bperhaps the most\\b|\\bthe most (?:popular|powerful)\\b", 1, "\"perhaps the most\""],
  ["\\b(?:dependable|steady|thoughtful)\\b", 1, "dependable / steady / thoughtful"],
  ["\\bbased on (?:the|your|this) (?:text|passage|information|description|excerpt)\\b|\\baccording to the (?:text|passage|excerpt)\\b", 2, "\"based on the text\""],
  ["\\bthe honest answer\\b|\\bgenuinely\\b", 1, "\"genuinely\" / \"the honest answer\" (Opus 5-era)"],
  ["(?:^|[.!?]\\s+)(?:here's|here is) (?:the|what|how|a)\\b", 0.5, "opens with \"Here's\""],
  ["\\bfor a long moment\\b|\\bsaid quietly\\b|\\bfelt something\\b|\\bsomething shifted\\b|\\b(?:she|he|they|i) (?:paused|stared)\\b", 1, "Opus 5.5 fiction habits (\"for a long moment\", \"paused\")"]
];
const GPT_FP = [
  ["\\bcertainly\\b", 1.5, "\"certainly\""],
  ["(?:^|[.!?]\\s+)overall,", 1, "\"Overall,\""],
  ["\\bbelow is\\b|\\bbelow are\\b", 1.5, "\"below is\""],
  ["\\bhere's a (?:breakdown|quick|step-by-step|clear|simple|concise)\\b", 1.5, "\"here's a breakdown\""],
  ["\\bif you(?:'d)? (?:want|like),? i can\\b", 2.5, "\"If you want, I can…\" offer"],
  ["\\bwould you like me to\\b", 2, "\"Would you like me to…\""],
  ["\\babsolutely!|\\bgreat question\\b", 2, "\"Absolutely!\" / \"Great question\""],
  ["\\bhope this (?:email|message) finds you well\\b", 1.5, "\"hope this email finds you well\""],
  ["\\b(?:delve|delves|delving|tapestry|in today's (?:fast-paced|digital))\\b", 1, "GPT-4-era words (delve, tapestry)"],
  ["\\blet's dive (?:in|into)\\b|\\bdive deeper\\b", 1.5, "\"let's dive in\""],
  ["\\bmay provide\\b|\\bnot necessarily\\b|\\bdoes not establish\\b", 1.5, "\"may provide\" / \"not necessarily\" (GPT-6 era)"],
  ["\\bsuch as\\b", 0.4, "\"such as\""],
  ["(?:^|[.!?]\\s+)ultimately,", 1, "\"Ultimately,\""],
  ["\\bplays? (?:a |an )?(?:crucial|vital|pivotal) role\\b|\\bnavigate (?:the|these|online)\\b", 1, "classic ChatGPT essay phrases"],
  ["\\bon the other hand\\b|\\bneither [\\w ]{1,25} nor\\b", 0.5, "balanced \"on one hand / other hand\" framing"],
  ["\\bin that moment\\b|\\b(?:she|he) whispered\\b", 0.75, "ChatGPT fiction habits (\"in that moment\")"]
];

const WORD = /[A-Za-z0-9][A-Za-z0-9'-]*/g;
function paraSplit(t) { return (/\n[ \t]*\n/.test(t) ? t.split(/\n\s*\n/) : t.split("\n")).filter(p => p.trim()); }
function clamp(x, a = 0, b = 1) { return Math.max(a, Math.min(b, x)); }
function nWords(s) { return (s.match(WORD) || []).length; }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function splitSentences(t) {
  return t.replace(/\s+/g, " ").trim().split(/(?<=[.!?])["')\]]?\s+(?=["'(\[]?[A-Z0-9])/).filter(s => s.trim());
}
// sentences with offsets (also breaks on line breaks, so bullets count as sentences)
function sentenceSpans(t) {
  const out = []; const re = /[^.!?\n]+(?:[.!?]+["')\]]?|(?=\n)|$)/g; let m;
  while ((m = re.exec(t))) { if (!m[0].trim()) { if (!m[0].length) re.lastIndex++; continue; } const lead = m[0].search(/\S/); out.push([m.index + lead, m.index + m[0].length]); }
  return out;
}

const WORD_WEIGHT = new Map();
for (const w of Object.keys(AI_WORDS)) for (const x of AI_WORDS[w]) WORD_WEIGHT.set(x, +w);
const WORD_RE = new RegExp("\\b(" + [...WORD_WEIGHT.keys()].sort((a, b) => b.length - a.length).map(escRe).join("|") + ")\\b", "gi");
const PHRASE_RES = AI_PHRASES.map(([s, w, l]) => [new RegExp("\\b" + s, "gi"), w, l]);
const FICTION_RE = new RegExp("\\b(?:" + FICTION.join("|") + ")", "gi");
const EOPEN_RE = new RegExp("\\b(?:" + EMAIL_OPEN.join("|") + ")", "gi");
const ECLOSE_RE = new RegExp("\\b(?:" + EMAIL_CLOSE.join("|") + ")", "gi");
const HEDGE_RE = new RegExp("\\b(?:" + HEDGES.join("|") + ")\\b", "gi");
const VAGUE_RE = new RegExp("\\b(?:" + VAGUE.join("|") + ")", "gi");
const PRAISE_RE = new RegExp("\\b(?:" + PRAISE.join("|") + ")\\b", "gi");
const HARD_RES = HARD.map(([s, l]) => [new RegExp(s, "gi"), l]);
const CLAUDE_RES = CLAUDE_FP.map(([s, w, l]) => [new RegExp(s, "gi"), w, l]);
const GPT_RES = GPT_FP.map(([s, w, l]) => [new RegExp(s, "gi"), w, l]);

// ---------- 4. Feature extraction ----------
function features(text) {
  const wc = nWords(text);
  const sents = splitSentences(text.replace(/^\s*(?:[-*•]|\d+\.)\s+/gm, ""));
  const ns = Math.max(1, sents.length);
  const lens = sents.map(nWords).filter(n => n > 0);
  const per100 = n => n / Math.max(1, wc) * 100;
  const hits = [];
  const add = (start, end, type, label) => hits.push({ start, end, type, label });
  const scan = (re, fn) => { re.lastIndex = 0; let m; while ((m = re.exec(text))) { fn(m); if (!m[0].length) re.lastIndex++; } };
  const lower = text.toLowerCase();
  let m;

  // giveaways
  let hard = 0;
  for (const [re, label] of HARD_RES) scan(re, m => { hard++; const lead = m[0].search(/\S/); add(m.index + Math.max(0, lead), m.index + m[0].length, "hard", label); });

  // measured AI words
  let vocab = 0, vocabN = 0;
  // each word counts at most twice, and everyday tier-1 words (common in student essays) count half
  const seenWord = {};
  scan(WORD_RE, m => { const lw = m[1].toLowerCase(); seenWord[lw] = (seenWord[lw] || 0) + 1; if (seenWord[lw] <= 2) { const wt = WORD_WEIGHT.get(lw) || 1; vocab += wt === 1 ? 0.5 : wt; } vocabN++; add(m.index, m.index + m[0].length, "word", "word AI over-uses (measured)"); });

  // stock phrases
  let phrase = 0, phraseN = 0;
  for (const [re, w, label] of PHRASE_RES) scan(re, m => { phrase += w; phraseN++; add(m.index, m.index + m[0].length, "phrase", label); });

  // negative parallelism  "not X, it's Y" / "isn't X. It's Y" / "not just X, but Y"
  let negpar = 0;
  const NEG = "(?:isn't|is not|wasn't|was not|aren't|are not|doesn't|don't|didn't|won't|it's not|that's not|are never|is never|never truly)";
  const NP = [
    new RegExp("\\b" + NEG + "\\s+(?:just |only |simply |merely |really |about |so much )?[^.!?;:—–\\n]{1,60}?\\s*[—–]\\s*(?:it|they|this|that|it's|they're|that's)\\b", "gi"),
    new RegExp("\\b" + NEG + "\\s+(?:just |only |simply |merely |really |about |so much )?[^.!?;:—–\\n]{1,60}?\\.\\s+(?:It's|It is|It was|They're|That's|This is|Instead|Rather)\\b", "g"),
    new RegExp("\\b" + NEG + "\\s+(?:just |only |simply |merely |really |about )?[^.!?;:—–\\n]{1,60}?[,;]\\s*(?:it's|it is|it was|they're|but rather|but instead)\\b", "gi"),
    /\bnot (?:just|only|simply|merely) (?:a |an |the |about )?[^.!?;\n]{1,50}?[,;—–]\s*(?:but|it's|it is|it was|they're|it)\b/gi,
    /,\s+not\s+(?:the |a |an |your |because |by |just |on |in |for |with )?[\w'-]+(?: [\w'-]+){0,4}[.!?](?:\s|$)/gi
  ];
  for (const re of NP) scan(re, m => { negpar++; add(m.index, m.index + m[0].length, "struct", "\"not X, it's Y\" contrast"); });

  // assistant-style framing sentences
  let frame = 0;
  const FR = /^(?:That's (?:why|the|what|because|all)|This is (?:why|where|what)|Here's|The (?:fix|catch|key|result|answer|problem|trick|reason|point|takeaway|upshot|good news|bad news|short answer|truth|hard part|big one) (?:is|was|isn't|here)|In practice|None of this|Either way|In other words|Put simply|Simply put|In short|Short answer|Most people|Whatever the|Pick one)\b/;
  for (const st of sents) if (FR.test(st)) { frame++; const at = text.indexOf(st.slice(0, 30)); const fm = st.match(FR); if (at >= 0 && fm) add(at, at + fm[0].length, "struct", "assistant-style framing"); }

  // trailing -ing clauses
  let part = 0;
  // lists of -ing words ("reading, writing and drawing") don't count: people write those all the time
  scan(/([A-Za-z]+),\s+([a-z]+ing)\b(?!\s*(?:,|and\b|or\b))/g, m => { if (!NOT_PARTICIPLES.has(m[2]) && !/ing$/i.test(m[1])) { part++; add(m.index + m[0].length - m[2].length, m.index + m[0].length, "struct", "trailing -ing clause"); } });

  // rule of three lists
  let tri = 0; scan(/\b[\w'-]+(?: [\w'-]+){0,2}, [\w'-]+(?: [\w'-]+){0,2},? (?:and|or) [\w'-]+/g, () => tri++);

  // formal transition openers
  let trans = 0;
  scan(new RegExp("(^|[.!?][\"')\\]]?\\s+|\\n)(" + TRANSITIONS.map(escRe).join("|") + ")\\b", "gi"), m => { trans++; const s = m.index + m[1].length; add(s, s + m[2].length, "trans", "formal transition opener"); });

  // summary closers in the last 30% of the text
  let summ = 0;
  const tailStart = Math.floor(text.length * 0.7);
  scan(/(?:^|[.!?]\s+|\n)(in short|in summary|to sum up|in conclusion|overall|the bottom line|tl;dr|all in all|in essence|to summari[sz]e)\b/gi, m => { const s = m.index + m[0].length - m[1].length; if (s >= tailStart) { summ = 1; add(s, s + m[1].length, "struct", "summary closer"); } });

  // fiction habits
  let fiction = 0; scan(FICTION_RE, m => { fiction++; add(m.index, m.index + m[0].length, "phrase", "fiction cliché"); });
  // tidy hopeful ending (last sentence)
  const lastS = (sents[sents.length - 1] || "").toLowerCase();
  const narrative = fiction > 0 || (text.match(/"[^"\n]{3,}"/g) || []).length >= 2;
  const hopeEnd = narrative && /\b(?:for the first time|began to (?:smile|laugh|hope|heal|believe)|smiled|finally (?:felt|knew|understood)|(?:maybe(?:,)? |and )?(?:that|this) was enough|was (?:a|the) (?:start|beginning)|(?:felt|feel) like home|hope\b|together\b|light\b|took (?:a|one) (?:step|breath)|began to read|whatever came next)\b/.test(lastS) ? 1 : 0;

  // email boilerplate
  let eopen = 0, eclose = 0;
  scan(EOPEN_RE, m => { eopen++; add(m.index, m.index + m[0].length, "phrase", "email boilerplate opener"); });
  scan(ECLOSE_RE, m => { eclose++; add(m.index, m.index + m[0].length, "phrase", "email boilerplate closer"); });
  const email = Math.min(eopen, 1) + Math.min(eclose, 2) + (eopen && eclose ? 1 : 0);

  // hedging, vague attributions, generic praise
  let hedge = 0; scan(HEDGE_RE, () => hedge++);
  let vague = 0; scan(VAGUE_RE, m => { vague++; add(m.index, m.index + m[0].length, "phrase", "vague attribution (who?)"); });
  let praise = 0; scan(PRAISE_RE, () => praise++);

  // punctuation and formatting
  const colons = (text.match(/[A-Za-z)\]"'*]:\s/g) || []).length;
  const dashes = (text.match(/—|\s–\s/g) || []).length;
  const lines = text.split("\n").filter(l => l.trim());
  const bullets = lines.filter(l => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(l)).length;
  // "Introduction:" / "Body Paragraph 1:" / "Conclusion:" labels, which ChatGPT puts on essays
  const sectionLabels = lines.filter(l => /^\s*(?:introduction|conclusion|body(?: paragraphs?)?(?: \d+)?|thesis(?: statement)?|title)\s*:/i.test(l)).length;
  const headings = sectionLabels + lines.filter(l => /^#{1,4}\s+\S/.test(l) || (/^[A-Z][^.!?]{2,60}$/.test(l.trim()) && l.trim().split(/\s+/).length <= 8 && lines.length > 3 && /^(?:[A-Z][\w'-]*\s?)+$/.test(l.trim()))).length;
  const bolds = (text.match(/\*\*[^*\n]{2,60}\*\*/g) || []).length;
  const boldLabels = lines.filter(l => /^\s*(?:[-*•]|\d+[.)])?\s*\*\*[^*\n]{1,40}:?\*\*:?/.test(l)).length;
  const emoji = (text.match(/[\u{1F300}-\u{1FAFF}\u{2705}\u{2728}\u{274C}\u{2B50}]/gu) || []).length;
  scan(/\*\*[^*\n]{2,60}\*\*|^#{1,4} .+$/gm, m => add(m.index, m.index + m[0].length, "struct", "Markdown formatting"));
  const fmt = bullets * 0.5 + headings + bolds + boldLabels + emoji;
  const listShare = lines.length ? bullets / lines.length : 0;

  // rhythm and shape
  let cv = 0.5, extreme = 0, avgLen = 0;
  if (lens.length >= 3) {
    avgLen = lens.reduce((a, b) => a + b, 0) / lens.length;
    cv = Math.sqrt(lens.reduce((a, b) => a + (b - avgLen) ** 2, 0) / lens.length) / avgLen;
    extreme = lens.filter(n => n >= 45 || n <= 3).length / lens.length;
  } else if (lens.length) avgLen = lens.reduce((a, b) => a + b, 0) / lens.length;
  const paraTexts = paraSplit(text);
  const paras = text.split(/\n\s*\n/).map(p => nWords(p)).filter(n => n >= 8);   // evenness uses blank-line paragraphs only (as in v5)
  let paraCv = 1;
  if (paras.length >= 3) { const pm = paras.reduce((a, b) => a + b, 0) / paras.length; paraCv = Math.sqrt(paras.reduce((a, b) => a + (b - pm) ** 2, 0) / paras.length) / pm; }

  // human slips and casual markers
  const slang = (lower.match(new RegExp("\\b(" + SLANG.map(escRe).join("|") + ")\\b", "g")) || []).length;
  const noApos = (lower.match(new RegExp("\\b(" + NO_APOS.join("|") + ")\\b", "g")) || []).length;
  const lowerI = (text.match(/(?:^|\s)i(?=[\s,.'!?])/g) || []).length;
  const lowerStart = sents.filter(s => /^[a-z]/.test(s)).length;
  const shout = (text.match(/!{2,}|\?{2,}|\?!|!\?|:\)|:\(|:D|;\)|\bx{2,}\b/g) || []).length;
  const doubleSpace = (text.match(/[a-z.,] {2,}[a-zA-Z]/g) || []).length;
  const lastLine = text.trim().split("\n").pop() || "";
  const missingFinal = /[a-z0-9]$/i.test(lastLine) && nWords(lastLine) > 6 ? 1 : 0;
  const slipsN = noApos + lowerI + shout + slang + doubleSpace + lowerStart + missingFinal;
  const slips = noApos * 2 + lowerI * 2 + lowerStart * 0.5 + shout + slang + doubleSpace + missingFinal;
  const casual = (lower.match(/\b(?:honestly|like,|kind of|sort of|pretty much|i guess|i reckon|i think|you know|basically|literally|to be honest|whatever)\b/g) || []).length;
  const contr = (lower.match(/\b\w+n't\b|\b\w+'(?:re|ve|ll|m|d)\b|\b(?:it|that|there|what|here|let|he|she|who)'s\b/g) || []).length;
  const excl = (text.match(/[!?]/g) || []).length;

  // generic moral / summary ending
  const wrap = /\b(ultimately|in the end|at the end of the day|for generations|future generations|remains (?:a|one)|timeless|journey|key to|it depends|depends (?:on )?how|balance|made me (?:think|realise|realize)|taught me|reminder|worth (?:it|noticing|remembering)|you'll notice|give it|what matters|matters most|the (?:simple|little) things)\b/.test(lastS) ? 1 : 0;

  // concrete specifics: digits, names mid-sentence, quoted speech
  const digits = (text.match(/\b\d[\d,.:%]*\b/g) || []).length;
  const names = (text.match(/(?<=[a-z,;] )[A-Z][a-z]{2,}/g) || []).length;
  const quotes = (text.match(/"[^"\n]{3,}"/g) || []).length;
  const specifics = per100(digits + names + quotes);
  const lowSpec = wc >= 120 && specifics < 1.2 ? 1 : 0;

  // composites
  const even = (lens.length >= 6 && cv < 0.38 ? 0.5 : 0) + (paras.length >= 3 && paraCv < 0.22 ? 0.3 : 0) + (excl === 0 && slipsN === 0 && wc >= 120 ? 0.2 : 0);
  // casual-sounding but suspiciously clean and generic (the "write like a teen" case)
  const casualStrong = (lower.match(/\b(?:honestly|like,|kind of|sort of|pretty much|i guess|i reckon|you know|basically|literally|to be honest|whatever)\b/g) || []).length;
  // Opus 5.5 "answer shape": habits measured on real Opus 5.5 answers vs 2,281 human texts.
  // Each one alone is common enough in human writing; 2+ together were rare, and 3+ never seen in humans.
  //  - label-style paragraphs: "Storage. Solar produces nothing at night…" (a short verbless label, a full stop, then the point)
  //  - a colon line introducing a plain list
  //  - a one-sentence opening paragraph that answers straight away, followed by 3+ more paragraphs
  //  - "that's why" / "which is why"
  //  - "the good news is", "the downside is", "a quick way to decide:", "depends mostly on"
  const LABEL_RE = /^[ \t]*(?:[-*•][ \t]*|\d+[.)][ \t]*)?([A-Z][a-z'’-]+(?:[ \t]+[a-z][\w'’()-]*){0,4})\.[ \t]+(?=[A-Z][^\n]{25,})/gm;
  const NOT_LABEL = /\b(?:is|are|was|were|be|been|am|has|have|had|do|does|did|can|could|will|would|should|may|might|must|i|you|he|she|it|we|they|me|him|her|them|us|my|his|their|our|your|this|that|there|here|not|no|yes|yeah|oh|ok|okay|well|so|then|now|just|said|says|thanks|thank|please|sorry|hello|hi|hey|mr|mrs|ms|dr|st|fell|froze|stood|sat|woke|ran|came|took|saw|felt|knew|thought|left|began|turned|looked|smiled|nodded|shook)\b|\w(?:ed|ly)\b/i;
  const labels = [];
  scan(LABEL_RE, m => { if (!NOT_LABEL.test(m[1])) labels.push([m.index + m[0].indexOf(m[1]), m[1].length]); });
  const shapeLabel = labels.length >= 2 ? 1 : 0;
  if (shapeLabel) for (const [a, n] of labels) add(a, a + n + 1, "struct", "label-style paragraph opener (Opus 5.5 habit)");
  const shapeList = /[a-z)][ \t]*:[ \t]*\n(?:[ \t]*\n)?[ \t]*(?:[-*•]|\d+[.)])[ \t]+\S[^\n]*\n[ \t]*(?:[-*•]|\d+[.)])[ \t]+\S/.test(text) ? 1 : 0;
  const p0 = (paraTexts[0] || "").trim();
  const shapeOpener = paraTexts.length >= 4 && !/^(?:hi|hey|dear|hello|good (?:morning|afternoon|evening)|subject|to whom)\b/i.test(p0) && !/,$/.test(p0)
    && (p0.match(/[.!?](?=\s|$)/g) || []).length === 1 && /\.$/.test(p0) && nWords(p0) >= 6 && nWords(p0) <= 28 ? 1 : 0;
  const shapeWhy = /\b(?:that's|which is|this is) (?:also |exactly )?why\b/i.test(text) ? 1 : 0;
  const shapeFrame = /\b(?:the good news is|the (?:downside|upside|trade-off|tradeoff|catch) is|a (?:simple|quick|handy|good|easy) (?:way|rule|shortcut|plan|test)\b[^.\n]{0,30}:|depends (?:mostly |largely |mainly )?on\b)/i.test(text) ? 1 : 0;
  const shapeN = shapeLabel + shapeList + shapeOpener + shapeWhy + shapeFrame;
  const shape = shapeN >= 3 ? shapeN - 1 : shapeN === 2 ? 0.3 : 0;   // 2 habits: a nudge; 3+: strong
  // ---- Edited-AI check ----
  // AI text that a person has "humanised": an AI explanation skeleton under a casual surface.
  // Measured on 15 edited Opus 5.5 answers vs 2,281 human texts (tests/data/opus55/refined_*.txt).
  const edHumanEv = [], edSkelEv = [];
  if (/\b(?:heaps|tbh|lol|honestly|kind of|kinda|pretty (?:cool|much|good|bad|sure)|basically|super \w+|way (?:more|less|faster|cleaner|better|bigger)|ngl|i reckon)\b/.test(lower)) edHumanEv.push("casual words (\"heaps\", \"tbh\", \"basically\")");
  if (/\b(?:thats|cant|dont|didnt|doesnt|isnt|wasnt|im|ive|theres|whats|wont|couldnt|wouldnt)\b/.test(lower)) edHumanEv.push("dropped apostrophes (\"thats\", \"cant\")");
  if (/(?:^|[.!?]\s+)(?:my (?:mum|mom|dad|parents|little |big |older |younger )?(?:sister|brother|mum|mom|dad|parents|best friend|friend|teacher|nan|grandma|family)\b|we went to|at my (?:old )?school|in our (?:prac|class|lesson)|on our (?:year \d+ )?(?:camp|excursion|trip))/.test(lower)) edHumanEv.push("a personal story dropped into an explanation");
  const SKEL = [
    [/\b(?:there(?:'?s| is| are| were)?|by|into|of) (?:two|three|four|five|a few|several|different) (?:(?:main|key|big|different|long[ -]term|short[ -]term|important) ){0,2}(?:stages|causes|reasons|types|ways|kinds|parts|steps|factors|sizes|options|things|problems|sides)\b/gi, "\"there are three main causes\"-style list"],
    [/\b(?:which|that)(?:'?s| is) (?:also )?why\b/gi, "\"that's why\""],
    [/\b(?:on the (?:positive|plus|good) side|a good thing about|the (?:main|biggest|strongest) (?:reason|argument|thing)|the (?:downside|upside|catch|trade-off) is|but there are (?:bad|real|some) (?:sides|downsides)|has good and bad sides|but there (?:were|was|are|is) (?:also )?(?:bad|good|darker|negative|positive|real) (?:parts|sides?|things|effects)|if you(?:'?re| are) (?:not sure|unsure|still not sure))\b/gi, "balanced \"good side / bad side\" or decision-rule framing"]
  ];
  for (const [re, label] of SKEL) { let hit = false; scan(re, m => { hit = true; add(m.index, m.index + m[0].length, "struct", "leftover AI structure (" + label + ")"); }); if (hit) edSkelEv.push(label); }
  const firstSent = (text.trim().split(/(?<=[.!?])\s/)[0] || "");
  if (/^[A-Z][\w' -]{2,40} (?:is|are|means) (?:when|how|somewhere|something|the (?:process|idea|way)|a |an |what )/.test(firstSent)) edSkelEv.push("opens with a textbook definition");
  if (shapeN >= 1) edSkelEv.push("an Opus 5.5 answer-shape habit");
  if (vocabN + phraseN >= 1) edSkelEv.push("AI-favoured words or stock phrases");
  const edNarr = (lower.match(/\b(?:i|we|he|she) (?:was|were|had|said|went|looked|saw|got)\b/g) || []).length >= 3;
  const edH = edHumanEv.length, edS = edSkelEv.length;
  const edited = edNarr ? 0 : edH >= 2 && edS >= 2 ? 2 : (edH >= 2 && edS >= 1) || (edH >= 1 && edS >= 3) ? 1 : 0;
  const tooClean = (casualStrong + slang >= 2 || (contr >= 4 && casualStrong + slang >= 1)) && slipsN === 0 && lens.length >= 6 && cv < 0.55 && (wrap || hopeEnd) ? 1 : 0;

  return {
    wc, ns, hits, sents,
    f: {
      hard, vocab: per100(vocab), phrase: per100(phrase), negpar: negpar / ns, frame: frame / ns, part: part / ns, tri: tri / ns, trans: trans / ns,
      summ, fiction: per100(fiction), hopeEnd, email, hedge: per100(hedge), vague: per100(vague), praise: per100(praise),
      colon: per100(colons), dash: per100(dashes), fmt: per100(fmt), cv, extreme, slips: per100(slips), wrap, lowSpec, even, tooClean, shape
    },
    counts: {
      hard, vocab: vocabN, phrase: phraseN, negpar, frame, part, tri, trans, summ, fiction, hopeEnd, email, eopen, eclose, hedge, vague, praise, colons, dashes,
      bullets, headings, bolds, boldLabels, emoji, listShare, sentences: lens.length, avgLen, cv, paraCv, paras: paras.length, minLen: lens.length ? Math.min(...lens) : 0,
      maxLen: lens.length ? Math.max(...lens) : 0, slips: slipsN, casual, contr, specifics, digits, names, quotes, wrap, excl,
      spacedDash: (text.match(/\s—\s/g) || []).length, tightDash: (text.match(/\w—\w/g) || []).length,
      shapeN, shapeLabel, shapeList, shapeOpener, shapeWhy, shapeFrame, labels: labels.length,
      edited, edHumanEv, edSkelEv
    }
  };
}

// ---------- 5. Scoring model ----------
// Logistic model. Weights were first hand-set from the research, then (v5) re-fitted on real text:
// 1,000+ human texts (student essays, Reddit stories, news, English-learner essays) and real
// ChatGPT/Claude output from the Ghostbuster dataset, plus this repo's own corpus. The fit counted
// each human text 3x and kept every clue's direction. The final weights are 70% hand-set + 30% fitted
// (so they don't over-fit 2023-era chatbots), with the bias set so fewer humans are flagged than in v4.
// See tests/eval_ghostbuster.js.
const MODEL = { bias: -2.0, w: {
  hard: 2.5, vocab: 0.59, phrase: 0.62, negpar: 2.49, frame: 3.0, part: 2.36, tri: 0.62, trans: 2.78,
  summ: 0.65, fiction: 0.97, hopeEnd: 0.34, email: 0.56, hedge: 0.08, vague: 1.21, praise: 0.27,
  colon: 0.14, dash: 0.29, fmt: 0.28, cv: -1.0, extreme: -2.21, slips: -0.87, wrap: 0.86, lowSpec: 0.27, even: 0.68, tooClean: 1.01, shape: 1.5
}, cap: { shape: 3, hard: 3, vocab: 6, phrase: 6, negpar: 0.5, frame: 0.5, part: 0.6, tri: 0.6, trans: 0.5, fiction: 3, email: 4, hedge: 6, vague: 2, praise: 6, colon: 3, dash: 3, fmt: 6, slips: 6 } };

function scoreFeatures(f) {
  let z = MODEL.bias; const contrib = {};
  for (const k in MODEL.w) { const v = Math.min(f[k], MODEL.cap[k] ?? Infinity); contrib[k] = MODEL.w[k] * v; z += contrib[k]; }
  return { p: 1 / (1 + Math.exp(-z)), z, contrib };
}

const BANDS = { human: 35, ai: 55 };   // below 35 = human-leaning, 35-55 = inconclusive, 55+ = AI-leaning

function analyze(text, opts = {}) {
  const wc = nWords(text);
  if (wc < 40) return { tooShort: true, wc };
  const F = features(text);
  const { p, contrib } = scoreFeatures(F.f);
  // short texts are pulled towards the middle: less text, less evidence
  const conf = opts.noShrink ? 1 : clamp((wc - 40) / 260, 0, 1);
  const prob = 0.5 + (p - 0.5) * (0.5 + 0.5 * conf);
  const score = Math.round(prob * 100);
  const hs = F.hits.slice().sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const clean = []; let last = -1;
  for (const h of hs) if (h.start >= last) { clean.push(h); last = h.end; }
  let band = score < BANDS.human ? "human" : score < BANDS.ai ? "inconclusive" : "ai";
  if (F.counts.hard && score >= 45) band = "ai";
  // strong edited-AI signs lift a human-leaning text into the inconclusive range (never to AI-leaning)
  let finalScore = score;
  if (F.counts.edited === 2 && band !== "ai") { finalScore = Math.max(score, 45); band = "edited"; }
  return { score: finalScore, rawScore: score, band, f: F.f, counts: F.counts, contrib, hits: clean, wc, conf };
}

// ---------- 6. Claude vs ChatGPT attribution ----------
function attribute(text, r) {
  const c = r.counts, ev = { claude: [], gpt: [] };
  let cl = 0, gp = 0;
  const run = (res, side) => { for (const [re, w, label] of res) { re.lastIndex = 0; const n = (text.match(re) || []).length; if (n) { const s = Math.min(n, 3) * w; if (side === "c") { cl += s; ev.claude.push(label + (n > 1 ? ` ×${n}` : "")); } else { gp += s; ev.gpt.push(label + (n > 1 ? ` ×${n}` : "")); } } } };
  run(CLAUDE_RES, "c"); run(GPT_RES, "g");
  // formatting fingerprints (Sun et al. 2025): ChatGPT bolds list labels and titles answers; Claude uses plain lists
  if (c.boldLabels >= 2) { gp += 2; ev.gpt.push(`bold labels on list items ×${c.boldLabels}`); }
  else if (c.bolds >= 3) { gp += 1; ev.gpt.push(`lots of bold text ×${c.bolds}`); }
  if (c.headings >= 2) { gp += 1; ev.gpt.push("section headers"); }
  if (c.emoji >= 1) { gp += 1.5; ev.gpt.push("emoji"); }
  if (c.bullets >= 3 && c.bolds === 0 && c.headings === 0) { cl += 1.5; ev.claude.push("plain bullet list with no bold"); }
  // dash style: Sonnet-style spaced " — " vs OpenAI-style "word—word" (weak; newer models vary)
  if (c.spacedDash >= 2 && c.spacedDash > c.tightDash) { cl += 1; ev.claude.push("spaced em dashes ( — )"); }
  if (c.tightDash >= 1 && c.tightDash > c.spacedDash) { gp += c.tightDash >= 2 ? 1 : 0.5; ev.gpt.push("unspaced em dashes (word—word)"); }
  // Opus 5.5 answer shape (measured on real Opus 5.5 answers in tests/data/opus55)
  if (c.shapeN >= 2) {
    const parts = [c.shapeLabel && "label-style paragraphs", c.shapeList && "colon then plain list", c.shapeOpener && "one-sentence opening answer", c.shapeWhy && "\"that's why\"", c.shapeFrame && "\"the good news is\" / \"depends on\""].filter(Boolean);
    cl += c.shapeN; ev.claude.push(`Opus 5.5 answer shape: ${parts.join(", ")}`);
  }
  if (/\bif you (?:paste|share|send|post|give me|tell me)\b[^.?!\n]{0,80}\bi(?:'ll| can| could)\b/i.test(text)) { cl += 1.5; ev.claude.push("offers to look at your work (\"if you paste…, I can…\")"); }
  // shape: Opus 5.5 writes short, even sentences (~10-13 words)
  if (c.sentences >= 6 && c.avgLen >= 8 && c.avgLen <= 13.5 && c.cv < 0.5) { cl += 1; ev.claude.push(`short, even sentences (avg ${c.avgLen.toFixed(0)} words)`); }
  if (c.sentences >= 6 && c.avgLen >= 19) { gp += 0.5; ev.gpt.push(`long sentences (avg ${c.avgLen.toFixed(0)} words)`); }
  const total = cl + gp, margin = cl - gp;
  let lean = "unclear";
  if (total >= 2 && Math.abs(margin) >= 1.5) lean = margin > 0 ? "claude" : "chatgpt";
  const confidence = lean === "unclear" ? "none" : (Math.abs(margin) >= 4 && total >= 5 ? "medium" : "low");
  return { claude: cl, gpt: gp, lean, confidence, ev };
}

// ---------- 6b. Suspected AI (shown at the end of every result) ----------
// Turns the score and the Claude-vs-ChatGPT clues into one plain answer, including a version hint.
function suspect(text, r, a) {
  const c = r.counts, lower = text.toLowerCase();
  const dashRate = r.wc ? c.dashes / r.wc * 1000 : 0;
  if (c.edited === 2 && r.score < 55 && !c.hard) {
    const who = a.lean === "claude" || c.shapeN >= 1 ? "The leftover structure looks most like Claude (Opus 5.5)." : a.lean === "chatgpt" ? "The leftover structure looks most like ChatGPT." : "Not enough clues to say which AI.";
    return { short: "edited AI?", label: "Possibly AI that a person has edited", detail: `Casual touches sit on top of an AI-style explanation skeleton (see the edited-AI check). ${who} Students writing casually can also look like this, so treat it as a reason to ask questions, not as proof.`, version: "edited", confidence: "low" };
  }
  const looksAI = r.score >= 55 || c.hard > 0;
  const maybeAI = r.score >= 35 || r.band === "mixed";
  const lean = a.lean;
  let name = null, version = "", why = "";
  if (lean === "claude") {
    const old = /\bgenuinely\b|\bthe honest answer\b|\bmatters enormously\b/.test(lower) || dashRate >= 3;
    name = old ? "Claude (older version, like Opus 5 or Sonnet)" : "Claude Opus 5.5 (or another recent Claude)";
    version = old ? "claude-old" : "claude-opus-5.5";
    why = old ? "Claude-style habits, plus em dashes or \"genuinely\", which older Claude versions used far more than Opus 5.5." : "Claude-style habits with almost no em dashes, which fits Opus 5.5.";
  } else if (lean === "chatgpt") {
    if (/\bmay provide\b|\bnot necessarily\b|\bdoes not establish\b/.test(lower)) { name = "ChatGPT (GPT-5 / GPT-6 era)"; version = "gpt-new"; why = "ChatGPT-style habits plus hedges like \"may provide\" and \"not necessarily\" that newer GPT models overuse."; }
    else if (/\bdelv(?:e|es|ing)\b|\btapestry\b|\bin today's (?:fast-paced|digital)\b|\btestament to\b/.test(lower)) { name = "ChatGPT (older, GPT-4-style)"; version = "gpt-old"; why = "ChatGPT-style habits plus words like \"delve\" and \"tapestry\" from the GPT-4 era."; }
    else { name = "ChatGPT, or a model that writes like it (Gemini, Grok, DeepSeek…)"; version = "gpt"; why = "ChatGPT-style habits. Many other models write the same way."; }
  }
  const SHORT = { "claude-old": "older Claude", "claude-opus-5.5": "Claude Opus 5.5", "gpt-new": "ChatGPT (GPT-5/6)", "gpt-old": "ChatGPT (GPT-4 style)", gpt: "ChatGPT-like" };
  const edNote = c.edited === 1 ? ` A few signs of edited AI were found (${c.edHumanEv.concat(c.edSkelEv).join(", ")}), but not enough to suspect it.` : "";
  if (!looksAI && !maybeAI) return { short: "none", label: "No AI suspected", detail: (name ? `Few AI habits overall. If AI was used, the closest match is ${name}.` : "Few AI habits, and no model-specific clues.") + edNote, version: "none", confidence: "none" };
  if (!name) return { short: looksAI ? "AI, unclear which" : "can't tell", label: looksAI ? "An AI model, but it's not clear which" : "Can't tell", detail: looksAI ? "Many AI habits, but no clear Claude or ChatGPT clues. It could be another model, or edited text." : r.band === "mixed" ? "Part of the text shows many AI habits, but there aren't enough model-specific clues to say which AI." : "Not enough evidence of AI, and no model stands out.", version: "unknown", confidence: "none" };
  return { short: SHORT[version], label: name, detail: why + (looksAI ? "" : " The overall score is inconclusive, so this is only a possibility."), version, confidence: looksAI ? a.confidence : "low" };
}

// ---------- 7. Long texts: sections and sliding window ----------
function segments(text, target = 110) {
  if (nWords(text) < 220) return [];
  const spans = []; const paraRe = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g; let m;
  while ((m = paraRe.exec(text))) if (nWords(m[0]) > 0) spans.push([m.index, m.index + m[0].length]);
  let units = spans;
  if (spans.length < 3) units = sentenceSpans(text);
  const segs = []; let cur = null;
  for (const [a, b] of units) {
    if (!cur) cur = [a, b]; else cur[1] = b;
    if (nWords(text.slice(cur[0], cur[1])) >= (spans.length >= 3 ? 60 : target)) { segs.push(cur); cur = null; }
  }
  if (cur) { if (segs.length && nWords(text.slice(cur[0], cur[1])) < 50) segs[segs.length - 1][1] = cur[1]; else segs.push(cur); }
  if (segs.length < 2) return [];
  return segs.map(([a, b]) => { const r = analyze(text.slice(a, b)); return { start: a, end: b, score: r.tooShort ? null : r.score }; });
}
// Sliding window over sentences (~90 words, half-overlapping). Each sentence gets the average
// score of the windows that contain it, so one pasted AI paragraph stands out from the rest.
function slidingWindow(text, size = 90) {
  const ss = sentenceSpans(text);
  if (nWords(text) < 200 || ss.length < 6) return null;
  const wins = [];
  for (let i = 0; i < ss.length;) {
    let j = i, n = 0;
    while (j < ss.length && n < size) { n += nWords(text.slice(ss[j][0], ss[j][1])); j++; }
    if (n >= 50) { const r = analyze(text.slice(ss[i][0], ss[j - 1][1]), { noShrink: true }); wins.push({ i, j, score: r.score }); }
    if (j >= ss.length) break;
    i += Math.max(1, Math.floor((j - i) / 2));
  }
  if (wins.length < 2) return null;
  const sent = ss.map(([a, b], k) => { const cover = wins.filter(w => k >= w.i && k < w.j); return { start: a, end: b, score: cover.length ? Math.round(cover.reduce((s, w) => s + w.score, 0) / cover.length) : null }; });
  return { sentences: sent, max: Math.max(...wins.map(w => w.score)), min: Math.min(...wins.map(w => w.score)) };
}

// Mixed-text check: does one paragraph stand out as much more AI-like than the rest?
// v8: the old rule (any ~90-word window ≥70 plus one ≤35) labelled 76 of 2,046 real human texts "Mixed",
// including 12% of student essays. Now one paragraph (not the last, since conclusions naturally sound
// like summaries) must score 70+ AND be 40+ points above the median of the other paragraphs.
// Real humans labelled mixed: 5 of 2,046. Real essays with a pasted ChatGPT/Claude paragraph: 22 of 193.
const MIXED_RULE = { para: 70, gap: 40, minParaWords: 40 };
function mixedCheck(text, r) {
  const none = { mixed: false };
  if (r.tooShort || r.band === "ai") return none;
  const paras = []; let from = 0;
  for (const p of paraSplit(text)) { const at = text.indexOf(p, from); if (at < 0) continue; from = at + p.length; if (nWords(p) >= MIXED_RULE.minParaWords) paras.push({ start: at, end: at + p.length, score: analyze(p).score }); }
  if (paras.length < 3) return none;
  let best = null;
  for (let i = 0; i < paras.length - 1; i++) {
    const others = paras.filter((_, j) => j !== i).map(p => p.score).sort((a, b) => a - b);
    const median = others[Math.floor(others.length / 2)];
    if (paras[i].score >= MIXED_RULE.para && paras[i].score - median >= MIXED_RULE.gap && (!best || paras[i].score > best.score)) best = Object.assign({ median }, paras[i]);
  }
  return best ? { mixed: true, para: best } : none;
}

// ---------- 8. Fairness cautions ----------
function cautions(r) {
  const c = r.counts, out = [];
  if (c.contr === 0 && c.casual === 0 && c.avgLen >= 17 && r.wc >= 100) out.push("This is formal writing. Careful, formal human writing (essays, reports, documentation) shares some habits with AI, so give this score less weight.");
  if (c.sentences >= 5 && c.avgLen <= 10 && c.slips === 0) out.push("This writing is very plain and simple. Plain writing, including writing by people using English as a second language, is often wrongly flagged by detectors. This tool doesn't score vocabulary or word length, but treat the result with extra caution.");
  if (c.listShare >= 0.3) out.push("This text is mostly a list. Notes, instructions and slides written by people are often list-heavy too, so formatting clues count for less here.");
  if (c.edited === 2) out.push("Possible edited AI: this text mixes casual touches with an AI-style explanation skeleton. Real students writing a school answer in a casual voice can look like this too, so this alone never makes the result AI-leaning.");
  if (r.wc < 150) out.push("This is a short text. Under about 150 words there isn't much evidence either way, so the score has been pulled towards the middle.");
  return out;
}
// ---------- style comparison (authorship check) ----------
// Stylometric profile + Burrows' Delta comparison
const FW = ["the","of","and","to","a","in","that","is","was","it","for","on","with","as","i","he","she","they","we","you","be","at","by","this","had","not","but","from","or","have","an","which","so","if","there","what","all","my","would","can","their","about","just","also","very","really","because","then","more","when","like","do","some","these","been","could","into","than","only","such","while","however","our","me","will","are","were"];
function profile(text) {
  const t = text.replace(/[’‘]/g, "'");
  const words = (t.toLowerCase().match(/[a-z][a-z']*/g) || []);
  const n = Math.max(1, words.length);
  const freq = {}; for (const w of FW) freq[w] = 0;
  for (const w of words) if (w in freq) freq[w]++;
  for (const w of FW) freq[w] = freq[w] / n * 100;
  const sents = t.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/).filter(s => /[a-z]/i.test(s));
  const lens = sents.map(s => (s.match(/[A-Za-z0-9']+/g) || []).length);
  const mean = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, lens.length));
  // moving-average type-token ratio (window 50)
  let mattr = 0, k = 0; for (let i = 0; i + 50 <= words.length; i += 10) { mattr += new Set(words.slice(i, i + 50)).size / 50; k++; }
  const per100 = re => (t.match(re) || []).length / n * 100;
  return {
    n, freq,
    style: {
      sentLen: mean, sentVar: mean ? sd / mean : 0,
      wordLen: words.reduce((a, w) => a + w.length, 0) / n,
      mattr: k ? mattr / k : 0,
      contr: per100(/\b\w+n't\b|\b\w+'(?:re|ve|ll|m|d|s)\b/gi),
      firstPerson: per100(/\b(?:i|me|my|mine)\b/gi),
      commas: per100(/,/g), dashes: per100(/—|\s–\s|\s-\s|--/g), excl: per100(/!/g), ques: per100(/\?/g), paren: per100(/\(/g), semis: per100(/;/g)
    }
  };
}

// Function-word means/SDs per 100 words, measured on the human test corpus.
const FW_STATS = {"mu": {"the": 7.263, "of": 2.55, "and": 2.259, "to": 2.874, "a": 2.722, "in": 1.673, "that": 1.114, "is": 2.5, "was": 0.231, "it": 1.025, "for": 1.107, "on": 0.439, "with": 0.737, "as": 0.88, "i": 0.175, "he": 0.054, "she": 0.015, "they": 0.152, "we": 0.133, "you": 0.772, "be": 1.209, "at": 0.261, "by": 0.726, "this": 0.873, "had": 0.028, "not": 0.65, "but": 0.23, "from": 0.462, "or": 0.888, "have": 0.223, "an": 0.633, "which": 0.403, "so": 0.229, "if": 1.175, "there": 0.151, "what": 0.051, "all": 0.35, "my": 0.049, "would": 0.068, "can": 0.595, "their": 0.172, "about": 0.103, "just": 0.059, "also": 0.255, "very": 0.072, "really": 0.017, "because": 0.034, "then": 0.235, "more": 0.215, "when": 0.366, "like": 0.091, "do": 0.135, "some": 0.163, "these": 0.16, "been": 0.069, "could": 0.043, "into": 0.149, "than": 0.117, "only": 0.204, "such": 0.114, "while": 0.081, "however": 0.034, "our": 0.031, "me": 0.035, "will": 0.653, "are": 0.776, "were": 0.122}, "sd": {"the": 3.263, "of": 2.384, "and": 1.711, "to": 1.851, "a": 1.873, "in": 1.407, "that": 1.138, "is": 2.1, "was": 0.772, "it": 1.195, "for": 1.125, "on": 0.78, "with": 0.865, "as": 1.014, "i": 0.67, "he": 0.339, "she": 0.15, "they": 0.367, "we": 0.531, "you": 1.387, "be": 1.18, "at": 0.61, "by": 0.918, "this": 0.99, "had": 0.199, "not": 0.891, "but": 0.431, "from": 0.76, "or": 1.142, "have": 0.45, "an": 0.942, "which": 0.697, "so": 0.449, "if": 1.288, "there": 0.38, "what": 0.234, "all": 0.622, "my": 0.354, "would": 0.269, "can": 0.919, "their": 0.502, "about": 0.347, "just": 0.229, "also": 0.457, "very": 0.244, "really": 0.15, "because": 0.24, "then": 0.538, "more": 0.507, "when": 0.633, "like": 0.277, "do": 0.33, "some": 0.435, "these": 0.392, "been": 0.241, "could": 0.254, "into": 0.46, "than": 0.337, "only": 0.405, "such": 0.329, "while": 0.368, "however": 0.165, "our": 0.173, "me": 0.241, "will": 0.947, "are": 0.99, "were": 0.476}};
function englishCoverage(text) { const p = profile(text); return Object.values(p.freq).reduce((a, b) => a + b, 0); }
function compareStyles(known, unknown) {
  const A = profile(known), B = profile(unknown);
  const z = p => FW.map(w => (p.freq[w] - FW_STATS.mu[w]) / FW_STATS.sd[w]);
  const za = z(A), zb = z(B);
  const delta = za.reduce((s, x, i) => s + Math.abs(x - zb[i]), 0) / FW.length;
  const a = A.style, b = B.style, diffs = [];
  const ratio = (x, y) => (Math.max(x, y) + 0.3) / (Math.min(x, y) + 0.3);
  const say = (cond, txt) => { if (cond) diffs.push(txt); };
  say(ratio(a.sentLen, b.sentLen) > 1.35, `Average sentence length: ${a.sentLen.toFixed(0)} words in the known writing vs ${b.sentLen.toFixed(0)} in the text being checked.`);
  say(Math.abs(a.sentVar - b.sentVar) > 0.2, `Sentence lengths ${a.sentVar > b.sentVar ? "vary much more in the known writing" : "vary much more in the text being checked"}.`);
  say(ratio(a.contr, b.contr) > 2 && Math.max(a.contr, b.contr) > 1, `Contractions (don't, it's…): ${a.contr.toFixed(1)} vs ${b.contr.toFixed(1)} per 100 words.`);
  say(ratio(a.firstPerson, b.firstPerson) > 2.5 && Math.max(a.firstPerson, b.firstPerson) > 1, `"I / me / my": ${a.firstPerson.toFixed(1)} vs ${b.firstPerson.toFixed(1)} per 100 words.`);
  say(Math.abs(a.wordLen - b.wordLen) > 0.45, `Average word length: ${a.wordLen.toFixed(1)} vs ${b.wordLen.toFixed(1)} letters. ${a.wordLen < b.wordLen ? "The text being checked uses longer words." : "The known writing uses longer words."}`);
  say(Math.abs(a.mattr - b.mattr) > 0.06, `Vocabulary variety: ${(a.mattr * 100).toFixed(0)} vs ${(b.mattr * 100).toFixed(0)} different words per 100.`);
  say(ratio(a.commas, b.commas) > 1.8, `Commas: ${a.commas.toFixed(1)} vs ${b.commas.toFixed(1)} per 100 words.`);
  say(ratio(a.dashes, b.dashes) > 3 && Math.max(a.dashes, b.dashes) > 0.4, `Dashes: ${a.dashes.toFixed(1)} vs ${b.dashes.toFixed(1)} per 100 words.`);
  say(ratio(a.excl + a.ques, b.excl + b.ques) > 3 && Math.max(a.excl + a.ques, b.excl + b.ques) > 0.5, `Exclamation and question marks: ${(a.excl + a.ques).toFixed(1)} vs ${(b.excl + b.ques).toFixed(1)} per 100 words.`);
  let level;
  if (diffs.length <= 1 && delta < 0.75) level = "similar";
  else if (diffs.length >= 3 || (diffs.length >= 2 && delta > 0.8)) level = "very different";
  else level = "somewhat different";
  return { delta, level, diffs, nA: A.n, nB: B.n };
}
// ==/CORE==
if (typeof module !== "undefined") module.exports = { mixedCheck, MIXED_RULE, suspect, compareStyles, englishCoverage, cleanText, features, analyze, scoreFeatures, MODEL, BANDS, attribute, segments, slidingWindow, cautions, nWords };
