import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KW,
  analyzeTitration,
  bisectRoot,
  bufferRange,
  chargeResidualAtPh,
  equivalenceVolume,
  exactEquivalencePh,
  generateCurve,
  hendersonPh,
  meterReadings,
  phAtHalfEquivalence,
  recommendIndicator,
  scanChargeRoot,
  solvePh,
  validateInput,
  validityFlags,
} from '../solver.js';

const close = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} +/- ${tolerance}, got ${actual}`,
  );
};

const strong = {
  acidType: 'strong',
  analyteConcentration: 0.1,
  analyteVolume: 50,
  titrantConcentration: 0.1,
  maxTitrantVolume: 75,
  points: 241,
};

const weak = {
  acidType: 'weak',
  analyteConcentration: 0.1,
  analyteVolume: 50,
  titrantConcentration: 0.1,
  ka: 1.8e-5,
  maxTitrantVolume: 75,
  points: 241,
};

const PKA_ACETIC = 4.7447274948966935;
const EPS_SOLVER = 1e-6;
const EPS_EXACT = 1e-12;
const EPS_RESIDUAL = 1e-10;
const EPS_MONOTONIC = 1e-10;

test('strong-strong equivalence volume is the hand stoichiometric ratio', () => {
  assert.equal(equivalenceVolume(strong), 50);
  assert.equal((0.1 * 50) / 0.1, 50);
});

test('strong acid initial pH is the hand-computed 0.1 M value', () => {
  close(solvePh(strong, 0), 1.0, EPS_SOLVER, 'initial pH epsilon 1e-6');
});

test('strong acid at 10 mL matches hand excess-acid concentration', () => {
  const excessH = ((0.1 * 50) - (0.1 * 10)) / (50 + 10);
  assert.ok(excessH > 0.0666666666 && excessH < 0.0666666667, 'excess acid is 1/15 M');
  close(solvePh(strong, 10), 1.176091259054704, EPS_SOLVER, '10 mL pH epsilon 1e-6');
});

test('strong acid at half-neutralization matches hand excess-acid concentration', () => {
  const excessH = ((0.1 * 50) - (0.1 * 25)) / (50 + 25);
  assert.equal(excessH, 1 / 30);
  close(solvePh(strong, 25), 1.4771212547157537, EPS_SOLVER, '25 mL pH epsilon 1e-6');
});

test('strong-strong equivalence pH is neutral within epsilon 1e-8', () => {
  close(solvePh(strong, 50), 7.0, 1e-8, 'equivalence pH epsilon 1e-8');
});

test('strong acid at 60 mL matches hand excess-base pH', () => {
  const excessOh = ((0.1 * 60) - (0.1 * 50)) / (50 + 60);
  assert.ok(excessOh > 0.009090909 && excessOh < 0.00909091, 'excess base is 1/110 M');
  close(solvePh(strong, 60), 11.958607314894325, EPS_SOLVER, '60 mL pH epsilon 1e-6');
});

test('strong acid final curve point matches hand excess-base pH at 75 mL', () => {
  const excessOh = ((0.1 * 75) - (0.1 * 50)) / (50 + 75);
  assert.equal(excessOh, 0.02);
  close(solvePh(strong, 75), 12.301029995674838, EPS_SOLVER, '75 mL pH epsilon 1e-6');
});

test('strong-acid solutions satisfy charge balance before and after equivalence', () => {
  const beforePh = solvePh(strong, 25);
  const afterPh = solvePh(strong, 60);
  assert.ok(Math.abs(chargeResidualAtPh(beforePh, strong, 25)) < EPS_RESIDUAL, 'pre-equivalence residual epsilon 1e-10 M');
  assert.ok(Math.abs(chargeResidualAtPh(afterPh, strong, 60)) < EPS_RESIDUAL, 'post-equivalence residual epsilon 1e-10 M');
});

test('weak-acid initial pH matches the independent quadratic hand calculation', () => {
  const ka = weak.ka;
  const ca = weak.analyteConcentration;
  const hydrogen = (-ka + Math.sqrt(ka * ka + 4 * ka * ca)) / 2;
  assert.ok(hydrogen > 0.00133267 && hydrogen < 0.00133268, 'hand hydrogen-ion concentration is about 0.001332671 M');
  close(solvePh(weak, 0), 2.8752770615501357, 2e-9, 'initial weak-acid pH epsilon 2e-9');
});

test('weak-acid equivalence volume is the hand stoichiometric ratio', () => {
  assert.equal(equivalenceVolume(weak), 50);
  assert.equal((0.1 * 50) / 0.1, 50);
});

test('weak-acid equivalence pH matches conjugate-base hydrolysis from Ka and Ca', () => {
  const conjugateBase = (weak.analyteConcentration * weak.analyteVolume) / (weak.analyteVolume + equivalenceVolume(weak));
  const hydroxide = Math.sqrt((KW / weak.ka) * conjugateBase);
  const handPh = 14 + Math.log10(hydroxide);
  assert.equal(conjugateBase, 0.05);
  assert.ok(handPh > 8.72184 && handPh < 8.72185, 'hand hydrolysis estimate is about pH 8.72185');
  close(exactEquivalencePh(weak), handPh, 1e-4, 'equivalence hydrolysis epsilon 1e-4');
});

test('weak-acid equivalence point is basic rather than forced to pH 7', () => {
  assert.ok(exactEquivalencePh(weak) > 8.7, 'solved equivalence pH is above 8.7');
  assert.ok(exactEquivalencePh(weak) < 8.73, 'solved equivalence pH stays near the hand hydrolysis value');
});

test('half-equivalence pH equals pKa within epsilon 7e-4', () => {
  close(phAtHalfEquivalence(weak), PKA_ACETIC, 7e-4, 'half-equivalence epsilon 7e-4');
  assert.equal(-Math.log10(weak.ka), PKA_ACETIC);
});

test('Henderson-Hasselbalch half-neutralization identity is exact', () => {
  close(hendersonPh(weak, 25), PKA_ACETIC, EPS_EXACT, 'Henderson half-equivalence epsilon 1e-12');
});

test('quarter-equivalence pH is near the hand Henderson value within epsilon 0.003', () => {
  const handPh = PKA_ACETIC + Math.log10(1 / 3);
  close(solvePh(weak, 12.5), handPh, 0.003, 'quarter-equivalence epsilon 0.003');
});

test('ninety-percent-neutralized pH is near the hand Henderson value within epsilon 5e-4', () => {
  const handPh = PKA_ACETIC + Math.log10(9);
  close(solvePh(weak, 45), handPh, 5e-4, '90 percent neutralized epsilon 5e-4');
});

test('weak-acid post-equivalence pH matches the excess-base hand calculation', () => {
  const excessOh = ((0.1 * 60) - (0.1 * 50)) / (50 + 60);
  close(solvePh(weak, 60), 14 + Math.log10(excessOh), 2e-3, 'post-equivalence excess base epsilon 0.002');
});

test('weak-acid solutions satisfy charge balance at equivalence and beyond', () => {
  const eqPh = exactEquivalencePh(weak);
  const postPh = solvePh(weak, 60);
  assert.ok(Math.abs(chargeResidualAtPh(eqPh, weak, 50)) < EPS_RESIDUAL, 'equivalence residual epsilon 1e-10 M');
  assert.ok(Math.abs(chargeResidualAtPh(postPh, weak, 60)) < EPS_RESIDUAL, 'post-equivalence residual epsilon 1e-10 M');
});

test('buffer-region endpoints are the exact 1/11 and 10/11 equivalence volumes', () => {
  const buffer = bufferRange(weak);
  close(buffer.startVolume, 50 / 11, EPS_EXACT, 'buffer start epsilon 1e-12 mL');
  close(buffer.endVolume, 500 / 11, EPS_EXACT, 'buffer end epsilon 1e-12 mL');
  assert.ok(buffer.endVolume > buffer.startVolume);
});

test('buffer lower edge is near pKa - 1 within epsilon 0.012', () => {
  const buffer = bufferRange(weak);
  close(buffer.startPh, PKA_ACETIC - 1, 0.012, 'buffer lower-edge epsilon 0.012');
});

test('buffer upper edge is near pKa + 1 within epsilon 0.001', () => {
  const buffer = bufferRange(weak);
  close(buffer.endPh, PKA_ACETIC + 1, 0.001, 'buffer upper-edge epsilon 0.001');
});

test('buffer-region slope matches the hand Henderson slope within epsilon 5e-4 pH per mL', () => {
  const buffer = bufferRange(weak);
  const slope = (buffer.endPh - buffer.startPh) / (buffer.endVolume - buffer.startVolume);
  const handSlope = 2 / ((500 / 11) - (50 / 11));
  assert.ok(handSlope > 0.0488888 && handSlope < 0.0488889, 'hand slope is about 0.0488889 pH/mL');
  close(slope, handSlope, 5e-4, 'buffer slope epsilon 5e-4 pH/mL');
});

test('strong-acid mode has no weak-acid buffer range', () => {
  assert.equal(bufferRange(strong), null);
});

test('grid scan brackets a known pH 7 root', () => {
  const bracket = scanChargeRoot((ph) => ph - 7);
  assert.ok(bracket.lo < 7, 'lower bracket is below pH 7');
  assert.ok(bracket.hi > 7, 'upper bracket is above pH 7');
});

test('grid scan bracket width is one 0.05 pH step', () => {
  const bracket = scanChargeRoot((ph) => ph - 7);
  assert.ok(bracket.hi - bracket.lo <= 0.050000001, 'bracket width epsilon 1e-9 beyond one grid step');
});

test('bisection converges to the bracketed root within epsilon 1e-12', () => {
  const residual = (ph) => ph - 7;
  const bracket = scanChargeRoot(residual);
  close(bisectRoot(residual, bracket.lo, bracket.hi), 7, EPS_EXACT, 'bisection root epsilon 1e-12');
});

test('bisection returns an exact endpoint root immediately', () => {
  assert.equal(bisectRoot((ph) => ph - 7, 7, 7), 7);
});

test('bisection rejects an interval that does not bracket a root', () => {
  assert.throws(() => bisectRoot((ph) => ph - 7, 8, 9), /does not bracket/);
});

test('grid scan reports when no root exists in the pH bounds', () => {
  assert.throws(() => scanChargeRoot(() => 1), /no charge-balance root bracketed/);
});

test('generated curve exposes the normalized input and requested point count', () => {
  const curve = generateCurve(weak);
  assert.equal(curve.points.length, 241);
  assert.equal(curve.input.acidType, 'weak');
  assert.equal(curve.input.maxTitrantVolume, 75);
  assert.equal(curve.input.points, 241);
});

test('generated curve volumes form an exact linear grid', () => {
  const curve = generateCurve(strong);
  assert.equal(curve.points[0].volume, 0);
  assert.equal(curve.points.at(-1).volume, 75);
  close(curve.points[1].volume - curve.points[0].volume, 0.3125, EPS_EXACT, 'grid spacing epsilon 1e-12 mL');
  close(curve.points[120].volume, 37.5, EPS_EXACT, 'middle grid volume epsilon 1e-12 mL');
});

test('generated chart-data points have the required shape and finite values', () => {
  const curve = generateCurve(weak);
  for (const point of [curve.points[0], curve.points[120], curve.points.at(-1)]) {
    assert.deepEqual(Object.keys(point), ['volume', 'ph', 'hydrogen', 'hydroxide', 'residual']);
    assert.ok(Number.isFinite(point.volume));
    assert.ok(Number.isFinite(point.ph));
    assert.ok(Number.isFinite(point.hydrogen));
    assert.ok(Number.isFinite(point.hydroxide));
    assert.ok(Number.isFinite(point.residual));
  }
});

test('generated chart data keeps hydrogen and hydroxide consistent with Kw', () => {
  const curve = generateCurve(strong);
  for (const index of [0, 60, 120, 180, 240]) {
    const point = curve.points[index];
    close(point.hydrogen * point.hydroxide, KW, 1e-22, `Kw product at index ${index} epsilon 1e-22`);
  }
});

test('strong curve pH is monotonic across the whole sweep', () => {
  const curve = generateCurve(strong);
  assert.equal(curve.monotonic, true);
  for (let i = 1; i < curve.points.length; i++) {
    assert.ok(curve.points[i].ph >= curve.points[i - 1].ph - EPS_MONOTONIC, `monotonic at index ${i} epsilon 1e-10 pH`);
  }
});

test('weak curve pH is monotonic across the whole sweep', () => {
  const curve = generateCurve(weak);
  assert.equal(curve.monotonic, true);
  for (let i = 1; i < curve.points.length; i++) {
    assert.ok(curve.points[i].ph >= curve.points[i - 1].ph - EPS_MONOTONIC, `monotonic at index ${i} epsilon 1e-10 pH`);
  }
});

test('strong curve maximum charge-balance residual stays within epsilon 1e-10 M', () => {
  const curve = generateCurve(strong);
  assert.ok(curve.maxAbsResidual < EPS_RESIDUAL, `maximum residual ${curve.maxAbsResidual}`);
});

test('weak curve maximum charge-balance residual stays within epsilon 1e-10 M', () => {
  const curve = generateCurve(weak);
  assert.ok(curve.maxAbsResidual < EPS_RESIDUAL, `maximum residual ${curve.maxAbsResidual}`);
});

test('chart-data endpoint values match the hand-computed strong-acid sweep', () => {
  const curve = generateCurve(strong);
  close(curve.initialPh, 1.0, EPS_SOLVER, 'initial chart pH epsilon 1e-6');
  close(curve.finalPh, 12.301029995674838, EPS_SOLVER, 'final chart pH epsilon 1e-6');
  close(curve.equivalencePh, 7.0, 1e-8, 'equivalence chart pH epsilon 1e-8');
});

test('neutral equivalence selects bromothymol blue inside its transition window', () => {
  const indicator = recommendIndicator(7.0);
  assert.equal(indicator.id, 'bromothymol-blue');
  assert.equal(indicator.match, 'inside-window');
  assert.equal(indicator.distanceToWindow, 0);
});

test('lower edge pH 3.1 selects methyl orange inside its transition window', () => {
  const indicator = recommendIndicator(3.1);
  assert.equal(indicator.id, 'methyl-orange');
  assert.equal(indicator.match, 'inside-window');
});

test('upper edge pH 10.0 selects phenolphthalein inside its transition window', () => {
  const indicator = recommendIndicator(10.0);
  assert.equal(indicator.id, 'phenolphthalein');
  assert.equal(indicator.match, 'inside-window');
});

test('shared edge pH 6.0 uses the closest indicator pKa among containing windows', () => {
  const indicator = recommendIndicator(6.0);
  assert.equal(indicator.id, 'methyl-red');
  assert.equal(indicator.match, 'inside-window');
});

test('acetic-acid equivalence selects phenolphthalein inside its transition window', () => {
  const indicator = recommendIndicator(exactEquivalencePh(weak));
  assert.equal(indicator.id, 'phenolphthalein');
  assert.equal(indicator.match, 'inside-window');
});

test('pH just below phenolphthalein window is explicitly rejected as outside range', () => {
  const indicator = recommendIndicator(8.299);
  assert.equal(indicator.id, 'phenolphthalein');
  assert.equal(indicator.match, 'nearest-outside-window');
  close(indicator.distanceToWindow, 0.001, 1e-12, 'distance below window epsilon 1e-12 pH');
});

test('pH above every tabulated window is explicitly rejected as outside range', () => {
  const indicator = recommendIndicator(11.2);
  assert.equal(indicator.id, 'phenolphthalein');
  assert.equal(indicator.match, 'nearest-outside-window');
  close(indicator.distanceToWindow, 1.2, 1e-12, 'distance above window epsilon 1e-12 pH');
});

test('input validation rejects zero, negative, NaN, out-of-range Ka, and zero burette range', () => {
  assert.throws(() => validateInput({ ...strong, analyteConcentration: 0 }), /analyteConcentration/, 'zero acid concentration rejected');
  assert.throws(() => validateInput({ ...strong, analyteConcentration: Number.NaN }), /analyteConcentration must be a finite number/, 'NaN acid concentration rejected');
  assert.throws(() => validateInput({ ...strong, titrantConcentration: -0.1 }), /titrantConcentration/, 'negative titrant concentration rejected');
  assert.throws(() => validateInput({ ...strong, analyteVolume: Number.NaN }), /analyteVolume must be a finite number/, 'NaN analyte volume rejected');
  assert.throws(() => validateInput({ ...strong, maxTitrantVolume: 0 }), /maxTitrantVolume/, 'zero burette range rejected');
  assert.throws(() => validateInput({ ...strong, maxTitrantVolume: -1 }), /maxTitrantVolume/, 'negative burette range rejected');
  assert.throws(() => validateInput({ ...weak, ka: 0 }), /ka/, 'zero Ka rejected');
  assert.throws(() => validateInput({ ...weak, ka: 1e-13 }), /ka/, 'Ka below the validated range rejected');
  assert.throws(() => validateInput({ ...weak, ka: 0.2 }), /ka/, 'Ka above the validated range rejected');
  assert.throws(() => validateInput({ ...weak, ka: undefined }), /ka/, 'missing weak-acid Ka rejected');
  assert.throws(() => validateInput({ ...strong, acidType: 'diprotic' }), /acidType/, 'unsupported acid type rejected');
  assert.throws(() => validateInput({ ...strong, points: 40 }), /points/, 'too few curve points rejected');
  assert.throws(() => validateInput({ ...strong, points: 241.5 }), /points/, 'noninteger curve points rejected');
  assert.throws(() => solvePh(strong, -1), /titrantVolume/, 'negative titrant volume rejected');
  assert.throws(() => solvePh(strong, Number.NaN), /titrantVolume/, 'NaN titrant volume rejected');
});

test('input validation normalizes valid input and derives the default burette range', () => {
  const normalized = validateInput(weak);
  assert.equal(normalized.acidType, 'weak');
  assert.equal(normalized.maxTitrantVolume, 75);
  assert.equal(normalized.points, 241);
  assert.equal(normalized.ka, weak.ka);

  const automaticRange = validateInput({ ...strong, maxTitrantVolume: undefined });
  assert.equal(automaticRange.maxTitrantVolume, 75, 'missing burette range defaults to 1.5 times equivalence');
  assert.equal(automaticRange.ka, null, 'strong-acid mode normalizes Ka to null');
});

test('meter table has the expected shape, exact rows, and honest two-decimal rounding', () => {
  const readings = meterReadings(weak);
  assert.equal(readings.length, 7);
  assert.deepEqual(readings.map((row) => row.fraction), [0, 0.25, 0.5, 0.9, 1, 1.1, 1.25]);
  assert.equal(readings[0].label, 'initial');
  assert.equal(readings[4].label, 'equivalence');
  assert.equal(readings[4].volume, 50);
  close(readings[4].ph, exactEquivalencePh(weak), EPS_EXACT, 'meter equivalence epsilon 1e-12 pH');
  for (const row of readings) {
    assert.equal(row.meterReading, Math.round(row.ph * 100) / 100);
  }
});

test('validity flags expose assumptions plus short-range and dilute-solution warnings', () => {
  const flags = validityFlags(weak, 75);
  assert.ok(flags.some((flag) => flag.includes('25 C')), 'temperature assumption present');
  assert.ok(flags.some((flag) => flag.includes('activity coefficients ignored')), 'activity assumption present');
  assert.ok(flags.some((flag) => flag.includes('monoprotic weak acid')), 'weak-acid assumption present');
  assert.ok(flags.some((flag) => flag.includes('not instrument-grade')), 'instrument limitation present');
  assert.ok(!flags.some((flag) => flag.includes('stops before equivalence')), 'complete range does not warn');
  assert.ok(validityFlags(weak, 40).some((flag) => flag.includes('stops before equivalence')), 'short range warning appears');
  assert.ok(validityFlags({ ...strong, analyteConcentration: 1e-5 }, 75).some((flag) => flag.includes('water autoionization')), 'dilute warning appears');
});

test('full analysis joins curve, buffer, indicator, meter, and monotonicity evidence', () => {
  const analysis = analyzeTitration(weak);
  assert.equal(analysis.monotonic, true);
  assert.equal(analysis.indicator.id, 'phenolphthalein');
  assert.equal(analysis.buffer.pKa, PKA_ACETIC);
  assert.equal(analysis.meter.length, 7);
  assert.equal(analysis.points.length, 241);
  close(analysis.halfEquivalencePh, PKA_ACETIC, 7e-4, 'analysis half-equivalence epsilon 7e-4');
  close(analysis.equivalencePh, exactEquivalencePh(weak), EPS_EXACT, 'analysis equivalence epsilon 1e-12');
  assert.ok(analysis.flags.length >= 5, 'at least five explicit assumptions or warnings are exposed');
});
