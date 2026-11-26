# Devpost copy for TitrationLab

## Inspiration

Titration curves are often presented as static diagrams that students memorize without seeing where the shape comes from. TitrationLab was built fresh during the November 23-25, 2026 work window to make the underlying chemistry visible. The goal was a workbench that a student can open offline, change like a real experiment, and trust because every displayed point comes from an explicit chemical model.

## What it does

TitrationLab is a single static page for strong-acid/strong-base and monoprotic weak-acid/strong-base titrations. It needs no install, account, network, key, or external library.

A user can choose a preset or enter acid concentration, acid volume, base concentration, maximum titrant volume, weak-acid Ka, curve resolution, and a comparison indicator. The live canvas chart updates immediately. It shows the titration curve, the equivalence volume, the weak-acid buffer region, the indicator transition window, and a movable inspection point.

The data readout reports the exact equivalence volume, exact solved equivalence pH, initial pH, final pH, pKa, buffer bounds, hydrogen-ion concentration, hydroxide-ion concentration, and charge-balance residual. A separate table shows exact model pH beside the two-decimal value a classroom pH meter would display. The curve can be downloaded as CSV data.

For the acetic-acid preset, the solver reports equivalence at 50.00 mL and pH 8.7219. It correctly recommends phenolphthalein because the basic equivalence point lies inside that indicator's transition window.

## How we built it

The app is dependency-free HTML, CSS, JavaScript, and Canvas. The chemistry core is a separate ES module so the same code is tested in Node and used by the browser.

At each titrant volume the solver writes charge balance. For a weak acid it combines charge balance, mass balance, water autoionization, and the Ka equilibrium expression. It scans pH from -2 to 16 in 0.05 steps to bracket the sign change, then applies 100 bisection iterations. This produces the positive hydrogen-ion concentration without assuming that equivalence is neutral.

The automated suite uses Node's built-in test runner. It contains 50 deterministic test cases with 101 assertion statements covering hand-computed strong-acid points, the weak-acid initial quadratic, half-equivalence pH against pKa, Henderson-Hasselbalch buffer behavior and slope, conjugate-base hydrolysis, indicator-window edges and outside-window rejection, input validation, charge residuals, meter rounding, chart-data shape, and monotonic chart data. A separate browser harness adds 20 browser-level checks, comprising 19 in-page assertions driven over CDP plus one console-and-exception hygiene check.

The demo assets were generated locally. Three screenshots were captured at 1440 by 900 in headless Chrome. The narration was synthesized locally, and the demo video was captured from the real running page.

## Challenges

The main chemistry challenge was avoiding a curve assembled from approximations. Dilution changes every concentration after each addition, and water autoionization matters near neutrality and in dilute solutions. Keeping those effects in one charge-balance equation made the solver more general and more testable.

A second challenge was honesty in the interface. It would be easy to show a smooth curve without saying what was ignored. The final interface includes an explicit validity and assumptions panel, a dynamic dilute-solution warning, a warning when the plotted range stops before equivalence, and a clear statement that the result is a modeled simulation rather than instrument-grade measurement.

The numerical display also needed care. A real meter does not report five decimal places, so the table separates exact model pH from a rounded meter-style reading instead of pretending the model has instrument precision.

## Accomplishments

The finished workbench is offline, dependency-free, and interactive while still solving real charge-balance chemistry. It does not force weak-acid equivalence to pH 7. The acetic-acid preset solves to pH 8.7219, matching the independent hydrolysis estimate of about 8.72.

The unit suite passes 50 of 50 test cases with 101 deterministic assertion statements that check the solver against hand-computed values and verify that generated chart data is monotonic. The browser harness passes 20 of 20 browser-level checks.

The interface also connects concepts that are often separated. Buffer shading, half-equivalence behavior, indicator windows, exact numerical readouts, meter-style rounding, CSV export, and validity warnings all update from the same model.

## What we learned

Solving the full charge balance is more honest than stitching together strong-acid, buffer, equivalence, and excess-base approximations. The work also reinforced how important dilution is. Even when the chemistry is simple enough for a classroom, the mixed volume appears in every concentration.

The project showed that scientific software needs interface honesty as much as numerical correctness. Assumptions, valid input ranges, uncertainty in representation, and the difference between a model and an instrument have to be visible to the user.

## What's next

Next steps are diprotic and polyprotic acids, weak-base titrations, activity-coefficient corrections, temperature-dependent Kw, titration of mixtures, and a comparison mode that overlays two experiments. A classroom worksheet export and accessibility audit for data-heavy interaction would also be useful.

## Built with

HTML, CSS, JavaScript, Canvas, Node.js, the Node test runner, headless Chrome, FFmpeg, and local OmniVoice narration synthesis.

## AI disclosure

AI coding assistants were used during implementation, debugging, test design, documentation, and video-production scripting. The chemistry model, numerical outputs, tests, and final claims were checked against independent hand calculations and deterministic automated tests. Local voice synthesis was used for the demo narration.
