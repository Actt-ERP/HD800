// 요청사항 · 문의사항: 현대측 / 액트투측 게시판 + 답변(댓글)
import { db, logActivity } from './db.js';
import { esc, modal, toast, getUser, setUser, confirmBox, fmtTime, SIDES, SIDE_SHORT } from './util.js';

export const REQ_STATUS = ['접수', '검토중', '완료'];

export async function loadRequests() {
  const [rows, cmts] = await Promise.all([
    db.list('requests', 'select=*&order=created_at.desc'),
    db.list('comments', 'select=request_id'),
  ]);
  const cnt = {};
  for (const c of cmts) cnt[c.request_id] = (cnt[c.request_id] || 0) + 1;
  for (const r of rows) r.comments = cnt[r.id] || 0;
  return rows;
}

export function reqCard(r) {
  return `<article class="req-card st-${esc(r.status)}" data-id="${r.id}" tabindex="0">
    <div class="req-top">
      <span class="kind k-${esc(r.kind)}">${esc(r.kind)}</span>
      <span class="st st-${esc(r.status)}">${esc(r.status)}</span>
      ${r.due_date ? `<span class="due small">회신희망 ${r.due_date.slice(5).replace('-', '/')}</span>` : ''}
    </div>
    <h4>${esc(r.title)}</h4>
    ${r.content ? `<p class="clamp muted">${esc(r.content)}</p>` : ''}
    <div class="req-foot small muted"><span>${esc(r.author)}</span><span>${fmtTime(r.created_at)}</span>${r.comments ? `<span class="cmt">💬 ${r.comments}</span>` : ''}</div>
  </article>`;
}

