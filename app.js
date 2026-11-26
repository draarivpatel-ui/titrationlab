import {
  INDICATORS,
  KW,
  analyzeTitration,
  chargeResidualAtPh,
  solvePh,
} from './solver.js';

const PRESETS = {
  strong: {
    label: 'Strong acid benchmark',
    acidType: 'strong',
    analyteConcentration: 0.1,
    analyteVolume: 50,
    titrantConcentration: 0.1,
    maxTitrantVolume: 75,
    points: 241,
    indicator: 'bromothymol-blue',
    caption: 'Strong acid titrated with strong base.',
  },
  acetic: {
    label: 'Acetic acid buffer',
    acidType: 'weak',
    analyteConcentration: 0.1,
    analyteVolume: 50,
    titrantConcentration: 0.1,
    ka: 1.8e-5,
    maxTitrantVolume: 75,
    points: 241,
    indicator: 'phenolphthalein',
    caption: 'Monoprotic weak acid titrated with strong base.',
  },
  dilute: {
    label: 'Dilute strong acid',
    acidType: 'strong',
    analyteConcentration: 0.001,
    analyteVolume: 100,
    titrantConcentration: 0.002,
    maxTitrantVolume: 75,
    points: 241,
    indicator: 'bromothymol-blue',
    caption: 'Dilute strong acid titrated with strong base.',
  },
  manual: {
    label: 'Manual inputs',
    caption: 'Custom titration inputs.',
  },
};

const $ = (selector) => document.querySelector(selector);
const els = {
  preset: $('#preset-select'),
  acidRadios: [...document.querySelectorAll('input[name="acid-type"]')],
  acidConcentration: $('#acid-concentration'),
  acidVolume: $('#acid-volume'),
  baseConcentration: $('#base-concentration'),
  maxVolume: $('#max-volume'),
  kaField: $('#ka-field'),
  ka: $('#ka-input'),
  indicator: $('#indicator-select'),
  points: $('#points-input'),
  pointsOutput: $('#points-output'),
  reset: $('#reset-button'),
  csv: $('#csv-button'),
  error: $('#input-error'),
  caption: $('#curve-caption'),
  chart: $('#titration-chart'),
  scrub: $('#scrub-input'),
  scrubOutput: $('#scrub-output'),
  pointPh: $('#point-ph'),
  pointH: $('#point-h'),
  pointOh: $('#point-oh'),
  pointResidual: $('#point-residual'),
  eqVolume: $('#eq-volume'),
  eqPh: $('#eq-ph'),
  initialPh: $('#initial-ph'),
  finalPh: $('#final-ph'),
  pkaRow: $('#pka-row'),
  pkaValue: $('#pka-value'),
  bufferRow: $('#buffer-row'),
  bufferValue: $('#buffer-value'),
  indicatorRecommendation: $('#indicator-recommendation'),
  indicatorComparison: $('#indicator-comparison'),
  flags: $('#flags-list'),
  meterBody: $('#meter-body'),
};

const state = {
  analysis: null,
  input: null,
  scrubFraction: 0,
};

function fmt(value, digits = 4) {
  if (!Number.isFinite(value)) return 'not finite';
  return value.toFixed(digits);
}

function fmtVolume(value) {
  return `${value.toFixed(Math.abs(value) < 10 ? 3 : 2)} mL`;
}

function fmtMolar(value) {
  if (!Number.isFinite(value) || value === 0) return '0 M';
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  if (exponent < -3 || exponent > 2) {
    return `${value.toExponential(2).replace('e+', 'e')} M`;
  }
  return `${value.toPrecision(3)} M`;
}

function scientific(value) {
  if (!Number.isFinite(value)) return '0';
  if (value === 0) return '0';
  return value.toExponential(1).replace('e+', 'e');
}

function populateControls() {
  els.preset.innerHTML = Object.entries(PRESETS)
    .map(([id, preset]) => `<option value="${id}">${preset.label}</option>`)
    .join('');
  els.indicator.innerHTML = INDICATORS
    .map((indicator) => `<option value="${indicator.id}">${indicator.name}</option>`)
    .join('');
}

