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
  recommendIndicator,
  scanChargeRoot,
  solvePh,
  validateInput,
  validityFlags,
} from '../solver.js';

const close = (actual, expected, tolerance, message) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
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

test('strong-acid strong-base charge balance matches hand-computed excess-acid and excess-base points', () => {
  assert.equal(equivalenceVolume(strong), 50);

  close(solvePh(strong, 0), 1.0, 1e-6, '0.100 M strong acid initial pH');

  const beforeEqH = ((0.1 * 50) - (0.1 * 10)) / (50 + 10);
  close(solvePh(strong, 10), -Math.log10(beforeEqH), 1e-6, '10 mL excess strong acid pH');
  assert.ok(beforeEqH > 0.066 && beforeEqH < 0.067, 'hand excess acid concentration is 0.0667 M');

  close(solvePh(strong, 50), 7.0, 1e-8, 'strong-strong equivalence pH');

  const excessOh = ((0.1 * 60) - (0.1 * 50)) / (50 + 60);
  const afterEq = 14 + Math.log10(excessOh);
  close(solvePh(strong, 60), afterEq, 1e-6, '60 mL excess strong base pH');
  assert.ok(afterEq > 11.95 && afterEq < 11.96, 'hand excess-base pH is about 11.959');

  const ph = solvePh(strong, 25);
  assert.ok(Math.abs(chargeResidualAtPh(ph, strong, 25)) < 1e-11, 'strong-acid charge-balance residual is near zero');
});

test('weak-acid strong-base solver matches independent initial-acid, buffer, and equivalence calculations', () => {
  const ka = weak.ka;
  const ca = weak.analyteConcentration;
  const initialH = (-ka + Math.sqrt(ka * ka + 4 * ka * ca)) / 2;
  const initialPh = -Math.log10(initialH);
  close(solvePh(weak, 0), initialPh, 5e-4, 'independent weak-acid initial quadratic');
  assert.ok(initialPh > 2.87 && initialPh < 2.88, 'hand initial weak-acid pH is about 2.875');

  const pKa = -Math.log10(ka);
  close(solvePh(weak, 25), pKa, 0.01, 'half-equivalence buffer pH is pKa');
  close(hendersonPh(weak, 25), pKa, 1e-12, 'Henderson-Hasselbalch half-neutralization identity');

  const eqVolume = equivalenceVolume(weak);
  assert.equal(eqVolume, 50);
  const conjugateBase = (ca * weak.analyteVolume) / (weak.analyteVolume + eqVolume);
  const approxOh = Math.sqrt((KW / ka) * conjugateBase);
  const approxEqPh = 14 + Math.log10(approxOh);
  close(exactEquivalencePh(weak), approxEqPh, 0.02, 'independent conjugate-base hydrolysis estimate');
  assert.ok(approxEqPh > 8.70 && approxEqPh < 8.74, 'hand weak-acid equivalence pH is about 8.72');
  assert.ok(exactEquivalencePh(weak) > 7.5, 'weak-acid equivalence point is basic, not forced to pH 7');

  const postEqOh = ((0.1 * 60) - (0.1 * 50)) / (50 + 60);
  close(solvePh(weak, 60), 14 + Math.log10(postEqOh), 2e-3, 'post-equivalence excess base dominates');
  assert.ok(Math.abs(chargeResidualAtPh(solvePh(weak, 37.5), weak, 37.5)) < 1e-11, 'weak-acid charge-balance residual is near zero');
});

test('grid scan plus bisection brackets and solves a known monotonic root', () => {
  const residual = (ph) => ph - 7;
  const bracket = scanChargeRoot(residual);
  assert.ok(bracket.lo < 7 && bracket.hi > 7, 'grid brackets pH 7');
  assert.ok(bracket.hi - bracket.lo <= 0.050000001, 'bracket width is one pH grid step');
  close(bisectRoot(residual, bracket.lo, bracket.hi), 7, 1e-12, 'bisected pH root');
  assert.equal(bisectRoot(residual, 7, 7), 7, 'exact endpoint root returns immediately');
  assert.throws(() => bisectRoot(residual, 8, 9), /does not bracket/, 'bisection rejects an unbracketed interval');
});

