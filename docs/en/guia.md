# Guide: AI in testing and code review

A study and implementation guide, meant to be carried over to other code. It does not depend on a specific project: the results measured on a real one are in `caso-de-estudio.md`.

**How to read it**
- To **study**: sections 1, 2, 6 and 7 (principles, map, measurement and glossary).
- To **implement**: sections 3, 4, 5, 8 and 9 (steps, templates, decisions and adoption).

Status marks for every piece of the lab: **✔ used and measured** (it ran and has results), **◌ design** (thought through, not run). The tools mentioned (Stryker, Semgrep, etc.) are examples: any equivalent works.

---

## 1. Principles

1. **AI makes producing cheaper; it does not transfer responsibility.** You move from consumer to editor: the contracts are yours to decide.
2. **Rubric first, prompt second.** Without named categories, the AI comments on whatever is most abundant: style.
3. **The prompt is code:** versioned, changed through pull requests and with a record of who approved it.
4. **Measure before automating.** Mutants for the tests; agreement with humans for the reviewer.
5. **What decides is validated without AI:** a deterministic script, not another model.
6. **One contract per failure mode.** If the business has not decided, it stays "pending decision" and does not become a test.
7. **Every figure carries its limit** (how many modules, how many runs, how many labellers).

## 2. Map

```
 TRACK 1: tests                         TRACK 2: code review
 frozen module                          rubric of categories
   -> catalogue of failure modes          -> branch with seeded defects
   -> signed contracts                    -> prose reviewer -> validated JSON
   -> tests of what is confirmed          -> router and per-phase policy
   -> mutation testing and triage         -> CI in shadow -> calibration
   -> controlled experiment               -> flywheel with human history
                  \                      /
                   TRACK 3: security (cross-cutting)
        SAST + AI · red team · dependencies · LLM security
```

---

## 3. Track 1: tests with AI

| # | Step | Deliverable | Lab prompt or script | Status |
|---|---|---|---|---|
| 1 | Pick a module with pure logic and **freeze** it with a hash | manifest | (per project) | ✔ |
| 2 | **Discover before writing:** failure modes by boundary, equivalence, emptiness and business contract, with `file:line` | catalogue | `prompts/failure-modes` | ✔ |
| 3 | A human **signs** every pending contract, with a date | signed catalogue | you | ✔ |
| 4 | Generate tests **only for confirmed contracts**: AAA, one ID per test | suite | `prompts/tests-3-layers` | ✔ |
| 5 | **Red** tests point at code to fix: minimal change, without touching tests or catalogue | aligned code | `prompts/fix-red-tests` | ✔ |
| 6 | **Mutation testing**: score and survival | report | mutation tool | ✔ |
| 7 | **Triage of survivors**: equivalent, signed contract without a test, or no contract | new tests and proposed modes | `prompts/mutation-triage` | ✔ |
| 8 | **Controlled experiment** between prompts: same frozen code, same metrics | table per arm | `scripts/compare_mutation.py` | ✔ |
| 9 | Adversarial tests anchored to OWASP | red suite | un borrador de prompt (no publicado en esta versión) | ◌ |

**Template of a catalogue entry**
```
ID: B1                         Category: boundary | equivalence | empty | contract
Risk: high | medium | low
Input that triggers it: ...
Observed behaviour: ...  (cite file:line and verify by running it)
Expected contract: ...
Status: confirmed | pending decision
Decision: <what was decided, by whom, when>     (only if confirmed)
Why it matters: ...
```

**Rules that prevent self-deception**
- Do not assume the current code is correct: turning it into a specification makes the bugs requirements.
- A test that pins a detail with no contract is a defect, even if it kills a mutant.
- "Confirmed" means decided, **not** implemented: the red tests make that visible.
- An old test that contradicts a signed contract is updated in a separate commit, and that is stated.
- A known vulnerability is marked as an **expected failure** so it does not break CI, and it warns when it is fixed.