function applyPreset(id) {
  const preset = PRESETS[id];
  if (!preset || id === 'manual') return;
  for (const radio of els.acidRadios) radio.checked = radio.value === preset.acidType;
  els.acidConcentration.value = preset.analyteConcentration;
  els.acidVolume.value = preset.analyteVolume;
  els.baseConcentration.value = preset.titrantConcentration;
  els.maxVolume.value = preset.maxTitrantVolume;
  els.ka.value = preset.ka ?? 1.8e-5;
  els.points.value = preset.points;
  els.indicator.value = preset.indicator;
  els.pointsOutput.value = `${preset.points} points`;
  updateAcidVisibility();
}

function updateAcidVisibility() {
  const weak = els.acidRadios.find((radio) => radio.checked)?.value === 'weak';
  els.kaField.hidden = !weak;
  els.ka.required = weak;
}

function readInputs() {
  const acidType = els.acidRadios.find((radio) => radio.checked)?.value ?? 'strong';
  return {
    acidType,
    analyteConcentration: Number.parseFloat(els.acidConcentration.value),
    analyteVolume: Number.parseFloat(els.acidVolume.value),
    titrantConcentration: Number.parseFloat(els.baseConcentration.value),
    ka: acidType === 'weak' ? Number.parseFloat(els.ka.value) : null,
    maxTitrantVolume: Number.parseFloat(els.maxVolume.value),
    points: Number.parseInt(els.points.value, 10),
  };
}

function selectedIndicator() {
  return INDICATORS.find((indicator) => indicator.id === els.indicator.value) ?? INDICATORS[2];
}

function update() {
  try {
    const input = readInputs();
    const analysis = analyzeTitration(input);
    state.input = analysis.input;
    state.analysis = analysis;
    els.error.hidden = true;
    els.error.textContent = '';
    render();
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error.message.replace('Invalid titration input: ', '');
  }
}

function render() {
  const { analysis, input } = state;
  if (!analysis || !input) return;

  const presetCaption = PRESETS[els.preset.value]?.caption;
  els.caption.textContent = input.acidType === 'weak'
    ? `Monoprotic weak acid titrated with strong base. Ka ${scientific(input.ka)} M.`
    : (presetCaption ?? 'Strong acid titrated with strong base.');

  els.eqVolume.textContent = fmtVolume(analysis.equivalenceVolume);
  els.eqPh.textContent = fmt(analysis.equivalencePh);
  els.initialPh.textContent = fmt(analysis.initialPh);
  els.finalPh.textContent = fmt(analysis.finalPh);

  if (input.acidType === 'weak') {
    els.pkaValue.textContent = fmt(analysis.buffer.pKa);
    els.bufferValue.textContent = `${fmtVolume(analysis.buffer.startVolume)} to ${fmtVolume(analysis.buffer.endVolume)}`;
  } else {
    els.pkaValue.textContent = 'not used';
    els.bufferValue.textContent = 'not present';
  }

  renderIndicator(analysis);
  renderFlags(analysis);
  renderMeter(analysis);
  renderScrubbedPoint();
  drawChart();
}

function renderIndicator(analysis) {
  const best = analysis.indicator;
  const compare = selectedIndicator();
  if (best.match === 'inside-window') {
    els.indicatorRecommendation.textContent = `${best.name}. Its ${best.low} to ${best.high} transition window contains equivalence pH ${fmt(analysis.equivalencePh, 2)} near pKa ${best.pKa}.`;
  } else {
    els.indicatorRecommendation.textContent = `${best.name} is the nearest tabulated choice, but equivalence pH ${fmt(analysis.equivalencePh, 2)} lies outside its ${best.low} to ${best.high} window.`;
  }

  if (compare.id === best.id) {
    els.indicatorComparison.textContent = `The comparison indicator is also ${compare.name}.`;
  } else {
    const inside = analysis.equivalencePh >= compare.low && analysis.equivalencePh <= compare.high;
    els.indicatorComparison.textContent = inside
      ? `${compare.name} also contains the equivalence point in its ${compare.low} to ${compare.high} window.`
      : `${compare.name} spans pH ${compare.low} to ${compare.high}, so it does not contain equivalence pH ${fmt(analysis.equivalencePh, 2)}.`;
  }
}

