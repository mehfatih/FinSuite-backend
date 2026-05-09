// ================================================================
// charts.ts — print-safe SVG/HTML factories for the cinematic chart
// system. Each fn returns an HTML string suitable for inlining into
// a PDF template. No JS, no animations — these are static "rest
// frames" of the D-1 React components.
//
// Print constraints:
//   - No <canvas> (FlowStream uses curves only; particles omitted)
//   - No filters that don't render in Chromium PDF (most do work — we
//     keep box-shadow + drop-shadow filter for SVG glows)
//   - Each fn accepts a Theme so glow strength + colors adapt
//
// Geometry math is ported from src/components/charts/cinematic/*.jsx
// (frontend) — same path-builders, just emitting strings.
// ================================================================
import { paletteOf, glowOf, toneColor, RGB, Theme, Tone, auroraOf } from '../palette';
import { esc } from '../escape';

// ─── Aurora line/area chart ───────────────────────────────────
export function auroraChart(args: {
  data:    Array<{ x: string | number; y: number }>;
  tone?:   Tone;
  width?:  number;
  height?: number;
  theme:   Theme;
}): string {
  const tone   = args.tone   || 'cyan';
  const width  = args.width  || 480;
  const height = args.height || 180;
  const fg     = toneColor(tone);
  const rgb    = RGB[tone];
  const pal    = paletteOf(args.theme);

  if (!args.data || args.data.length < 2) {
    return placeholder(width, height, args.theme, 'No data');
  }

  const PAD = { t: 14, r: 18, b: 20, l: 30 };
  const ys = args.data.map((d) => d.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const range = max - min || 1;
  const W = width  - PAD.l - PAD.r;
  const H = height - PAD.t - PAD.b;

  const pts = args.data.map((d, i) => {
    const x = PAD.l + (i / (args.data.length - 1)) * W;
    const y = PAD.t + H - ((d.y - min) / range) * H;
    return [x, y] as const;
  });
  const linePath = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L${pts[pts.length - 1][0]},${PAD.t + H} L${pts[0][0]},${PAD.t + H} Z`;

  const yLabels = [0, 0.5, 1].map((t) => ({
    y: PAD.t + H - t * H,
    label: numShort(min + t * range)
  }));
  const xLabels = [0, Math.floor(args.data.length / 2), args.data.length - 1].map((i) => ({
    x: pts[i][0],
    label: String(args.data[i].x)
  }));

  const gradId = `auroraGrad-${tone}-${Math.random().toString(36).slice(2, 8)}`;
  const filterId = `auroraGlow-${tone}-${Math.random().toString(36).slice(2, 8)}`;

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible;">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${fg}" stop-opacity="0.50" />
      <stop offset="60%"  stop-color="${fg}" stop-opacity="0.18" />
      <stop offset="100%" stop-color="${fg}" stop-opacity="0.0" />
    </linearGradient>
    <filter id="${filterId}" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="${pal.isDark ? 2.5 : 1.2}" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
  ${yLabels.map((g) => `
    <line x1="${PAD.l}" y1="${g.y}" x2="${width - PAD.r}" y2="${g.y}"
          stroke="${pal.border}" stroke-width="0.5" stroke-dasharray="2 4" />
    <text x="${PAD.l - 6}" y="${g.y + 3}" text-anchor="end"
          fill="${pal.textFaint}" font-size="7pt"
          font-family="'Inter', monospace">${esc(g.label)}</text>
  `).join('')}
  ${xLabels.map((g) => `
    <text x="${g.x}" y="${height - 5}" text-anchor="middle"
          fill="${pal.textFaint}" font-size="7pt"
          font-family="'Inter', monospace">${esc(g.label)}</text>
  `).join('')}
  <path d="${areaPath}" fill="url(#${gradId})" />
  <path d="${linePath}" fill="none" stroke="${fg}" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round"
        filter="url(#${filterId})" />
  ${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.5" fill="${fg}" />`).join('')}
  <!-- Endpoint emphasis -->
  <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3" fill="${fg}" />
