// DWG(설치 도면.dwg) → data/plan.json 변환 스크립트
// 사용법: cd tools && npm install && node convert-dwg.mjs "<설치 도면.dwg 경로>"
//
// 도면 구성(분석 결과)
//  - '건축도면' 레이어: PDF에서 가져온 1층 시험실 확대평면도 (1 unit = 1 mm)
//      lineweight 5 → 벽체 외곽선, lineweight 7/9 → 철골 기둥(H형강·베이스플레이트)
//  - '0', '내압기 도면' 레이어: 내압기 설비 배치 (리액터, 분압기, 커플링 커패시터 등)
// 출력 좌표계: mm, 원점 = 크롭 영역 좌상단, Y축 아래 방향(SVG 좌표)
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) { console.error('usage: node convert-dwg.mjs <file.dwg>'); process.exit(1); }

const lib = await LibreDwg.create(path.join(here, 'node_modules/@mlightcad/libredwg-web/wasm/'));
const dwg = lib.dwg_read_data(fs.readFileSync(src), Dwg_File_Type.DWG);
const db = lib.convert(dwg);
lib.dwg_free(dwg);

// 시트 크롭 영역 (DXF 좌표, mm)
const CROP = { x0: 14000, y0: 2000, x1: 92000, y1: 87000 };
// 이격거리 계산에 쓰는 건물 영역 (치수선·범례 제외)
const BLDG = { x0: 26000, y0: 7000, x1: 70500, y1: 79000 };

const W = CROP.x1 - CROP.x0, H = CROP.y1 - CROP.y0;
const tx = (x) => Math.round(x - CROP.x0);
const ty = (y) => Math.round(CROP.y1 - y);
const inBox = (p, b) => p && p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;

// 호(arc) → 점 목록
function arcPts(cx, cy, r, a0, a1) {
  while (a1 <= a0) a1 += Math.PI * 2;
  const n = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * Math.min(48, Math.max(8, (2 * Math.PI * r) / 250))));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}
// LWPOLYLINE(bulge 포함) → 점 목록
function lwPts(e) {
  const v = e.vertices, closed = e.flag & 1, out = [];
  const n = closed ? v.length : v.length - 1;
  out.push(v[0]);
  for (let i = 0; i < n; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    if (a.bulge) {
      // 현(chord) 중점 + 좌측 법선 방향으로 (r - sagitta) 만큼 이동한 점이 중심
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      const s = d / 2, sag = a.bulge * s;
      const r = (s * s + sag * sag) / (2 * sag);
      const k = (r - sag) / d;
      const cx = (a.x + b.x) / 2 - dy * k, cy = (a.y + b.y) / 2 + dx * k;
      const a0 = Math.atan2(a.y - cy, a.x - cx), a1 = Math.atan2(b.y - cy, b.x - cx);
      const pts = a.bulge > 0 ? arcPts(cx, cy, Math.abs(r), a0, a1) : arcPts(cx, cy, Math.abs(r), a1, a0).reverse();
      out.push(...pts.slice(1));
    } else out.push(b);
  }
  return out;
}

function entityPts(e) {
  switch (e.type) {
    case 'LINE': return [[e.startPoint, e.endPoint]];
    case 'LWPOLYLINE': return [lwPts(e)];
    case 'ARC': return [arcPts(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle)];
    case 'CIRCLE': return [arcPts(e.center.x, e.center.y, e.radius, 0, Math.PI * 2)];
    default: return [];
  }
}

// 상대좌표 path 인코딩 (용량 절감)
function pathD(pts) {
  let px = tx(pts[0].x), py = ty(pts[0].y), d = 'M' + px + ' ' + py;
  for (let i = 1; i < pts.length; i++) {
    const x = tx(pts[i].x), y = ty(pts[i].y);
    if (x === px && y === py) continue;
    d += 'l' + (x - px) + ' ' + (y - py);
    px = x; py = y;
  }
  return d;
}

const groupOf = (lw) => (lw === 5 ? 'wall' : lw === 7 || lw === 9 ? 'col' : lw >= 3 ? 'mid' : 'thin');
const paths = { thin: [], mid: [], wall: [], col: [] };
const fills = [];
const texts = [];
const obstacles = { wall: [], col: [] };
const colBoxes = [];

