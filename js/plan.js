// 배치도 렌더링 · 팬/줌 · 설비 드래그 · 이격거리 계산
// 좌표계: mm, Y축 아래 방향 (tools/convert-dwg.mjs 출력 기준)
import { esc } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
export const CLEAR = [
  { d: 5000, key: 'c5', label: '5m', color: '#f2c94c' },
  { d: 4000, key: 'c4', label: '4m', color: '#f2994a' },
  { d: 3000, key: 'c3', label: '3m', color: '#eb5757' },
];
// 시험실 영역 (초기 화면)
export const ROOM_VIEW = { x: 12500, y: 9000, w: 46000, h: 54000 };

let planPromise;
export function loadPlan() {
  if (!planPromise) planPromise = fetch('data/plan.json').then((r) => r.json()).then(preparePlan);
  return planPromise;
}
function preparePlan(p) {
  const segs = { wall: p.obstacles.wall, col: [] };
  for (const [x, y, w, h] of p.obstacles.col) {
    segs.col.push([x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]);
  }
  p.segs = segs;
  return p;
}

// ---------- 기하 ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
function closestOnSeg(p, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return [a[0] + ab[0] * t, a[1] + ab[1] * t];
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function segIntersect(p1, p2, q1, q2) {
  const r = sub(p2, p1), s = sub(q2, q1), den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(q1, p1), s) / den, u = cross(sub(q1, p1), r) / den;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [p1[0] + r[0] * t, p1[1] + r[1] * t];
  return null;
}
// 두 선분 최근접점 [거리, 점A, 점B]
function segSeg(a1, a2, b1, b2) {
  const x = segIntersect(a1, a2, b1, b2);
  if (x) return [0, x, x];
  let best = [Infinity];
  for (const [p, a, b, flip] of [[a1, b1, b2, 0], [a2, b1, b2, 0], [b1, a1, a2, 1], [b2, a1, a2, 1]]) {
    const q = closestOnSeg(p, a, b), d = dist(p, q);
    if (d < best[0]) best = flip ? [d, q, p] : [d, p, q];
  }
  return best;
}
function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function itemPoly(it) {
  const a = ((it.rot || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const hw = it.w / 2, hh = it.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [it.x + x * c - y * s, it.y + x * s + y * c]);
}
// 설비 하나와 장애물 그룹 사이 최소 거리
function distToGroup(it, segs) {
  let best = { d: Infinity };
  // 리액터: 사각형은 바닥 구조물이라 이격거리는 원(코일) 기준
  const hasCircle = it.shape === 'circle' || it.shape === 'reactor';
  const hasRect = !hasCircle;
  const c = [it.x, it.y];
  const poly = hasRect ? itemPoly(it) : null;
  for (const s of segs) {
    const a = [s[0], s[1]], b = [s[2], s[3]];
    if (hasCircle) {
      const q = closestOnSeg(c, a, b), d0 = dist(c, q), d = d0 - it.r;
      if (d < best.d) {
        const p = d0 > 0 ? [c[0] + ((q[0] - c[0]) / d0) * it.r, c[1] + ((q[1] - c[1]) / d0) * it.r] : c;
        best = { d: Math.max(0, d), p, q };
      }
    }
    if (hasRect) {
      if (inPoly(a, poly)) { best = { d: 0, p: a, q: a }; continue; }
      for (let i = 0; i < 4; i++) {
        const [d, p, q] = segSeg(poly[i], poly[(i + 1) % 4], a, b);
        if (d < best.d) best = { d, p, q };
      }
    }
  }
  return best;
}
export function itemClearance(it, plan) {
  return { wall: distToGroup(it, plan.segs.wall), col: distToGroup(it, plan.segs.col) };
}
export function minClear(c) { return Math.min(c.wall.d, c.col.d); }
export function clearLevel(d) {
  if (d < 3000) return { cls: 'lv-bad', text: '3m 미만' };
  if (d < 4000) return { cls: 'lv-warn', text: '3~4m' };
  if (d < 5000) return { cls: 'lv-mid', text: '4~5m' };
  return { cls: 'lv-ok', text: '5m 이상' };
}
export const fmtM = (mm) => (mm / 1000).toFixed(2) + 'm';

// ---------- SVG 도우미 ----------
function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
const ANCHOR = { 1: 'start', 2: 'middle', 3: 'end', 4: 'start', 5: 'middle', 6: 'end', 7: 'start', 8: 'middle', 9: 'end' };
const BASE = { 1: 'hanging', 2: 'hanging', 3: 'hanging', 4: 'central', 5: 'central', 6: 'central', 7: 'alphabetic', 8: 'alphabetic', 9: 'alphabetic' };

// ---------- 뷰 ----------
// opts: { editable, showLabels, layers: {c3,c4,c5,range,text}, onChange(items, final), onSelect(id) }
export function createPlanView(container, plan, opts = {}) {
  const o = { editable: false, layers: { c3: true, c4: true, c5: true, range: true, text: true, dims: true }, ...opts };
  container.classList.add('plan-view');
  const svg = svgEl('svg', { class: 'plan-svg', xmlns: NS }, container);
  svg.innerHTML = `<defs>
    <pattern id="hatchEq" width="200" height="200" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="200" stroke="currentColor" stroke-width="40" opacity=".35"/></pattern>
  </defs>`;
  const W = plan.size[0], H = plan.size[1];

  // 배경 도면
  const bg = svgEl('g', { class: 'bg' }, svg);
  svgEl('rect', { x: 0, y: 0, width: W, height: H, class: 'paper' }, bg);
  svgEl('path', { d: plan.fills, class: 'p-fill' }, bg);
  svgEl('path', { d: plan.paths.thin, class: 'p-thin' }, bg);
  svgEl('path', { d: plan.paths.mid, class: 'p-mid' }, bg);
  svgEl('path', { d: plan.paths.wall, class: 'p-wall' }, bg);
  svgEl('path', { d: plan.paths.col, class: 'p-col' }, bg);
  const tg = svgEl('g', { class: 'p-text' }, bg);
  for (const t of plan.texts) {
    const e = svgEl('text', { x: t.x, y: t.y, 'font-size': t.h, 'text-anchor': ANCHOR[t.a] || 'start', 'dominant-baseline': BASE[t.a] || 'central' }, tg);
    e.textContent = t.t;
  }

  // 이격거리 영역 (선분을 2d 두께로 칠하면 거리 d 이내 영역이 됨)
  const clearG = svgEl('g', { class: 'clear' }, svg);
  const wallD = plan.obstacles.wall.map(([a, b, c, d]) => `M${a} ${b}L${c} ${d}`).join('');
  const clearLayers = {};
  for (const c of CLEAR) {
    const g = svgEl('g', { class: 'clear-band', opacity: 0.3 }, clearG);
    svgEl('path', { d: wallD, stroke: c.color, 'stroke-width': c.d * 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' }, g);
    for (const [x, y, w, h] of plan.obstacles.col) {
      svgEl('rect', { x: x - c.d, y: y - c.d, width: w + c.d * 2, height: h + c.d * 2, rx: c.d, fill: c.color }, g);
    }
    clearLayers[c.key] = g;
  }
  // 기둥 강조
  const colG = svgEl('g', { class: 'col-mark' }, svg);
  for (const [x, y, w, h] of plan.obstacles.col) svgEl('rect', { x, y, width: w, height: h }, colG);

  const rangeG = svgEl('g', { class: 'range' }, svg);
  const eqG = svgEl('g', { class: 'equip' }, svg);
  const dimG = svgEl('g', { class: 'dims' }, svg);
  const labelG = svgEl('g', { class: 'labels' }, svg);
  const measG = svgEl('g', { class: 'measure' }, svg);

  let items = [];
  let selected = null;
  let vb = { ...ROOM_VIEW };
  let measure = null; // {active, pts:[]}

  // ---- view box ----
  function applyVB() {
    const r = container.getBoundingClientRect();
    const ar = r.height / Math.max(1, r.width);
    vb.h = vb.w * ar;
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const px = vb.w / Math.max(1, r.width); // mm per screen px
    svg.style.setProperty('--px', px);
    labelG.setAttribute('font-size', 12 * px);
    dimG.setAttribute('font-size', 12 * px);
    measG.setAttribute('font-size', 13 * px);
    rangeG.setAttribute('font-size', 12 * px);
    labelG.querySelectorAll('[data-dy]').forEach((t) => t.setAttribute('dy', t.dataset.dy * px));
  }
  function fit(region = ROOM_VIEW) {
    const r = container.getBoundingClientRect();
    const ar = r.height / Math.max(1, r.width);
    const w = Math.max(region.w, region.h / ar);
    vb = { x: region.x + region.w / 2 - w / 2, y: region.y + region.h / 2 - (w * ar) / 2, w };
    applyVB();
  }
  function toSvg(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }
  function zoomAt(f, cx, cy) {
    const nw = Math.min(W * 1.5, Math.max(1500, vb.w * f));
    const k = nw / vb.w;
    vb.x = cx - (cx - vb.x) * k;
    vb.y = cy - (cy - vb.y) * k;
    vb.w = nw;
    applyVB();
  }
  // 컨테이너 크기가 처음 정해질 때 시험실에 맞춤, 이후에는 비율만 갱신
  let fitted = false;
  new ResizeObserver(() => {
    const r = container.getBoundingClientRect();
    if (!fitted && r.width > 0 && r.height > 0) { fitted = true; fit((o.fitTo && o.fitTo(items)) || ROOM_VIEW); } else applyVB();
  }).observe(container);

  // ---- 설비 그리기 ----
  function drawItems() {
    eqG.innerHTML = '';
    labelG.innerHTML = '';
    rangeG.innerHTML = '';
    for (const it of items) {
      if (it.hidden) continue;
      const g = svgEl('g', { class: 'eq' + (it.id === selected ? ' sel' : '') + (it.locked ? ' locked' : ''), 'data-id': it.id, transform: `translate(${it.x} ${it.y}) rotate(${it.rot || 0})`, style: `color:${it.color}` }, eqG);
      if (it.shape === 'circle') {
        svgEl('circle', { r: it.r, class: 'shape' }, g);
      } else if (it.shape === 'reactor') {
        svgEl('rect', { x: -it.w / 2, y: -it.h / 2, width: it.w, height: it.h, class: 'shape base' }, g);
        svgEl('circle', { r: it.r, class: 'shape' }, g);
      } else {
        svgEl('rect', { x: -it.w / 2, y: -it.h / 2, width: it.w, height: it.h, rx: it.shape === 'tube' ? Math.min(it.w, it.h) / 4 : 0, class: 'shape' }, g);
      }
      // 회전 방향 표시 (작은 삼각형)
      if (it.shape !== 'circle') {
        const hh = it.h / 2, m = Math.min(it.w, it.h) * 0.15;
        svgEl('path', { d: `M${-m} ${-hh + m * 0.3}L${m} ${-hh + m * 0.3}L0 ${-hh + m * 1.3}Z`, class: 'dir' }, g);
      }
      if (o.layers.range && it.range) {
        svgEl('circle', { cx: it.x, cy: it.y, r: it.range, class: 'range-c' }, rangeG);
        const t = svgEl('text', { x: it.x, y: it.y - it.range, 'text-anchor': 'middle', 'dominant-baseline': 'hanging', class: 'range-t' }, rangeG);
        t.textContent = `${it.short || it.name} 케이블 이동범위 ${it.range / 1000}m`;
      }
      // 라벨
      const ext = it.shape === 'circle' ? it.r : Math.max(it.w, it.h) / 2;
      const lbl = svgEl('text', { x: it.x, y: it.y + (it.shape === 'circle' || it.shape === 'reactor' ? 0 : ext), 'text-anchor': 'middle', class: 'eq-label' + (it.id === selected ? ' sel' : '') }, labelG);
      lbl.textContent = it.short || it.name;
      if (!(it.shape === 'circle' || it.shape === 'reactor')) lbl.setAttribute('data-dy', 14);
      else lbl.setAttribute('dominant-baseline', 'central');
    }
    drawDims();
    applyVB();
  }
  function drawDims() {
    dimG.innerHTML = '';
    const it = items.find((i) => i.id === selected);
    if (!it || it.hidden || !o.layers.dims) return;
    const c = itemClearance(it, plan);
    for (const [k, v] of Object.entries(c)) {
      if (!isFinite(v.d)) continue;
      const lv = clearLevel(v.d);
      svgEl('line', { x1: v.p[0], y1: v.p[1], x2: v.q[0], y2: v.q[1], class: 'dim-l ' + lv.cls }, dimG);
      svgEl('circle', { cx: v.q[0], cy: v.q[1], r: 120, class: 'dim-p ' + lv.cls }, dimG);
      const t = svgEl('text', { x: (v.p[0] + v.q[0]) / 2, y: (v.p[1] + v.q[1]) / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'dim-t ' + lv.cls }, dimG);
      t.textContent = `${k === 'wall' ? '벽' : '기둥'} ${fmtM(v.d)}`;
    }
  }

  // ---- 상호작용 ----
  const pointers = new Map();
  let drag = null; // {type:'pan'|'item', ...}
  let moved = false;

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    moved = false;
    if (pointers.size === 2) { drag = { type: 'pinch', d0: pinchDist(), w0: vb.w }; return; }
    const eqEl = e.target.closest('.eq');
    if (o.editable && eqEl && !measure?.active) {
      const it = items.find((i) => i.id === eqEl.dataset.id);
      select(it.id);
      if (!it.locked) {
        const p = toSvg(e);
        drag = { type: 'item', it, dx: p[0] - it.x, dy: p[1] - it.y, sx: it.x, sy: it.y };
      } else drag = { type: 'pan', x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y };
      return;
    }
    if (!o.editable && eqEl && o.onItemClick) { drag = { type: 'click', id: eqEl.dataset.id }; return; }
    drag = { type: 'pan', x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y };
  });
  function pinchDist() { const [a, b] = [...pointers.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  svg.addEventListener('pointermove', (e) => {
    if (measure?.active && measure.pts.length === 1) { measure.hover = toSvg(e); drawMeasure(); }
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    if (Math.hypot(e.clientX - prev[0], e.clientY - prev[1]) > 3) moved = true;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (!drag) return;
    if (drag.type === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const mid = toSvg({ clientX: (a[0] + b[0]) / 2, clientY: (a[1] + b[1]) / 2 });
      zoomAt((drag.w0 * drag.d0) / pinchDist() / vb.w, mid[0], mid[1]);
    } else if (drag.type === 'pan') {
      const r = container.getBoundingClientRect(), k = vb.w / r.width;
      vb.x = drag.vx - (e.clientX - drag.x) * k;
      vb.y = drag.vy - (e.clientY - drag.y) * k;
      applyVB();
    } else if (drag.type === 'item' && moved) {
      const p = toSvg(e);
      drag.it.x = Math.round((p[0] - drag.dx) / 10) * 10;
      drag.it.y = Math.round((p[1] - drag.dy) / 10) * 10;
      const g = eqG.querySelector(`[data-id="${drag.it.id}"]`);
      g.setAttribute('transform', `translate(${drag.it.x} ${drag.it.y}) rotate(${drag.it.rot || 0})`);
      redrawLight();
      o.onChange && o.onChange(items, false);
    }
  });
  let rafPending = false;
  function redrawLight() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; drawItems(); });
  }
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (drag?.type === 'item' && moved && (drag.it.x !== drag.sx || drag.it.y !== drag.sy)) o.onChange && o.onChange(items, true);
    if (!moved && drag?.type === 'pan') {
      if (measure?.active) addMeasurePt(toSvg(e));
      else if (o.editable) select(null);
    }
    if (!moved && drag?.type === 'click') o.onItemClick(drag.id);
    if (pointers.size === 0) drag = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = toSvg(e);
    zoomAt(Math.pow(1.0015, e.deltaY), p[0], p[1]);
  }, { passive: false });

  // ---- 거리 측정 ----
  function addMeasurePt(p) {
    if (measure.pts.length >= 2) measure.pts = [];
    measure.pts.push(p);
    drawMeasure();
  }
  function drawMeasure() {
    measG.innerHTML = '';
    if (!measure?.active) return;
    const pts = [...measure.pts];
    if (pts.length === 1 && measure.hover) pts.push(measure.hover);
    for (const p of pts) svgEl('circle', { cx: p[0], cy: p[1], r: 150, class: 'm-p' }, measG);
    if (pts.length === 2) {
      svgEl('line', { x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1], class: 'm-l' }, measG);
      const t = svgEl('text', { x: (pts[0][0] + pts[1][0]) / 2, y: (pts[0][1] + pts[1][1]) / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'm-t' }, measG);
      const dx = Math.abs(pts[1][0] - pts[0][0]), dy = Math.abs(pts[1][1] - pts[0][1]);
      t.textContent = `${fmtM(dist(pts[0], pts[1]))}  (가로 ${fmtM(dx)} · 세로 ${fmtM(dy)})`;
    }
  }

  function select(id) {
    selected = id;
    drawItems();
    o.onSelect && o.onSelect(id);
  }
  function setLayers(l) {
    Object.assign(o.layers, l);
    for (const c of CLEAR) clearLayers[c.key].style.display = o.layers[c.key] ? '' : 'none';
    tg.style.display = o.layers.text ? '' : 'none';
    drawItems();
  }

  setLayers({});
  // (초기 맞춤은 ResizeObserver에서 처리)

  return {
    svg,
    setItems(list) { items = list; drawItems(); },
    getItems: () => items,
    redraw: drawItems,
    select,
    get selected() { return selected; },
    setLayers,
    fit,
    fitAll: () => fit({ x: 0, y: 0, w: W, h: H }),
    fitItems: (margin = 6000) => { const r = itemsBox(items, margin); if (r) fit(r); },
    zoom: (f) => zoomAt(f, vb.x + vb.w / 2, vb.y + vb.h / 2),
    centerOn(it) { vb.x = it.x - vb.w / 2; vb.y = it.y - vb.h / 2; applyVB(); },
    setMeasure(on) { measure = on ? { active: true, pts: [] } : null; svg.classList.toggle('measuring', !!on); drawMeasure(); },
  };
}

