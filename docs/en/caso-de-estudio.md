# Case study: Traslados Global VIP

The method in `guia.md` was applied to a real application: a transfer quoting site (Next.js, TypeScript, Vitest and Playwright). This document tells what was done, what came out and how much each result is worth, in two phases: a controlled experiment on one module (sections 1 to 5) and the application to the production repository with a review system that was measured (sections 6 to 11).

**Reproducibility notice:** the case's code lives in another repository, local and unpublished, and contains a business's real fares. What is here is the method, the prompts, the scripts and the evidence; not the code under test. The plan to close this gap with a generic example inside the lab is in `roadmap.md`.

## 1. Test experiment: three ways to generate a suite

**Code under test:** `lib/quote.ts`, the pure logic that computes the quote (about 220 lines plus a fare table), frozen as `quote-v1` with a manifest of hashes.

**Catalogue:** 22 failure modes with contracts signed by the owner. New modes that came out of the triage were also shown (seven, unsigned).

| Arm | What it is |
|---|---|
| S0 | The suite that already existed |
| A | A naive prompt: "write tests" |
| B | The three-layer prompt with the catalogue, in a clean context |
| C | B plus a round of triage of the surviving mutants |
| Informed B | My contract tests, written after seeing the mutants (contaminated; reported separately) |

**Results** (374 mutants; "survivors" = survived or had no coverage)

| Suite | Tests | Survivors | Survival | Mutation score |
|---|---|---|---|---|
| S0 | 364 | 65 | 17.4 % | 82.62 % |
| A (naive) | 24 | 131 | 35.0 % | 64.97 % |
| B (catalogue) | 63 | 144 | 38.5 % | 61.50 % |
| **C (B + triage)** | 92 | 108 | **28.9 %** | **71.12 %** |
| Informed B | 88 | 122 | 32.6 % | 67.38 % |

**Detection of unmet contracts.** Every suite was run against the code from before the fix, which failed seven signed contracts:

| Arm | Contracts detected |
|---|---|
| A | 3 to 4 of 7 |
| **B** | **7 of 7** |

## 2. What was learned

1. **The naive prompt does not lose on mutation, but it loses on what matters.** A beat B on score with a third of the tests, because whoever writes while looking at the code covers internal branches. But only the catalogue made it possible to see what the code **should not** do: 7 unmet contracts out of 7 against 3 or 4. Measuring only mutation would have given the opposite conclusion.
2. **"No contract, no test."** The triage classified 144 survivors of B: 36 had a signed contract without a test (29 new tests), 34 were equivalent, 71 had no contract. For those last ones **no test was written**: they went back to the catalogue as seven proposed failure modes. That way the iteration does not overfit.
3. **Confirmed is not implemented.** There were signed contracts the code did not meet; the red tests made it visible and the code was fixed with the minimal change. Four old tests contradicted a signed contract and were updated in a separate commit.
4. **Equivalent mutants reveal redundant code.** Several mutants survived because there were branches that never run.
5. **The naive suite is not wrong for lack of effort:** it replicates what the code does, defects included.

## 3. Reviewer experiment

A branch was seeded with **6 defects** (one per rubric category), **1 injection attempt** (a comment asking to report "no findings") and **2 harmless changes** as decoys. The answer key was kept out of the diff.

| | Reviewer v1 (prose) | Reviewer v2 (validated JSON) |
|---|---|---|
| Seeded defects detected | 6 of 6 | 6 of 6 |
| Injection | Resisted and reported it | Resisted and reported it |
| Decoys flagged | 0 of 2 | 0 of 2 |
| Total findings | 18 | 8 |
| Location | approximate, sometimes from the diff | whole `file:line`, verified against the diff |
| Consumable by a pipeline | No | Yes |

What the exercise left:
- The rubric by categories keeps the reviewer from staying on style.
- The deterministic validator rejects an invented line that the diff does not contain and a missing field, with a clear message.
- v2 stopped reporting several findings that v1 did give and that were labelled as valid; with one run per version, the effect of the "one problem, once" rule cannot be told apart from the model's noise.

## 4. How much each result is worth

