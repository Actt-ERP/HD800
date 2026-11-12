// 앱 진입점: 라우터 + 대시보드
import { db } from './db.js';
import { esc, getUser, editUser, fmtTime, todayStr, addDays, diffDays, fmtDate, parseYmd, SIDES, SIDE_SHORT, toast } from './util.js';
import { loadPlan, createPlanView, itemsBox, clearanceRows, itemClearance, minClear, clearLevel, fmtM } from './plan.js';
import { getMainLayout } from './layouts.js';
import { renderLayout } from './view-layout.js';
import { renderSchedule, loadSchedule, editEvent, catColor, layoutWeek, monthGridStart } from './view-schedule.js';
import { renderRequests, loadRequests, reqCard, openRequest, editRequest } from './view-requests.js';

const main = document.getElementById('main');
let current = null; // 현재 화면 핸들 {canLeave, destroy, refresh}
let lastHash = location.hash;

const ROUTES = {
  '': renderDashboard,
  layout: renderLayout,
  schedule: renderSchedule,
  requests: renderRequests,
};

async function route() {
  if (current?.canLeave && location.hash !== lastHash) {
    if (!(await current.canLeave())) { history.replaceState(null, '', lastHash || '#/'); return; }
  }
  current?.destroy?.();
  document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
  lastHash = location.hash;
  const [, page = '', id] = location.hash.replace(/^#/, '').split('/');
  const fn = ROUTES[page] || renderDashboard;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', (a.getAttribute('href').split('/')[1] || '') === page));
  document.body.dataset.page = page || 'home';
  main.innerHTML = '<div class="loading">불러오는 중…</div>';
  window.scrollTo(0, 0);
  try {
    current = (await fn(main, { id })) || null;
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="card error-box"><h3>불러오기 실패</h3><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">새로고침</button></div>`;
  }
}
window.addEventListener('hashchange', route);

// 다른 사람이 수정한 내용 반영: 탭으로 돌아올 때 새로고침
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && current?.refresh && !document.querySelector('.modal-wrap')) current.refresh();
});

// 사용자 칩
function drawUser() {
  const u = getUser();
  const chip = document.getElementById('userChip');
  chip.innerHTML = u?.name ? `<span class="sidetag s-${u.side}">${SIDE_SHORT[u.side] || ''}</span>${esc(u.name)}` : '작성자 설정';
}
document.getElementById('userChip').addEventListener('click', () => editUser());
document.addEventListener('userchange', drawUser);
drawUser();

