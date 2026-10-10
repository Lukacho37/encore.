// Jumeau de démo du module « account » (server/account.js, P0-F, PLAN.md 4.1.8) : mêmes routes, mêmes formes.
//   GET    /account/export            toutes les données du joueur de la démo (3 exports par jour, compteur dans db.exports) ;
//   DELETE /account                   { password, confirm: <pseudo> } : le joueur et tout ce qui lui appartient disparaissent ;
//   POST   /account/password          { current, next } (la démo n'a qu'une session : aucune autre à fermer) ;
//   POST   /account/sessions/revoke   rien à fermer non plus ({ revoked: 0 }).
export const name = 'account';

export const EXPORTS_PER_DAY = 3;
const DAY = 86_400_000;
const PASSWORD_MIN = 8;

// Même empreinte que mockServer.js (démo seulement : rien n'y est secret).
const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `h${h >>> 0}`;
};

/** Début du jour à Paris (pour le quota d'exports), comme shared/periods.js. */
function parisDay(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

function exportData(ctx, u) {
  const { db } = ctx;
  const since90 = Date.now() - 90 * DAY;
  const nameOf = (id) => db.users.find((x) => x.id === id)?.username ?? null;
  const list = (key) => (Array.isArray(db[key]) ? db[key] : []);
  return {
    format: 'albummania-export',
    version: 1,
    demo: true,
    exportedAt: new Date().toISOString(),
    profile: {
      id: u.id, username: u.username, email: u.email, emailVerifiedAt: u.verified || null, createdAt: u.createdAt, lang: u.lang,
      avatar: u.avatar, avatarColor: u.avatarColor, bio: u.bio ?? null, xp: u.xp, royalties: u.royalties, packs: u.packs,
      bonusPacks: u.bonusPacks, showcase: u.showcase, termsAcceptedAt: u.termsAcceptedAt ?? null, termsVersion: u.termsVersion ?? null,
      onboardedAt: u.onboardedAt ?? null, suspendedUntil: u.suspendedUntil ?? null, suspensionReason: u.suspensionReason ?? null,
    },
    settings: { lang: u.lang, ratingScale: u.ratingScale || 'stars', prefs: u.prefs || {} },
    cards: Object.entries(db.cards[u.id] || {}).map(([k, v]) => {
      const [trackId, variant] = k.split('|');
      return { trackId, variant, count: v.count, firstAt: v.at };
    }),
    achievements: Object.entries(db.achievements[u.id] || {}).map(([key, at]) => ({ key, createdAt: at })),
    ratings: db.ratings.filter((r) => r.userId === u.id).map((r) => ({
      id: r.rid ?? null, itemType: r.type, itemId: r.id, score: r.score, review: r.review || null, reviewAt: r.reviewAt ?? null,
      createdAt: r.createdAt, updatedAt: r.updatedAt, hiddenAt: r.hiddenAt ?? null,
    })),
    friendships: db.friendships.filter((f) => f.requester === u.id || f.addressee === u.id).map((f) => ({
      status: f.status, createdAt: f.createdAt, respondedAt: f.respondedAt ?? null, direction: f.requester === u.id ? 'sent' : 'received',
      username: nameOf(f.requester === u.id ? f.addressee : f.requester),
    })),
    blocks: list('blocks').filter((b) => b.blocker === u.id).map((b) => ({ username: nameOf(b.blocked), createdAt: b.createdAt })),
    lists: list('lists').filter((l) => l.userId === u.id),
    posts: list('posts').filter((p) => p.userId === u.id),
    comments: list('comments').filter((c) => c.userId === u.id),
    likes: list('likes').filter((l) => l.userId === u.id),
    battleVotes: list('battleVotes').filter((v) => v.userId === u.id),
    quests: list('userQuests').filter((q) => q.userId === u.id),
    notifications: list('notifications').filter((n) => n.userId === u.id && n.createdAt >= since90).map((n) => ({
      kind: n.kind, targetType: n.targetType, targetId: n.targetId, data: n.data, createdAt: n.createdAt, readAt: n.readAt,
    })),
    reportsMade: list('reports').filter((r) => r.reporterId === u.id).map((r) => ({
      targetType: r.targetType, targetId: r.targetId, reason: r.reason, details: r.details, status: r.status, decision: r.decision || null,
      createdAt: r.createdAt, handledAt: r.handledAt || null,
    })),
    moderationDecisions: list('modActions').filter((a) => a.authorId === u.id && a.action !== 'dismiss').map((a) => ({
      id: a.id, action: a.action, ground: a.ground, statement: a.statement, targetType: a.targetType, targetId: a.targetId, createdAt: a.createdAt,
      appealedAt: a.appealedAt ?? null, appealText: a.appealText ?? null, appealDecision: a.appealDecision ?? null, appealDecidedAt: a.appealDecidedAt ?? null,
    })),
  };
}

/** Suppression : le joueur, ses cartes, notes, amitiés, blocages, notifications, signalements faits (auteur effacé). */
function deleteAccount(ctx, u) {
  const { db } = ctx;
  const id = u.id;
  db.users = db.users.filter((x) => x.id !== id);
  delete db.cards[id];
  delete db.achievements[id];
  db.ratings = db.ratings.filter((r) => r.userId !== id);
  db.friendships = db.friendships.filter((f) => f.requester !== id && f.addressee !== id);
  if (Array.isArray(db.blocks)) db.blocks = db.blocks.filter((b) => b.blocker !== id && b.blocked !== id);
  if (Array.isArray(db.notifications)) db.notifications = db.notifications.filter((n) => n.userId !== id && n.actorId !== id);
  for (const key of ['posts', 'comments', 'likes', 'lists', 'battleVotes', 'userQuests']) {
    if (Array.isArray(db[key])) db[key] = db[key].filter((x) => x.userId !== id);
  }
  // Comme le serveur (ON DELETE SET NULL) : les signalements et les décisions restent, sans le joueur.
  for (const r of Array.isArray(db.reports) ? db.reports : []) {
    if (r.reporterId === id) r.reporterId = null;
    if (r.targetUserId === id) r.targetUserId = null;
  }
  for (const a of Array.isArray(db.modActions) ? db.modActions : []) if (a.authorId === id) a.authorId = null;
  if (Array.isArray(db.audit)) db.audit.push({ id: db.nextAuditId++, adminId: null, action: 'account_deleted', target: `user:${id}`, payload: null, createdAt: Date.now() });
  if (db.exports) delete db.exports[id];
  db.session = null;
}

export const routes = [
  ['GET', /^\/account\/export$/, ({ ctx }) => {
    const u = ctx.me();
    const { db } = ctx;
    if (!db.exports || typeof db.exports !== 'object') db.exports = {};
    const day = parisDay();
    const saved = db.exports[u.id];
    const n = saved?.day === day ? saved.n : 0;
    if (n >= EXPORTS_PER_DAY) ctx.fail(429, 'quota_exceeded', { kind: 'exports', max: EXPORTS_PER_DAY });
    db.exports[u.id] = { day, n: n + 1 };
    return exportData(ctx, u);
  }],
  ['DELETE', /^\/account$/, ({ body, ctx }) => {
    const u = ctx.me();
    if (typeof body.password !== 'string' || !body.password) ctx.fail(400, 'password_missing');
    if (u.password !== hash(body.password)) ctx.fail(403, 'wrong_password');
    if (typeof body.confirm !== 'string' || body.confirm.trim().toLowerCase() !== u.username.toLowerCase()) ctx.fail(400, 'confirm_mismatch');
    deleteAccount(ctx, u);
    return { ok: true };
  }],
  ['POST', /^\/account\/password$/, ({ body, ctx }) => {
    const u = ctx.me();
    if (typeof body.current !== 'string' || u.password !== hash(body.current)) ctx.fail(403, 'wrong_password');
    if (typeof body.next !== 'string' || body.next.length < PASSWORD_MIN) ctx.fail(400, 'password_short');
    if (body.next.length > 200) ctx.fail(400, 'password_long');
    u.password = hash(body.next);
    return { ok: true, revoked: 0 };
  }],
  ['POST', /^\/account\/sessions\/revoke$/, ({ ctx }) => {
    ctx.me();
    return { ok: true, revoked: 0 };
  }],
];

export function seed() {}

export function migrate(db) {
  if (db.exports && typeof db.exports !== 'object') delete db.exports;
}
