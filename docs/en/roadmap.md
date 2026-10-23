# Status and next steps

Cut-off date: 2026-10-22. The lab covers the full cycle in structure and tools, and has already been applied to a real repository. What follows is putting it to use to gather data and measure it better.

## What is there
| Area | Content | Status |
|---|---|---|
| Method | `docs/guia.md` (concepts and implementation), `docs/caso-de-estudio.md` (two phases) | Written and updated |
| Prompts used and measured | `failure-modes`, `tests-3-layers`, `fix-red-tests`, `mutation-triage`, `naive-tests`, `reviewer` v1 and v2 | ✔ First phase |
| Draft prompts already run | Red team, supply chain, Semgrep rule, legacy audit and tour, four reviewers and router, differential review, Semgrep triage, calibration policy generator | ✔ One run each, with limits; they stay in un borrador de prompt (no publicado en esta versión) until repeated |
| Prompts not run | Audit of LLM applications | ◌ Postponed: Traslados uses no model; it will be done on another own project that does use a model |
| Tools with tests | `validate_review`, `compare_mutation`, `review_policy`, `calibrate`, `regression_check`, `check_commit_msg` | ✔ |
| Tools that ran with real data | `audit_dependencies` (npm registry, 61 dependencies) and the scripts in la evidencia privada del caso (thermometers, citation verifiers, pilot scoring) | ✔ |
| Tools still without real data | `route_review`, `stability`, `calibrate` | Tested with simulated data; see "What is missing" |
| Review system | `qa/review/` and `/review` in the case repository (private), with CI that validates the review and does not call the model | ✔ Advisory phase |
| Skill | `skills/ai-code-review/`: the same system, portable (`.ai-review/` in the reviewed repo, per-project context), with a ledger and a precision and recall report | ✔ v0 with 168 tests and one end-to-end test; no real data of its own yet |
| Experiments | la evidencia de la primera fase (privada), `reviewer-seeded/` and the ten in la evidencia privada del caso | ✔ with declared limits |
| Design | `design/revisor-en-ci.md`, `design/calibracion.md` | ◌ Partly validated: what CI validates and the advisory phase were applied; the thresholds are still proposals |
| Study material | las notas de estudio (no publicadas), las notas de estudio (no publicadas) | ◌ Notes from a course |

## What is missing to move up a phase
The calibration policy generated with real data (la evidencia privada del caso) lists the gaps. With the current evidence the 30-row threshold is not met in any category and the broad precision is 79 % against the 90 % proposed for blocking.

| # | Missing | Effort |
|---|---|---|
| 1 | Rubric category on every label | Low: the review files already carry it |
| 2 | Cases where the reviewer stays silent: seeded defects and harmless changes | High |
| 3 | A random sample labelled before seeing the reviewer's output | Medium |
| 4 | Decisions in block, warn, pass format and a real run of `calibrate.py` | Low, after 1 and 3 |
| 5 | A second labeller on part of the sample | Medium |
| 6 | More runs and a set outside the focus leakage | Medium |
| 7 | A written labelling guide (what A, M and R are) | Low |
| 8 | Cover with mutation the module that decides the phase (61.7 %) and decide what a stale review does | Medium |

Two limits that are not tasks: a single model and a single labeller do not generalise, and the team's action policy and the flow that turns an override into a row are missing.

## Other evidence gaps
- Replicate the test experiment on another module, with several runs per arm.
- Second round: generate the arms against the earlier code, to remove the design bias.
- Manual review of equivalent mutants.
- Real cost and latency over more runs.
- Actually run static analysis with extended rules in CI and the auditor against the registry with the full tree, not only the direct dependencies.

## Reproducibility
The case's code under test is not in the lab (it is private and contains real fares). For anyone to repeat the method end to end, the **seeded public module** is missing (next block).

## Next steps, in order
1. **Update the lab** *(done in this pass)*: case study, roadmap, guide and README up to date with what was measured.
2. **Turn the system into a skill** *(done, v0)*: `skills/ai-code-review/`, advisory, with an automatic record of every review (`ledger.jsonl`) and of what the human decides with it, and with the warning that it does not see omission or interface defects. Tested end to end on another repository (`experiments/skill-e2e/`). It still has to be used on real projects to gather data.
3. **Seeded public module:** a small piece of code with fictional fares and planted defects with a known answer (of public classes and of real errors from PRs, not invented to taste), plus harmless cases. It closes the recall and true-negative gap and lets the method be repeated.
4. **Static dashboard** of the metrics, generated from the record.
5. **Improve what is measured:** category per row, a second labeller, a random sample and cover `policy.mjs` with mutation.
6. **More data sources:** other own projects and public pull requests of other projects whose later fixes are known (measurement only; findings are not published to their owners).
7. **Anonymised public repo, personal guide and publications:** at the end, on figures already measured.
8. **Move up a phase** only when calibration justifies it; with the current evidence it cannot be done.

**Cross-cutting:** publish by milestones, with numbers and their limits, and not before measuring. Every new piece with its own measurement before calling it finished, and one at a time.
