# Trained-parser baseline (Python)

The only Python in this repo. It runs a trained parser on exactly the split and gold words the
TypeScript evals use, so its scores are directly comparable.

```sh
python3 -m venv baselines/.venv
baselines/.venv/bin/pip install -r baselines/requirements.txt
bun run fetch-ud
baselines/.venv/bin/python baselines/stanza_parse.py data/ud/en_ewt-ud-dev.conllu baselines/out/stanza-ewt-dev.conllu
bun run eval:score baselines/out/stanza-ewt-dev.conllu --name stanza-ewt
# Score only the sentences an eval run used:
bun run eval:score baselines/out/stanza-ewt-dev.conllu --name stanza-ewt --ids results/runs/<run>.ids
```

Stanza downloads its models from Hugging Face on first run (a few hundred MB with PyTorch).

**Status:** written but not yet run. The sandbox it was written in can't reach Hugging Face.