</svg>`;
}

// ─── Liquid KPI tile (static, fill at rest = 100%) ────────────
export function liquidKpiCard(args: {
  value:     number;
  label:     string;
  tone?:     Tone;
  delta?:    number;
  format?:   (n: number) => string;
  width?:    number;
  height?:   number;
  theme:     Theme;
}): string {
  const tone   = args.tone || 'cyan';
  const fg     = toneColor(tone);
  const rgb    = RGB[tone];
  const pal    = paletteOf(args.theme);
  const fmt    = args.format || ((n) => Math.round(n).toLocaleString());
  const width  = args.width  || 180;
  const height = args.height || 110;

  const fillFg = pal.isDark ? `rgba(${rgb}, 0.18)` : `rgba(${rgb}, 0.10)`;

  const deltaPart = typeof args.delta === 'number'
    ? `<div style="display: inline-flex; align-items: center; gap: 3pt; font-size: 8pt; font-weight: 700; color: ${args.delta >= 0 ? '#06FFA5' : '#FF3D5A'}; margin-top: 4pt;">
        ${args.delta >= 0 ? '↑' : '↓'} ${Math.abs(args.delta).toFixed(1)}%
      </div>` : '';

  return `<div style="
    position: relative;
    width: ${width}pt; height: ${height}pt;
    background: ${pal.surface};
    border: 1px solid ${pal.border};
    border-radius: 12pt;
    padding: 12pt;
    overflow: hidden;
    box-shadow: ${glowOf(tone, args.theme, 1)};
  ">
    <div style="position: absolute; left: 0; right: 0; bottom: 0; height: 100%;
                background: linear-gradient(180deg, transparent 30%, ${fillFg} 100%); pointer-events: none;"></div>
    <div style="position: relative;">
      <div style="font-size: 8pt; font-weight: 700; letter-spacing: 0.08em;
                  text-transform: uppercase; color: ${pal.textFaint}; margin-bottom: 6pt;">
        ${esc(args.label)}
      </div>
      <div style="font-size: 22pt; font-weight: 700; letter-spacing: -0.02em;
                  color: ${pal.textPrimary}; line-height: 1;">
        ${esc(fmt(args.value))}
      </div>
      ${deltaPart}
    </div>
  </div>`;
}

// ─── Pulse sparkline (static, no animation in print) ──────────
export function pulseSparkline(args: {
  data:     number[];
  severity?: 'normal' | 'warning' | 'critical';
  width?:   number;
  height?:  number;
  theme:    Theme;
}): string {
  const severity = args.severity || 'normal';
  const tone: Tone = severity === 'critical' ? 'crimson' : severity === 'warning' ? 'amber' : 'cyan';
  const fg = toneColor(tone);
  const rgb = RGB[tone];
  const width  = args.width  || 110;
  const height = args.height || 28;

  if (!args.data || args.data.length < 2) {
    return `<svg width="${width}" height="${height}"></svg>`;
  }
  const min = Math.min(...args.data);
  const max = Math.max(...args.data);
  const range = max - min || 1;
  const stepX = width / (args.data.length - 1);
  const pts = args.data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gradId = `spark-${tone}-${Math.random().toString(36).slice(2, 8)}`;

  return `<svg width="${width}" height="${height}" style="display: inline-block; overflow: visible;
            filter: drop-shadow(0 0 2pt rgba(${rgb}, 0.4));">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${fg}" stop-opacity="0.45" />
        <stop offset="100%" stop-color="${fg}" stop-opacity="0.0" />
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#${gradId})" />
    <path d="${line}" fill="none" stroke="${fg}" stroke-width="1.4"
          stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

