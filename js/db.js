// Supabase REST 래퍼 (LIRAsupabase 프로젝트의 hd800_* 테이블만 사용)
// anon 키는 공개용 키이며, RLS 정책으로 hd800_* 테이블만 읽기/쓰기 허용됨
const URL = 'https://mevovgaunpoioskkdqls.supabase.co/rest/v1/';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ldm92Z2F1bnBvaW9za2tkcWxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyNzAyNTgsImV4cCI6MjEwNjg0NjI1OH0.NyOQmX8XHIaDuWc5dPCOXs1Un5OhR3M8t5buprfRPbM';

async function req(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try { const j = await res.json(); msg = j.message || msg; } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

export const db = {
  list: (table, query = '') => req(`hd800_${table}?${query}`),
  get: async (table, id) => (await req(`hd800_${table}?id=eq.${encodeURIComponent(id)}`))[0],
  insert: async (table, row) => (await req(`hd800_${table}`, { method: 'POST', body: row, prefer: 'return=representation' }))[0],
  update: async (table, id, patch) => (await req(`hd800_${table}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }))[0],
  remove: (table, id) => req(`hd800_${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// 변경 이력 기록 (실패해도 무시)
export function logActivity(actor, action, target) {
  db.insert('activity', { actor: actor || '익명', action: action.slice(0, 300), target }).catch(() => {});
}