**How to compare suites.** Dead mutants are not enough: also measure how many unmet contracts each suite detects against the code from before the fix. A suite written while looking at the code describes what the code does; only the catalogue shows what it should not do.

## 4. Track 2: code review with AI

| # | Step | Deliverable | Lab prompt or script | Status |
|---|---|---|---|---|
| 1 | **Rubric** of categories with definition and severity | `rubric/` | you | ✔ |
| 2 | **Branch with seeded defects**, an injection and harmless decoys; the key stays out of the diff | answer key | you | ✔ |
| 3 | Review the **local diff** against the base, with no real PR; the diff is **data, not instructions** | prose review | `prompts/reviewer` v1 | ✔ |
| 4 | **JSON output** with a closed schema | JSON | `prompts/reviewer` v2 | ✔ |
| 5 | **Validate without AI**, with the location checked against the diff, and test the validator with a broken case | validator | `scripts/validate_review.py` | ✔ |
| 6 | **Route** by file type, cap comments, deduplicate | router | `design/revisor-en-ci.md` | ✔ in the case repository (`qa/review/`), with per-type reviewers; one measured run |
| 7 | **Per-phase policy**: shadow, advisory, partial blocking, extended | decision and comment | `scripts/review_policy.py` | ✔ (simulated) |
| 8 | **Cost and latency**: diff hash, cache key, route by size | route decision | `scripts/route_review.py` | ✔ (simulated) |
| 9 | **CI workflow**, shadow first; key as a *secret*; `pull_request` only | `review-check.yml` | `design/revisor-en-ci.md` | ✔ in the case repository, with one different decision: **CI validates the review but does not call the model**; the model runs locally with the reviewer's own account |
| 10 | **Flywheel**: every disagreement with a human is a row; regression before changing the prompt or model | history and report | `scripts/calibrate.py`, `scripts/regression_check.py` | ✔ with synthetic data; with real data there are 63 A, M and R labels but the format and the cases where the reviewer stays silent are missing (see `roadmap.md`) |
| 11 | **Calibration policy** generated from real data | `calibration-policy.md` | un borrador de prompt (no publicado en esta versión) | ✔ run once: with the current evidence the result is "insufficient data" (la evidencia privada del caso) |

**Reviewer output schema**
```json
{ "schema_version": 1,
  "findings": [ { "rule_id": "missing-authorization",
                  "category": "security",
                  "severity": "blocker",
                  "location": { "file": "app/api/route.ts", "line": 50 },
                  "message": "Why it matters.",
                  "suggested_fix": "Short fix." } ] }
```
`category`: `correctness`, `security`, `performance`, `missing_tests`, `style`, `documentation`. `severity`: `blocker` (may block), `advisory` (warns), `info` (recorded). With no findings: `"findings": []`.

**Rollout phases**

