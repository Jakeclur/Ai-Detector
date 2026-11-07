"""Convert the ASAP essay set (training_set_rel3.tsv) into tests/data/samples/asap.jsonl.

ASAP (Automated Student Assessment Prize, Hewlett Foundation, 2012): about 13,000 essays by US students in
grades 7-10, written before chatbots existed. Used here as real teenage human writing for false-positive
testing only (split "test"): training on it was tried in v13 and didn't make the detector fairer. Anonymisation codes such as @PERSON1 are replaced with ordinary words.
The output is gitignored: the essays are not redistributed in this repo.

    python3 tests/data/asap_to_jsonl.py training_set_rel3.tsv tests/data/samples/asap.jsonl
"""
import csv, json, re, sys
src, dst = sys.argv[1], sys.argv[2]
REPL = {"PERSON": "Alex", "ORGANIZATION": "the company", "LOCATION": "the city", "CITY": "Springfield", "STATE": "Ohio", "COUNTRY": "America",
        "DATE": "Monday", "TIME": "three o'clock", "MONTH": "March", "MONEY": "$20", "PERCENT": "20%", "NUM": "3", "EMAIL": "an email",
        "CAPS": "Jordan", "DR": "Dr. Smith", "LAW": "the law"}
def clean(t):
    t = re.sub(r"@([A-Z]+)\d*", lambda m: REPL.get(m.group(1), "it"), t)
    return re.sub(r"[ \t]+", " ", t).strip()
# prompts: 1-2 persuasive letters/essays, 3-6 source-based responses, 7-8 narratives
GENRE = {1: "academic", 2: "academic", 3: "explanation", 4: "explanation", 5: "explanation", 6: "explanation", 7: "creative", 8: "creative"}
n = 0
with open(src, encoding="latin-1") as f, open(dst, "w") as out:
    for row in csv.DictReader(f, delimiter="\t"):
        text = clean(row["essay"])
        if len(text.split()) < 40: continue
        s = int(row["essay_set"])
        out.write(json.dumps({"text": text, "label": "human", "model": "human", "genre": GENRE[s], "condition": "original",
                              "source": f"asap/set{s}", "group": "asap:" + row["essay_id"], "split": "test"}) + "\n"); n += 1
print(n, "essays written")