test('generated strong and weak curves are monotonic, bounded, and numerically charge-balanced', () => {
  const strongCurve = generateCurve(strong);
  const weakCurve = generateCurve(weak);

  assert.equal(strongCurve.points.length, 241);
  assert.equal(weakCurve.points.length, 241);
  assert.equal(strongCurve.monotonic, true);
  assert.equal(weakCurve.monotonic, true);
  assert.ok(strongCurve.maxAbsResidual < 1e-10, 'strong curve maximum residual below 1e-10 M');
  assert.ok(weakCurve.maxAbsResidual < 1e-10, 'weak curve maximum residual below 1e-10 M');
  assert.equal(strongCurve.points[0].volume, 0);
  assert.equal(strongCurve.points.at(-1).volume, 75);
  assert.ok(strongCurve.points[0].ph < strongCurve.points.at(-1).ph, 'strong curve rises overall');
  assert.ok(weakCurve.points[0].ph < weakCurve.points.at(-1).ph, 'weak curve rises overall');

  for (let i = 1; i < strongCurve.points.length; i++) {
    assert.ok(strongCurve.points[i].ph >= strongCurve.points[i - 1].ph - 1e-10, `strong curve monotonic at index ${i}`);
    assert.ok(weakCurve.points[i].ph >= weakCurve.points[i - 1].ph - 1e-10, `weak curve monotonic at index ${i}`);
  }
});

test('weak-acid buffer range occupies the expected Henderson-Hasselbalch region', () => {
  const buffer = bufferRange(weak);
  const pKa = -Math.log10(weak.ka);
  close(buffer.startVolume, 50 / 11, 1e-12, 'buffer start volume');
  close(buffer.endVolume, 500 / 11, 1e-12, 'buffer end volume');
  close(buffer.startPh, pKa - 1, 0.025, 'buffer lower edge near pKa - 1');
  close(buffer.endPh, pKa + 1, 0.025, 'buffer upper edge near pKa + 1');
  assert.ok(buffer.endVolume > buffer.startVolume, 'buffer volume range is ordered');
  assert.equal(bufferRange(strong), null, 'strong-acid mode has no weak-acid buffer range');
});

test('indicator recommendation uses transition windows rather than a universal indicator', () => {
  const neutral = recommendIndicator(7.0);
  assert.equal(neutral.id, 'bromothymol-blue');
  assert.equal(neutral.match, 'inside-window');
  assert.equal(neutral.distanceToWindow, 0);

  const weakEq = recommendIndicator(exactEquivalencePh(weak));
  assert.equal(weakEq.id, 'phenolphthalein');
  assert.equal(weakEq.match, 'inside-window');

  const acidic = recommendIndicator(3.6);
  assert.equal(acidic.id, 'methyl-orange');
  assert.equal(acidic.match, 'inside-window');

  const outside = recommendIndicator(11.2);
  assert.equal(outside.id, 'phenolphthalein');
  assert.equal(outside.match, 'nearest-outside-window');
  assert.ok(outside.distanceToWindow > 1.19 && outside.distanceToWindow < 1.21, 'outside-window distance is explicit');
});

test('meter readings expose exact model pH plus an honestly rounded meter column', () => {
  const readings = meterReadings(weak);
  assert.equal(readings.length, 7);
  assert.equal(readings[0].label, 'initial');
  assert.equal(readings[4].label, 'equivalence');
  assert.equal(readings[4].volume, 50);
  close(readings[4].ph, exactEquivalencePh(weak), 1e-12, 'meter table equivalence uses exact solve');
  assert.equal(readings[4].meterReading, Math.round(readings[4].ph * 100) / 100);
  assert.ok(readings[1].ph < readings[2].ph, 'quarter-neutralized pH precedes half-neutralized pH');
  assert.ok(readings[3].ph < readings[4].ph, '90 percent neutralized pH precedes equivalence pH');
  assert.ok(readings[5].ph > readings[4].ph, 'post-equivalence pH rises');
});

