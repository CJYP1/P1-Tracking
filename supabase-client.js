// =====================================================================
// Zone Resource Map — Supabase client library v2
// NOT wired into the html yet. This file is the full client-side piece:
// login (two roles, one hidden), per-element / per-slab-qty sync, an
// offline queue, and admin helpers. When you're ready, add before your
// closing </body>:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="supabase-client.js"></script>
// then call the functions below from the existing click handlers
// (cycleElem, zpSetDone, etc.) instead of / alongside the localStorage
// calls that are already there.
// =====================================================================

const SUPABASE_URL = 'https://rxarahrcsylkkqbcatxw.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_f_DTCZskL9aCdMdn0KTHsg_AsCdQ1tB';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ---------------------------------------------------------------------
// Hidden admin entry point
// Nobody sees an admin login button. You reach it by opening the page
// with this exact URL fragment, e.g.:
//   yourfile.html#zradmin92
// Change ZRADMIN92 to your own private string before you deploy — treat
// it like a second password. Whatever you pick, keep this constant and
// the URL you actually type in sync.
// ---------------------------------------------------------------------
const RWS_ADMIN_HASH = '#zradmin92';
function rwsIsAdminEntryRequested() {
  return window.location.hash === RWS_ADMIN_HASH;
}

// ---------------------------------------------------------------------
// Session (stored in localStorage so a page refresh doesn't log you out)
// ---------------------------------------------------------------------
const RWS_SESSION_KEY = 'rws_session';

function rwsGetSession() {
  try { return JSON.parse(localStorage.getItem(RWS_SESSION_KEY) || 'null'); } catch (e) { return null; }
}
function rwsSetSession(s) {
  try { localStorage.setItem(RWS_SESSION_KEY, JSON.stringify(s)); } catch (e) {}
}
function rwsClearSession() {
  try { localStorage.removeItem(RWS_SESSION_KEY); } catch (e) {}
}

// Low-level RPC wrapper: tells the caller whether a failure was a network
// problem (worth queuing for later) or a real rejection (bad password,
// no permission, expired session — retrying later won't help).
async function rwsCall(fn, args) {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      const msg = (error.message || '').toLowerCase();
      const rejected = msg.includes('not permitted') || msg.includes('admin only') ||
        msg.includes('bad ') || msg.includes('invalid username') || msg.includes('invalid or expired');
      return { ok: false, error, rejected, offline: false };
    }
    return { ok: true, data };
  } catch (networkErr) {
    return { ok: false, error: networkErr, offline: true };
  }
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------

// returns the session object on success, throws on bad credentials
async function rwsLogin(username, password) {
  const r = await rwsCall('rws_login', { p_username: username, p_password: password });
  if (!r.ok) throw new Error(r.error && r.error.message ? r.error.message : 'login failed');
  const session = r.data; // {token,user_id,username,display_name,role,allowed_scopes}
  rwsSetSession(session);
  return session;
}

async function rwsLogout() {
  const s = rwsGetSession();
  if (s) await rwsCall('rws_logout', { p_token: s.token });
  rwsClearSession();
}

// call on page load: revalidates the stored token, clears it if expired
async function rwsRestoreSession() {
  const s = rwsGetSession();
  if (!s) return null;
  const r = await rwsCall('rws_check_session', { p_token: s.token });
  if (!r.ok || !r.data) { rwsClearSession(); return null; }
  const merged = { ...s, ...r.data };
  rwsSetSession(merged);
  return merged;
}

function rwsIsAdmin() {
  const s = rwsGetSession();
  return !!s && s.role === 'admin';
}

// ---------------------------------------------------------------------
// Offline queue
// Every edit follows: 1) caller updates its own UI + localStorage first
// (that part already exists in the html) 2) it calls one of the rwsSync*
// functions below 3) if that fails to reach Supabase, the edit is queued
// here and retried automatically when back online.
// ---------------------------------------------------------------------
const RWS_QUEUE_KEY = 'rws_offline_queue';

function rwsQueueList() {
  try { return JSON.parse(localStorage.getItem(RWS_QUEUE_KEY) || '[]'); } catch (e) { return []; }
}
function rwsQueueSave(q) {
  try { localStorage.setItem(RWS_QUEUE_KEY, JSON.stringify(q)); } catch (e) {}
}
function rwsQueuePush(fn, args) {
  const q = rwsQueueList();
  q.push({ id: Date.now() + '_' + Math.random().toString(36).slice(2), fn, args, ts: Date.now() });
  rwsQueueSave(q);
}
function rwsQueueSize() { return rwsQueueList().length; }