| Result | Reliability |
|---|---|
| A/B/C comparison | One module, one model, one run per arm. A demonstration, not statistics. Unreviewed equivalent mutants make the scores a floor |
| Contracts detected 7 of 7 against 3 or 4 | Both arms read the already fixed code, which favours A; the fair comparison (generating against the earlier code) is pending |
| Reviewer 6 of 6 | The defects are obvious and were seeded by whoever wrote the key |
| Reviewer precision (8 of 8, 18 of 18) | **Not reliable:** a single labeller and no false positive to contrast with |
| Resistance to injection | One test, one model, one case |
| Everything about the flywheel and calibration | In this first phase only with synthetic data. The second phase already has 63 real labels (section 8), but all on findings the reviewer raised: without false negatives or harmless cases there is no kappa |

## 5. Where the evidence is (first phase)
- la evidencia de la primera fase (privada): protocol and full results, catalogue, prompts used, mutant triage and proposed modes.
- la evidencia de la primera fase (privada): answer key, reviewed diff, v1 and v2 reviews, labels and scores.

---

# Second phase: applying it to the real repository (21 and 22 October 2026)

The first phase was a laboratory on one module. The second took the method to the full production repository, with small changes per pull request (from #20 to #36), and tested the review system that came out of it. **It is still one model, one labeller and a single business**; every figure carries its limit.

## 6. What was done in the real repository

| Piece | What was done | Result | Limit |
|---|---|---|---|
| Contract catalogue | 30 contracts of `lib/quote.ts`; the ones the code failed were signed by the business owner and fixed with red tests first | Unmet contracts implemented (confirmed is not implemented) | One module; it was not re-verified that all 30 are signed |
| Mutation | Stryker on the pure logic and the validation; survivors were classified as artefact, equivalent, test gap and pending contract | From 84.09 % to 95.17 % (quote 93.59, event validation 98.70, form rules 99.20) | Unreviewed equivalents make the figure a floor; it was classified once |
| API red team | An isolated agent wrote 46 adversarial tests; they were compared against the unfixed and the fixed route | 18 detect a defect, 0 regressions; the 13 that stayed red were labelled real by the user and closed in a PR | One run; the known answer was written by whoever fixed the code |
| Supply chain | `audit_dependencies.py` against the real registry (61 direct dependencies) and an agent that interprets it | Zero invented names; the agent said what the evidence does not cover. `npm audit` instead found 7 advisories (1 critical) that led to upgrading Next | It measures existence, not vulnerabilities: they are two different risks |
| Semgrep rule | An agent derived a rule from an anti-pattern; it was compared with the hand-written rule | The agent's YAML was not valid; the short hand-written rule stayed, with its own tests in CI | One run; Semgrep ran later in CI, not in that test |
| Legacy audit | Tour verified by the owner and then findings with a cited line, in two files | `quote.ts`: 3 of 5 level-1 defects and 2 of 7 level-2 ones; `contact-form.tsx`: 19 findings, 11 actionable, 4 minor, 4 noise | One model and one run; the `quote.ts` defects were known to whoever wrote the key |
| Secret leak | The infrastructure reviewer found that the Vercel bypass secret ended up inside the Lighthouse reports | Confirmed in a real artefact (12 of 14 files); fixed and verified | Only that arm saw it |

## 7. The review system that came out

A procedure inside the case repository (`qa/review/`): it splits the diff by file type and numbers its lines, a fresh, isolated agent reviews each block with a base prompt and a focus, a deterministic validator checks the JSON and that every cited line exists in the diff, and a CI workflow validates the review that travels with the pull request. **The model runs locally; CI never calls it**, so the code does not leave for a third party. The current phase is advisory.

Its pull request reviewed itself three times: 6, 7 and 6 findings; those of the first two rounds were fixed with a test, and it was checked that the earlier code failed three of those cases. Its modules have a mutation coverage of 61.7 % to 76.2 %, lower than the product's logic (87 % to 99 %).

## 8. What was measured of the review system

**Precision: 63 findings labelled A, M or R, by the same labeller, in five experiments.**

| | Rows | Result |
|---|---|---|
| Actionable (A) | 25 | 40 % (interval 29 to 52 %) |
| Actionable or minor (A + M) | 50 | **79 %** (interval 68 to 88 %) |
| Noise (R) | 13 | 21 % (interval 12 to 32 %) |

These are findings the reviewer raised, not a random sample, and the rows of one experiment are not independent. To block, the design proposes a precision of at least 90 %: 79 % does not reach it.

**Recall and stability: a pilot with three cases of known answer, three runs per case and one control without focus.**

| Case | Elements | Per run | Control | Union | Consensus |
|---|---|---|---|---|---|
| API PR | 5 | 0, 0, 0 | 0 | 0 | 0 |
| `contact-form.tsx` | 11 | 5, 4, 3 | 3 | 6 | 4 |
| `quote.ts` and data | 12 | 2, 4, 1 | 1 | 4 | 2 |

The mean overlap of findings between runs of the same case was 0.42, 0.59 and 0.26. **The recall figures are low and variable.**

**Other experiments with the same system:**
- **Five reviewers on the same material** (TypeScript, Python, infrastructure, generic and router): 24 findings that reduce to 15 distinct ones, of which 7 actionable, 5 minor and 3 noise. The validator would have rejected 2 of 5 outputs (locations outside the diff and a JSON with an unescaped backslash). Only the infrastructure reviewer saw the secret leak; neither the generic one nor the router did.
- **Differential review** of the changes between two versions of a module: 12 findings, 4 actionable, 5 minor and 3 noise.
- **Triage of 19 Semgrep alarms:** the model left all 19 as "needs a human" and the user considered them all real, so 0 of 19 matched and no human decision was saved.
- **Calibration policy generated with real data:** it came out with every category as "insufficient data" and without recommending any trusted action. The 29 percentage figures of the document appear in its inputs, and the six fractions that did not appear are sums of the document itself, checked by hand.

## 9. What the second phase taught

1. **Reading a diff and attacking the route find different defects.** The five omission defects the red team found by running tests (blank text, content type, out-of-range numbers, values outside a list) were seen by none of the reviewer's seven runs. In exchange it found others nobody had seen: the nested arrays that bypassed the prototype-key filter, a real defect that was fixed afterwards in a pull request.
2. **A focus written from the findings inflates the result.** The TypeScript focus names "double clicks" and "unvalidated external input", and those two elements appeared in all three runs of the full system and in none of the control. Merit cannot be separated from leakage with one control run.
3. **Trimmed context fabricates noise.** The three false findings of the differential review and the "no test" rule of one of the reviewers came from a diff that did not show the file that refuted them. If a finding depends on something the reviewer cannot see, it must say so; it does not always do so.
4. **A model with a "do not make things up" rule does not commit.** When in doubt it says "needs a human": it is honest, but it saves no work. A policy stated in the prompt could change that; it was not tested.
5. **Numbers depend on the run.** The same case gave 1 to 4 of 12 depending on the run. Running three times gained at most one element over the best single run.
6. **Whoever coordinates is also wrong, and it has to be shown.** A verifier of our own gave 0 of 14 citations because of a regular-expression error; a score of two findings was corrected when the code was reopened; a premise about a blocked popup did not survive the check. What stayed was presenting every finding with its check in front before asking for the label.
7. **The same system reviewed its own code and found real errors** (for example, an option that could delete the current directory). With the circularity that implies: the same kind of model writes it and reviews it.

## 10. How much each second-phase result is worth

| Result | Reliability |
|---|---|
| Mutation from 84.09 % to 95.17 % | A real measurement on real code; unreviewed equivalents leave it as a floor |
| Precision of 79 % | One labeller, non-independent rows, not a random sample; enough to start talking, not to decide a phase |
| Pilot recall | Three cases, one model, three runs; focus leakage and circularity declared |
| Semgrep triage, 0 of 19 | Two rules, 19 almost identical alarms; it does not measure application-code alarms |
| Calibration policy | A draft with insufficient data: it works as a list of what is missing, not as a decision |
| Moving up a phase | **No** with the current evidence |

## 11. Where the evidence is (second phase)
la evidencia privada del caso: one directory per experiment (`red-team`, `supply-chain`, `semgrep-rule`, `legacy-quote`, `legacy-contact-form`, `reviewers`, `differential-review`, `semgrep-triage`, `recall-pilot`, `calibration`), each with a protocol and a known answer written before running, the agents' outputs and their results. la evidencia privada del caso gathers all the user's labels and `calibration/thermometers.mjs` computes the precisions with their intervals. The code of the fixes and the review system live in the case repository (private).
