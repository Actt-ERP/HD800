// 공통 유틸: HTML 이스케이프, 사용자 정보, 모달, 토스트, 날짜
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const SIDES = { HD: 'HD현대일렉트릭', ACTT: '(주)액트투' };
export const SIDE_SHORT = { HD: '현대', ACTT: '액트투' };

// ---- 사용자 (이 브라우저에만 저장) ----
const USER_KEY = 'hd800.user';
export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; } catch { return null; }
}
export function setUser(u) {
  try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch {}
  document.dispatchEvent(new CustomEvent('userchange'));
}
// 이름이 없으면 먼저 물어봄
export async function requireUser() {
  const u = getUser();
  if (u && u.name) return u;
  return editUser();
}
export function editUser() {
  const u = getUser() || { name: '', side: 'ACTT' };
  return new Promise((resolve) => {
    const m = modal({
      title: '작성자 정보',
      body: `
        <p class="muted small">입력 및 수정 시 작성자로 기록됩니다. 이 브라우저에만 저장됩니다.</p>
        <label class="field"><span>이름</span><input name="name" maxlength="50" required value="${esc(u.name)}" placeholder="예: 홍길동 과장"></label>
        <label class="field"><span>소속</span>
          <div class="seg">
            <label><input type="radio" name="side" value="ACTT" ${u.side !== 'HD' ? 'checked' : ''}><span>${SIDES.ACTT}</span></label>
            <label><input type="radio" name="side" value="HD" ${u.side === 'HD' ? 'checked' : ''}><span>${SIDES.HD}</span></label>
          </div>
        </label>`,
      actions: [{ label: '저장', primary: true, submit: true }],
      onSubmit: (fd) => {
        const nu = { name: fd.get('name').trim(), side: fd.get('side') };
        if (!nu.name) return false;
        setUser(nu);
        resolve(nu);
      },
      onClose: () => resolve(getUser()),
    });
    m.querySelector('input[name=name]').focus();
  });
}

// ---- 모달 ----
// actions: [{label, primary, danger, submit, onClick}]
export function modal({ title, body, actions = [], onSubmit, onClose, wide }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `
    <form class="modal ${wide ? 'wide' : ''}" novalidate>
      <header><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-close aria-label="닫기">✕</button></header>
      <div class="modal-body">${body}</div>
      <footer></footer>
    </form>`;
  const form = wrap.querySelector('form');
  const footer = wrap.querySelector('footer');
  let closed = false;
  const close = (silent) => {
    if (closed) return;
    closed = true;
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    if (!silent && onClose) onClose();
  };
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = a.submit ? 'submit' : 'button';
    b.className = 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '');
    if (a.left) b.style.marginRight = 'auto';
    b.textContent = a.label;
    if (a.onClick) b.addEventListener('click', async () => { if ((await a.onClick(close, form)) !== false) {} });
    footer.appendChild(b);
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try {
      const r = onSubmit ? await onSubmit(new FormData(form), form) : true;
      if (r !== false) close(true);
    } catch (err) {
      toast('저장 실패: ' + err.message, 'error');
    } finally { if (btn) btn.disabled = false; }
  });
  wrap.querySelector('[data-close]').addEventListener('click', () => close());
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  form.close = close;
  return form;
}

export function confirmBox(msg, { okLabel = '확인', danger } = {}) {
  return new Promise((resolve) => {
    modal({
      title: '확인',
      body: `<p>${esc(msg)}</p>`,
      actions: [{ label: '취소', onClick: (close) => { close(true); resolve(false); } }, { label: okLabel, primary: !danger, danger, submit: true }],
      onSubmit: () => resolve(true),
      onClose: () => resolve(false),
    });
  });
}

// ---- 토스트 ----
export function toast(msg, type = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

// ---- 날짜 ----
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const todayStr = () => ymd(new Date());
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const fmtDate = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
export function fmtTime(iso) {
  const d = new Date(iso), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return Math.floor(diff / 60) + '분 전';
  if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
