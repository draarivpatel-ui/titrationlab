# TitrationLab product context

Assumed from the autonomous hackathon brief because this implementation lane cannot pause for an interview.

## Product truth

TitrationLab is a single-page, offline acid-base titration workbench for students. It models strong-acid/strong-base and monoprotic weak-acid/strong-base titrations with charge-balance chemistry rather than a chart stitched from heuristics. It is educational simulation software, honestly labeled as not instrument-grade.

## User and success

A student or judge should be able to choose a preset or type manual concentrations and volumes, watch the titration curve update immediately, inspect exact computed points, understand the equivalence and buffer regions, and choose a chemically defensible indicator.

## Constraints

- Zero dependencies, no network calls, no keys, static files only.
- Node 22+ tests with deterministic hand-computed chemistry checks.
- Built fresh during the 2026-11-23 to 2026-11-25 STEM Innovation Challenge work window.
- No eyebrow or kicker text above titles and no tagline directly under titles.
