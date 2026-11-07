"""Convert the OUTFOX test pickles (tests/data/external/outfox/*.pkl) to tests/data/samples/outfox.jsonl (gitignored).
Pickle files can run code when loaded, so this uses a restricted unpickler that refuses every global:
only plain lists, dicts, strings and numbers can be built. Every row is test-only (split "test")."""
import io, json, pickle, sys, os, hashlib
class SafeUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        raise pickle.UnpicklingError(f"refused global {module}.{name}")
def load(p):
    with open(p, "rb") as f: return SafeUnpickler(f).load()
here = os.path.dirname(os.path.abspath(__file__)); src = os.path.join(here, "external", "outfox")
out = os.path.join(here, "samples", "outfox.jsonl"); os.makedirs(os.path.dirname(out), exist_ok=True)
sets = {"common_test_test_humans.pkl": ("human", "human", "original"), "chatgpt_test_test_lms.pkl": ("ai", "gpt-3.5-turbo", "original"),
        "text_davinci_003_test_test_lms.pkl": ("ai", "text-davinci-003", "original"), "flan_t5_xxl_test_test_lms.pkl": ("ai", "flan-t5-xxl", "original"),
        "dipper_chatgpt_test_attacks.pkl": ("ai", "gpt-3.5-turbo", "dipper-paraphrase"), "chatgpt_test_test_outfox_attacks.pkl": ("ai", "gpt-3.5-turbo", "outfox-attack")}
n = 0
with open(out, "w") as w:
    for fn, (label, model, cond) in sets.items():
        p = os.path.join(src, fn)
        if not os.path.exists(p): print("missing", fn); continue
        data = load(p)
        assert isinstance(data, list), type(data)
        for i, t in enumerate(data):
            if not isinstance(t, str) or len(t.split()) < 40: continue
            # same essay prompt index across files = same group (keeps a prompt's human and AI essays together)
            w.write(json.dumps({"text": t.strip(), "label": label, "model": model, "genre": "academic", "condition": cond,
                                "source": f"outfox/{label if label == 'human' else model}" + ("" if cond == "original" else "/" + cond),
                                "group": f"outfox:{i}", "split": "test"}) + "\n"); n += 1
print("wrote", n, "rows to", out)