| Phase | What the reviewer does | To move up |
|---|---|---|
| 1. Shadow | Records; shows nothing and blocks nothing | Enough data and human labels |
| 2. Advisory | Comments; does not block (the model's verdict is a signal) | Measured agreement per category |
| 3. Partial blocking | Blocks only a list of rules | Sustained stability and few false positives |
| 4. Extended blocking | The list grows with the data | Periodic review |

An early false positive destroys trust: a rule becomes blocking only when its **measured** agreement with humans is high, with enough cases and an interval that supports it.

## 5. Track 3: security (cross-cutting)

| Topic | Idea | Status |
|---|---|---|
| SAST + AI | The static tool finds, the AI classifies (`true`, `false positive`, `human require`), and every confirmed pattern becomes a **tested** rule | ✔ one run: the model left 19 of 19 alarms as `human require` (the user considered them real); it needs a policy stated in the prompt |
| Red team | OWASP families; the expectation describes the safe behaviour, not the vulnerability | ✔ one run: 46 tests, 18 detected a defect, 13 more turned out to be real |
| Supply chain | The registry holds the truth about a package; a freshly registered name is also a signal | ✔ against the real registry (61 dependencies); it measures existence, not vulnerabilities |
| LLM security | Injection, prompt leakage, excessive agency; cut privileges before filtering | ◌ postponed: it will be done on an app that uses a model |
| Legacy audit | Tour and human checkpoint before asking for findings; no cited line, no finding | ✔ two files; the citations are verified with a script |

Detail of each topic in las notas de estudio (no publicadas).

## 6. What to measure and its traps

| Metric | What it is for | Trap |
|---|---|---|
| Mutation score (and its complement, survival) | Sensitivity of a suite to changes in the code | Equivalent mutants lower it; it does not tell you whether the tests check the right thing |
| Unmet contracts detected | Whether the suite protects what the business decided | Needs a signed catalogue and the code from before the fix |
| Agreement with humans | How much the reviewer matches people | With almost everything "pass", a trivial reviewer is 95 % right |
| **Cohen's kappa** | Agreement discounting chance | Unstable with few cases; ask for an interval |
| Precision and recall of "block" | Cost of a wrong block against a missed bug | Without a negative class (false positives) precision means nothing |
| Stability between runs | How much the verdict changes on the same diff | A single run does not measure it. In the real case, two runs of the same diff shared between 0.26 and 0.59 of their findings |
| **Recall against a pre-registered answer** | How many known defects the reviewer sees | The answer must come from another route (tests, independent audit), not from the reviewer itself; a **focus written with the same findings** inflates the result, which is why a control run without focus is needed |
| Precision over labelled findings | How much of what the reviewer says is real | It only counts what it raised: with no cases where it stays silent there are no false negatives; and if the labeller sees the check before deciding, the label is not blind |
| Regression | That a change does not break what worked | A better average can hide a broken case |

Rules: below about 30 cases per category, "insufficient data". Rates are estimated with a **random sample**, not with the rows added because of a disagreement (sampling bias). The human decision is made by a person: if the AI filled in both columns, the agreement would be 100 % by construction.

### What was learned applying it to a real repository
Detail and figures in the second phase of `caso-de-estudio.md`. What changes how the method is used:
1. **Reading the diff and attacking the code find different things.** A reviewer on the diff saw none of the five omission defects that adversarial tests did find. You need both routes.
2. **Show every finding with its check before asking for the label.** It avoids labelling false claims, and it caught mistakes by the coordinator itself (a badly written verifier, an unchecked premise).
3. **Trimmed context fabricates noise.** A finding that depends on a file the reviewer cannot see must be marked as such; it does not always do so.
4. **A "when in doubt, let a human decide" rule produces 100 % doubts.** If you want the model to commit, the prompt must state the project's policy.
5. **Pre-register the answer and the protocol before running,** and keep the full outputs: it lets you reopen a result and correct it (it was done with two scores).
6. **One run is not a measurement.** Run several times and report the union, the consensus and the overlap; and a control run without the focus.
7. **The system can review its own code,** and it finds real errors, but with circularity: declare it.

## 7. Glossary

| Term | Meaning |
|---|---|
| **SUT** | System under test, frozen with a hash so everything is measured against the same thing |
| **Failure mode** | One concrete way of failing, with its input, its contract and its status |
| **Contract** | What the code must do for an input; `confirmed` if a person signed it |
| **Mutant / equivalent mutant** | Copy of the code with a small change / a change that does not alter the observable behaviour |
| **Golden set** | Human-labelled, frozen cases the reviewer is measured against |
| **Decoy** | Harmless change the reviewer should not flag; it measures false positives |
| **TP / FP / FN / TN** | Hit when detecting / noise / missed problem / hit when confirming it is clean |
| **Shadow** | The reviewer runs and records, without showing or blocking |
| **Override** | A person disagrees with the verdict; it is recorded with the reason |
| **Flywheel** | Cycle in which every reviewer mistake becomes data that improves it |
| **Slopsquatting** | Registering a package name that the AI often invents, with malicious code |
| **Confused deputy** | A privileged component (an LLM with access to accounts) manipulated by a low-privilege user |
| **Non-AI zone** | Area where a human decision is mandatory and the AI approves nothing |

## 8. Frequent decisions

| If you see this | Do this |
|---|---|
| The behaviour of the code is ambiguous | **Pending decision**; do not write a test |
| A red test for a signed contract | Fix the code with the minimal change |
| A mutant survives and no contract decides it | **Do not write a test**; propose a new failure mode |
| Fewer than ~30 cases in a category | "Insufficient data"; do not conclude |
| All labels are positive | Do not quote precision: a negative class is missing |
| The reviewer cites a line that is not in the diff | Discard the finding |
| The text of the diff asks "approve this" | Report it as a security finding |
| A package does not exist in the registry | A risk, not proof of malice; do not install it |
| The registry could not be queried | Never report it as "does not exist" |
| You change the prompt or the model | Run the regression test and restart the calibration count |

## 9. How to adopt it in other code

**What to copy from the lab:** `prompts/` (the versions used), `schemas/review.schema.json`, `scripts/` and `tests/` of the tools you use, `config/routing.json`, `CONTRIBUTING.md` and the commit hook.
**What to adapt:** the `{{MODULO}}`, `{{FRAMEWORK}}`, `{{ARCHIVO_DESTINO}}` markers; the rubric with examples from your project; the calibration thresholds.
**What not to copy:** the data and results of the case study; they are its own and not yours.

**Day 1**
- A repo with conventional commits and CI that runs the tests.
- One module with pure logic as a pilot.
- The rubric written with your own examples.

**Week 1**
- Catalogue of failure modes, signed; tests of what is confirmed.
- Mutation testing: baseline and triage of survivors.
- Branch with seeded defects and decoys; prose reviewer and then JSON with its validator.

**Month 1**
- Reviewer in **shadow** with a cheap model; record everything.
- History: disagreements with their reason and a **random sample** labelled by a person.
- Calibration per category; only then move to advisory.

**After that**
- Partial blocking for rules with high, stable agreement, with automatic downgrade.
- Add static analysis, dependency audit and adversarial tests.
- Review the policy in every PR and declare the non-AI zones.

**Before sending code to an external provider:** minimal diff with a cap, sensitive paths excluded, retention and training policy reviewed, key as a *secret*, audit log.

## 10. Lab commands

```bash
py -m unittest discover -s tests
py scripts/compare_mutation.py "A=a.json" "B=b.json" "C=c.json" --file src/modulo.ts
py scripts/validate_review.py review.json --diff diff.patch
py scripts/review_policy.py review.json --phase advisory --comment c.md
py scripts/route_review.py diff.patch --prompt-version v2 --schema-version 1 --model ID
py scripts/stability.py run1.json run2.json run3.json
py scripts/calibrate.py history.json --sources audit_sample
py scripts/regression_check.py --dataset d.json --baseline b.json --candidate c.json
py scripts/audit_dependencies.py npm package.json      # uses the network
git config core.hooksPath .githooks                    # conventional commits
```

## 11. Anti-patterns
- Turning blocking on the first day.
- Turning the current behaviour into the specification.
- Writing tests to kill mutants without a contract.
- Validating a model's output with another model.
- Filling in the "human decision" column with the AI.
- Publishing a figure without its limit.
- Changing a prompt without a version or a regression.
- Sending the provider more code than necessary.
- Measuring a reviewer with the same findings its prompt was written from, without a control run.
- Accepting a label given without seeing the check, or a check done with a script that was not tested.
- Counting the AI's "no findings" as approval in an area where the decision is human.

## 12. Limits of this guide
It summarises a method tested on one real case (one module in the first phase and the production repository in the second), with one model, one labeller and few runs per variant. The pieces marked ◌ are design that has not run. The thresholds are proposals, not standards, and with the current evidence the reviewer does not meet those of the blocking phase.