// ─── Holographic donut ────────────────────────────────────────
export function holographicDonut(args: {
  data:        Array<{ name: string; value: number; tone?: Tone }>;
  width?:      number;
  height?:     number;
  thickness?:  number;
  centerLabel?: string;
  centerSub?:  string;
  format?:     (n: number) => string;
  theme:       Theme;
}): string {
  const data = args.data || [];
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return placeholder(args.width || 220, args.height || 220, args.theme, 'No data');

  const width  = args.width  || 220;
  const height = args.height || 220;
  const thickness = args.thickness || 30;
  const cx = width / 2, cy = height / 2;
  const rOuter = Math.min(width, height) / 2 - 10;
  const rInner = rOuter - thickness;
  const fmt = args.format || ((n) => Math.round(n).toLocaleString());
  const pal = paletteOf(args.theme);

  const tones: Tone[] = ['cyan', 'violet', 'mint', 'amber', 'crimson'];
  let acc = 0;
  const segments = data.map((d, i) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += d.value;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const tone = d.tone || tones[i % tones.length];
    return { start, end, mid: (start + end) / 2, tone, ...d };
  });

  const arcPath = (rO: number, rI: number, start: number, end: number) => {
    const x1 = cx + Math.cos(start) * rO;
    const y1 = cy + Math.sin(start) * rO;
    const x2 = cx + Math.cos(end)   * rO;
    const y2 = cy + Math.sin(end)   * rO;
    const x3 = cx + Math.cos(end)   * rI;
    const y3 = cy + Math.sin(end)   * rI;
    const x4 = cx + Math.cos(start) * rI;
    const y4 = cy + Math.sin(start) * rI;
    const large = end - start > Math.PI ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rO} ${rO} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${rI} ${rI} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
  };

  const defs = segments.map((s, i) => {
    const rgb = RGB[s.tone];
    return `<radialGradient id="donut-${i}"
              cx="${cx + Math.cos(s.mid) * rInner * 0.7}"
              cy="${cy + Math.sin(s.mid) * rInner * 0.7}"
              r="${rOuter * 0.9}" fx="50%" fy="50%"
              gradientUnits="userSpaceOnUse">
        <stop offset="0%"   stop-color="rgba(${rgb}, 1)" />
        <stop offset="65%"  stop-color="rgba(${rgb}, 0.7)" />
        <stop offset="100%" stop-color="rgba(${rgb}, 0.4)" />
      </radialGradient>`;
  }).join('');

  const segs = segments.map((s, i) => `<path d="${arcPath(rOuter, rInner, s.start, s.end)}"
            fill="url(#donut-${i})" stroke="rgba(${RGB[s.tone]}, 0.7)" stroke-width="0.5" />`).join('');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible;">
    <defs>${defs}</defs>
    <circle cx="${cx}" cy="${cy}" r="${rOuter + 3}" fill="none"
            stroke="${pal.border}" stroke-width="0.5" />
    ${segs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle"
          font-family="'Inter'" font-size="20pt" font-weight="700"
          letter-spacing="-0.02em"
          fill="${pal.textPrimary}">${esc(args.centerLabel || fmt(total))}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle"
          font-family="'Inter'" font-size="8pt" letter-spacing="0.08em"
          fill="${pal.textFaint}" style="text-transform: uppercase;">
      ${esc(args.centerSub || 'Total')}
    </text>
  </svg>`;
}

// ─── Flow stream (static curves only, no particles) ───────────
export function flowStream(args: {
  inflows:  Array<{ name: string; value: number }>;
  outflows: Array<{ name: string; value: number }>;
  width?:   number;
  height?:  number;
  theme:    Theme;
  format?:  (n: number) => string;
}): string {
  const width  = args.width  || 480;
  const height = args.height || 220;
  const inflows = args.inflows || [];
  const outflows = args.outflows || [];
  const totalIn  = inflows.reduce((s, x) => s + x.value, 0);
  const totalOut = outflows.reduce((s, x) => s + x.value, 0);
  const max = Math.max(totalIn, totalOut, 1);
  const fmt = args.format || ((n) => Math.round(n).toLocaleString());
  const pal = paletteOf(args.theme);
  const center = { x: width / 2, y: height / 2 };

  const inNodes = inflows.map((d, i) => ({
    ...d, x: 56,
    y: 40 + (i * (height - 80)) / Math.max(inflows.length - 1, 1)
  }));
  const outNodes = outflows.map((d, i) => ({
    ...d, x: width - 56,
    y: 40 + (i * (height - 80)) / Math.max(outflows.length - 1, 1)
  }));

  const drawCurve = (p0: [number, number], p1: [number, number], p2: [number, number], thickness: number, tone: Tone) =>
    `<path d="M ${p0[0]} ${p0[1]} Q ${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]}"
           fill="none" stroke="rgba(${RGB[tone]}, 0.45)" stroke-width="${thickness}"
           stroke-linecap="round" />`;

  const inflowCurves = inNodes.map((n) =>
    drawCurve([n.x, n.y], [center.x - 40, n.y], [center.x, center.y],
              Math.max(2, (n.value / max) * 12), 'mint')
  ).join('');
  const outflowCurves = outNodes.map((n) =>
    drawCurve([center.x, center.y], [center.x + 40, n.y], [n.x, n.y],
              Math.max(2, (n.value / max) * 12), 'crimson')
  ).join('');

  const labelNode = (x: number, y: number, name: string, value: number, tone: Tone, align: 'left' | 'right' | 'center', big = false) => {
    const fg = toneColor(tone);
    const rgb = RGB[tone];
    return `<g>
      <circle cx="${x}" cy="${y}" r="${big ? 6 : 4}" fill="${fg}"
              filter="drop-shadow(0 0 ${big ? 5 : 3}pt rgba(${rgb}, 0.7))" />
      <text x="${align === 'left' ? x - 10 : align === 'right' ? x + 10 : x}"
            y="${y - 9}"
            text-anchor="${align === 'left' ? 'end' : align === 'right' ? 'start' : 'middle'}"
            fill="${pal.textDim}" font-family="'Inter'" font-size="8pt">${esc(name)}</text>
      <text x="${align === 'left' ? x - 10 : align === 'right' ? x + 10 : x}"
            y="${y + (big ? 16 : 14)}"
            text-anchor="${align === 'left' ? 'end' : align === 'right' ? 'start' : 'middle'}"
            fill="${pal.textPrimary}" font-family="'Inter'" font-size="${big ? 11 : 9}pt"
            font-weight="700">${esc(fmt(value))}</text>
    </g>`;
  };

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible;">
    ${inflowCurves}${outflowCurves}
    ${inNodes.map((n) => labelNode(n.x, n.y, n.name, n.value, 'mint', 'left')).join('')}
    ${labelNode(center.x, center.y, 'Net', totalIn - totalOut, 'cyan', 'center', true)}
    ${outNodes.map((n) => labelNode(n.x, n.y, n.name, n.value, 'crimson', 'right')).join('')}
  </svg>`;
}

