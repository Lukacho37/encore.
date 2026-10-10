// Jumeau de démo du module « moderation » (server/moderation.js, P0-F, PLAN.md 4.1.6) : mêmes routes, mêmes formes.
// Données de la démo :
//   db.blocks       [{ blocker, blocked, createdAt }] (lu aussi par les jumeaux des notes, des notifications…) ;
//   db.reports      [{ id, reporterId, reporterEmail, reporterName, targetType, targetId, targetUserId, reason, details,
//                      goodFaith, snapshot, status, createdAt, handledAt, handledBy, decision }] ;
//   db.modActions   [{ id, adminId, reportId, targetType, targetId, authorId, action, ground, statement, snapshot, createdAt,
//                      appealedAt, appealText, appealDecision, appealDecidedAt }] ;
//   db.audit        [{ id, adminId, action, target, payload, createdAt }] ;
//   db.coverBlocked [albumId] ; users[].suspendedUntil / suspensionReason.
// Contenu d'exemple (pour que l'onglet Modération de l'admin de la démo ne soit pas vide) : un joueur fictif publie une
// critique publicitaire, deux autres la signalent ; une personne signale une adresse par le formulaire public ; une
// décision déjà prise est contestée par son auteur.
import { notify } from './notifications.js';

export const name = 'moderation';

const REPORT_REASONS = ['illegal_hate', 'harassment', 'threat', 'copyright', 'personal_data', 'spam', 'sexual', 'other'];
const REPORT_TARGETS = ['review', 'post', 'comment', 'list', 'user'];
const DECISIONS = ['hide', 'delete', 'warn', 'suspend', 'dismiss'];
const SUSPEND_DAYS = [1, 7, 30, 365];
const AFFECTS_AUTHOR = new Set(['hide', 'delete', 'warn', 'suspend']);
const GROUND_RE = /^(rules|law):[a-z0-9][a-z0-9_.-]{0,39}$/;
const DAY = 86_400_000;
const PAGE = 20;
const NNBSP = ' ';

