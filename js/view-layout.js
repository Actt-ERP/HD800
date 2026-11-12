// 배치도 화면: 배치 확인 / 이격거리 / 배치 수정 / 배치안 관리
import { db, logActivity } from './db.js';
import { loadPlan, createPlanView, CLEAR, clearanceRows, itemClearance, minClear, clearLevel, fmtM } from './plan.js';
import { listLayouts, setMain, ORIGIN, defaultItems } from './layouts.js';
import { esc, modal, toast, requireUser, confirmBox, fmtTime } from './util.js';

const STEP_KEY = 'hd800.step';
const LAYER_KEY = 'hd800.layers';

export async function renderLayout(root, params) {
  root.innerHTML = `
  <div class="layout-page">
    <div class="toolbar card">
      <div class="tb-group">
        <label class="sr-only" for="lySel">배치안</label>
        <select id="lySel" class="ly-sel"></select>
        <span id="lyDirty" class="dirty" hidden>● 저장 안 됨</span>
      </div>
      <div class="tb-group">
        <button class="btn primary" id="btnSave" title="현재 배치안에 저장 (Ctrl+S)">저장</button>
        <button class="btn" id="btnSaveAs">새 배치안으로 저장</button>
        <button class="btn" id="btnMore" aria-haspopup="true">⋯</button>
      </div>
      <div class="tb-menu card" id="moreMenu" hidden>
        <button data-act="main">⭐ 기본안으로 지정 (대시보드 표시)</button>
        <button data-act="rename">✎ 이름/메모 수정</button>
        <button data-act="reset">↺ CAD 기준 위치로 되돌리기</button>
        <button data-act="delete" class="danger">🗑 배치안 삭제</button>
      </div>
    </div>
    <div class="ly-meta muted small" id="lyMeta"></div>
    <div class="ly-main">
      <div class="ly-canvas card">
        <div id="planBox" class="plan-box"></div>
        <div class="map-ctrl">
          <button class="icon-btn" data-z="in" title="확대">＋</button>
          <button class="icon-btn" data-z="out" title="축소">－</button>
          <button class="icon-btn" data-z="fit" title="시험실 맞춤">⌂</button>
          <button class="icon-btn" data-z="all" title="도면 전체">⛶</button>
          <button class="icon-btn" id="btnMeasure" title="거리 측정">📏</button>
        </div>
        <div class="map-legend">
          ${CLEAR.slice().reverse().map((c) => `<label><input type="checkbox" data-layer="${c.key}"><i style="background:${c.color}"></i>${c.label} 이내</label>`).join('')}
          <label><input type="checkbox" data-layer="range"><i class="ring"></i>이동범위</label>
          <label><input type="checkbox" data-layer="dims"><i class="dimi"></i>거리표시</label>
          <label><input type="checkbox" data-layer="text"><i class="txt">A</i>도면문자</label>
        </div>
        <div class="measure-hint" id="measureHint" hidden>도면 위 두 지점을 클릭하면 거리가 표시됩니다. <button class="link" id="measureOff">종료</button></div>
      </div>
      <aside class="ly-side">
        <section class="card" id="selPanel"></section>
        <section class="card">
          <div class="card-h"><h3>이격거리 검토</h3><span class="muted small">벽체·기둥까지 최소거리</span></div>
          <table class="tbl clear-tbl"><thead><tr><th>설비</th><th>벽체</th><th>기둥</th><th>판정</th></tr></thead><tbody id="clearBody"></tbody></table>
        </section>
        <section class="card">
          <div class="card-h"><h3>설비 목록</h3><button class="btn sm" id="btnAdd">＋ 설비 추가</button></div>
          <ul class="eq-list" id="eqList"></ul>
        </section>
      </aside>
    </div>
  </div>`;

  const plan = await loadPlan();
  const $ = (s) => root.querySelector(s);
  let layouts = [];
  let cur = null; // 현재 배치안 레코드
  let items = [];
  let dirty = false;
  const undo = [], redo = [];
  let step = Number(localStorage.getItem(STEP_KEY)) || 100;

  let layers = { c3: true, c4: true, c5: true, range: true, dims: true, text: true };
  try { Object.assign(layers, JSON.parse(localStorage.getItem(LAYER_KEY)) || {}); } catch {}

  const view = createPlanView($('#planBox'), plan, {
    editable: true,
    layers,
    onChange: (its, final) => { if (final) { pushUndo(); markDirty(); } refreshSide(); },
    onSelect: () => refreshSide(),
  });
  root.querySelectorAll('[data-layer]').forEach((cb) => {
    cb.checked = !!layers[cb.dataset.layer];
    cb.addEventListener('change', () => {
      layers[cb.dataset.layer] = cb.checked;
      try { localStorage.setItem(LAYER_KEY, JSON.stringify(layers)); } catch {}
      view.setLayers(layers);
    });
  });
  root.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => {
    const z = b.dataset.z;
    if (z === 'in') view.zoom(0.7); else if (z === 'out') view.zoom(1.4); else if (z === 'fit') view.fit(); else view.fitAll();
  }));
  const setMeasure = (on) => { view.setMeasure(on); $('#btnMeasure').classList.toggle('on', on); $('#measureHint').hidden = !on; };
  $('#btnMeasure').addEventListener('click', () => setMeasure(!$('#btnMeasure').classList.contains('on')));
  $('#measureOff').addEventListener('click', () => setMeasure(false));

  // ---- 상태 ----
  let snapshot = '';
  function pushUndo() {
    undo.push(snapshot);
    if (undo.length > 100) undo.shift();
    redo.length = 0;
    snapshot = JSON.stringify(items);
  }
  function restore(json) {
    const sel = view.selected;
    items = JSON.parse(json);
    snapshot = json;
    view.setItems(items);
    if (sel && items.find((i) => i.id === sel)) view.select(sel); else view.select(null);
    markDirty();
  }
  let savedSnap = '';
  function markDirty(v = true) {
    if (v === false) savedSnap = JSON.stringify(items);
    dirty = v && JSON.stringify(items) !== savedSnap;
    $('#lyDirty').hidden = !dirty;
  }
  function changed() { pushUndo(); markDirty(); view.redraw(); refreshSide(); }

  // ---- 배치안 로드 ----
  async function loadList(selectId) {
    layouts = await listLayouts();
    const sel = $('#lySel');
    sel.innerHTML = layouts.map((l) => `<option value="${l.id}">${l.is_main ? '⭐ ' : ''}${esc(l.name)}</option>`).join('');
    const want = selectId || params.id;
    const id = layouts.some((l) => l.id === want) ? want : (layouts.find((l) => l.is_main) || layouts[0]).id;
    sel.value = id;
    await openLayout(id);
  }
  async function openLayout(id) {
    cur = await db.get('layouts', id);
    if (!cur) { toast('배치안을 찾을 수 없습니다', 'error'); return; }
    items = cur.items || [];
    snapshot = JSON.stringify(items);
    undo.length = redo.length = 0;
    markDirty(false);
    view.setItems(items);
    view.select(null);
    $('#lyMeta').innerHTML = `${cur.is_main ? '<b class="badge main">기본안</b> ' : ''}작성 ${esc(cur.author)} · 최종 수정 ${esc(cur.updated_by || cur.author)} ${fmtTime(cur.updated_at)}${cur.note ? ' · ' + esc(cur.note) : ''}`;
    history.replaceState(null, '', '#/layout/' + id);
  }
  $('#lySel').addEventListener('change', async (e) => {
    if (dirty && !(await confirmBox('저장하지 않은 변경사항이 있습니다. 다른 배치안을 열까요?'))) { e.target.value = cur.id; return; }
    openLayout(e.target.value);
  });

  // ---- 저장 ----
  async function save() {
    const u = await requireUser();
    if (!u) return;
    const latest = await db.list('layouts', `select=updated_at,updated_by&id=eq.${cur.id}`);
    if (latest[0] && latest[0].updated_at !== cur.updated_at) {
      const ok = await confirmBox(`${latest[0].updated_by || '다른 사용자'}님이 ${fmtTime(latest[0].updated_at)}에 이 배치안을 수정했습니다. 덮어쓸까요? (취소 후 "새 배치안으로 저장"을 권장)`, { okLabel: '덮어쓰기', danger: true });
      if (!ok) return;
    }
    cur = await db.update('layouts', cur.id, { items, updated_by: u.name });
    markDirty(false);
    logActivity(u.name, `배치안 "${cur.name}" 수정`, 'layout');
    toast('저장했습니다');
    $('#lyMeta').innerHTML = `${cur.is_main ? '<b class="badge main">기본안</b> ' : ''}작성 ${esc(cur.author)} · 최종 수정 ${esc(cur.updated_by)} ${fmtTime(cur.updated_at)}${cur.note ? ' · ' + esc(cur.note) : ''}`;
  }
  $('#btnSave').addEventListener('click', save);
  $('#btnSaveAs').addEventListener('click', async () => {
    const u = await requireUser();
    if (!u) return;
    modal({
      title: '새 배치안으로 저장',
      body: `<label class="field"><span>배치안 이름</span><input name="name" required maxlength="100" value="${esc(cur.name)} (수정 ${u.name})"></label>
             <label class="field"><span>메모 (변경 내용)</span><textarea name="note" rows="3" maxlength="2000" placeholder="예: 리액터를 동측으로 2m 이동"></textarea></label>`,
      actions: [{ label: '저장', primary: true, submit: true }],
      onSubmit: async (fd) => {
        const row = await db.insert('layouts', { name: fd.get('name').trim(), note: fd.get('note').trim(), author: u.name, updated_by: u.name, items, is_main: false });
        logActivity(u.name, `새 배치안 "${row.name}" 작성`, 'layout');
        toast('새 배치안을 저장했습니다');
        await loadList(row.id);
      },
    });
  });

  // 더보기 메뉴
  const menu = $('#moreMenu');
  $('#btnMore').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', () => (menu.hidden = true), { signal: ac().signal });
  menu.addEventListener('click', async (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    menu.hidden = true;
    const u = await requireUser();
    if (!u) return;
    if (act === 'main') {
      await setMain(cur.id);
      logActivity(u.name, `배치안 "${cur.name}"을 기본안으로 지정`, 'layout');
      toast('기본안으로 지정했습니다');
      loadList(cur.id);
    } else if (act === 'rename') {
      modal({
        title: '배치안 정보 수정',
        body: `<label class="field"><span>이름</span><input name="name" required maxlength="100" value="${esc(cur.name)}"></label>
               <label class="field"><span>메모</span><textarea name="note" rows="3" maxlength="2000">${esc(cur.note)}</textarea></label>`,
        actions: [{ label: '저장', primary: true, submit: true }],
        onSubmit: async (fd) => {
          await db.update('layouts', cur.id, { name: fd.get('name').trim(), note: fd.get('note').trim(), updated_by: u.name });
          loadList(cur.id);
        },
      });
    } else if (act === 'reset') {
      if (!(await confirmBox('모든 설비를 CAD 도면(설치 도면.dwg) 기준 위치로 되돌릴까요? (저장 전까지 반영되지 않습니다)'))) return;
      const defs = await defaultItems();
      const custom = items.filter((i) => i.custom);
      items.splice(0, items.length, ...defs, ...custom);
      view.setItems(items);
      changed();
    } else if (act === 'delete') {
      if (cur.is_main) { toast('기본안은 삭제할 수 없습니다. 다른 안을 기본안으로 지정한 뒤 삭제하세요.', 'error'); return; }
      if (!(await confirmBox(`배치안 "${cur.name}"을 삭제할까요? 되돌릴 수 없습니다.`, { okLabel: '삭제', danger: true }))) return;
      await db.remove('layouts', cur.id);
      logActivity(u.name, `배치안 "${cur.name}" 삭제`, 'layout');
      markDirty(false);
      loadList();
    }
  });

  // ---- 사이드 패널 ----
  function refreshSide() {
    const sel = items.find((i) => i.id === view.selected);
    $('#clearBody').innerHTML = clearanceRows(items, plan, view.selected) || '<tr><td colspan="4" class="muted">검토 대상 설비가 없습니다</td></tr>';
    $('#eqList').innerHTML = items.map((it) => `
      <li class="${it.id === view.selected ? 'sel' : ''} ${it.hidden ? 'off' : ''}" data-id="${esc(it.id)}">
        <span class="dot" style="background:${esc(it.color)}"></span>
        <span class="nm">${esc(it.name)}</span>
        ${it.locked ? '<span title="고정됨">🔒</span>' : ''}
        <button class="icon-btn sm" data-vis title="${it.hidden ? '표시' : '숨기기'}">${it.hidden ? '◌' : '●'}</button>
      </li>`).join('');
    const p = $('#selPanel');
    if (!sel) {
      p.innerHTML = `<div class="card-h"><h3>배치 수정</h3></div>
        <p class="muted small">도면에서 설비를 끌어 옮기거나, 아래 목록에서 선택하세요.<br>
        빈 곳을 끌면 화면 이동, 휠/두 손가락으로 확대·축소합니다.<br>
        선택한 설비는 키보드 방향키로 ${step}mm씩 이동, R 키로 90° 회전합니다.</p>
        <div class="row gap"><button class="btn sm" id="bUndo" ${undo.length ? '' : 'disabled'}>↶ 실행취소</button><button class="btn sm" id="bRedo" ${redo.length ? '' : 'disabled'}>↷ 다시실행</button></div>`;
    } else {
      const c = itemClearance(sel, plan), m = minClear(c), lv = clearLevel(m);
      const isCirc = sel.shape === 'circle';
      p.innerHTML = `
        <div class="card-h"><h3><span class="dot" style="background:${esc(sel.color)}"></span>${esc(sel.name)}</h3><button class="icon-btn sm" id="bDesel" title="선택 해제">✕</button></div>
        <div class="sel-clear"><span>벽체 <b>${fmtM(c.wall.d)}</b></span><span>기둥 <b>${fmtM(c.col.d)}</b></span><span class="lv ${lv.cls}">${lv.text}</span></div>
        <div class="grid2">
          <label class="field sm"><span>X (좌측벽 내측→, m)</span><input type="number" step="0.01" id="fX" value="${((sel.x - ORIGIN.x) / 1000).toFixed(2)}" ${sel.locked ? 'disabled' : ''}></label>
          <label class="field sm"><span>Y (상부벽 내측↓, m)</span><input type="number" step="0.01" id="fY" value="${((sel.y - ORIGIN.y) / 1000).toFixed(2)}" ${sel.locked ? 'disabled' : ''}></label>
        </div>
        <div class="nudge" ${sel.locked ? 'hidden' : ''}>
          <div class="pad">
            <span></span><button class="btn sm" data-n="0,-1">▲</button><span></span>
            <button class="btn sm" data-n="-1,0">◀</button>
            <select id="fStep" title="이동 간격">${[10, 50, 100, 500, 1000].map((s) => `<option value="${s}" ${s === step ? 'selected' : ''}>${s >= 1000 ? s / 1000 + 'm' : s + 'mm'}</option>`).join('')}</select>
            <button class="btn sm" data-n="1,0">▶</button>
            <span></span><button class="btn sm" data-n="0,1">▼</button><span></span>
          </div>
          ${isCirc ? '' : `<div class="rot">
            <span class="small muted">회전 ${sel.rot || 0}°</span>
            <div class="row gap"><button class="btn sm" data-r="-90">⟲90°</button><button class="btn sm" data-r="-15">⟲15°</button><button class="btn sm" data-r="15">⟳15°</button><button class="btn sm" data-r="90">⟳90°</button></div>
          </div>`}
        </div>
        <details class="more-props">
          <summary>속성 (크기·이름·색상)</summary>
          <label class="field sm"><span>이름</span><input id="fName" maxlength="60" value="${esc(sel.name)}"></label>
          <label class="field sm"><span>약칭 (도면 표시)</span><input id="fShort" maxlength="20" value="${esc(sel.short || '')}"></label>
          <div class="grid2">
            ${sel.shape === 'circle' || sel.shape === 'reactor' ? `<label class="field sm"><span>지름 (mm)</span><input type="number" id="fD" min="10" step="10" value="${sel.r * 2}"></label>` : ''}
            ${sel.shape !== 'circle' ? `<label class="field sm"><span>가로 (mm)</span><input type="number" id="fW" min="10" step="10" value="${sel.w}"></label>
            <label class="field sm"><span>세로 (mm)</span><input type="number" id="fH" min="10" step="10" value="${sel.h}"></label>` : ''}
            <label class="field sm"><span>케이블 이동범위 (m, 0=없음)</span><input type="number" id="fRange" min="0" step="1" value="${(sel.range || 0) / 1000}"></label>
            <label class="field sm"><span>색상</span><input type="color" id="fColor" value="${esc(sel.color)}"></label>
          </div>
        </details>
        <div class="row gap wrap checks">
          <label><input type="checkbox" id="fCheck" ${sel.check ? 'checked' : ''}> 이격거리 검토 대상</label>
          <label><input type="checkbox" id="fLock" ${sel.locked ? 'checked' : ''}> 위치 고정</label>
        </div>
        <div class="row gap">
          <button class="btn sm" id="bUndo" ${undo.length ? '' : 'disabled'}>↶ 실행취소</button><button class="btn sm" id="bRedo" ${redo.length ? '' : 'disabled'}>↷ 다시실행</button>
          ${sel.custom ? '<button class="btn sm danger" id="bDel" style="margin-left:auto">삭제</button>' : ''}
        </div>`;
      bindSel(sel);
    }
    $('#bUndo') && ($('#bUndo').onclick = doUndo);
    $('#bRedo') && ($('#bRedo').onclick = doRedo);
  }
  function bindSel(sel) {
    const p = $('#selPanel');
    p.querySelector('#bDesel').onclick = () => view.select(null);
    p.querySelectorAll('[data-n]').forEach((b) => (b.onclick = () => { const [dx, dy] = b.dataset.n.split(',').map(Number); nudge(sel, dx, dy); }));
    p.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { sel.rot = (((sel.rot || 0) + Number(b.dataset.r)) % 360 + 360) % 360; changed(); }));
    const fStep = p.querySelector('#fStep');
    if (fStep) fStep.onchange = () => { step = Number(fStep.value); try { localStorage.setItem(STEP_KEY, step); } catch {} };
    const num = (id, fn) => { const e = p.querySelector(id); if (e) e.onchange = () => { const v = parseFloat(e.value); if (isFinite(v)) { fn(v); changed(); } }; };
    num('#fX', (v) => (sel.x = Math.round(v * 1000 + ORIGIN.x)));
    num('#fY', (v) => (sel.y = Math.round(v * 1000 + ORIGIN.y)));
    num('#fD', (v) => (sel.r = Math.max(5, Math.round(v / 2))));
    num('#fW', (v) => (sel.w = Math.max(10, Math.round(v))));
    num('#fH', (v) => (sel.h = Math.max(10, Math.round(v))));
    num('#fRange', (v) => (sel.range = Math.max(0, Math.round(v * 1000)) || undefined));
    const txt = (id, key) => { const e = p.querySelector(id); if (e) e.onchange = () => { sel[key] = e.value.trim() || sel[key]; changed(); }; };
    txt('#fName', 'name'); txt('#fShort', 'short');
    p.querySelector('#fColor').oninput = (e) => { sel.color = e.target.value; view.redraw(); };
    p.querySelector('#fColor').onchange = () => changed();
    p.querySelector('#fCheck').onchange = (e) => { sel.check = e.target.checked; changed(); };
    p.querySelector('#fLock').onchange = (e) => { sel.locked = e.target.checked; changed(); };
    const del = p.querySelector('#bDel');
    if (del) del.onclick = async () => {
      if (!(await confirmBox(`"${sel.name}"을(를) 이 배치안에서 삭제할까요?`, { okLabel: '삭제', danger: true }))) return;
      items.splice(items.indexOf(sel), 1);
      view.select(null);
      changed();
    };
  }
  function nudge(sel, dx, dy) {
    if (sel.locked) return;
    sel.x += dx * step; sel.y += dy * step;
    changed();
  }
  function doUndo() { if (!undo.length) return; redo.push(snapshot); restore(undo.pop()); refreshSide(); }
  function doRedo() { if (!redo.length) return; undo.push(snapshot); restore(redo.pop()); refreshSide(); }

  $('#eqList').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const it = items.find((i) => i.id === li.dataset.id);
    if (e.target.closest('[data-vis]')) { it.hidden = !it.hidden; changed(); return; }
    view.select(it.id);
    if (!it.hidden) view.centerOn(it);
  });
  $('#clearBody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const it = items.find((i) => i.id === tr.dataset.id);
    view.select(it.id);
    view.centerOn(it);
  });

  // 설비 추가
  $('#btnAdd').addEventListener('click', () => {
    modal({
      title: '설비 추가',
      body: `<label class="field"><span>이름</span><input name="name" required maxlength="60" placeholder="예: 제어반, 케이블 드럼, 안전펜스"></label>
        <label class="field"><span>모양</span><div class="seg"><label><input type="radio" name="shape" value="rect" checked><span>사각형</span></label><label><input type="radio" name="shape" value="circle"><span>원형</span></label></div></label>
        <div class="grid2">
          <label class="field"><span>가로 또는 지름 (mm)</span><input name="w" type="number" min="10" step="10" required value="1000"></label>
          <label class="field"><span>세로 (mm, 사각형)</span><input name="h" type="number" min="10" step="10" value="1000"></label>
        </div>
        <label class="field"><span>색상</span><input type="color" name="color" value="#495057"></label>
        <label><input type="checkbox" name="check"> 이격거리 검토 대상</label>
        <p class="muted small">현재 화면 중앙에 추가됩니다. 저장해야 다른 사람에게 보입니다.</p>`,
      actions: [{ label: '추가', primary: true, submit: true }],
      onSubmit: (fd) => {
        const shape = fd.get('shape'), w = Number(fd.get('w')), h = Number(fd.get('h')) || w;
        const vbx = view.svg.viewBox.baseVal;
        const it = {
          id: 'c' + Date.now().toString(36), custom: true, name: fd.get('name').trim(), short: fd.get('name').trim().slice(0, 12),
          shape, color: fd.get('color'), x: Math.round(vbx.x + vbx.width / 2), y: Math.round(vbx.y + vbx.height / 2), rot: 0,
          w, h, r: Math.round(w / 2), check: fd.get('check') === 'on',
        };
        items.push(it);
        changed();
        view.select(it.id);
      },
    });
  });

  // 키보드
  const onKey = (e) => {
    if (e.target.matches('input, textarea, select') || document.querySelector('.modal-wrap')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    const sel = items.find((i) => i.id === view.selected);
    if (e.key === 'Escape') { setMeasure(false); view.select(null); return; }
    if (!sel) return;
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (k) { e.preventDefault(); nudge(sel, ...k); }
    if (e.key === 'r' || e.key === 'R') { if (!sel.locked && sel.shape !== 'circle') { sel.rot = ((sel.rot || 0) + (e.shiftKey ? -90 : 90) + 360) % 360; changed(); } }
  };
  document.addEventListener('keydown', onKey, { signal: ac().signal });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }, { signal: ac().signal });

  await loadList();
  refreshSide();

  // 다른 화면으로 이동할 때 확인
  return {
    canLeave: async () => !dirty || confirmBox('저장하지 않은 배치 변경사항이 있습니다. 이동할까요?'),
    destroy: () => ac().abort(),
  };
}

// 화면 단위 이벤트 정리용 AbortController
let _ac;
function ac() { if (!_ac || _ac.signal.aborted) _ac = new AbortController(); return _ac; }
