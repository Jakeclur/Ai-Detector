# Import your own labelled samples

Put `.jsonl` files in this folder: one JSON object per line. They're picked up automatically by
`tests/train.js` (training split) and `tests/benchmark.js` (test split). No code changes are needed
to add a new model, genre or editing condition.

```json
{"text": "The full text…", "label": "ai", "model": "gpt-5", "genre": "academic", "condition": "original", "group": "prompt-17"}
{"text": "The same prompt answered by a person…", "label": "human", "genre": "academic", "group": "prompt-17"}
{"text": "The gpt-5 answer after a student edited it…", "label": "ai", "model": "gpt-5", "condition": "human-edited", "group": "prompt-17"}
```

| Field | Required | Values |
|---|---|---|
| `text` | yes | the full text |
| `label` | yes | `human` or `ai` |
| `model` | no | e.g. `gpt-5`, `gemini-2.5`, `claude-opus-5.5`, `deepseek-v3`, `llama-4` (default `unknown-ai` or `human`) |
| `genre` | no | `academic`, `creative`, `news`, `explanation`, `conversational`, `learner`, `other` |
| `condition` | no | `original`, `prompt-variant`, `humaniser`, `paraphrased`, `human-edited`, `multi-stage-edit`, … |
| `group` | no, but recommended | anything shared by texts written for the same prompt or derived from the same source. Every text in a group lands in the same split, so edited versions can't leak into training while their original is in testing |
| `split` | no | `train` or `test` (default: decided from the group, about 60/40) |
| `source` | no | where it came from |

Only add text you're allowed to use, and never commit other people's private writing to this public repo.
Files here are gitignored unless named `*.public.jsonl`.
