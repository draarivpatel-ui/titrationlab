// Exact charge-balance titration solver for TitrationLab.
// All volumes are mL, all concentrations are mol/L, and temperature is fixed at 25 C.

export const KW = 1e-14;
export const PH_MIN = -2;
export const PH_MAX = 16;
export const PH_GRID_STEP = 0.05;

export const INDICATORS = Object.freeze([
  Object.freeze({ id: 'methyl-orange', name: 'Methyl orange', pKa: 3.7, low: 3.1, high: 4.4, acidColor: '#e4574f', baseColor: '#f2c14e' }),
  Object.freeze({ id: 'methyl-red', name: 'Methyl red', pKa: 5.1, low: 4.4, high: 6.2, acidColor: '#d94848', baseColor: '#f2d16b' }),
  Object.freeze({ id: 'bromothymol-blue', name: 'Bromothymol blue', pKa: 7.1, low: 6.0, high: 7.6, acidColor: '#f0cf5a', baseColor: '#2f7ddb' }),
  Object.freeze({ id: 'phenolphthalein', name: 'Phenolphthalein', pKa: 9.3, low: 8.3, high: 10.0, acidColor: '#d8dee9', baseColor: '#f065a7' }),
]);

const LIMITS = Object.freeze({
  analyteConcentration: [1e-6, 2],
  titrantConcentration: [1e-6, 2],
  analyteVolume: [1, 500],
  maxTitrantVolume: [1, 1000],
  ka: [1e-12, 1e-1],
  points: [41, 2001],
});

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function checkRange(errors, name, value, [min, max], unit) {
  if (!finiteNumber(value)) {
    errors.push(`${name} must be a finite number`);
  } else if (value < min || value > max) {
    errors.push(`${name} must be between ${min} and ${max} ${unit}`);
  }
}

export function validateInput(input = {}) {
  const errors = [];
  const acidType = input.acidType ?? 'strong';
  if (acidType !== 'strong' && acidType !== 'weak') errors.push('acidType must be "strong" or "weak"');

  checkRange(errors, 'analyteConcentration', input.analyteConcentration, LIMITS.analyteConcentration, 'M');
  checkRange(errors, 'titrantConcentration', input.titrantConcentration, LIMITS.titrantConcentration, 'M');
  checkRange(errors, 'analyteVolume', input.analyteVolume, LIMITS.analyteVolume, 'mL');
  if (input.maxTitrantVolume != null) checkRange(errors, 'maxTitrantVolume', input.maxTitrantVolume, LIMITS.maxTitrantVolume, 'mL');
  if (acidType === 'weak') checkRange(errors, 'ka', input.ka, LIMITS.ka, 'M');

  let points = input.points ?? 241;
  if (!Number.isInteger(points) || points < LIMITS.points[0] || points > LIMITS.points[1]) {
    errors.push(`points must be an integer between ${LIMITS.points[0]} and ${LIMITS.points[1]}`);
  }

  if (errors.length) throw new Error(`Invalid titration input: ${errors.join('; ')}`);

  const normalized = {
    acidType,
    analyteConcentration: input.analyteConcentration,
    titrantConcentration: input.titrantConcentration,
    analyteVolume: input.analyteVolume,
    ka: acidType === 'weak' ? input.ka : null,
    maxTitrantVolume: input.maxTitrantVolume ?? null,
    points,
  };
  if (normalized.maxTitrantVolume == null) {
    normalized.maxTitrantVolume = Math.min(
      LIMITS.maxTitrantVolume[1],
      Math.max(LIMITS.maxTitrantVolume[0], equivalenceVolume(normalized) * 1.5),
    );
  }
  return normalized;
}

export function equivalenceVolume(input) {
  return (input.analyteConcentration * input.analyteVolume) / input.titrantConcentration;
}

export function speciesAt(input, titrantVolume) {
  const totalVolume = input.analyteVolume + titrantVolume;
  const titrantCation = (input.titrantConcentration * titrantVolume) / totalVolume;
  const acidTotal = (input.analyteConcentration * input.analyteVolume) / totalVolume;
  return { totalVolume, titrantCation, acidTotal };
}

export function chargeResidualAtPh(ph, input, titrantVolume) {
  const h = 10 ** (-ph);
  const oh = KW / h;
  const { titrantCation, acidTotal } = speciesAt(input, titrantVolume);
  if (input.acidType === 'strong') {
    return h + titrantCation - oh - acidTotal;
  }
  const aMinus = (acidTotal * input.ka) / (h + input.ka);
  return h + titrantCation - oh - aMinus;
}

export function scanChargeRoot(residual, phMin = PH_MIN, phMax = PH_MAX, step = PH_GRID_STEP) {
  let lowerPh = phMin;
  let lowerValue = residual(phMin);
  if (!Number.isFinite(lowerValue)) throw new Error('charge-balance residual is not finite at the lower pH bound');
  if (lowerValue === 0) return { lo: phMin, hi: phMin };

  for (let ph = phMin + step; ph <= phMax + step * 0.5; ph += step) {
    const value = residual(ph);
    if (!Number.isFinite(value)) throw new Error(`charge-balance residual is not finite at pH ${ph}`);
    if (value === 0) return { lo: ph, hi: ph };
    if ((lowerValue < 0 && value > 0) || (lowerValue > 0 && value < 0)) {
      return { lo: lowerPh, hi: ph };
    }
    lowerPh = ph;
    lowerValue = value;
  }
  throw new Error(`no charge-balance root bracketed between pH ${phMin} and ${phMax}`);
}