// processes the queue in order; stops at the first network failure so
// order is preserved, but drops entries the server actively rejects
// (those would never succeed on retry, e.g. permission changed meanwhile)
let _rwsFlushing = false;
async function rwsQueueFlush() {
  if (_rwsFlushing) return;
  _rwsFlushing = true;
  try {
    let q = rwsQueueList();
    while (q.length) {
      const item = q[0];
      const r = await rwsCall(item.fn, item.args);
      if (r.ok) {
        q.shift();
        rwsQueueSave(q);
      } else if (r.offline) {
        break; // still offline — leave the rest queued, try again later
      } else {
        console.warn('[rws] dropping queued edit, server rejected it:', item, r.error);
        q.shift();
        rwsQueueSave(q);
      }
    }
  } finally {
    _rwsFlushing = false;
  }
}
window.addEventListener('online', rwsQueueFlush);
setInterval(rwsQueueFlush, 20000);

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

// {elements:{key:status}, slab_qty:{key:qty}, zone_updates:[...]}
async function rwsGetState() {
  const s = rwsGetSession();
  if (!s) throw new Error('not logged in');
  const r = await rwsCall('rws_get_state', { p_token: s.token });
  if (!r.ok) throw new Error(r.error && r.error.message ? r.error.message : 'failed to load state');
  return r.data;
}

// ---------------------------------------------------------------------
// Writes (per-record — never the whole JSON)
// ---------------------------------------------------------------------

// elementKey must be in the html's existing ekey() format: lv||mk||type||id
async function rwsSyncElementStatus(elementKey, status) {
  const s = rwsGetSession();
  if (!s) return { ok: false, error: new Error('not logged in') };
  const args = { p_token: s.token, p_element_key: elementKey, p_status: status };
  const r = await rwsCall('rws_update_element', args);
  if (!r.ok && r.offline) rwsQueuePush('rws_update_element', args);
  return r;
}

// qtyKey must match the html's existing zpSetDone key format: zone||month||idx
// level/zoneMk are the *resource-map* level + zone mk this schedule row
// resolves to (the html already computes this via its _zpRev mapping) —
// pass them through so scope checks work without the server needing to
// understand the schedule-sheet naming.
async function rwsSyncSlabQty(qtyKey, level, zoneMk, qty) {
  const s = rwsGetSession();
  if (!s) return { ok: false, error: new Error('not logged in') };
  const args = { p_token: s.token, p_qty_key: qtyKey, p_level: level, p_zone_mk: zoneMk, p_qty: qty };
  const r = await rwsCall('rws_update_slab_qty', args);
  if (!r.ok && r.offline) rwsQueuePush('rws_update_slab_qty', args);
  return r;
}

// admin only — the free-form per-zone site-update log
async function rwsAddZoneUpdate({ zoneMk, level, zoneLabel, pct, status, date, note, crew }) {
  const s = rwsGetSession();
  if (!s) return { ok: false, error: new Error('not logged in') };
  const args = {
    p_token: s.token, p_zone_mk: zoneMk, p_level: level, p_zone_label: zoneLabel,
    p_pct: pct, p_status: status, p_date: date, p_note: note, p_crew: crew
  };
  const r = await rwsCall('rws_add_zone_update', args);
  if (!r.ok && r.offline) rwsQueuePush('rws_add_zone_update', args);
  return r;
}

// ---------------------------------------------------------------------
// Admin dashboard helpers
// ---------------------------------------------------------------------

// "谁干了什么" — full audit trail, admin only
async function rwsAdminActivityLog(limit = 300) {
  const s = rwsGetSession();
  if (!s || s.role !== 'admin') throw new Error('admin only');
  const r = await rwsCall('rws_admin_activity_log', { p_token: s.token, p_limit: limit });
  if (!r.ok) throw new Error(r.error && r.error.message ? r.error.message : 'failed to load activity log');
  return r.data;
}

async function rwsAdminListUsers() {
  const s = rwsGetSession();
  if (!s || s.role !== 'admin') throw new Error('admin only');
  const r = await rwsCall('rws_admin_list_users', { p_token: s.token });
  if (!r.ok) throw new Error(r.error && r.error.message ? r.error.message : 'failed to load users');
  return r.data;
}

// pass password: null/'' when editing an existing user without changing it
// allowedScopes example: [{level:'L5'}, {level:'L3', zone:'A3'}]
async function rwsAdminUpsertUser({ username, password, displayName, role, allowedScopes, active }) {
  const s = rwsGetSession();
  if (!s || s.role !== 'admin') throw new Error('admin only');
  const r = await rwsCall('rws_admin_upsert_user', {
    p_token: s.token, p_username: username, p_password: password || null,
    p_display_name: displayName || '', p_role: role, p_allowed_scopes: allowedScopes || [], p_active: active !== false
  });
  if (!r.ok) throw new Error(r.error && r.error.message ? r.error.message : 'failed to save user');
  return r.data;
}