function renderFlags(analysis) {
  els.flags.innerHTML = '';
  for (const flag of analysis.flags) {
    const li = document.createElement('li');
    li.textContent = flag;
    els.flags.append(li);
  }
}

function renderMeter(analysis) {
  els.meterBody.innerHTML = analysis.meter.map((row) => `
    <tr>
      <td>${row.label}</td>
      <td class="number">${fmtVolume(row.volume)}</td>
      <td class="number">${fmt(row.ph, 5)}</td>
      <td class="number">${row.meterReading.toFixed(2)}</td>
    </tr>
  `).join('');
}

function scrubVolume() {
  if (!state.input) return 0;
  return (state.scrubFraction * state.input.maxTitrantVolume);
}

function renderScrubbedPoint() {
  const { input } = state;
  if (!input) return;
  const volume = scrubVolume();
  const ph = solvePh(input, volume);
  const h = 10 ** (-ph);
  const oh = KW / h;
  const residual = chargeResidualAtPh(ph, input, volume);
  els.scrubOutput.value = fmtVolume(volume);
  els.pointPh.textContent = fmt(ph);
  els.pointH.textContent = fmtMolar(h);
  els.pointOh.textContent = fmtMolar(oh);
  els.pointResidual.textContent = scientific(Math.abs(residual));
}

