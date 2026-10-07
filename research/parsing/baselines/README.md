# Trained-parser baseline (Python)

The only Python in this repo. It runs a trained parser on exactly the split and gold words the
TypeScript evals use, so its scores are directly comparable.

```sh
python3 -m venv research/parsing/baselines/.venv
research/parsing/baselines/.venv/bin/pip install -r research/parsing/baselines/requirements.txt
bun run fetch-ud
research/parsing/baselines/.venv/bin/python research/parsing/baselines/stanza_parse.py data/ud/en_ewt-ud-dev.conllu research/parsing/baselines/out/stanza-ewt-dev.conllu
bun run eval:score research/parsing/baselines/out/stanza-ewt-dev.conllu --name stanza-ewt
# Score only the sentences an eval run used:
bun run eval:score research/parsing/baselines/out/stanza-ewt-dev.conllu --name stanza-ewt --ids results/runs/<run>.ids
```

Stanza downloads its models from Hugging Face on first run (a few hundred MB with PyTorch).

**Status:** written but not yet run. The sandbox it was written in can't reach Hugging Face.