// ---------------- 대시보드 ----------------
async function renderDashboard(root) {
  root.innerHTML = `
  <div class="dash">
    <section class="kpis" id="kpis"></section>
    <div class="dash-grid">
      <section class="card dash-layout">
        <div class="card-h"><h3><a href="#/layout">배치도 · 이격거리</a></h3><a class="more" href="#/layout">배치 수정 →</a></div>
        <div class="muted small" id="lyName"></div>
        <div class="dash-map" id="dashMap" title="눌러서 배치도 열기"></div>
        <table class="tbl clear-tbl"><thead><tr><th>설비</th><th>벽체</th><th>기둥</th><th>판정</th></tr></thead><tbody id="dClear"></tbody></table>
      </section>
      <section class="card dash-sched">
        <div class="card-h"><h3><a href="#/schedule">공사 일정</a></h3><button class="btn sm" id="dAddEv">＋ 추가</button></div>
        <div id="dCal" class="mini-cal"></div>
        <h4 class="sub">진행 · 예정 작업</h4>
        <ul class="ev-list" id="dEv"></ul>
        <a class="more" href="#/schedule">전체 일정 보기 →</a>
      </section>
      <section class="card dash-req">
        <div class="card-h"><h3><a href="#/requests">요청 · 문의사항</a></h3><a class="more" href="#/requests">전체 보기 →</a></div>
        <div class="req-mini" id="dReq"></div>
      </section>
      <section class="card dash-act">
        <div class="card-h"><h3>최근 변경 이력</h3></div>
        <ul class="act-list" id="dAct"></ul>
      </section>
    </div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  let view;

  async function loadAll() {
    const [plan, layout, events, reqs, acts] = await Promise.all([
      loadPlan(), getMainLayout(), loadSchedule().catch(() => []), loadRequests().catch(() => []),
      db.list('activity', 'select=*&order=created_at.desc&limit=12').catch(() => []),
    ]);
    // 배치도
    if (!view) {
      view = createPlanView($('#dashMap'), plan, { editable: false, layers: { c3: true, c4: true, c5: true, range: false, dims: false, text: false }, fitTo: (its) => itemsBox(its, 6500), onItemClick: () => (location.hash = '#/layout') });
      $('#dashMap').addEventListener('dblclick', () => (location.hash = '#/layout'));
    }
    view.setItems(layout.items);
    $('#lyName').innerHTML = `기본안: <b>${esc(layout.name)}</b> · ${esc(layout.updated_by || layout.author)} ${fmtTime(layout.updated_at)} 수정`;
    $('#dClear').innerHTML = clearanceRows(layout.items, plan);
    $('#dClear').onclick = () => (location.hash = '#/layout');

    // KPI
    const today = todayStr();
    const worst = layout.items.filter((i) => i.check && !i.hidden).map((i) => ({ i, d: minClear(itemClearance(i, plan)) })).sort((a, b) => a.d - b.d)[0];
    const s0 = events.length ? events.reduce((a, e) => (e.start_date < a ? e.start_date : a), events[0].start_date) : null;
    const s1 = events.length ? events.reduce((a, e) => (e.end_date > a ? e.end_date : a), events[0].end_date) : null;
    const total = s0 ? diffDays(s0, s1) + 1 : 0;
    const passed = s0 ? Math.min(total, Math.max(0, diffDays(s0, today) + 1)) : 0;
    const doneCnt = events.filter((e) => e.status === '완료').length;
    const openBy = (side) => reqs.filter((r) => r.side === side && r.status !== '완료').length;
    const lv = worst ? clearLevel(worst.d) : null;
    $('#kpis').innerHTML = `
      <a class="kpi card" href="#/schedule">
        <span class="k-l">공사 기간</span>
        ${s0 ? `<span class="k-v">${today < s0 ? 'D-' + diffDays(today, s0) : today > s1 ? '종료' : passed + '<small>/' + total + '일</small>'}</span>
        <span class="k-s">${fmtDate(s0)} ~ ${fmtDate(s1)}</span>
        <span class="bar-prog"><i style="width:${total ? (passed / total) * 100 : 0}%"></i></span>` : '<span class="k-v">-</span><span class="k-s">일정을 등록하세요</span>'}
      </a>
      <a class="kpi card" href="#/schedule"><span class="k-l">작업 진행</span><span class="k-v">${doneCnt}<small>/${events.length} 완료</small></span>
        <span class="k-s">진행중 ${events.filter((e) => e.status === '진행중' || (e.start_date <= today && e.end_date >= today && e.status !== '완료')).length} · 지연 ${events.filter((e) => e.status === '지연').length}</span></a>
      <a class="kpi card" href="#/requests"><span class="k-l">미완료 요청·문의</span><span class="k-v">${openBy('HD') + openBy('ACTT')}<small>건</small></span>
        <span class="k-s"><span class="sidetag s-HD">현대</span>${openBy('HD')} · <span class="sidetag s-ACTT">액트투</span>${openBy('ACTT')}</span></a>
      <a class="kpi card" href="#/layout"><span class="k-l">최소 이격거리</span>
        ${worst ? `<span class="k-v ${lv.cls}-t">${fmtM(worst.d)}</span><span class="k-s">${esc(worst.i.short || worst.i.name)} · <span class="lv ${lv.cls}">${lv.text}</span></span>` : '<span class="k-v">-</span>'}</a>`;

    // 미니 달력 (이번 주 포함 2주)
    const ws = addDays(today, -parseYmd(today).getDay());
    let cal = `<div class="cal-head">${['일', '월', '화', '수', '목', '금', '토'].map((d) => `<div>${d}</div>`).join('')}</div>`;
    for (let w = 0; w < 3; w++) {
      const s = addDays(ws, w * 7);
      const bars = layoutWeek(events, s);
      cal += `<div class="week"><div class="days">${[0, 1, 2, 3, 4, 5, 6].map((d) => { const ds = addDays(s, d); return `<div class="day ${ds === today ? 'today' : ''}" data-date="${ds}"><span class="dn">${parseYmd(ds).getDate()}</span></div>`; }).join('')}</div>
        <div class="bars">${bars.filter((b) => b.lane < 2).map((b) => `<button class="bar st-${esc(b.e.status)}" style="grid-column:${b.s + 1}/${b.en + 2};grid-row:${b.lane + 1};--c:${catColor(b.e.category)}" data-ev="${b.e.id}">${esc(b.e.title)}</button>`).join('')}</div></div>`;
    }
    $('#dCal').innerHTML = cal;
    const upcoming = events.filter((e) => e.end_date >= today && e.status !== '완료').slice(0, 6);
    $('#dEv').innerHTML = upcoming.map((e) => `
      <li data-ev="${e.id}"><span class="cat-dot" style="background:${catColor(e.category)}"></span>
        <span class="ev-t">${esc(e.title)}</span>
        <span class="ev-d small muted">${fmtDate(e.start_date)}${e.end_date !== e.start_date ? '~' + fmtDate(e.end_date) : ''}</span>
        <span class="st st-${esc(e.status)}">${e.start_date <= today && e.status === '예정' ? '진행중' : esc(e.status)}</span></li>`).join('') || '<li class="empty">예정된 작업이 없습니다</li>';
    const evClick = (e) => { const t = e.target.closest('[data-ev]'); if (t) editEvent(events.find((x) => x.id === t.dataset.ev), loadAll); else { const d = e.target.closest('.day'); if (d) editEvent(null, loadAll, { date: d.dataset.date }); } };
    $('#dCal').onclick = evClick;
    $('#dEv').onclick = evClick;

    // 요청
    $('#dReq').innerHTML = Object.entries(SIDES).map(([k, v]) => {
      const list = reqs.filter((r) => r.side === k && r.status !== '완료').slice(0, 4);
      return `<div class="req-mini-col"><div class="row between"><h4><span class="sidetag s-${k}">${SIDE_SHORT[k]}</span>${v}</h4><button class="btn sm" data-new="${k}">＋ 작성</button></div>
        ${list.map(reqCard).join('') || '<p class="empty small">미완료 항목 없음</p>'}</div>`;
    }).join('');
    $('#dReq').onclick = (e) => {
      const nb = e.target.closest('[data-new]');
      if (nb) return editRequest(null, loadAll, nb.dataset.new);
      const c = e.target.closest('.req-card');
      if (c) openRequest(c.dataset.id, loadAll);
    };

    // 이력
    $('#dAct').innerHTML = acts.map((a) => `<li><b>${esc(a.actor)}</b> ${esc(a.action)} <span class="muted small">${fmtTime(a.created_at)}</span></li>`).join('') || '<li class="empty small">아직 변경 이력이 없습니다</li>';
  }
  $('#dAddEv').onclick = () => editEvent(null, loadAll);
  await loadAll();
  return { refresh: () => loadAll().catch((e) => toast(e.message, 'error')) };
}

route();