// 작성/수정 모달
export function editRequest(r, onDone, presetSide) {
  const u = getUser() || {};
  const isNew = !r;
  r = r || { side: presetSide || u.side || 'ACTT', kind: '요청', title: '', content: '', author: u.name || '', status: '접수', due_date: '' };
  modal({
    title: isNew ? '요청 · 문의 작성' : '요청 · 문의 수정',
    wide: true,
    body: `
      <div class="grid2">
        <label class="field"><span>작성 측</span><div class="seg">${Object.entries(SIDES).map(([k, v]) => `<label><input type="radio" name="side" value="${k}" ${r.side === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div></label>
        <label class="field"><span>구분</span><div class="seg">${['요청', '문의'].map((k) => `<label><input type="radio" name="kind" value="${k}" ${r.kind === k ? 'checked' : ''}><span>${k}사항</span></label>`).join('')}</div></label>
      </div>
      <label class="field"><span>제목</span><input name="title" required maxlength="200" value="${esc(r.title)}" placeholder="예: 리액터 반입 시 지게차 지원 요청"></label>
      <label class="field"><span>내용</span><textarea name="content" rows="7" maxlength="5000" placeholder="요청 또는 문의 내용을 입력하세요">${esc(r.content)}</textarea></label>
      <div class="grid2">
        <label class="field"><span>작성자 이름</span><input name="author" required maxlength="50" value="${esc(r.author)}" placeholder="이름 (직급)"></label>
        <label class="field"><span>회신 희망일 (선택)</span><input type="date" name="due_date" value="${esc(r.due_date || '')}"></label>
      </div>
      ${isNew ? '' : `<label class="field"><span>상태</span><div class="seg">${REQ_STATUS.map((s) => `<label><input type="radio" name="status" value="${s}" ${r.status === s ? 'checked' : ''}><span>${s}</span></label>`).join('')}</div></label>`}`,
    actions: [{ label: isNew ? '등록' : '저장', primary: true, submit: true }],
    onSubmit: async (fd) => {
      const row = {
        side: fd.get('side'), kind: fd.get('kind'), title: fd.get('title').trim(), content: fd.get('content').trim(),
        author: fd.get('author').trim(), due_date: fd.get('due_date') || null,
      };
      if (!isNew) row.status = fd.get('status');
      if (!getUser()?.name) setUser({ name: row.author, side: row.side });
      if (isNew) {
        const saved = await db.insert('requests', row);
        logActivity(row.author, `[${SIDE_SHORT[row.side]}] ${row.kind} "${row.title}" 등록`, 'request');
        toast('등록했습니다');
        onDone && onDone(saved);
      } else {
        await db.update('requests', r.id, row);
        logActivity(getUser()?.name || row.author, `${row.kind} "${row.title}" 수정`, 'request');
        toast('저장했습니다');
        onDone && onDone();
      }
    },
  });
}

// 상세 + 답변
export async function openRequest(id, onChange) {
  const r = await db.get('requests', id);
  if (!r) { toast('삭제된 글입니다', 'error'); return; }
  const cmts = await db.list('comments', `select=*&request_id=eq.${id}&order=created_at.asc`);
  const u = getUser() || {};
  const f = modal({
    title: `${SIDES[r.side]} ${r.kind}사항`,
    wide: true,
    body: `
      <div class="req-detail">
        <div class="req-top"><span class="kind k-${esc(r.kind)}">${esc(r.kind)}</span>
          <div class="seg sm" id="stSeg">${REQ_STATUS.map((s) => `<label><input type="radio" name="st" value="${s}" ${r.status === s ? 'checked' : ''}><span>${s}</span></label>`).join('')}</div>
        </div>
        <h3>${esc(r.title)}</h3>
        <div class="small muted">${esc(r.author)} · ${new Date(r.created_at).toLocaleString('ko-KR')}${r.due_date ? ' · 회신희망 ' + r.due_date : ''}</div>
        <div class="req-body">${esc(r.content) || '<span class="muted">(내용 없음)</span>'}</div>
        <h4 class="cmt-h">답변 · 의견 ${cmts.length}</h4>
        <ul class="cmts">${cmts.map((c) => `
          <li class="side-${esc(c.side || '')}"><div class="small"><b>${esc(c.author)}</b> ${c.side ? `<span class="sidetag">${SIDE_SHORT[c.side]}</span>` : ''} <span class="muted">${fmtTime(c.created_at)}</span>
            <button type="button" class="link small danger" data-delc="${c.id}">삭제</button></div><div class="cmt-body">${esc(c.content)}</div></li>`).join('') || '<li class="muted small">아직 답변이 없습니다.</li>'}</ul>
        <div class="cmt-form">
          <textarea name="c_content" rows="3" maxlength="3000" placeholder="답변 또는 의견을 입력하세요"></textarea>
          <div class="row gap">
            <input name="c_author" maxlength="50" placeholder="작성자 이름" value="${esc(u.name || '')}">
            <select name="c_side">${Object.entries(SIDES).map(([k, v]) => `<option value="${k}" ${u.side === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <button type="button" class="btn primary" id="cSend">답변 등록</button>
          </div>
        </div>
      </div>`,
    actions: [
      { label: '삭제', danger: true, left: true, onClick: async (close) => {
        if (!(await confirmBox(`"${r.title}" 글을 삭제할까요? 답변도 함께 삭제됩니다.`, { okLabel: '삭제', danger: true }))) return;
        await db.remove('requests', r.id);
        logActivity(getUser()?.name || '익명', `${r.kind} "${r.title}" 삭제`, 'request');
        close(true); onChange && onChange();
      } },
      { label: '수정', onClick: (close) => { close(true); editRequest(r, onChange); } },
      { label: '닫기', primary: true, onClick: (close) => close() },
    ],
    onClose: () => onChange && onChange(),
  });
  f.querySelector('#stSeg').addEventListener('change', async (e) => {
    await db.update('requests', r.id, { status: e.target.value });
    logActivity(getUser()?.name || '익명', `${r.kind} "${r.title}" 상태 → ${e.target.value}`, 'request');
    toast(`상태: ${e.target.value}`);
  });
  f.querySelector('#cSend').addEventListener('click', async () => {
    const content = f.c_content.value.trim(), author = f.c_author.value.trim(), side = f.c_side.value;
    if (!content) { f.c_content.focus(); return; }
    if (!author) { toast('작성자 이름을 입력하세요', 'error'); f.c_author.focus(); return; }
    if (!getUser()?.name) setUser({ name: author, side });
    await db.insert('comments', { request_id: r.id, author, side, content });
    logActivity(author, `"${r.title}"에 답변 등록`, 'request');
    if (r.status === '접수') await db.update('requests', r.id, { status: '검토중' });
    f.close(true);
    openRequest(id, onChange);
  });
  f.querySelectorAll('[data-delc]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('이 답변을 삭제할까요?', { okLabel: '삭제', danger: true }))) return;
    await db.remove('comments', b.dataset.delc);
    f.close(true);
    openRequest(id, onChange);
  }));
}

export async function renderRequests(root, params) {
  let rows = [];
  let stFilter = 'open';
  let q = '';
  root.innerHTML = `
  <div class="req-page">
    <div class="toolbar card">
      <div class="tb-group">
        <div class="seg sm" id="stF"><label><input type="radio" name="f" value="open" checked><span>미완료</span></label><label><input type="radio" name="f" value="all"><span>전체</span></label><label><input type="radio" name="f" value="done"><span>완료</span></label></div>
        <input type="search" id="q" placeholder="검색 (제목·내용·작성자)" class="search">
      </div>
    </div>
    <div class="req-board">
      ${Object.entries(SIDES).map(([k, v]) => `
      <section class="req-col card" data-side="${k}">
        <div class="card-h"><h3><span class="sidetag big s-${k}">${SIDE_SHORT[k]}</span>${v} 요청 · 문의</h3><button class="btn sm primary" data-new="${k}">＋ 작성</button></div>
        <div class="req-list"></div>
      </section>`).join('')}
    </div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  async function reload() {
    try { rows = await loadRequests(); } catch (e) { toast('불러오기 실패: ' + e.message, 'error'); }
    draw();
  }
  function draw() {
    for (const col of root.querySelectorAll('.req-col')) {
      const side = col.dataset.side;
      const list = rows.filter((r) => r.side === side)
        .filter((r) => (stFilter === 'all' ? true : stFilter === 'done' ? r.status === '완료' : r.status !== '완료'))
        .filter((r) => !q || (r.title + ' ' + r.content + ' ' + r.author).toLowerCase().includes(q));
      const open = rows.filter((r) => r.side === side && r.status !== '완료').length;
      col.querySelector('h3').dataset.count = open;
      col.querySelector('.req-list').innerHTML = list.map(reqCard).join('') || `<p class="empty">${stFilter === 'open' ? '미완료 ' : ''}항목이 없습니다.</p>`;
    }
  }
  root.addEventListener('click', (e) => {
    const nb = e.target.closest('[data-new]');
    if (nb) { editRequest(null, reload, nb.dataset.new); return; }
    const card = e.target.closest('.req-card');
    if (card) openRequest(card.dataset.id, reload);
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.req-card')) openRequest(e.target.dataset.id, reload); });
  $('#stF').addEventListener('change', (e) => { stFilter = e.target.value; draw(); });
  $('#q').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
  await reload();
  if (params.id) openRequest(params.id, reload);
  return { refresh: reload };
}