// ─── Constellation map ────────────────────────────────────────
export function constellationMap(args: {
  points: Array<{ x: number; y: number; value: number; label: string; tone?: Tone }>;
  width?: number;
  height?: number;
  linkRadius?: number;
  theme: Theme;
}): string {
  const width  = args.width  || 480;
  const height = args.height || 240;
  const linkRadius = args.linkRadius || 0.30;
  const points = args.points || [];
  if (points.length === 0) return placeholder(width, height, args.theme, 'No points');

  const tones: Tone[] = ['cyan', 'violet', 'mint', 'amber'];
  const maxV = Math.max(...points.map((p) => p.value || 1));
  const proj = points.map((p, i) => ({
    ...p,
    px: 16 + p.x * (width - 32),
    py: 16 + p.y * (height - 32),
    r:  3 + ((p.value || 1) / maxV) * 7,
    tone: p.tone || tones[i % tones.length]
  }));

  const edges: string[] = [];
  for (let i = 0; i < proj.length; i++) {
    for (let j = i + 1; j < proj.length; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= linkRadius) {
        const op = (1 - d / linkRadius) * 0.4;
        edges.push(`<line x1="${proj[i].px}" y1="${proj[i].py}" x2="${proj[j].px}" y2="${proj[j].py}"
                          stroke="rgba(${RGB.cyan}, ${op.toFixed(3)})" stroke-width="0.5" />`);
      }
    }
  }

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible;">
    <defs>
      <radialGradient id="nebula-bg" cx="50%" cy="50%" r="60%">
        <stop offset="0%"  stop-color="rgba(${RGB.violet}, 0.18)" />
        <stop offset="60%" stop-color="rgba(0,0,0,0)" />
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#nebula-bg)" rx="10" />
    ${edges.join('')}
    ${proj.map((p) => {
      const fg = toneColor(p.tone);
      const rgb = RGB[p.tone];
      return `<circle cx="${p.px}" cy="${p.py}" r="${p.r}" fill="${fg}"
                      filter="drop-shadow(0 0 3pt rgba(${rgb}, 0.7))" />
              <circle cx="${p.px}" cy="${p.py}" r="${(p.r * 0.4).toFixed(1)}" fill="#FFFFFF" opacity="0.85" />`;
    }).join('')}
  </svg>`;
}

// ─── AI insight card (static print version) ───────────────────
export function aiInsightCard(args: {
  severity:    'critical' | 'attention' | 'opportunity';
  title:       string;
  description: string;
  actionLabel?: string;
  badgeText:    string;     // pre-localized badge text
  theme:       Theme;
}): string {
  const tones: Record<typeof args.severity, Tone> = {
    critical: 'crimson',
    attention: 'amber',
    opportunity: 'mint'
  };
  const tone = tones[args.severity];
  const fg = toneColor(tone);
  const rgb = RGB[tone];
  const pal = paletteOf(args.theme);
  const auroraBox = auroraOf(args.theme, 2);

  const actionPart = args.actionLabel ? `
    <div style="display: inline-block; padding: 6pt 12pt;
                background: linear-gradient(135deg, rgba(${rgb}, 0.95) 0%, rgba(${rgb}, 0.7) 100%);
                color: #FFFFFF; border-radius: 8pt;
                font-size: 9pt; font-weight: 700; letter-spacing: 0.04em;
                margin-top: 10pt;">
      ${esc(args.actionLabel)}
    </div>` : '';

  return `<div style="
    position: relative;
    background: ${pal.surface};
    border: 1px solid ${pal.borderStrong};
    border-radius: 14pt;
    padding: 16pt;
    box-shadow: ${auroraBox};
    page-break-inside: avoid;
  ">
    <div style="display: inline-flex; align-items: center; gap: 6pt;
                font-size: 8pt; font-weight: 700; letter-spacing: 0.08em;
                color: ${fg}; text-transform: uppercase; margin-bottom: 10pt;">
      <span style="display: inline-block; width: 6pt; height: 6pt;
                   border-radius: 50%; background: ${fg};
                   box-shadow: 0 0 4pt rgba(${rgb}, 0.7);"></span>
      ${esc(args.badgeText)}
    </div>
    <div style="font-size: 14pt; font-weight: 600; line-height: 1.3;
                color: ${pal.textPrimary}; margin-bottom: 6pt; letter-spacing: -0.01em;">
      ${esc(args.title)}
    </div>
    <div style="font-size: 10.5pt; line-height: 1.55; color: ${pal.textDim};">
      ${esc(args.description)}
    </div>
    ${actionPart}
  </div>`;
}

// ─── Constellation KPI grid (4-tile static layout) ────────────
export function constellationKpiGrid(args: {
  kpis: Array<{
    label:    string;
    value:    number;
    tone?:    Tone;
    delta?:   number;
    format?:  (n: number) => string;
  }>;
  theme: Theme;
}): string {
  if (!args.kpis || args.kpis.length === 0) return '';
  return `<div style="display: grid; grid-template-columns: repeat(${Math.min(args.kpis.length, 4)}, 1fr); gap: 10pt;">
    ${args.kpis.map((k) => liquidKpiCard({
      value:  k.value,
      label:  k.label,
      tone:   k.tone || 'cyan',
      delta:  k.delta,
      format: k.format,
      width:  120,
      height: 100,
      theme:  args.theme
    })).join('')}
  </div>`;
}

// ─── Internal helpers ────────────────────────────────────────

function placeholder(width: number, height: number, theme: Theme, message: string): string {
  const pal = paletteOf(theme);
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect x="0" y="0" width="${width}" height="${height}" rx="10"
          fill="${pal.surface}" stroke="${pal.border}" stroke-width="0.5" stroke-dasharray="4 6" />
    <text x="${width / 2}" y="${height / 2 + 4}" text-anchor="middle"
          font-family="'Inter'" font-size="8pt"
          fill="${pal.textFaint}" style="text-transform: uppercase; letter-spacing: 0.08em;">
      ${esc(message)}
    </text>
  </svg>`;
}

function numShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}
