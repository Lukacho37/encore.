// Module « account » : droits sur les données (RGPD art. 15, 17, 20) et sécurité du compte (PLAN.md 4.1.8). Chantier : P0-F.
//   GET    /api/account/export            toutes mes données en JSON (pièce jointe), 3 fois par jour, une requête par section ;
//   DELETE /api/account                   { password, confirm: <pseudo> } : suppression définitive, compteurs recalculés ;
//   POST   /api/account/password          { current, next } : nouveau mot de passe, les autres sessions sont fermées ;
//   POST   /api/account/sessions/revoke   déconnecte les autres appareils.
// Un compte suspendu peut exporter, supprimer son compte et changer son mot de passe (rien de tout cela n'est publié).
import { COOKIE } from './auth.js';
import { hashPassword, verifyPassword, parseCookies, sha256 } from './security.js';
import { validatePassword } from '../shared/rules.js';

export const name = 'account';

export const EXPORTS_PER_DAY = 3;
const DAY = 86_400_000;
// Tables des contenus dont les compteurs (mentions « J'aime », commentaires) sont recalculés après une suppression.
const COUNTED = { post: 'posts', review: 'ratings', comment: 'comments', list: 'lists' };

function parse(text, fallback = null) {
  if (typeof text !== 'string') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function init(deps) {
  const { db, services, config, HttpError } = deps;
  const q = (sql) => db.prepare(sql);
  const all = (sql, ...args) => q(sql).all(...args);

  /** Quota d'exports : 3 par jour (heure de Paris), compté dans kv (survit aux redémarrages). */
  function takeExport(userId) {
    const key = `export:${userId}`;
    const day = deps.periods.dayStart();
    const saved = parse(q('SELECT value FROM kv WHERE key = ?').get(key)?.value, null);
    const n = saved?.day === day ? saved.n : 0;
    if (n >= EXPORTS_PER_DAY) throw new HttpError(429, 'quota_exceeded', { kind: 'exports', max: EXPORTS_PER_DAY, resetAt: deps.periods.nextDayStart() });
    q('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify({ day, n: n + 1 }));
  }

  /** Toutes les données du joueur, section par section (une requête chacune). */
  function exportData(userId) {
    const u = services.getUser(userId);
    if (!u) throw new HttpError(404, 'user_not_found');
    const since90 = Date.now() - 90 * DAY;
    return {
      format: 'albummania-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: {
        id: u.id,
        username: u.username,
        email: u.email,
        emailVerifiedAt: u.email_verified_at,
        createdAt: u.created_at,
        lastSeenAt: u.last_seen_at ?? null,
        lang: u.lang,
        avatar: u.avatar,
        avatarColor: u.avatar_color,
        bio: u.bio ?? null,
        xp: u.xp,
        royalties: u.royalties,
        packs: u.packs,
        bonusPacks: u.bonus_packs,
        showcase: parse(u.showcase, []),
        studio: parse(u.studio, {}),
        cosmetics: parse(u.cosmetics, {}),
        profileVisibility: u.profile_visibility ?? 'public',
        termsAcceptedAt: u.terms_accepted_at ?? null,
        termsVersion: u.terms_version ?? null,
        onboardedAt: u.onboarded_at ?? null,
        suspendedUntil: u.suspended_until ?? null,
        suspensionReason: u.suspension_reason ?? null,
      },
      settings: { lang: u.lang, ratingScale: u.rating_scale || 'stars', prefs: parse(u.prefs, {}) },
      cards: all('SELECT track_id AS trackId, variant, count, first_at AS firstAt, pulled_rarity AS pulledRarity FROM cards WHERE user_id = ? ORDER BY first_at', userId),
      achievements: all('SELECT key, created_at AS createdAt, rank, data FROM achievements WHERE user_id = ? ORDER BY created_at', userId)
        .map((a) => ({ ...a, data: parse(a.data, null) })),
      ratings: all(`SELECT id, item_type AS itemType, item_id AS itemId, score, review, review_at AS reviewAt, created_at AS createdAt,
        updated_at AS updatedAt, hidden_at AS hiddenAt FROM ratings WHERE user_id = ? ORDER BY created_at`, userId),
      friendships: all(`SELECT f.status, f.created_at AS createdAt, f.responded_at AS respondedAt,
          CASE WHEN f.requester_id = ? THEN 'sent' ELSE 'received' END AS direction, o.username
        FROM friendships f JOIN users o ON o.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
        WHERE f.requester_id = ? OR f.addressee_id = ? ORDER BY f.created_at`, userId, userId, userId, userId),
      blocks: all('SELECT o.username, b.created_at AS createdAt FROM blocks b JOIN users o ON o.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at', userId),
      lists: all(`SELECT l.id, l.kind, l.title, l.description, l.ranked, l.visibility, l.created_at AS createdAt, l.updated_at AS updatedAt,
          (SELECT json_group_array(json_object('position', i.position, 'itemType', i.item_type, 'itemId', i.item_id, 'note', i.note, 'addedAt', i.added_at))
             FROM (SELECT * FROM list_items WHERE list_id = l.id ORDER BY position) i) AS items
        FROM lists l WHERE l.user_id = ? ORDER BY l.created_at`, userId).map((l) => ({ ...l, ranked: !!l.ranked, items: parse(l.items, []) })),
      posts: all(`SELECT id, body, item_type AS itemType, item_id AS itemId, visibility, created_at AS createdAt, edited_at AS editedAt,
        hidden_at AS hiddenAt FROM posts WHERE user_id = ? ORDER BY created_at`, userId),
      comments: all(`SELECT id, target_type AS targetType, target_id AS targetId, parent_id AS parentId, body, created_at AS createdAt,
        edited_at AS editedAt, deleted_at AS deletedAt, hidden_at AS hiddenAt FROM comments WHERE user_id = ? ORDER BY created_at`, userId),
      likes: all('SELECT target_type AS targetType, target_id AS targetId, created_at AS createdAt FROM likes WHERE user_id = ? ORDER BY created_at', userId),
      battleVotes: all(`SELECT item_type AS itemType, a_id AS a, b_id AS b, winner_id AS winner, context, created_at AS createdAt
        FROM battle_votes WHERE user_id = ? ORDER BY created_at`, userId),
      quests: all(`SELECT period_key AS periodKey, slot, quest_id AS questId, rerolled, claimed_at AS claimedAt, reward, created_at AS createdAt
        FROM user_quests WHERE user_id = ? ORDER BY created_at`, userId).map((x) => ({ ...x, reward: parse(x.reward, x.reward) })),
      boosters: all('SELECT kind, theme, source, created_at AS createdAt, opened_at AS openedAt FROM user_boosters WHERE user_id = ? ORDER BY created_at', userId),
      cosmetics: all('SELECT cosmetic_id AS id, source, created_at AS createdAt FROM user_cosmetics WHERE user_id = ? ORDER BY created_at', userId),
      packOpenings: all('SELECT source, cards, created_at AS createdAt FROM pack_openings WHERE user_id = ? ORDER BY created_at', userId)
        .map((p) => ({ ...p, cards: parse(p.cards, []) })),
      blindtestGames: all(`SELECT genre, score, correct, rewarded, created_at AS createdAt, finished_at AS finishedAt FROM blindtest_games
        WHERE user_id = ? ORDER BY created_at`, userId),
      notifications: all(`SELECT kind, target_type AS targetType, target_id AS targetId, data, created_at AS createdAt, read_at AS readAt
        FROM notifications WHERE user_id = ? AND created_at >= ? ORDER BY created_at`, userId, since90).map((n) => ({ ...n, data: parse(n.data, null) })),
      reportsMade: all(`SELECT target_type AS targetType, target_id AS targetId, reason, details, status, decision, created_at AS createdAt,
        handled_at AS handledAt FROM reports WHERE reporter_id = ? ORDER BY created_at`, userId),
      moderationDecisions: all(`SELECT id, action, ground, statement, target_type AS targetType, target_id AS targetId, created_at AS createdAt,
        appealed_at AS appealedAt, appeal_text AS appealText, appeal_decision AS appealDecision, appeal_decided_at AS appealDecidedAt
        FROM moderation_actions WHERE author_id = ? AND action <> 'dismiss' ORDER BY created_at`, userId),
    };
  }

  /** Compteurs des contenus touchés par une suppression (mentions « J'aime », commentaires, réponses). */
  function recount({ liked = [], commented = [], parents = [] }) {
    for (const t of liked) {
      const table = COUNTED[t.target_type];
      if (table) q(`UPDATE ${table} SET like_count = (SELECT COUNT(*) FROM likes WHERE target_type = ? AND target_id = ?) WHERE id = ?`).run(t.target_type, t.target_id, t.target_id);
    }
    for (const t of commented) {
      const table = COUNTED[t.target_type];
      if (table) {
        q(`UPDATE ${table} SET comment_count = (SELECT COUNT(*) FROM comments WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL) WHERE id = ?`)
          .run(t.target_type, t.target_id, t.target_id);
      }
    }
    for (const id of parents) {
      q('UPDATE comments SET reply_count = (SELECT COUNT(*) FROM comments c WHERE c.parent_id = ? AND c.deleted_at IS NULL) WHERE id = ?').run(id, id);
    }
  }

  /**
   * Suppression définitive du compte (section 3.7) : ce qui pointe vers ses contenus est retiré (purgeTarget), la ligne
   * users part avec tout ce qui en dépend (cascades), puis les compteurs des contenus qu'il aimait ou commentait et les
   * statistiques des éléments qu'il notait sont recalculés. Le journal garde « account_deleted » sans donnée personnelle.
   */
  async function deleteAccount(userId, body) {
    const u = services.getUser(userId);
    if (!u) throw new HttpError(404, 'user_not_found');
    if (typeof body.password !== 'string' || !body.password) throw new HttpError(400, 'password_missing');
    if (!(await verifyPassword(body.password, u.password_hash))) throw new HttpError(403, 'wrong_password');
    if (typeof body.confirm !== 'string' || body.confirm.trim().toLowerCase() !== u.username.toLowerCase()) throw new HttpError(400, 'confirm_mismatch');
    let listIds = [];
    deps.tx(() => {
      const liked = all('SELECT DISTINCT target_type, target_id FROM likes WHERE user_id = ?', userId);
      const commented = all('SELECT DISTINCT target_type, target_id FROM comments WHERE user_id = ?', userId);
      const parents = all('SELECT DISTINCT parent_id AS id FROM comments WHERE user_id = ? AND parent_id IS NOT NULL', userId).map((r) => r.id);
      const rated = all('SELECT DISTINCT item_type, item_id FROM ratings WHERE user_id = ?', userId);
      const own = [
        ...all('SELECT id FROM ratings WHERE user_id = ? AND review IS NOT NULL', userId).map((r) => ['review', r.id]),
        ...all('SELECT id FROM posts WHERE user_id = ?', userId).map((r) => ['post', r.id]),
        ...all('SELECT id FROM comments WHERE user_id = ?', userId).map((r) => ['comment', r.id]),
        ...all('SELECT id FROM lists WHERE user_id = ?', userId).map((r) => ['list', r.id]),
      ];
      listIds = own.filter(([type]) => type === 'list').map(([, id]) => id);
      // Les contenus des autres qui pointent vers les siens (mentions, commentaires, notifications, activité).
      for (const [type, id] of own) deps.moderation?.purgeTarget?.(type, id);
      q('DELETE FROM users WHERE id = ?').run(userId);
      recount({ liked, commented, parents });
      for (const r of rated) services.refreshRatingStats(r.item_type, r.item_id);
      services.audit(null, 'account_deleted', `user:${userId}`);
    });
    deps.search?.remove?.('user', String(userId));
    for (const id of listIds) deps.search?.remove?.('list', String(id));
    deps.moderation?.forgetUser?.(userId);
    services.forget?.(userId);
    return { ok: true };
  }

  /** Session de la requête (empreinte du jeton du cookie), gardée quand on ferme les autres. */
  const sessionOf = (req) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    return token ? sha256(token) : null;
  };

  async function changePassword(req, body) {
    const u = services.getUser(req.user.id);
    if (typeof body.current !== 'string' || !(await verifyPassword(body.current, u.password_hash))) throw new HttpError(403, 'wrong_password');
    const error = validatePassword(body.next);
    if (error) throw new HttpError(400, error);
    const hash = await hashPassword(body.next);
    const keep = sessionOf(req);
    q('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, u.id);
    const revoked = q('DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?').run(u.id, keep).changes;
    q("DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'reset'").run(u.id);
    return { ok: true, revoked };
  }

  function revokeSessions(req) {
    const revoked = q('DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?').run(req.user.id, sessionOf(req)).changes;
    return { ok: true, revoked };
  }

  /** Cookie de session effacé (même attributs que auth.js). */
  function clearCookie(res) {
    const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (config.secureCookies) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  return { exportData, deleteAccount, changePassword, revokeSessions, takeExport, clearCookie, recount };
}

export function routes(r, deps) {
  const { limits } = deps;
  const api = () => deps.account;

  r.get('/account/export', limits.heavy, (req, res) => {
    api().takeExport(req.user.id);
    const data = api().exportData(req.user.id);
    const date = new Date().toISOString().slice(0, 10);
    const safe = String(req.user.username).replace(/[^\w.-]/g, '_');
    res.set('Content-Disposition', `attachment; filename="albummania-${safe}-${date}.json"`);
    res.json(data);
  });

  r.delete('/account', limits.write, async (req, res) => {
    const result = await api().deleteAccount(req.user.id, req.body);
    api().clearCookie(res);
    res.json(result);
  });

  r.post('/account/password', limits.write, async (req, res) => res.json(await api().changePassword(req, req.body)));
  r.post('/account/sessions/revoke', limits.write, (req, res) => res.json(api().revokeSessions(req)));
}