test('input validation rejects invalid chemistry and accepts a normalized valid input', () => {
  assert.throws(() => validateInput({ ...strong, analyteConcentration: 0 }), /analyteConcentration/, 'zero acid concentration rejected');
  assert.throws(() => validateInput({ ...strong, titrantConcentration: -0.1 }), /titrantConcentration/, 'negative titrant concentration rejected');
  assert.throws(() => validateInput({ ...strong, analyteVolume: 0 }), /analyteVolume/, 'zero analyte volume rejected');
  assert.throws(() => validateInput({ ...strong, maxTitrantVolume: 0 }), /maxTitrantVolume/, 'zero titrant range rejected');
  assert.throws(() => validateInput({ ...strong, acidType: 'diprotic' }), /acidType/, 'unsupported acid type rejected');
  assert.throws(() => validateInput({ ...weak, ka: 0 }), /ka/, 'zero Ka rejected');
  assert.throws(() => validateInput({ ...weak, ka: undefined }), /ka/, 'missing weak-acid Ka rejected');
  assert.throws(() => validateInput({ ...strong, points: 40 }), /points/, 'too few curve points rejected');
  assert.throws(() => validateInput({ ...strong, points: 241.5 }), /points/, 'noninteger curve points rejected');
  assert.throws(() => solvePh(strong, -1), /titrantVolume/, 'negative titrant volume rejected');

  const normalized = validateInput(weak);
  assert.equal(normalized.acidType, 'weak');
  assert.equal(normalized.maxTitrantVolume, 75);
  assert.equal(normalized.points, 241);
  const automaticRange = validateInput({ ...strong, maxTitrantVolume: undefined });
  assert.equal(automaticRange.maxTitrantVolume, 75, 'missing titrant range defaults to 1.5x equivalence');
});

test('validity flags state assumptions and dynamic warnings explicitly', () => {
  const flags = validityFlags(weak, 75);
  assert.ok(flags.some((flag) => flag.includes('25 C')), 'temperature assumption present');
  assert.ok(flags.some((flag) => flag.includes('activity coefficients ignored')), 'activity assumption present');
  assert.ok(flags.some((flag) => flag.includes('monoprotic weak acid')), 'monoprotic weak-acid assumption present');
  assert.ok(flags.some((flag) => flag.includes('not instrument-grade')), 'honest instrument limitation present');
  assert.ok(!flags.some((flag) => flag.includes('stops before equivalence')), 'complete range does not warn');

  const shortFlags = validityFlags(weak, 40);
  assert.ok(shortFlags.some((flag) => flag.includes('stops before equivalence')), 'short range warning appears');

  const diluteFlags = validityFlags({ ...strong, analyteConcentration: 1e-5 }, 75);
  assert.ok(diluteFlags.some((flag) => flag.includes('water autoionization')), 'dilute-solution warning appears');
});

test('full analysis object joins curve, equivalence, buffer, indicator, meter, and monotonicity evidence', () => {
  const analysis = analyzeTitration(weak);
  assert.equal(analysis.monotonic, true);
  assert.equal(analysis.indicator.id, 'phenolphthalein');
  assert.equal(analysis.buffer.pKa, -Math.log10(weak.ka));
  assert.equal(analysis.meter.length, 7);
  assert.ok(analysis.halfEquivalencePh > 4.73 && analysis.halfEquivalencePh < 4.76, 'half-equivalence pH in acetic-acid buffer region');
  close(analysis.equivalencePh, exactEquivalencePh(weak), 1e-12, 'analysis equivalence pH is exact solver result');
  assert.ok(analysis.flags.length >= 5, 'at least five explicit assumptions or warnings are exposed');
});