// 설비들의 외곽 범위 (+여유)
export function itemsBox(items, margin = 6000) {
  const vis = items.filter((i) => !i.hidden);
  if (!vis.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of vis) {
    const e = i.shape === 'circle' ? i.r : Math.hypot(i.w, i.h) / 2;
    x0 = Math.min(x0, i.x - e); y0 = Math.min(y0, i.y - e); x1 = Math.max(x1, i.x + e); y1 = Math.max(y1, i.y + e);
  }
  return { x: x0 - margin, y: y0 - margin, w: x1 - x0 + margin * 2, h: y1 - y0 + margin * 2 };
}

// 설비 목록 표 HTML (대시보드/배치화면 공용)
export function clearanceRows(items, plan, selectedId) {
  return items.filter((i) => i.check && !i.hidden).map((it) => {
    const c = itemClearance(it, plan), m = minClear(c), lv = clearLevel(m);
    return `<tr data-id="${esc(it.id)}" class="${it.id === selectedId ? 'sel' : ''}">
      <td><span class="dot" style="background:${esc(it.color)}"></span>${esc(it.short || it.name)}</td>
      <td class="num">${fmtM(c.wall.d)}</td><td class="num">${fmtM(c.col.d)}</td>
      <td><span class="lv ${lv.cls}">${lv.text}</span></td></tr>`;
  }).join('');
}