export function bisectRoot(residual, lo, hi, iterations = 100) {
  if (lo === hi) return lo;
  let fLo = residual(lo);
  let fHi = residual(hi);
  if (fLo === 0) return lo;
  if (fHi === 0) return hi;
  if (fLo * fHi > 0) throw new Error(`bisection interval does not bracket a root: f(${lo})=${fLo}, f(${hi})=${fHi}`);

  let a = lo;
  let b = hi;
  let fa = fLo;
  for (let i = 0; i < iterations; i++) {
    const mid = (a + b) / 2;
    const fm = residual(mid);
    if (fm === 0) return mid;
    if ((fa < 0 && fm < 0) || (fa > 0 && fm > 0)) {
      a = mid;
      fa = fm;
    } else {
      b = mid;
    }
  }
  return (a + b) / 2;
}

export function solvePh(input, titrantVolume) {
  if (!finiteNumber(titrantVolume) || titrantVolume < 0) throw new Error('titrantVolume must be a nonnegative finite number');
  const residual = (ph) => chargeResidualAtPh(ph, input, titrantVolume);
  const { lo, hi } = scanChargeRoot(residual);
  return bisectRoot(residual, lo, hi);
}

export function exactEquivalencePh(input) {
  return solvePh(input, equivalenceVolume(input));
}

export function phAtHalfEquivalence(input) {
  return solvePh(input, equivalenceVolume(input) / 2);
}

export function generateCurve(input) {
  const n = validateInput(input);
  const eqVolume = equivalenceVolume(n);
  const curve = [];
  let monotonic = true;
  let maxAbsResidual = 0;
  let previousPh = null;

  for (let i = 0; i < n.points; i++) {
    const volume = (n.maxTitrantVolume * i) / (n.points - 1);
    const ph = solvePh(n, volume);
    const residual = chargeResidualAtPh(ph, n, volume);
    maxAbsResidual = Math.max(maxAbsResidual, Math.abs(residual));
    if (previousPh != null && ph < previousPh - 1e-10) monotonic = false;
    previousPh = ph;
    curve.push({
      volume,
      ph,
      hydrogen: 10 ** (-ph),
      hydroxide: KW / (10 ** (-ph)),
      residual,
    });
  }

  return {
    input: n,
    points: curve,
    monotonic,
    maxAbsResidual,
    equivalenceVolume: eqVolume,
    equivalencePh: exactEquivalencePh(n),
    initialPh: curve[0].ph,
    finalPh: curve[curve.length - 1].ph,
  };
}

export function bufferRange(input) {
  if (input.acidType !== 'weak') return null;
  const eq = equivalenceVolume(input);
  const startVolume = eq / 11;
  const endVolume = (10 * eq) / 11;
  return {
    startVolume,
    endVolume,
    startPh: solvePh(input, startVolume),
    endPh: solvePh(input, endVolume),
    pKa: -Math.log10(input.ka),
  };
}

export function hendersonPh(input, titrantVolume) {
  if (input.acidType !== 'weak') return null;
  const eq = equivalenceVolume(input);
  if (titrantVolume <= 0 || titrantVolume >= eq) return null;
  return -Math.log10(input.ka) + Math.log10(titrantVolume / (eq - titrantVolume));
}

export function recommendIndicator(equivalencePh, indicators = INDICATORS) {
  const containing = indicators.filter((indicator) => equivalencePh >= indicator.low && equivalencePh <= indicator.high);
  if (containing.length) {
    return {
      ...containing.sort((a, b) => Math.abs(equivalencePh - a.pKa) - Math.abs(equivalencePh - b.pKa))[0],
      match: 'inside-window',
      distanceToWindow: 0,
    };
  }
  const nearest = indicators
    .map((indicator) => {
      const distance = equivalencePh < indicator.low ? indicator.low - equivalencePh : equivalencePh - indicator.high;
      return { ...indicator, distanceToWindow: distance };
    })
    .sort((a, b) => a.distanceToWindow - b.distanceToWindow)[0];
  return { ...nearest, match: 'nearest-outside-window' };
}

export function meterReadings(input, fractions = [0, 0.25, 0.5, 0.9, 1, 1.1, 1.25]) {
  const eq = equivalenceVolume(input);
  return fractions.map((fraction) => {
    const volume = eq * fraction;
    const ph = solvePh(input, volume);
    return {
      fraction,
      volume,
      ph,
      meterReading: Math.round(ph * 100) / 100,
      label: fraction === 0 ? 'initial' : fraction === 1 ? 'equivalence' : `${Math.round(fraction * 100)}% neutralized`,
    };
  });
}

export function validityFlags(input, maxTitrantVolume = input.maxTitrantVolume) {
  const flags = [
    '25 C isothermal model with Kw = 1.0e-14',
    'activity coefficients ignored; concentrations are used as activities',
    'strong acid and strong base are treated as fully dissociated',
  ];
  if (input.acidType === 'weak') {
    flags.push('monoprotic weak acid with one constant Ka; no dilution-dependent Ka or secondary equilibria');
  } else {
    flags.push('monoprotic strong acid; no activity or ion-pair corrections');
  }
  if (input.analyteConcentration < 1e-4 || input.titrantConcentration < 1e-4) {
    flags.push('dilute solution: water autoionization materially shapes the charge balance');
  }
  if (maxTitrantVolume < equivalenceVolume(input)) {
    flags.push('the plotted titrant range stops before equivalence');
  }
  flags.push('modeled simulation only; not instrument-grade or a substitute for laboratory measurement');
  return flags;
}

export function analyzeTitration(input) {
  const n = validateInput(input);
  const curve = generateCurve(n);
  return {
    ...curve,
    halfEquivalencePh: n.acidType === 'weak' ? phAtHalfEquivalence(n) : null,
    buffer: bufferRange(n),
    indicator: recommendIndicator(curve.equivalencePh),
    meter: meterReadings(n),
    flags: validityFlags(n, n.maxTitrantVolume),
  };
}
