// 공사 일정: 월간 달력 + 목록, 일정 추가/수정/삭제
import { db, logActivity } from './db.js';
import { esc, modal, toast, getUser, setUser, confirmBox, ymd, parseYmd, todayStr, addDays, diffDays, fmtDate, pad } from './util.js';

export const CATS = [
  { key: '운송', color: '#4c6ef5' },
  { key: '반입·양중', color: '#15aabf' },
  { key: '설치', color: '#f08c00' },
  { key: '배선·결선', color: '#7950f2' },
  { key: '시운전·시험', color: '#e03131' },
  { key: '회의·검수', color: '#2f9e44' },
  { key: '기타', color: '#868e96' },
];
export const catColor = (k) => (CATS.find((c) => c.key === k) || CATS[CATS.length - 1]).color;
export const STATUS = ['예정', '진행중', '완료', '지연'];

export const loadSchedule = () => db.list('schedule', 'select=*&order=start_date.asc,created_at.asc');

// 일정 편집 모달 (대시보드에서도 사용)
export async function editEvent(ev, onDone, preset = {}) {
  const u = getUser() || {};
  const isNew = !ev;
  ev = ev || { title: '', start_date: preset.date || todayStr(), end_date: preset.date || todayStr(), category: '설치', assignee: '', note: '', status: '예정', author: u.name || '' };
  const f = modal({
    title: isNew ? '일정 추가' : '일정 수정',
    body: `
      <label class="field"><span>작업명</span><input name="title" required maxlength="200" value="${esc(ev.title)}" placeholder="예: 리액터 반입 및 양중"></label>
      <div class="grid2">
        <label class="field"><span>시작일</span><input type="date" name="start_date" required value="${ev.start_date}"></label>
        <label class="field"><span>종료일</span><input type="date" name="end_date" required value="${ev.end_date}"></label>
      </div>
      <label class="field"><span>구분</span><div class="chips">${CATS.map((c) => `<label><input type="radio" name="category" value="${c.key}" ${ev.category === c.key ? 'checked' : ''}><span style="--c:${c.color}">${c.key}</span></label>`).join('')}</div></label>
      <label class="field"><span>상태</span><div class="seg">${STATUS.map((s) => `<label><input type="radio" name="status" value="${s}" ${ev.status === s ? 'checked' : ''}><span>${s}</span></label>`).join('')}</div></label>
      <label class="field"><span>담당 (업체·인원)</span><input name="assignee" maxlength="100" value="${esc(ev.assignee)}" placeholder="예: 액트투 2명, 크레인 업체"></label>
      <label class="field"><span>메모</span><textarea name="note" rows="3" maxlength="2000">${esc(ev.note)}</textarea></label>
      <label class="field"><span>작성자</span><input name="author" required maxlength="50" value="${esc(isNew ? u.name || '' : ev.author)}" placeholder="이름"></label>
      ${isNew ? '' : `<p class="muted small">최초 작성: ${esc(ev.author)}</p>`}`,
    actions: [
      ...(isNew ? [] : [{ label: '삭제', danger: true, left: true, onClick: async (close) => {
        if (!(await confirmBox(`"${ev.title}" 일정을 삭제할까요?`, { okLabel: '삭제', danger: true }))) return;
        await db.remove('schedule', ev.id);
        logActivity(getUser()?.name || '익명', `일정 "${ev.title}" 삭제`, 'schedule');
        toast('삭제했습니다');
        close(true);
        onDone && onDone();
      } }]),
      { label: '저장', primary: true, submit: true },
    ],
    onSubmit: async (fd) => {
      const row = Object.fromEntries(['title', 'start_date', 'end_date', 'category', 'status', 'assignee', 'note', 'author'].map((k) => [k, (fd.get(k) || '').trim()]));
      if (row.end_date < row.start_date) { toast('종료일이 시작일보다 빠릅니다', 'error'); return false; }
      const name = row.author;
      if (!getUser()?.name) setUser({ name, side: 'ACTT' });
      if (isNew) {
        await db.insert('schedule', row);
        logActivity(name, `일정 "${row.title}" 추가 (${row.start_date}~${row.end_date})`, 'schedule');
      } else {
        delete row.author; // 최초 작성자 유지
        await db.update('schedule', ev.id, row);
        logActivity(name, `일정 "${row.title}" 수정`, 'schedule');
      }
      toast('저장했습니다');
      onDone && onDone();
    },
  });
  const s = f.querySelector('[name=start_date]'), e = f.querySelector('[name=end_date]');
  s.addEventListener('change', () => { if (e.value < s.value) e.value = s.value; });
}

// 주 단위 막대 배치 (lane 계산)
export function layoutWeek(events, weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const evs = events.filter((e) => e.start_date <= weekEnd && e.end_date >= weekStart)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || diffDays(b.start_date, b.end_date) - diffDays(a.start_date, a.end_date));
  const lanes = [];
  return evs.map((e) => {
    const s = Math.max(0, diffDays(weekStart, e.start_date)), en = Math.min(6, diffDays(weekStart, e.end_date));
    let lane = lanes.findIndex((end) => end < s);
    if (lane < 0) { lane = lanes.length; lanes.push(en); } else lanes[lane] = en;
    return { e, s, en, lane, contL: e.start_date < weekStart, contR: e.end_date > weekEnd };
  });
}

export function monthGridStart(y, m) {
  const first = new Date(y, m, 1);
  return ymd(new Date(y, m, 1 - first.getDay()));
}