for (const e of db.entities) {
  if (e.layer !== '건축도면') continue;
  if (e.type === 'MTEXT') {
    if (!inBox(e.insertionPoint, CROP)) continue;
    const t = e.text.replace(/\\[A-Za-z][^;]*;|[{}]/g, '').replace(/\\P/g, ' ').trim();
    if (!t || t === '_') continue;
    texts.push({ x: tx(e.insertionPoint.x), y: ty(e.insertionPoint.y), h: Math.round(e.textHeight), t, a: e.attachmentPoint });
    continue;
  }
  if (e.type === 'SOLID') {
    const p = [e.corner1, e.corner2, e.corner4, e.corner3].filter(Boolean);
    if (!p.length || !inBox(p[0], CROP)) continue;
    fills.push(pathD(p) + 'z');
    continue;
  }
  const g = groupOf(e.lineweight);
  for (const pts of entityPts(e)) {
    if (!pts.some((p) => inBox(p, CROP))) continue;
    paths[g].push(pathD(pts));
    if (g === 'col' && pts.every((p) => inBox(p, BLDG))) {
      colBoxes.push(pts.reduce((b, p) => [Math.min(b[0], p.x), Math.min(b[1], p.y), Math.max(b[2], p.x), Math.max(b[3], p.y)], [1e18, 1e18, -1e18, -1e18]));
    }
    if (g === 'wall' && pts.every((p) => inBox(p, BLDG))) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (Math.hypot(b.x - a.x, b.y - a.y) < 1) continue;
        obstacles[g].push([tx(a.x), ty(a.y), tx(b.x), ty(b.y)]);
      }
    }
  }
}

// 기둥: 서로 200mm 이내로 붙은 요소(H형강, 베이스플레이트, 앵커볼트)를 하나의 사각형으로 병합
{
  let boxes = colBoxes.slice(), merged = true;
  const near = (a, b, g) => a[0] - g <= b[2] && b[0] - g <= a[2] && a[1] - g <= b[3] && b[1] - g <= a[3];
  while (merged) {
    merged = false;
    const out = [];
    for (const b of boxes) {
      const hit = out.find((o) => near(o, b, 200));
      if (hit) { hit[0] = Math.min(hit[0], b[0]); hit[1] = Math.min(hit[1], b[1]); hit[2] = Math.max(hit[2], b[2]); hit[3] = Math.max(hit[3], b[3]); merged = true; }
      else out.push(b.slice());
    }
    boxes = out;
  }
  // 너무 작은 것(단독 앵커볼트 등 < 150mm)은 제외
  obstacles.col = boxes.filter((b) => Math.max(b[2] - b[0], b[3] - b[1]) >= 150)
    .map((b) => [tx(b[0]), ty(b[3]), Math.round(b[2] - b[0]), Math.round(b[3] - b[1])]); // [x, y(top), w, h]
}

// 기존 배치 (CAD 도면 기준 초기값) — 좌표는 출력 좌표계(mm)
const R = (x0, y0, x1, y1) => ({ x: tx((x0 + x1) / 2), y: ty((y0 + y1) / 2), w: Math.round(x1 - x0), h: Math.round(y1 - y0) });
const C = (cx, cy, r) => ({ x: tx(cx), y: ty(cy), r });
const equipment = [
  { id: 'reactor', name: '직렬 리액터 (Series Reactors)', shape: 'reactor', color: '#d9480f', ...R(35050, 60986, 38550, 64486), r: 2100 },
  { id: 'cap_div', name: '용량성 분압기 (Capacitive Divider)', shape: 'circle', color: '#1971c2', ...C(36800, 68676, 1400) },
  { id: 'coup_cap', name: '커플링 커패시터 (Coupling Capacitor)', shape: 'circle', color: '#0c8599', ...C(42520, 68676, 1400) },
  { id: 'exc_tr', name: '여자변압기 (Excitation TR)', shape: 'rect', color: '#7048e8', ...R(31980, 64031, 32895, 64646), range: 20000 },
  { id: 'iso_tr', name: '절연변압기 (Isolation TR)', shape: 'rect', color: '#9c36b5', ...R(28770, 63995, 29770, 64695) },
  { id: 'reg_filter', name: '레귤레이터/필터 캐비닛', shape: 'rect', color: '#c2255c', ...R(28973, 63255, 29573, 63755) },
  { id: 'up_switch', name: '상위 스위치 (Upstream Switch)', shape: 'rect', color: '#5c940d', ...R(28973, 62500, 29573, 63000) },
  { id: 'hv_tube1', name: 'HV 연결관 (리액터-분압기)', shape: 'tube', color: '#868e96', ...R(36475 - 100, 64526 - 100, 37125 + 100, 66986 + 100) },
  { id: 'hv_tube2', name: 'HV 연결관 (분압기-커플링)', shape: 'tube', color: '#868e96', ...R(38480 - 100, 68351 - 100, 40840 + 100, 69001 + 100) },
].map((e) => ({ rot: 0, ...e }));

const out = {
  source: path.basename(src),
  generated: new Date().toISOString(),
  size: [W, H],
  paths: Object.fromEntries(Object.entries(paths).map(([k, v]) => [k, v.join('')])),
  fills: fills.join(''),
  texts,
  obstacles,
  equipment,
};
const dst = path.join(here, '../data/plan.json');
fs.writeFileSync(dst, JSON.stringify(out));
console.log('wrote', dst, (fs.statSync(dst).size / 1024).toFixed(0) + 'KB',
  'walls', obstacles.wall.length, 'cols', obstacles.col.length, 'texts', texts.length);