const encodeCursor = (values) => btoa(JSON.stringify(values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decodeCursor(raw, ctx) {
  if (!raw) return null;
  try {
    const values = JSON.parse(atob(String(raw).replace(/-/g, '+').replace(/_/g, '/')));
    if (Array.isArray(values) && values.length) return values;
  } catch {
    // curseur illisible
  }
  return ctx.fail(400, 'invalid_input', { field: 'cursor' });
}
const limitOf = (query, def = PAGE, max = 50) => Math.max(1, Math.min(max, Number.parseInt(query.get('limit'), 10) || def));
const str = (v, max) => (typeof v === 'string' ? v.trim().normalize('NFC').slice(0, max) : '');

// ---------- données ----------

function ensure(db) {
  for (const k of ['blocks', 'reports', 'modActions', 'audit', 'coverBlocked']) if (!Array.isArray(db[k])) db[k] = [];
  db.nextReportId = Math.max(Number.isInteger(db.nextReportId) ? db.nextReportId : 1, 1 + Math.max(0, ...db.reports.map((r) => r.id || 0)));
  db.nextActionId = Math.max(Number.isInteger(db.nextActionId) ? db.nextActionId : 1, 1 + Math.max(0, ...db.modActions.map((a) => a.id || 0)));
  db.nextAuditId = Math.max(Number.isInteger(db.nextAuditId) ? db.nextAuditId : 1, 1 + Math.max(0, ...db.audit.map((a) => a.id || 0)));
}

/** Identifiants stables des critiques (même règle que mock/ratings.js, qui les complète aussi). */
function ensureRids(db) {
  if (!Number.isInteger(db.nextRatingId)) db.nextRatingId = 1 + Math.max(0, ...db.ratings.map((r) => (Number.isInteger(r.rid) ? r.rid : 0)));
  for (const r of db.ratings) if (!Number.isInteger(r.rid)) r.rid = db.nextRatingId++;
}

const userOf = (db, id) => db.users.find((u) => u.id === id);
const isAdmin = (u) => u?.role === 'admin';
const suspendedUntil = (u) => (u?.suspendedUntil && u.suspendedUntil > Date.now() ? u.suspendedUntil : null);

function hiddenIds(db, uid) {
  const out = new Set();
  for (const b of db.blocks) {
    if (b.blocker === uid) out.add(b.blocked);
    if (b.blocked === uid) out.add(b.blocker);
  }
  return out;
}

function requireAdmin(ctx) {
  const u = ctx.me();
  if (!isAdmin(u)) ctx.fail(403, 'forbidden');
  return u;
}

function audit(db, adminId, action, target, payload = null) {
  db.audit.push({ id: db.nextAuditId++, adminId: adminId ?? null, action, target, payload, createdAt: Date.now() });
}

/** Copie d'un contenu (comme snapshot() du serveur), ou null. Les posts, commentaires et listes arrivent en P1. */
function snapshot(db, type, rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (type === 'review') {
    const r = db.ratings.find((x) => x.rid === id && x.review);
    return r ? { type, id, authorId: r.userId, text: r.review, score: r.score, itemType: r.type, itemId: r.id, at: r.reviewAt || r.updatedAt, hidden: !!r.hiddenAt } : null;
  }
  if (type === 'user') {
    const u = userOf(db, id);
    return u && u.verified ? { type, id, authorId: u.id, username: u.username, text: u.bio || null, avatar: u.avatar, at: u.createdAt, hidden: false } : null;
  }
  for (const [t, key] of [['post', 'posts'], ['comment', 'comments'], ['list', 'lists']]) {
    if (type !== t || !Array.isArray(db[key])) continue;
    const r = db[key].find((x) => x.id === id && !x.deletedAt);
    return r ? { type, id, authorId: r.userId, text: r.body ?? r.description ?? null, title: r.title, at: r.createdAt, hidden: !!r.hiddenAt } : null;
  }
  return null;
}
const frozen = (snap) => {
  if (!snap) return null;
  const { hidden: _hidden, ...rest } = snap;
  return rest;
};

function setHidden(db, type, id, hidden) {
  if (type === 'review') {
    const r = db.ratings.find((x) => x.rid === Number(id) && x.review);
    if (r) r.hiddenAt = hidden ? Date.now() : null;
    return !!r;
  }
  for (const [t, key] of [['post', 'posts'], ['comment', 'comments'], ['list', 'lists']]) {
    if (type !== t || !Array.isArray(db[key])) continue;
    const r = db[key].find((x) => x.id === Number(id));
    if (r) r.hiddenAt = hidden ? Date.now() : null;
    return !!r;
  }
  return false;
}

function deleteContent(db, type, id) {
  if (type === 'review') {
    const r = db.ratings.find((x) => x.rid === Number(id) && x.review);
    if (!r) return false;
    // La note reste ; le texte disparaît.
    r.review = null;
    r.reviewAt = null;
    r.hiddenAt = null;
    return true;
  }
  for (const [t, key] of [['post', 'posts'], ['comment', 'comments'], ['list', 'lists']]) {
    if (type !== t || !Array.isArray(db[key])) continue;
    const before = db[key].length;
    db[key] = db[key].filter((x) => x.id !== Number(id));
    return db[key].length < before;
  }
  return false;
}

const actionView = (a) => ({
  id: a.id, action: a.action, ground: a.ground, statement: a.statement, targetType: a.targetType, targetId: a.targetId,
  reportId: a.reportId ?? null, createdAt: a.createdAt,
  appeal: a.appealedAt ? { at: a.appealedAt, text: a.appealText, decision: a.appealDecision || null, decidedAt: a.appealDecidedAt || null } : null,
});

const reportView = (r) => ({
  id: r.id, targetType: r.targetType, targetId: r.targetId, reason: r.reason, details: r.details || null, goodFaith: !!r.goodFaith,
  status: r.status, createdAt: r.createdAt, handledAt: r.handledAt || null, decision: r.decision || null,
  public: r.reporterId == null && !!r.reporterEmail,
  reporterName: r.reporterId == null ? r.reporterName : null,
  reporterEmail: r.reporterId == null ? r.reporterEmail : null,
});

// ---------- blocages ----------

function block(ctx, rawOther) {
  const { db } = ctx;
  const u = ctx.me();
  const other = Number(rawOther);
  if (other === u.id) ctx.fail(400, 'cannot_block_self');
  const target = userOf(db, other);
  if (!target || !target.verified) ctx.fail(404, 'user_not_found');
  if (!db.blocks.some((b) => b.blocker === u.id && b.blocked === other)) db.blocks.push({ blocker: u.id, blocked: other, createdAt: Date.now() });
  // Plus d'amitié ni de demande en cours, plus de notifications de l'un chez l'autre.
  db.friendships = db.friendships.filter((f) => !((f.requester === u.id && f.addressee === other) || (f.requester === other && f.addressee === u.id)));
  if (Array.isArray(db.notifications)) {
    db.notifications = db.notifications.filter((n) => !((n.userId === u.id && n.actorId === other) || (n.userId === other && n.actorId === u.id)));
  }
  return { blocked: true };
}

function listBlocks(ctx) {
  const { db } = ctx;
  const u = ctx.me();
  const rows = db.blocks.filter((b) => b.blocker === u.id).sort((a, b) => b.createdAt - a.createdAt);
  const users = ctx.summaries(rows.map((r) => r.blocked));
  return { items: rows.filter((r) => users.has(r.blocked)).map((r) => ({ user: users.get(r.blocked), blockedAt: r.createdAt })), catalog: ctx.refs() };
}

// ---------- signalements ----------

function report(ctx, body) {
  const { db } = ctx;
  const u = ctx.me();
  if (!REPORT_TARGETS.includes(body.targetType)) ctx.fail(400, 'invalid_input', { field: 'targetType' });
  if (!REPORT_REASONS.includes(body.reason)) ctx.fail(400, 'invalid_input', { field: 'reason' });
  const details = str(body.details, 2000) || null;
  const snap = snapshot(db, body.targetType, body.targetId);
  if (!snap || snap.hidden || (snap.authorId !== u.id && hiddenIds(db, u.id).has(snap.authorId))) ctx.fail(404, 'not_found');
  if (snap.authorId === u.id) ctx.fail(400, 'cannot_report_self');
  const targetId = String(snap.id);
  if (db.reports.some((r) => r.reporterId === u.id && r.targetType === body.targetType && r.targetId === targetId)) ctx.fail(409, 'already_reported');
  const id = db.nextReportId++;
  db.reports.push({
    id, reporterId: u.id, targetType: body.targetType, targetId, targetUserId: snap.authorId, reason: body.reason, details,
    goodFaith: false, snapshot: frozen(snap), status: 'open', createdAt: Date.now(),
  });
  return { id };
}

/** Adresse d'une page de la démo → contenu signalé quand c'est possible (critique, profil), sinon l'adresse elle-même. */
function resolveUrl(db, raw) {
  let url;
  try {
    url = new URL(raw, window.location.href);
  } catch {
    return null;
  }
  // Démo : l'application tient dans une page (ancre #/…) ; une adresse « /album/x#review-3 » collée est acceptée aussi.
  const route = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), 'https://demo.invalid') : url;
  let path;
  try {
    path = decodeURIComponent(route.pathname).replace(/\/+$/, '') || '/';
  } catch {
    return null;
  }
  const review = /#review-(\d+)$/.exec(route.hash || url.hash);
  let m;
  if ((m = /^\/review\/(\d+)$/.exec(path))) return { path, targetType: 'review', targetId: Number(m[1]) };
  if (review && /^\/(album|track)\//.test(path)) return { path: `${path}#review-${review[1]}`, targetType: 'review', targetId: Number(review[1]) };
  if ((m = /^\/u\/([^/]+)/.exec(path))) {
    const u = db.users.find((x) => x.username.toLowerCase() === m[1].toLowerCase());
    if (u) return { path, targetType: 'user', targetId: u.id };
  }
  return { path: `${path}${route.search}`.slice(0, 500), targetType: 'url', targetId: null };
}

function publicReport(ctx, body) {
  const { db } = ctx;
  const incomplete = (field) => ctx.fail(400, 'notice_incomplete', { field });
  const name = str(body.name, 200);
  const email = str(body.email, 300).toLowerCase();
  const rawUrl = str(body.url, 600);
  const details = str(body.details, 2100);
  if ([...name].length < 2 || [...name].length > 100) incomplete('name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) incomplete('email');
  if (!rawUrl || rawUrl.length > 500) incomplete('url');
  if (!REPORT_REASONS.includes(body.reason)) incomplete('reason');
  if ([...details].length < 10 || [...details].length > 2000) incomplete('details');
  if (body.goodFaith !== true) incomplete('goodFaith');
  const target = resolveUrl(db, rawUrl);
  if (!target) incomplete('url');
  const snap = target.targetId ? snapshot(db, target.targetType, target.targetId) : null;
  // Adresse d'un contenu qui n'existe pas (ou plus) : signalement de l'adresse elle-même, examiné à la main.
  const isUrl = target.targetType === 'url' || !snap;
  const id = db.nextReportId++;
  db.reports.push({
    id, reporterId: null, reporterEmail: email, reporterName: name,
    targetType: isUrl ? 'url' : target.targetType, targetId: isUrl ? target.path : String(target.targetId),
    targetUserId: isUrl ? null : snap.authorId, reason: body.reason, details, goodFaith: true,
    snapshot: isUrl ? { type: 'url', url: target.path } : frozen(snap), status: 'open', createdAt: Date.now(),
  });
  return { id };
}

// ---------- décisions ----------

function checkDecision(ctx, body) {
  const action = DECISIONS.includes(body.action) ? body.action : ctx.fail(400, 'invalid_action');
  const ground = action === 'dismiss' && !body.ground ? 'rules:none' : String(body.ground || '');
  if (!GROUND_RE.test(ground)) ctx.fail(400, 'invalid_ground');
  const statement = str(body.statement, 2000);
  if (action !== 'dismiss' && !statement) ctx.fail(400, 'statement_required');
  let suspendDays = null;
  if (action === 'suspend') {
    suspendDays = Number(body.suspendDays);
    if (!SUSPEND_DAYS.includes(suspendDays)) ctx.fail(400, 'invalid_duration');
  }
  return { action, ground, statement, suspendDays };
}

function notifyReporters(ctx, targetType, targetId, a) {
  const outcome = a.action === 'dismiss' ? 'dismissed' : 'actioned';
  for (const r of ctx.db.reports) {
    if (r.targetType !== targetType || r.targetId !== targetId || r.handledAt !== a.createdAt || !r.reporterId) continue;
    notify(ctx.db, r.reporterId, 'report_resolved', {
      targetType, targetId,
      data: { reportId: r.id, outcome, reason: r.reason, reportedAt: r.createdAt, ...(a.snapshot?.itemType ? { itemType: a.snapshot.itemType, itemId: a.snapshot.itemId } : {}) },
    });
  }
}

function notifyAuthor(ctx, a) {
  if (!a.authorId || !AFFECTS_AUTHOR.has(a.action)) return;
  const snap = a.snapshot || {};
  const until = a.action === 'suspend' ? userOf(ctx.db, a.authorId)?.suspendedUntil : null;
  notify(ctx.db, a.authorId, 'moderation_action', {
    targetType: a.targetType, targetId: a.targetId,
    data: {
      actionId: a.id, action: a.action, ground: a.ground, statement: a.statement, appealable: true,
      ...(snap.itemType && snap.itemId ? { itemType: snap.itemType, itemId: snap.itemId } : {}),
      ...(typeof snap.text === 'string' ? { excerpt: snap.text.slice(0, 140) } : {}),
      ...(until ? { until } : {}),
    },
  });
}

/** Applique une décision (comme decide() du serveur) ; renvoie la ligne de la décision. */
function decide(ctx, admin, { report: rep = null, targetType, targetId, action, ground, statement, suspendDays }) {
  const { db } = ctx;
  const now = Date.now();
  const snap = targetType === 'url' ? null : snapshot(db, targetType, targetId);
  const authorId = snap?.authorId ?? rep?.targetUserId ?? null;
  if (targetType === 'url' && action !== 'dismiss') ctx.fail(400, 'invalid_action');
  if (targetType === 'user' && (action === 'hide' || action === 'delete')) ctx.fail(400, 'invalid_action');
  if ((action === 'hide' || action === 'delete') && !snap) ctx.fail(409, 'target_gone');
  if ((action === 'warn' || action === 'suspend') && !authorId) ctx.fail(409, 'target_gone');
  if (action === 'suspend' && isAdmin(userOf(db, authorId))) ctx.fail(400, 'cannot_moderate_admin');
  const content = targetType !== 'user' && targetType !== 'url';
  if (action === 'hide' || (action === 'suspend' && content && snap)) setHidden(db, targetType, targetId, true);
  if (action === 'delete') deleteContent(db, targetType, targetId);
  if (action === 'suspend') {
    const u = userOf(db, authorId);
    u.suspendedUntil = now + suspendDays * DAY;
    u.suspensionReason = statement.slice(0, 500);
  }
  const a = {
    id: db.nextActionId++, adminId: admin?.id ?? null, reportId: rep?.id ?? null, targetType, targetId: String(targetId), authorId,
    action, ground, statement, snapshot: rep?.snapshot ?? frozen(snap), createdAt: now,
  };
  db.modActions.push(a);
  // Tous les signalements ouverts du même contenu sont clos par la même décision.
  for (const r of db.reports) {
    if (r.targetType === targetType && r.targetId === String(targetId) && r.status === 'open') {
      Object.assign(r, { status: action === 'dismiss' ? 'dismissed' : 'actioned', handledBy: admin?.id ?? null, handledAt: now, decision: action });
    }
  }
  audit(db, admin?.id, `moderation.${action}`, `${targetType}:${String(targetId).slice(0, 120)}`, { actionId: a.id, reportId: rep?.id ?? null, ground, ...(suspendDays ? { days: suspendDays } : {}) });
  notifyAuthor(ctx, a);
  notifyReporters(ctx, targetType, String(targetId), a);
  return a;
}

function priorActions(db, authorId) {
  if (!authorId) return { count: 0, suggestSuspend: false, suspendedUntil: null, items: [] };
  const rows = db.modActions.filter((a) => a.authorId === authorId && AFFECTS_AUTHOR.has(a.action) && a.createdAt >= Date.now() - 90 * DAY && a.appealDecision !== 'reversed')
    .sort((a, b) => b.createdAt - a.createdAt);
  const suspended = suspendedUntil(userOf(db, authorId));
  return {
    count: rows.length, suggestSuspend: !suspended && rows.length + 1 >= 3, suspendedUntil: suspended,
    items: rows.slice(0, 5).map((r) => ({ id: r.id, action: r.action, ground: r.ground, createdAt: r.createdAt })),
  };
}

function counts(db) {
  const out = { open: 0, actioned: 0, dismissed: 0, appeals: 0 };
  for (const r of db.reports) out[r.status] = (out[r.status] || 0) + 1;
  out.appeals = db.modActions.filter((a) => a.appealedAt && !a.appealDecision).length;
  return out;
}

function refsOf(ctx, snaps, users) {
  const albumIds = [];
  const trackIds = [];
  for (const s of snaps) {
    if (s?.itemType === 'album' && ctx.ALBUM.has(s.itemId)) albumIds.push(s.itemId);
    if (s?.itemType === 'track' && ctx.TRACK.has(s.itemId)) trackIds.push(s.itemId);
  }
  for (const u of users) if (typeof u?.avatar === 'string' && u.avatar.startsWith('album:') && ctx.ALBUM.has(u.avatar.slice(6))) albumIds.push(u.avatar.slice(6));
  return ctx.refs({ albumIds, trackIds });
}

function listReports(ctx, query) {
  const { db } = ctx;
  requireAdmin(ctx);
  const status = ['open', 'actioned', 'dismissed'].includes(query.get('status')) ? query.get('status') : 'open';
  const reason = query.get('reason');
  const type = query.get('type');
  const limit = limitOf(query);
  let rows = db.reports.filter((r) => r.status === status && (!reason || r.reason === reason) && (!type || r.targetType === type));
  let page;
  let nextCursor = null;
  if (status === 'open') {
    // Ouverts : les plus anciens d'abord (pagination par décalage, comme le serveur).
    rows.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    const offset = Number(decodeCursor(query.get('cursor'), ctx)?.[0]) || 0;
    page = rows.slice(offset, offset + limit);
    if (offset + limit < rows.length) nextCursor = encodeCursor([offset + limit]);
  } else {
    rows.sort((a, b) => b.handledAt - a.handledAt || b.id - a.id);
    const after = decodeCursor(query.get('cursor'), ctx);
    if (after) rows = rows.filter((r) => r.handledAt < after[0] || (r.handledAt === after[0] && r.id < after[1]));
    page = rows.slice(0, limit);
    const last = page[page.length - 1];
    if (rows.length > limit && last) nextCursor = encodeCursor([last.handledAt, last.id]);
  }
  const users = ctx.summaries(page.flatMap((r) => [r.targetUserId, r.reporterId]).filter(Boolean));
  const snaps = [];
  const items = page.map((r) => {
    const current = r.targetType === 'url' ? null : snapshot(db, r.targetType, r.targetId);
    snaps.push(r.snapshot, current);
    const action = r.status === 'open' ? null : db.modActions.filter((a) => a.targetType === r.targetType && a.targetId === r.targetId && a.createdAt === r.handledAt).pop();
    return {
      report: { ...reportView(r), lowTrust: false, sameTarget: db.reports.filter((x) => x.targetType === r.targetType && x.targetId === r.targetId && x.status === 'open').length },
      snapshot: r.snapshot,
      current,
      author: users.get(r.targetUserId) || null,
      reporter: r.reporterId ? users.get(r.reporterId) || null : r.reporterEmail ? { name: r.reporterName, email: r.reporterEmail } : null,
      priorActions: priorActions(db, r.targetUserId),
      action: action ? actionView(action) : null,
    };
  });
  return { items, nextCursor, counts: counts(db), catalog: refsOf(ctx, snaps, users.values()) };
}

function listAppeals(ctx, query) {
  const { db } = ctx;
  requireAdmin(ctx);
  const pending = query.get('status') !== 'decided';
  let rows = db.modActions.filter((a) => a.appealedAt && (pending ? !a.appealDecision : !!a.appealDecision)).sort((a, b) => b.appealedAt - a.appealedAt || b.id - a.id);
  const after = decodeCursor(query.get('cursor'), ctx);
  if (after) rows = rows.filter((a) => a.appealedAt < after[0] || (a.appealedAt === after[0] && a.id < after[1]));
  const limit = limitOf(query);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const users = ctx.summaries(page.map((a) => a.authorId).filter(Boolean));
  const snaps = [];
  const items = page.map((a) => {
    const current = a.targetType === 'url' || a.targetType === 'album' ? null : snapshot(db, a.targetType, a.targetId);
    snaps.push(a.snapshot, current);
    return { action: actionView(a), author: users.get(a.authorId) || null, snapshot: a.snapshot, current };
  });
  return { items, nextCursor: rows.length > limit && last ? encodeCursor([last.appealedAt, last.id]) : null, counts: counts(db), catalog: refsOf(ctx, snaps, users.values()) };
}

function mine(ctx) {
  const { db } = ctx;
  const u = ctx.me();
  const rows = db.modActions.filter((a) => a.authorId === u.id && ['hide', 'delete', 'warn', 'suspend', 'unsuspend'].includes(a.action))
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id).slice(0, 50);
  const items = rows.map((a) => ({
    ...actionView(a),
    appealable: AFFECTS_AUTHOR.has(a.action) && !a.appealedAt,
    item: a.snapshot ? { type: a.snapshot.type, itemType: a.snapshot.itemType ?? null, itemId: a.snapshot.itemId ?? null, excerpt: typeof a.snapshot.text === 'string' ? a.snapshot.text.slice(0, 160) : null } : null,
  }));
  const until = suspendedUntil(u);
  return { items, suspendedUntil: until, suspensionReason: until ? u.suspensionReason || null : null, catalog: refsOf(ctx, rows.map((a) => a.snapshot), []) };
}

function appeal(ctx, rawId, body) {
  const { db } = ctx;
  const u = ctx.me();
  const a = db.modActions.find((x) => x.id === Number(rawId) && x.authorId === u.id);
  if (!a) ctx.fail(404, 'not_found');
  if (!AFFECTS_AUTHOR.has(a.action)) ctx.fail(400, 'not_appealable');
  if (a.appealedAt) ctx.fail(409, 'already_appealed');
  const text = str(body.text, 2000);
  if (!text) ctx.fail(400, 'appeal_required');
  a.appealedAt = Date.now();
  a.appealText = text;
  return { ok: true, item: actionView(a) };
}

function appealDecision(ctx, rawId, body) {
  const { db } = ctx;
  const admin = requireAdmin(ctx);
  if (!['upheld', 'reversed'].includes(body.decision)) ctx.fail(400, 'invalid_input', { field: 'decision' });
  const note = str(body.note, 2000) || null;
  const a = db.modActions.find((x) => x.id === Number(rawId));
  if (!a) ctx.fail(404, 'not_found');
  if (!a.appealedAt) ctx.fail(409, 'not_appealed');
  if (a.appealDecision) ctx.fail(409, 'already_decided');
  a.appealDecision = body.decision;
  a.appealDecidedAt = Date.now();
  let restored = false;
  if (body.decision === 'reversed') {
    // Annulation : le contenu masqué revient, la suspension est levée ; un contenu supprimé ne peut pas revenir.
    if ((a.action === 'hide' || a.action === 'suspend') && !['user', 'url', 'album'].includes(a.targetType)) restored = setHidden(db, a.targetType, a.targetId, false);
    if (a.action === 'suspend') {
      const u = userOf(db, a.authorId);
      if (u) Object.assign(u, { suspendedUntil: null, suspensionReason: null });
    }
  }
  audit(db, admin.id, `appeal.${body.decision}`, `action:${a.id}`, note ? { note: note.slice(0, 200) } : null);
  if (a.authorId) {
    notify(db, a.authorId, 'appeal_decided', {
      targetType: a.targetType, targetId: a.targetId,
      data: { actionId: a.id, action: a.action, decision: body.decision, note, restored, ...(a.snapshot?.itemType ? { itemType: a.snapshot.itemType, itemId: a.snapshot.itemId } : {}) },
    });
  }
  return { action: actionView(a) };
}

// ---------- suspensions, pochettes, journal, critiques ----------

function suspensions(ctx) {
  const { db } = ctx;
  requireAdmin(ctx);
  const rows = db.users.filter((u) => suspendedUntil(u)).sort((a, b) => a.suspendedUntil - b.suspendedUntil);
  const users = ctx.summaries(rows.map((u) => u.id));
  return { items: rows.map((u) => ({ user: users.get(u.id), until: u.suspendedUntil, reason: u.suspensionReason || null })), catalog: refsOf(ctx, [], users.values()) };
}

function unsuspend(ctx, rawId, body) {
  const { db } = ctx;
  const admin = requireAdmin(ctx);
  const u = userOf(db, Number(rawId));
  if (!u) ctx.fail(404, 'user_not_found');
  Object.assign(u, { suspendedUntil: null, suspensionReason: null });
  const a = {
    id: db.nextActionId++, adminId: admin.id, reportId: null, targetType: 'user', targetId: String(u.id), authorId: u.id, action: 'unsuspend',
    ground: GROUND_RE.test(body.ground || '') ? body.ground : 'rules:none', statement: str(body.statement, 2000), snapshot: null, createdAt: Date.now(),
  };
  db.modActions.push(a);
  audit(db, admin.id, 'moderation.unsuspend', `user:${u.id}`, { actionId: a.id });
  notify(db, u.id, 'moderation_action', { targetType: 'user', targetId: u.id, data: { actionId: a.id, action: 'unsuspend', ground: a.ground, statement: a.statement, appealable: false } });
  return { action: actionView(a) };
}

function recentReviews(ctx) {
  const { db } = ctx;
  requireAdmin(ctx);
  ensureRids(db);
  const rows = db.ratings.filter((r) => r.review).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60);
  const users = ctx.summaries(rows.map((r) => r.userId));
  const items = rows.filter((r) => users.has(r.userId)).map((r) => ({
    user: users.get(r.userId), type: r.type, id: r.id, ratingId: r.rid, score: r.score, review: r.review, updatedAt: r.updatedAt, hidden: !!r.hiddenAt,
  }));
  return { items, catalog: refsOf(ctx, items.map((i) => ({ itemType: i.type, itemId: i.id })), users.values()) };
}