function chartGeometry(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(320, rect.width);
  const height = Math.max(280, rect.height);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawChart() {
  const { analysis, input } = state;
  if (!analysis || !input) return;

  const { ctx, width, height } = chartGeometry(els.chart);
  const margin = { left: 58, right: 24, top: 24, bottom: 48 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const xMax = input.maxTitrantVolume;
  const phValues = analysis.points.map((point) => point.ph);
  let yMin = Math.min(0, Math.floor(Math.min(...phValues) - 0.35));
  let yMax = Math.max(14, Math.ceil(Math.max(...phValues) + 0.35));
  yMin = Math.max(-1, yMin);
  yMax = Math.min(15, yMax);
  if (yMax - yMin < 4) yMax = yMin + 4;

  const x = (volume) => margin.left + (volume / xMax) * plotW;
  const y = (ph) => margin.top + ((yMax - ph) / (yMax - yMin)) * plotH;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#08151a';
  ctx.fillRect(0, 0, width, height);

  const compare = selectedIndicator();
  ctx.fillStyle = hexToRgba(compare.baseColor, 0.13);
  ctx.fillRect(margin.left, y(compare.high), plotW, Math.max(2, y(compare.low) - y(compare.high)));

  if (analysis.buffer) {
    ctx.fillStyle = 'rgba(94, 215, 195, 0.085)';
    const bx = x(analysis.buffer.startVolume);
    const bw = x(analysis.buffer.endVolume) - bx;
    ctx.fillRect(bx, margin.top, bw, plotH);
  }

  ctx.strokeStyle = 'rgba(159, 193, 191, 0.16)';
  ctx.lineWidth = 1;
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = 'rgba(159, 193, 191, 0.78)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let ph = Math.ceil(yMin); ph <= Math.floor(yMax); ph += 1) {
    const yy = y(ph);
    ctx.beginPath();
    ctx.moveTo(margin.left, yy);
    ctx.lineTo(width - margin.right, yy);
    ctx.stroke();
    ctx.fillText(String(ph), margin.left - 10, yy);
  }

  const xTicks = 5;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i <= xTicks; i++) {
    const volume = (xMax * i) / xTicks;
    const xx = x(volume);
    ctx.strokeStyle = 'rgba(159, 193, 191, 0.11)';
    ctx.beginPath();
    ctx.moveTo(xx, margin.top);
    ctx.lineTo(xx, height - margin.bottom);
    ctx.stroke();
    ctx.fillStyle = 'rgba(159, 193, 191, 0.78)';
    ctx.fillText(volume.toFixed(volume < 10 ? 1 : 0), xx, height - margin.bottom + 10);
  }

  ctx.strokeStyle = 'rgba(237, 248, 246, 0.42)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, height - margin.bottom);
  ctx.lineTo(width - margin.right, height - margin.bottom);
  ctx.stroke();

  if (analysis.equivalenceVolume <= xMax) {
    const ex = x(analysis.equivalenceVolume);
    ctx.save();
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = 'rgba(239, 179, 92, 0.88)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ex, margin.top);
    ctx.lineTo(ex, height - margin.bottom);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(239, 179, 92, 0.95)';
    ctx.textAlign = ex > width - 110 ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`equivalence ${fmtVolume(analysis.equivalenceVolume)}`, ex + (ex > width - 110 ? -7 : 7), margin.top + 5);
  }

  ctx.strokeStyle = '#5ed7c3';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  analysis.points.forEach((point, index) => {
    const xx = x(point.volume);
    const yy = y(point.ph);
    if (index === 0) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
  });
  ctx.stroke();

  const markerVolume = scrubVolume();
  const markerPh = solvePh(input, markerVolume);
  const mx = x(markerVolume);
  const my = y(markerPh);
  ctx.strokeStyle = 'rgba(141, 240, 223, 0.32)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mx, margin.top);
  ctx.lineTo(mx, height - margin.bottom);
  ctx.stroke();
  ctx.fillStyle = '#071014';
  ctx.strokeStyle = '#8df0df';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(mx, my, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(237, 248, 246, 0.86)';
  ctx.font = '12px Avenir Next, Trebuchet MS, ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('base added, mL', margin.left + plotW / 2, height - 8);
  ctx.save();
  ctx.translate(15, margin.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('pH', 0, 0);
  ctx.restore();

  els.chart.setAttribute(
    'aria-label',
    `Titration curve rising from pH ${fmt(analysis.initialPh, 2)} to pH ${fmt(analysis.finalPh, 2)} with equivalence at ${fmtVolume(analysis.equivalenceVolume)} and pH ${fmt(analysis.equivalencePh, 2)}.`,
  );
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace('#', '');
  const n = Number.parseInt(clean, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function downloadCsv() {
  if (!state.analysis) return;
  const rows = [
    'base_added_ml,ph,hydrogen_molar,hydroxide_molar,charge_residual_molar',
    ...state.analysis.points.map((point) => [
      point.volume.toFixed(6),
      point.ph.toFixed(8),
      point.hydrogen.toExponential(8),
      point.hydroxide.toExponential(8),
      point.residual.toExponential(3),
    ].join(',')),
  ];
  const blob = new Blob([`${rows.join('\n')}\n`], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'titrationlab-curve.csv';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function markManual() {
  els.preset.value = 'manual';
}

function wireEvents() {
  els.preset.addEventListener('change', () => {
    applyPreset(els.preset.value);
    update();
  });

  for (const control of [els.acidConcentration, els.acidVolume, els.baseConcentration, els.maxVolume, els.ka, els.points]) {
    control.addEventListener('input', () => {
      markManual();
      els.pointsOutput.value = `${els.points.value} points`;
      update();
    });
  }

  for (const radio of els.acidRadios) {
    radio.addEventListener('change', () => {
      markManual();
      updateAcidVisibility();
      update();
    });
  }

  els.indicator.addEventListener('change', () => {
    markManual();
    render();
  });

  els.scrub.addEventListener('input', () => {
    state.scrubFraction = Number(els.scrub.value) / 1000;
    renderScrubbedPoint();
    drawChart();
  });

  els.reset.addEventListener('click', () => {
    els.preset.value = 'strong';
    state.scrubFraction = 0;
    els.scrub.value = '0';
    applyPreset('strong');
    update();
  });

  els.csv.addEventListener('click', downloadCsv);

  const resizeObserver = new ResizeObserver(() => drawChart());
  resizeObserver.observe(els.chart.parentElement);
}

populateControls();
wireEvents();
els.preset.value = 'strong';
applyPreset('strong');
update();