export async function renderSchedule(root) {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth();
  let events = [];
  let catFilter = new Set(CATS.map((c) => c.key));

  root.innerHTML = `
  <div class="sched-page">
    <div class="toolbar card">
      <div class="tb-group">
        <button class="icon-btn" id="prev" aria-label="이전 달">‹</button>
        <h2 id="ym" class="ym"></h2>
        <button class="icon-btn" id="next" aria-label="다음 달">›</button>
        <button class="btn sm" id="today">오늘</button>
      </div>
      <div class="tb-group">
        <div class="seg sm" id="viewSeg"><label><input type="radio" name="v" value="cal" checked><span>달력</span></label><label><input type="radio" name="v" value="list"><span>목록</span></label></div>
        <button class="btn primary" id="add">＋ 일정 추가</button>
      </div>
    </div>
    <div class="cat-filter" id="catFilter">${CATS.map((c) => `<label><input type="checkbox" value="${c.key}" checked><span style="--c:${c.color}">${c.key}</span></label>`).join('')}</div>
    <div id="calBox" class="card cal"></div>
    <div id="listBox" class="card" hidden></div>
  </div>`;
  const $ = (s) => root.querySelector(s);

  async function reload() {
    try { events = await loadSchedule(); } catch (e) { toast('일정을 불러오지 못했습니다: ' + e.message, 'error'); }
    draw();
  }
  const visible = () => events.filter((e) => catFilter.has(e.category));

  function draw() {
    $('#ym').textContent = `${y}년 ${m + 1}월`;
    drawCal();
    drawList();
  }
  function drawCal() {
    const start = monthGridStart(y, m), today = todayStr();
    const evs = visible();
    let html = `<div class="cal-head">${['일', '월', '화', '수', '목', '금', '토'].map((d, i) => `<div class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</div>`).join('')}</div>`;
    for (let w = 0; w < 6; w++) {
      const ws = addDays(start, w * 7);
      if (w >= 4 && parseYmd(ws).getMonth() !== m) break;
      const bars = layoutWeek(evs, ws);
      const maxLane = 3;
      const hidden = Array(7).fill(0);
      for (const b of bars) if (b.lane >= maxLane) for (let d = b.s; d <= b.en; d++) hidden[d]++;
      html += `<div class="week"><div class="days">`;
      for (let d = 0; d < 7; d++) {
        const ds = addDays(ws, d), dt = parseYmd(ds);
        html += `<div class="day ${dt.getMonth() !== m ? 'out' : ''} ${ds === today ? 'today' : ''} ${d === 0 ? 'sun' : d === 6 ? 'sat' : ''}" data-date="${ds}"><span class="dn">${dt.getDate()}</span>${hidden[d] ? `<span class="more">+${hidden[d]}</span>` : ''}</div>`;
      }
      html += `</div><div class="bars">`;
      for (const b of bars) {
        if (b.lane >= maxLane) continue;
        html += `<button class="bar st-${esc(b.e.status)} ${b.contL ? 'cl' : ''} ${b.contR ? 'cr' : ''}" style="grid-column:${b.s + 1}/${b.en + 2};grid-row:${b.lane + 1};--c:${catColor(b.e.category)}" data-id="${b.e.id}" title="${esc(b.e.title)} (${b.e.start_date}~${b.e.end_date})">${b.e.status === '완료' ? '✓ ' : b.e.status === '지연' ? '⚠ ' : ''}${esc(b.e.title)}</button>`;
      }
      html += `</div></div>`;
    }
    $('#calBox').innerHTML = html;
  }
  function drawList() {
    const evs = visible();
    if (!evs.length) { $('#listBox').innerHTML = '<p class="empty">등록된 일정이 없습니다. "＋ 일정 추가"로 공사 일정을 입력하세요.</p>'; return; }
    const today = todayStr();
    $('#listBox').innerHTML = `<table class="tbl sched-tbl"><thead><tr><th>기간</th><th>작업</th><th>구분</th><th>담당</th><th>상태</th></tr></thead><tbody>${evs.map((e) => `
      <tr data-id="${e.id}" class="${e.start_date <= today && e.end_date >= today ? 'now' : ''}">
        <td class="nowrap">${fmtDate(e.start_date)}${e.end_date !== e.start_date ? ' ~ ' + fmtDate(e.end_date) : ''}<div class="muted small">${diffDays(e.start_date, e.end_date) + 1}일</div></td>
        <td><b>${esc(e.title)}</b>${e.note ? `<div class="muted small clamp">${esc(e.note)}</div>` : ''}</td>
        <td><span class="cat" style="--c:${catColor(e.category)}">${esc(e.category)}</span></td>
        <td>${esc(e.assignee)}</td>
        <td><span class="st st-${esc(e.status)}">${esc(e.status)}</span></td>
      </tr>`).join('')}</tbody></table>`;
  }

  root.addEventListener('click', (e) => {
    const bar = e.target.closest('[data-id]');
    if (bar && (bar.classList.contains('bar') || bar.tagName === 'TR')) {
      editEvent(events.find((x) => x.id === bar.dataset.id), reload);
      return;
    }
    const day = e.target.closest('.day');
    if (day) editEvent(null, reload, { date: day.dataset.date });
  });
  $('#prev').onclick = () => { m--; if (m < 0) { m = 11; y--; } draw(); };
  $('#next').onclick = () => { m++; if (m > 11) { m = 0; y++; } draw(); };
  $('#today').onclick = () => { y = now.getFullYear(); m = now.getMonth(); draw(); };
  $('#add').onclick = () => editEvent(null, reload);
  $('#viewSeg').addEventListener('change', (e) => {
    const list = e.target.value === 'list';
    $('#calBox').hidden = list; $('#listBox').hidden = !list;
  });
  $('#catFilter').addEventListener('change', (e) => {
    e.target.checked ? catFilter.add(e.target.value) : catFilter.delete(e.target.value);
    draw();
  });
  await reload();
  return { refresh: reload };
}
