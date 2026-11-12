// 배치안 데이터 (DB hd800_layouts) — 대시보드와 배치 화면에서 공용
import { db, logActivity } from './db.js';
import { loadPlan } from './plan.js';

// 시험실 내벽 기준점 (좌측벽 내측 X, 상부벽 내측 Y) — 도면 출력좌표(mm), 좌표 표시용
export const ORIGIN = { x: 14170, y: 11137 };

const DEFAULTS = {
  reactor: { short: '리액터', check: true },
  cap_div: { short: '분압기', check: true },
  coup_cap: { short: '커플링C', check: true },
  exc_tr: { short: '여자TR', check: false },
  iso_tr: { short: '절연TR', check: false },
  reg_filter: { short: 'REG/필터', check: false },
  up_switch: { short: '상위SW', check: false },
  hv_tube1: { short: 'HV관1', check: true },
  hv_tube2: { short: 'HV관2', check: true },
};

export async function defaultItems() {
  const plan = await loadPlan();
  return plan.equipment.map((e) => ({ ...e, ...(DEFAULTS[e.id] || {}), locked: false, hidden: false }));
}

// 배치안 목록 (없으면 CAD 기준안을 만들어 둠)
export async function listLayouts() {
  let rows = await db.list('layouts', 'select=id,name,note,author,is_main,created_at,updated_at,updated_by&order=created_at.asc');
  if (!rows.length) {
    const items = await defaultItems();
    await db.insert('layouts', { name: 'CAD 도면 기준안', note: '설치 도면.dwg 의 설비 배치를 그대로 가져온 초기안', author: '시스템', items, is_main: true });
    logActivity('시스템', '배치안 "CAD 도면 기준안" 생성', 'layout');
    rows = await db.list('layouts', 'select=id,name,note,author,is_main,created_at,updated_at,updated_by&order=created_at.asc');
  }
  return rows;
}

export async function getMainLayout() {
  const rows = await listLayouts();
  const main = rows.find((r) => r.is_main) || rows[0];
  return db.get('layouts', main.id);
}

export async function setMain(id) {
  const rows = await listLayouts();
  for (const r of rows) if (r.is_main && r.id !== id) await db.update('layouts', r.id, { is_main: false });
  await db.update('layouts', id, { is_main: true });
}
