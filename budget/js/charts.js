export const PALETTE = ['#4F46E5', '#F59E0B', '#10B981', '#EF4444', '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#84CC16'];

const SVG_NS = 'http://www.w3.org/2000/svg';

function polarToCartesian(cx, cy, r, angle) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export function renderDonutChart(svgEl, data) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  svgEl.innerHTML = '';
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const r = 78;
  const strokeWidth = 32;
  svgEl.setAttribute('viewBox', `0 0 ${size} ${size}`);

  if (total <= 0) {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', r);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'var(--border)');
    circle.setAttribute('stroke-width', strokeWidth);
    svgEl.appendChild(circle);
    return;
  }

  let startAngle = -Math.PI / 2;
  const gap = data.length > 1 ? 0.02 : 0;
  data.forEach((d, i) => {
    const fraction = d.value / total;
    const endAngle = startAngle + fraction * Math.PI * 2;
    const drawEnd = data.length > 1 ? endAngle - gap : endAngle;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', describeArc(cx, cy, r, startAngle, Math.max(drawEnd, startAngle)));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', d.color || PALETTE[i % PALETTE.length]);
    path.setAttribute('stroke-width', strokeWidth);
    path.setAttribute('stroke-linecap', 'round');
    svgEl.appendChild(path);
    startAngle = endAngle;
  });
}

// Income and expenses side by side per month, so month-over-month differences are
// readable without comparing two separate charts.
export function renderGroupedBarChart(svgEl, data, opts = {}) {
  svgEl.innerHTML = '';
  const width = opts.width || 340;
  const height = opts.height || 180;
  const padding = 28;
  svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const maxVal = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  const zeroY = height - padding;
  const slot = (width - padding * 2) / Math.max(data.length, 1);
  const barWidth = Math.min(slot * 0.32, 16);
  const usableHeight = height - padding * 2 - 10;

  data.forEach((d, i) => {
    const groupCenter = padding + i * slot + slot / 2;
    [
      { value: d.income, color: '#10B981', offset: -barWidth / 2 - 2 },
      { value: d.expense, color: '#EF4444', offset: barWidth / 2 + 2 },
    ].forEach(({ value, color, offset }) => {
      const barHeight = (value / maxVal) * usableHeight;
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', groupCenter + offset - barWidth / 2);
      rect.setAttribute('y', zeroY - Math.max(barHeight, 2));
      rect.setAttribute('width', barWidth);
      rect.setAttribute('height', Math.max(barHeight, 2));
      rect.setAttribute('rx', 3);
      rect.setAttribute('fill', color);
      svgEl.appendChild(rect);
    });

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', groupCenter);
    label.setAttribute('y', height - padding + 15);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '9.5');
    label.setAttribute('fill', 'var(--text-muted)');
    label.textContent = d.label;
    svgEl.appendChild(label);
  });

  const baseline = document.createElementNS(SVG_NS, 'line');
  baseline.setAttribute('x1', padding);
  baseline.setAttribute('x2', width - padding);
  baseline.setAttribute('y1', zeroY);
  baseline.setAttribute('y2', zeroY);
  baseline.setAttribute('stroke', 'var(--border)');
  svgEl.appendChild(baseline);
}

export function renderBarChart(svgEl, data, opts = {}) {
  svgEl.innerHTML = '';
  const width = opts.width || 320;
  const height = opts.height || 170;
  const padding = 28;
  svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const values = data.map((d) => d.value);
  const maxVal = Math.max(1, ...values.map((v) => Math.abs(v)));
  const zeroY = height - padding;
  const gap = (width - padding * 2) / data.length;
  const barWidth = Math.min(gap * 0.55, 34);

  data.forEach((d, i) => {
    const barHeight = (Math.abs(d.value) / maxVal) * (height - padding * 2 - 16);
    const x = padding + i * gap + (gap - barWidth) / 2;
    const y = zeroY - Math.max(barHeight, 2);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', barWidth);
    rect.setAttribute('height', Math.max(barHeight, 2));
    rect.setAttribute('rx', 5);
    rect.setAttribute('fill', d.value >= 0 ? '#10B981' : '#EF4444');
    svgEl.appendChild(rect);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', x + barWidth / 2);
    label.setAttribute('y', height - padding + 15);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '9.5');
    label.setAttribute('fill', 'var(--text-muted)');
    label.textContent = d.label;
    svgEl.appendChild(label);
  });

  const baseline = document.createElementNS(SVG_NS, 'line');
  baseline.setAttribute('x1', padding);
  baseline.setAttribute('x2', width - padding);
  baseline.setAttribute('y1', zeroY);
  baseline.setAttribute('y2', zeroY);
  baseline.setAttribute('stroke', 'var(--border)');
  svgEl.appendChild(baseline);
}