// ---------- routes ----------

export const routes = [
  ['POST', /^\/reports$/, ({ body, ctx }) => report(ctx, body)],
  ['GET', /^\/blocks$/, ({ ctx }) => listBlocks(ctx)],
  ['PUT', /^\/blocks\/(\d+)$/, ({ params, ctx }) => block(ctx, params[0])],
  ['DELETE', /^\/blocks\/(\d+)$/, ({ params, ctx }) => {
    const u = ctx.me();
    ctx.db.blocks = ctx.db.blocks.filter((b) => !(b.blocker === u.id && b.blocked === Number(params[0])));
    return { blocked: false };
  }],
  ['GET', /^\/moderation\/mine$/, ({ ctx }) => mine(ctx)],
  ['POST', /^\/moderation\/(\d+)\/appeal$/, ({ params, body, ctx }) => appeal(ctx, params[0], body)],
  ['POST', /^\/public\/report$/, ({ body, ctx }) => publicReport(ctx, body)],

  ['GET', /^\/admin\/reports$/, ({ query, ctx }) => listReports(ctx, query)],
  ['POST', /^\/admin\/reports\/(\d+)\/decision$/, ({ params, body, ctx }) => {
    const admin = requireAdmin(ctx);
    const rep = ctx.db.reports.find((r) => r.id === Number(params[0]));
    if (!rep) ctx.fail(404, 'not_found');
    if (rep.status !== 'open') ctx.fail(409, 'already_decided');
    const a = decide(ctx, admin, { report: rep, targetType: rep.targetType, targetId: rep.targetId, ...checkDecision(ctx, body) });
    return { report: reportView(rep), action: actionView(a) };
  }],
  ['GET', /^\/admin\/appeals$/, ({ query, ctx }) => listAppeals(ctx, query)],
  ['POST', /^\/admin\/moderation\/act$/, ({ body, ctx }) => {
    const admin = requireAdmin(ctx);
    if (!REPORT_TARGETS.includes(body.targetType)) ctx.fail(400, 'invalid_input', { field: 'targetType' });
    const decision = checkDecision(ctx, body);
    if (decision.action === 'dismiss') ctx.fail(400, 'invalid_action');
    return { action: actionView(decide(ctx, admin, { targetType: body.targetType, targetId: Number(body.targetId), ...decision })) };
  }],
  ['POST', /^\/admin\/moderation\/(\d+)\/appeal-decision$/, ({ params, body, ctx }) => appealDecision(ctx, params[0], body)],
  ['GET', /^\/admin\/suspensions$/, ({ ctx }) => suspensions(ctx)],
  ['POST', /^\/admin\/users\/(\d+)\/suspend$/, ({ params, body, ctx }) => {
    const admin = requireAdmin(ctx);
    const target = userOf(ctx.db, Number(params[0]));
    if (!target || !target.verified) ctx.fail(404, 'user_not_found');
    const d = checkDecision(ctx, { ...body, action: 'suspend', suspendDays: body.days ?? body.suspendDays });
    return { action: actionView(decide(ctx, admin, { targetType: 'user', targetId: target.id, ...d })) };
  }],
  ['POST', /^\/admin\/users\/(\d+)\/unsuspend$/, ({ params, body, ctx }) => unsuspend(ctx, params[0], body)],
  ['GET', /^\/admin\/albums\/blocked-covers$/, ({ ctx }) => {
    requireAdmin(ctx);
    const blocked = [...ctx.db.coverBlocked].reverse();
    const at = (id) => ctx.db.modActions.filter((a) => a.targetType === 'album' && a.targetId === id && a.action === 'cover_block').pop()?.createdAt ?? null;
    return { items: blocked.map((albumId) => ({ albumId, at: at(albumId) })), catalog: ctx.refs({ albumIds: blocked.filter((id) => ctx.ALBUM.has(id)) }) };
  }],
  ['POST', /^\/admin\/albums\/([^/]+)\/cover$/, ({ params, body, ctx }) => {
    const admin = requireAdmin(ctx);
    const albumId = decodeURIComponent(params[0]);
    if (!ctx.ALBUM.has(albumId)) ctx.fail(404, 'unknown_album');
    const blocked = body.blocked === true || body.blocked === 'true';
    const note = str(body.note, 500);
    ctx.db.coverBlocked = ctx.db.coverBlocked.filter((id) => id !== albumId);
    if (blocked) ctx.db.coverBlocked.push(albumId);
    ctx.db.modActions.push({
      id: ctx.db.nextActionId++, adminId: admin.id, targetType: 'album', targetId: albumId, authorId: null, action: blocked ? 'cover_block' : 'cover_unblock',
      ground: GROUND_RE.test(body.ground || '') ? body.ground : 'law:copyright', statement: note, snapshot: null, createdAt: Date.now(),
    });
    audit(ctx.db, admin.id, blocked ? 'cover.block' : 'cover.unblock', `album:${albumId}`, note ? { note: note.slice(0, 200) } : null);
    return { albumId, blocked, catalog: ctx.refs({ albumIds: [albumId] }) };
  }],
  ['GET', /^\/admin\/audit$/, ({ query, ctx }) => {
    requireAdmin(ctx);
    let rows = [...ctx.db.audit].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
    const after = decodeCursor(query.get('cursor'), ctx);
    if (after) rows = rows.filter((r) => r.createdAt < after[0] || (r.createdAt === after[0] && r.id < after[1]));
    const limit = limitOf(query, 50, 100);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const users = ctx.summaries(page.map((r) => r.adminId).filter(Boolean));
    return {
      items: page.map((r) => ({ id: r.id, admin: users.get(r.adminId) || null, action: r.action, target: r.target, payload: r.payload, createdAt: r.createdAt })),
      nextCursor: rows.length > limit && last ? encodeCursor([last.createdAt, last.id]) : null,
    };
  }],
  // Anciennes routes des critiques (comme le serveur) : la liste porte l'identifiant de la critique ; la suppression passe
  // par une décision de modération (exposé des motifs, notification de l'auteur, journal).
  ['GET', /^\/admin\/reviews$/, ({ ctx }) => recentReviews(ctx)],
  ['DELETE', /^\/admin\/reviews\/(\d+)\/(album|track)\/([^/]+)$/, ({ params, ctx }) => {
    const admin = requireAdmin(ctx);
    ensureRids(ctx.db);
    const [userId, type, id] = [Number(params[0]), params[1], decodeURIComponent(params[2])];
    const row = ctx.db.ratings.find((r) => r.userId === userId && r.type === type && r.id === id && r.review);
    if (!row) ctx.fail(404, 'review_not_found');
    decide(ctx, admin, {
      targetType: 'review', targetId: row.rid, action: 'delete', ground: 'rules:respect',
      statement: `Ta critique a été retirée par la modération${NNBSP}: elle ne respecte pas les règles de la communauté AlbumMania.`,
    });
    return recentReviews(ctx);
  }],
];

