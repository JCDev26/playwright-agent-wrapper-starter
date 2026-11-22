# Calibrate the reviewer on a known case

Can a reviewer distinguish a real defect, a working implementation and insufficient evidence? This exercise uses the existing reservation example. A client loses its acknowledgment and retries. The question is how many bookings the ledger actually contains. Each reviewer gets the same evidence from three local configurations. This is a focused test of evidence reading within the [two-pass Architecture Challenge](https://github.com/JCDev26/agentic-engineering-reference).

## Run a blind comparison

Use a maintainer and two independent reviewers. Only the maintainer needs the wrapper checkout. Keep the answer key, the saved pilot and this guide away from the reviewers until scoring. With the repo dependencies installed, run the following commands as each stage becomes due.

1. Run `npm run --silent quality -- calibrate brief`. Give both reviewers the same JSON. Use the same time or word limit, tools and access. For the ordinary review, ask for an engineering assessment and what evidence would decide the claim. For the two-pass review, ask for a prediction, an observation that would contradict it, and a positive control. Save both first responses before revealing the observations.
2. Run `npm run --silent quality -- calibrate packet`. Give both reviewers that exact JSON. It includes a digest, a control, the client result and the available independent ledger evidence for each case. Ask each reviewer to return one verdict per case with evidence references and a short rationale. Allowed verdicts are `supported`, `contradicted` and `inconclusive`.
3. Put the two responses in `comparison.json` under `baseline` and `twoPass`. Each record needs a distinct `reviewer`, the supplied `packetDigest` and three `answers`. Each answer has `id`, `verdict`, an array of `evidence` references and a `rationale`. Keep each reviewer's original text and first pass with the comparison. The saved pilot provides a complete example for the maintainer. [Comparison file](../examples/calibration/reservation-comparison.json)
4. Run `npm run --silent quality -- calibrate score comparison.json`. Read each verdict alongside its expected outcome. The scorer reports correct verdicts, missed defects, false accusations on sound cases and definitive judgments with missing evidence. It also checks whether a correct answer cited both the control and the independent ledger observation. A maintainer still needs to read the rationale.

## What happened in the first pilot

Two assistant reviewers in the same session took separate, packet-only reviews with a 150-word limit per stage. Both submitted their first responses before receiving the evidence. The scorer reproduces the result directly from their records.

```sh
npm run --silent quality -- calibrate score examples/calibration/reservation-comparison.json
```

| Observed result | Ordinary review | Two-pass review |
| --- | ---: | ---: |
| Correct verdicts | 3/3 | 3/3 |
| Missed defects | 0 | 0 |
| False accusations on the sound case | 0 | 0 |
| Definitive judgments with missing evidence | 0 | 0 |
| Correct answers citing both the control and the trial ledger | 0/3 | 3/3 |

Both reviewers cited the trial ledger in all three cases. The observed difference was in citing the control. This pilot used one fixture family, one review per method and no external maintainer. Estimating a difference in defect detection would require held-out examples, repeated trials and independent reviewers. For a target repository, a maintainer can privately select a known defect, a sound sibling case and a case with unavailable evidence, freeze their expected outcomes, and run the same sequence before revealing the key.

The exercise grades the resulting booking state and makes an unavailable ledger a legitimate outcome. Anthropic's evaluation guidance describes the distinction between the interaction transcript and the final state and explains why repeated trials matter. [Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)