// ---------- contenu d'exemple ----------

function seedExamples(db) {
  ensure(db);
  if (db.moderationSeeded) return;
  db.moderationSeeded = true;
  ensureRids(db);
  const byName = (n) => db.users.find((u) => u.username === n);
  const spammer = byName('k.dot_fan');
  const lea = byName('lea.beats');
  const max = byName('maxvinyl');
  const soul = byName('soulcollector');
  if (!spammer || !lea || !max || !soul) return;
  const now = Date.now();
  // 1. Une critique publicitaire, signalée par deux joueurs fictifs (file ouverte).
  const item = db.ratings.some((r) => r.userId === spammer.id && r.type === 'album' && r.id === 'thriller') ? 'abbey-road' : 'thriller';
  const spam = {
    userId: spammer.id, type: 'album', id: item, score: 1,
    review: `Album surcoté. Venez plutôt écouter mes beats et gagner des abonnés gratuits${NNBSP}: écris «${NNBSP}BEATS${NNBSP}» en commentaire sur toutes les critiques, je te suis en retour${NNBSP}!!!`,
    createdAt: now - 9 * 3_600_000, updatedAt: now - 9 * 3_600_000, reviewAt: now - 9 * 3_600_000,
    rid: db.nextRatingId++, likeCount: 0, commentCount: 0, hiddenAt: null,
  };
  db.ratings.push(spam);
  const snap = { type: 'review', id: spam.rid, authorId: spammer.id, text: spam.review, score: spam.score, itemType: 'album', itemId: item, at: spam.reviewAt };
  db.reports.push(
    { id: db.nextReportId++, reporterId: lea.id, targetType: 'review', targetId: String(spam.rid), targetUserId: spammer.id, reason: 'spam',
      details: 'Il colle le même message publicitaire partout.', goodFaith: false, snapshot: snap, status: 'open', createdAt: now - 7 * 3_600_000 },
    { id: db.nextReportId++, reporterId: max.id, targetType: 'review', targetId: String(spam.rid), targetUserId: spammer.id, reason: 'spam',
      details: null, goodFaith: false, snapshot: snap, status: 'open', createdAt: now - 5 * 3_600_000 },
  );
  // 2. Le formulaire public : une adresse qui ne correspond à aucun contenu (examen à la main).
  db.reports.push({
    id: db.nextReportId++, reporterId: null, reporterEmail: 'camille.martin@example.org', reporterName: 'Camille Martin', targetType: 'url',
    targetId: '/collection/albums?q=pirate', targetUserId: null, reason: 'copyright',
    details: 'Un lien de téléchargement pirate circulait sur cette page hier soir, je ne le retrouve plus.', goodFaith: true,
    snapshot: { type: 'url', url: '/collection/albums?q=pirate' }, status: 'open', createdAt: now - 26 * 3_600_000,
  });
  // 3. Une décision déjà prise (critique masquée), contestée par son auteur.
  const target = db.ratings.find((r) => r.userId === soul.id && r.review);
  if (target) {
    const at = now - 3 * DAY;
    const a = {
      id: db.nextActionId++, adminId: null, reportId: null, targetType: 'review', targetId: String(target.rid), authorId: soul.id, action: 'hide',
      ground: 'rules:offtopic',
      statement: `Nous avons masqué ta critique${NNBSP}: elle a été jugée hors sujet. Si tu penses que c’est une erreur, tu peux contester cette décision.`,
      snapshot: { type: 'review', id: target.rid, authorId: soul.id, text: target.review, score: target.score, itemType: target.type, itemId: target.id, at: target.updatedAt },
      createdAt: at, appealedAt: now - 2 * DAY,
      appealText: 'Ma critique parle bien de l’album, morceau par morceau. Je ne comprends pas pourquoi elle a été masquée.',
    };
    target.hiddenAt = at;
    db.modActions.push(a);
    db.audit.push({ id: db.nextAuditId++, adminId: null, action: 'moderation.hide', target: `review:${target.rid}`, payload: { actionId: a.id, ground: a.ground }, createdAt: at });
  }
}

export function seed(db) {
  seedExamples(db);
}

export function migrate(db) {
  // Sauvegarde d'avant le module : mêmes tables, et le contenu d'exemple s'il manque.
  seedExamples(db);
}
