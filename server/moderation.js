// Module « moderation » : signalements, formulaire public, blocages, file de modération, décisions motivées, appels,
// suspensions, retrait de pochette, journal (PLAN.md 4.1.6, 7.1, 7.2). Chantier : P0-F.
//
// Règles d'accès communes à tous les modules (deps.access) :
//   hiddenIds(viewerId)   joueurs bloqués dans un sens ou dans l'autre (Set gardé en cache, oublié à chaque blocage) ;
//   isBlocked(a, b)       blocage entre deux joueurs, dans un sens ou dans l'autre ;
//   canSee(v, o, vis)     visibilité d'un contenu de `o` ('public' | 'friends' | 'private') pour `v`, blocages compris ;
//   assertActive(user)    écriture de contenu publié (critique, post, commentaire, liste, demande d'ami) : 403
//                         `suspended { until }` pour un compte suspendu, 403 `terms_required` sans les CGU en vigueur ;
//   linkPolicy(text, u)   liens d'un texte publié : seuls les sites de la liste blanche restent, les autres sont
//                         retirés ; un compte de moins de 24 h ou sous le niveau 3 ne peut poster aucun lien (400).
// API interne (deps.moderation) : purgeTarget(type, id) (tout ce qui s'accroche à un contenu retiré : mentions
// « J'aime », commentaires et leurs mentions, notifications, activité), snapshot(type, id), forgetUser(id).
//
// Une décision (masquer, supprimer, avertir, suspendre, classer) écrit `moderation_actions` (motif, exposé des motifs,
// copie figée du contenu) et `admin_audit`, clôt tous les signalements ouverts du même contenu, prévient l'auteur
// (notification avec l'exposé des motifs et « Contester », DSA art. 17) et chaque auteur de signalement (DSA art. 16).
// Un contenu masqué reste en base comme preuve ; un contenu supprimé disparaît, sa copie reste dans la décision.
import nodemailer from 'nodemailer';
import { levelFromXp } from '../shared/rules.js';

export const name = 'moderation';

/** Motifs de signalement (DSA art. 16), dans l'ordre du formulaire. */
export const REPORT_REASONS = ['illegal_hate', 'harassment', 'threat', 'copyright', 'personal_data', 'spam', 'sexual', 'other'];
/** Contenus signalables depuis le site (le formulaire public accepte aussi une adresse qui ne correspond à rien). */
export const REPORT_TARGETS = ['review', 'post', 'comment', 'list', 'user'];
/** Décisions possibles sur un signalement. */
export const DECISIONS = ['hide', 'delete', 'warn', 'suspend', 'dismiss'];
/** Durées de suspension proposées (jours). */
export const SUSPEND_DAYS = [1, 7, 30, 365];
/**
 * Sites dont les liens restent dans un texte publié (le reste est retiré). Même liste côté site :
 * client/src/components/safety/links.js (UgcText n'en rend cliquables que ceux-là).
 */
export const LINK_HOSTS = ['deezer.com', 'open.spotify.com', 'music.apple.com', 'youtube.com', 'youtu.be', 'bandcamp.com', 'musicbrainz.org', 'wikipedia.org'];
export const DETAILS_MAX = 2000;
export const STATEMENT_MAX = 2000;

const DAY = 86_400_000;
/** Liens interdits aux comptes de moins de 24 h et sous ce niveau. */
const NEW_ACCOUNT_MS = DAY;
export const LINK_MIN_LEVEL = 3;
/**
 * Comptes sans aucun consentement enregistré aux CGU (comptes d'avant la case d'inscription) : bloqués en écriture
 * (`terms_required`) seulement quand ceci vaut true. Laissé à false tant que les comptes existants n'ont pas de bannière
 * pour accepter les CGU (sinon plus personne ne pourrait écrire de critique) ; un consentement à une ancienne
 * version est, lui, toujours refusé.
 */
export const REQUIRE_RECORDED_CONSENT = false;
/** Récidive : 3 décisions maintenues en 90 jours (celle à prendre comprise) → la file propose une suspension. */
const REPEAT_WINDOW = 90 * DAY;
const REPEAT_THRESHOLD = 3;
/** Auteurs de signalements classés 5 fois en 30 jours : leurs signalements passent en bas de la file. */
const LOW_TRUST_WINDOW = 30 * DAY;
const LOW_TRUST_DISMISSED = 5;
const OPEN_CAP = 500;
const PAGE = 20;
// Motif d'une décision : section des règles de la communauté (`rules:harassment`) ou texte de loi (`law:lcen-6`).
const GROUND_RE = /^(rules|law):[a-z0-9][a-z0-9_.-]{0,39}$/;
/** Décisions qui touchent l'auteur : notifiées, contestables. */
const AFFECTS_AUTHOR = new Set(['hide', 'delete', 'warn', 'suspend']);
const CONTENT_TABLES = { review: 'ratings', post: 'posts', comment: 'comments', list: 'lists' };
// Repère une adresse dans un texte publié (schéma http(s) ou « www. »).
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'«»]+/gi;
const TRAILING = /[.,;:!?)\]}»”’]+$/;

/** Hôte autorisé (le domaine lui-même ou un de ses sous-domaines) ? */
export function allowedUrl(raw) {
  let url;
  try {
    url = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return LINK_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** E-mails du formulaire public : accusé de réception, puis résultat. */
const MAIL = {
  fr: {
    ackSubject: 'Ton signalement a bien été reçu · AlbumMania',
    ack: (n, url) => `Bonjour ${n},\n\nNous avons bien reçu ton signalement concernant :\n${url}\n\nUn modérateur va l'examiner. Tu recevras un e-mail quand une décision sera prise.\n\nL'équipe AlbumMania`,
    doneSubject: 'Ton signalement a été examiné · AlbumMania',
    actioned: (n, url) => `Bonjour ${n},\n\nAprès examen, le contenu que tu as signalé (${url}) a été modéré.\n\nMerci pour ton aide.\nL'équipe AlbumMania`,
    dismissed: (n, url) => `Bonjour ${n},\n\nAprès examen, le contenu que tu as signalé (${url}) n'enfreint pas nos règles : il reste en ligne.\n\nMerci pour ton aide.\nL'équipe AlbumMania`,
  },
  en: {
    ackSubject: 'We received your report · AlbumMania',
    ack: (n, url) => `Hello ${n},\n\nWe received your report about:\n${url}\n\nA moderator will review it. You will get an email once a decision is made.\n\nThe AlbumMania team`,
  },
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Lecture tolérante d'un JSON stocké (valeur abîmée → `fallback`). */
function parse(text, fallback = null) {
  if (typeof text !== 'string') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function init(deps) {
  const { db, config, services, validate, HttpError } = deps;
  const statements = new Map();
  const q = (sql) => {
    let st = statements.get(sql);
    if (!st) {
      st = db.prepare(sql);
      statements.set(sql, st);
    }
    return st;
  };
  const json = (v) => JSON.stringify(v);
  /** Transaction, sauf si l'appelant en a déjà ouvert une (suppression de compte, décisions). */
  const atomic = (fn) => (db.isTransaction ? fn() : deps.tx(fn));

  // ----- blocages et règles d'accès ---------------------------------------------------------------

  // Joueurs masqués pour chacun (blocages dans les deux sens), oubliés à chaque blocage ou déblocage.
  const hiddenCache = deps.lru({ max: 5000, ttlMs: 5 * 60_000 });
  function hiddenIds(viewerId) {
    const id = Number(viewerId);
    if (!Number.isInteger(id) || id <= 0) return new Set();
    return hiddenCache.wrap(id, () => new Set(q(`SELECT blocked_id AS id FROM blocks WHERE blocker_id = ?
      UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?`).all(id, id).map((r) => r.id)));
  }
  const isBlocked = (a, b) => hiddenIds(a).has(Number(b));
  /** Oublie les blocages gardés en cache d'un joueur et de ceux qui le masquent. */
  function forgetUser(userId) {
    const id = Number(userId);
    for (const other of hiddenCache.get(id) || []) hiddenCache.delete(other);
    hiddenCache.delete(id);
  }
  const areFriends = (a, b) => !!q(`SELECT 1 FROM friendships WHERE status = 'accepted'
    AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`).get(a, b, b, a);

  function canSee(viewerId, ownerId, visibility) {
    if (viewerId != null && Number(viewerId) === Number(ownerId)) return true;
    if (isBlocked(viewerId, ownerId)) return false;
    if (visibility === 'public') return true;
    if (visibility === 'friends') return areFriends(Number(viewerId), Number(ownerId));
    return false;
  }

  const rowOf = (user) => (typeof user === 'object' && user ? user : services.getUser(Number(user)));
  const suspendedUntil = (u) => (u?.suspended_until && u.suspended_until > Date.now() ? u.suspended_until : null);

  function assertActive(user) {
    const u = rowOf(user);
    if (!u) throw new HttpError(401, 'unauthenticated');
    const until = suspendedUntil(u);
    if (until) throw new HttpError(403, 'suspended', { until });
    // CGU : un compte qui a accepté une version plus ancienne doit accepter la version en vigueur avant d'écrire.
    // Un compte sans consentement enregistré (créé avant l'acceptation à l'inscription) n'est bloqué que si
    // REQUIRE_RECORDED_CONSENT est vrai : à activer quand la bannière d'acceptation des comptes existants est en place.
    const consented = !!u.terms_accepted_at && !!u.terms_version;
    if (consented ? u.terms_version !== config.termsVersion : REQUIRE_RECORDED_CONSENT) {
      throw new HttpError(403, 'terms_required', { version: config.termsVersion });
    }
  }

  function linkPolicy(text, user) {
    if (typeof text !== 'string' || !text) return text;
    URL_RE.lastIndex = 0;
    if (!URL_RE.test(text)) return text;
    const u = user == null ? null : rowOf(user);
    if (u && !services.isAdmin(u)) {
      const young = Date.now() - (u.created_at || 0) < NEW_ACCOUNT_MS;
      const low = levelFromXp(u.xp || 0).level < LINK_MIN_LEVEL;
      if (young || low) throw new HttpError(400, 'links_not_allowed', { minLevel: LINK_MIN_LEVEL });
    }
    return text
      .replace(URL_RE, (raw) => {
        // La ponctuation qui suit une adresse (« … https://x.fr). ») ne fait pas partie du lien.
        const tail = TRAILING.exec(raw)?.[0] || '';
        const link = tail ? raw.slice(0, -tail.length) : raw;
        return allowedUrl(link) ? raw : tail;
      })
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  const access = { hiddenIds, isBlocked, canSee, assertActive, linkPolicy };

  function block(userId, rawOther) {
    const other = validate.int(rawOther, { min: 1, field: 'userId', code: 'user_not_found' });
    if (other === userId) throw new HttpError(400, 'cannot_block_self');
    const target = q('SELECT id FROM users WHERE id = ? AND email_verified_at IS NOT NULL').get(other);
    if (!target) throw new HttpError(404, 'user_not_found');
    atomic(() => {
      q('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(userId, other, Date.now());
      // Plus d'amitié ni de demande en cours, plus de Taste Match en cache, plus de notifications de l'un chez l'autre.
      q('DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)').run(userId, other, other, userId);
      q('DELETE FROM taste_matches WHERE user_a = ? AND user_b = ?').run(Math.min(userId, other), Math.max(userId, other));
      q('DELETE FROM notifications WHERE (user_id = ? AND actor_id = ?) OR (user_id = ? AND actor_id = ?)').run(userId, other, other, userId);
    });
    forgetUser(userId);
    forgetUser(other);
    services.forget?.(userId);
    services.forget?.(other);
    return { blocked: true };
  }

  function unblock(userId, rawOther) {
    const other = validate.int(rawOther, { min: 1, field: 'userId', code: 'user_not_found' });
    q('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(userId, other);
    forgetUser(userId);
    forgetUser(other);
    return { blocked: false };
  }

  /** Mes blocages (au plus 500), les plus récents d'abord, avec le résumé de chaque joueur (jamais filtré ici). */
  function listBlocks(userId) {
    const rows = q('SELECT blocked_id, created_at FROM blocks WHERE blocker_id = ? ORDER BY created_at DESC LIMIT 500').all(userId);
    const users = services.userSummaries(rows.map((r) => r.blocked_id), userId, { hidden: new Set() });
    const items = rows.filter((r) => users.has(r.blocked_id)).map((r) => ({ user: users.get(r.blocked_id), blockedAt: r.created_at }));
    return { items, catalog: deps.refs({ albumIds: services.summaryAlbums(users.values()) }) };
  }

  // ----- contenus signalés ----------------------------------------------------------------------------

  /**
   * Copie d'un contenu (pour un signalement, une décision, la file) : { type, id, authorId, text, …, at, hidden },
   * ou null s'il n'existe pas (ou plus). Une critique est une note avec un texte (ratings.id).
   */
  function snapshot(type, rawId) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (type === 'review') {
      const r = q('SELECT id, user_id, item_type, item_id, score, review, review_at, updated_at, hidden_at FROM ratings WHERE id = ? AND review IS NOT NULL').get(id);
      return r ? { type, id, authorId: r.user_id, text: r.review, score: r.score, itemType: r.item_type, itemId: r.item_id, at: r.review_at || r.updated_at, hidden: !!r.hidden_at } : null;
    }
    if (type === 'post') {
      const r = q('SELECT id, user_id, body, item_type, item_id, visibility, created_at, hidden_at FROM posts WHERE id = ?').get(id);
      return r ? { type, id, authorId: r.user_id, text: r.body, itemType: r.item_type, itemId: r.item_id, visibility: r.visibility, at: r.created_at, hidden: !!r.hidden_at } : null;
    }
    if (type === 'comment') {
      const r = q('SELECT id, user_id, body, target_type, target_id, created_at, deleted_at, hidden_at FROM comments WHERE id = ?').get(id);
      return r && !r.deleted_at ? { type, id, authorId: r.user_id, text: r.body, parentType: r.target_type, parentId: r.target_id, at: r.created_at, hidden: !!r.hidden_at } : null;
    }
    if (type === 'list') {
      const r = q('SELECT id, user_id, title, description, kind, visibility, item_count, created_at, hidden_at FROM lists WHERE id = ?').get(id);
      return r ? { type, id, authorId: r.user_id, title: r.title, text: r.description, kind: r.kind, visibility: r.visibility, itemCount: r.item_count, at: r.created_at, hidden: !!r.hidden_at } : null;
    }
    if (type === 'user') {
      const r = q('SELECT id, username, bio, avatar, created_at FROM users WHERE id = ? AND email_verified_at IS NOT NULL').get(id);
      return r ? { type, id, authorId: r.id, username: r.username, text: r.bio || null, avatar: r.avatar, at: r.created_at, hidden: false } : null;
    }
    return null;
  }

  /** Copie à stocker (sans l'état « masqué », qui change). */
  const frozen = (snap) => {
    if (!snap) return null;
    const { hidden: _hidden, ...rest } = snap;
    return json(rest);
  };

  /**
   * Retire tout ce qui pointe vers un contenu supprimé : mentions « J'aime », commentaires (et leurs mentions,
   * notifications, activité), notifications et activité du contenu lui-même. Les signalements restent (preuves).
   */
  function purgeTarget(type, rawId) {
    const key = String(rawId);
    const id = Number(rawId);
    atomic(() => {
      if (Number.isInteger(id) && ['post', 'review', 'list'].includes(type)) {
        const commentIds = q('SELECT id FROM comments WHERE target_type = ? AND target_id = ?').all(type, id).map((r) => r.id);
        if (commentIds.length) {
          const list = json(commentIds);
          q("DELETE FROM likes WHERE target_type = 'comment' AND target_id IN (SELECT value FROM json_each(?))").run(list);
          q("DELETE FROM notifications WHERE target_type = 'comment' AND target_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))").run(list);
          q("DELETE FROM activity WHERE object_type = 'comment' AND object_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))").run(list);
          q('DELETE FROM comments WHERE target_type = ? AND target_id = ?').run(type, id);
        }
      }
      if (Number.isInteger(id) && ['post', 'review', 'list', 'comment'].includes(type)) {
        q('DELETE FROM likes WHERE target_type = ? AND target_id = ?').run(type, id);
      }
      q('DELETE FROM notifications WHERE target_type = ? AND target_id = ?').run(type, key);
      q('DELETE FROM activity WHERE object_type = ? AND object_id = ?').run(type, key);
    });
  }

  /** Masque (ou ré-affiche) un contenu ; sans effet pour un joueur ou une adresse. Renvoie le nombre de lignes. */
  function setHidden(type, id, hidden) {
    const table = CONTENT_TABLES[type];
    if (!table) return 0;
    return q(`UPDATE ${table} SET hidden_at = ? WHERE id = ?`).run(hidden ? Date.now() : null, Number(id)).changes;
  }

  /** Supprime un contenu (décision de modération) ; renvoie true s'il existait. */
  function deleteContent(type, rawId) {
    const id = Number(rawId);
    if (type === 'review') {
      const r = q('SELECT item_type, item_id FROM ratings WHERE id = ? AND review IS NOT NULL').get(id);
      if (!r) return false;
      // La note reste (elle n'est pas un contenu publié) ; le texte disparaît.
      q('UPDATE ratings SET review = NULL, review_at = NULL, hidden_at = NULL WHERE id = ?').run(id);
      services.refreshRatingStats(r.item_type, r.item_id);
      return true;
    }
    if (type === 'post') return q('DELETE FROM posts WHERE id = ?').run(id).changes > 0;
    if (type === 'list') return q('DELETE FROM lists WHERE id = ?').run(id).changes > 0;
    if (type === 'comment') {
      const c = q('SELECT id, target_type, target_id, parent_id FROM comments WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!c) return false;
      if (q('SELECT 1 FROM comments WHERE parent_id = ? LIMIT 1').get(id)) {
        // Un commentaire qui a des réponses reste en place, vidé (« Commentaire supprimé » à la lecture).
        q("UPDATE comments SET deleted_at = ?, hidden_at = NULL, body = '—' WHERE id = ?").run(Date.now(), id);
      } else {
        q('DELETE FROM comments WHERE id = ?').run(id);
        if (c.parent_id) q('UPDATE comments SET reply_count = MAX(reply_count - 1, 0) WHERE id = ?').run(c.parent_id);
      }
      const table = CONTENT_TABLES[c.target_type];
      if (table) q(`UPDATE ${table} SET comment_count = MAX(comment_count - 1, 0) WHERE id = ?`).run(c.target_id);
      return true;
    }
    return false;
  }

  // ----- e-mails du formulaire public ----------------------------------------------------------------

  let transport = null;
  async function sendMail(to, subject, text) {
    try {
      // Un envoi générique fourni par le cœur (deps.mailer.send) passe en premier ; sinon même règle que mailer.js :
      // SMTP s'il est configuré, sinon la boîte de test (DEV_MAILBOX=1 en local, ou les tests).
      if (deps.mailer?.send) {
        await deps.mailer.send({ to, subject, text });
        return;
      }
      if (config.smtp) {
        transport ||= nodemailer.createTransport(config.smtp);
        await transport.sendMail({ from: config.mailFrom, to, subject, text });
        return;
      }
      if (config.devMailbox || config.isTest) {
        q('INSERT INTO dev_emails (to_addr, subject, text, html, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(to, subject, text, `<pre style="font-family:Helvetica,Arial,sans-serif;white-space:pre-wrap">${esc(text)}</pre>`, Date.now());
      }
      if (!config.isTest) console.log(`\n✉️  [${config.devMailbox ? 'boîte de test' : 'e-mail non envoyé, aucun SMTP'}] ${subject} → ${to}\n${text}\n`);
    } catch (err) {
      console.error('[moderation] e-mail non envoyé :', err);
    }
  }

  // ----- signalements -------------------------------------------------------------------------------

  /** Signalement d'un joueur connecté (POST /api/reports). */
  function report(user, body, ip = null) {
    const targetType = validate.oneOf(body.targetType, REPORT_TARGETS, { field: 'targetType' });
    const targetId = validate.int(body.targetId, { min: 1, field: 'targetId' });
    const reason = validate.oneOf(body.reason, REPORT_REASONS, { field: 'reason' });
    const details = validate.str(body.details, { max: DETAILS_MAX, optional: true, field: 'details' });
    const snap = snapshot(targetType, targetId);
    // Un contenu masqué, ou d'un joueur bloqué dans un sens ou dans l'autre, n'est pas visible : comme s'il n'existait pas.
    if (!snap || snap.hidden || (snap.authorId !== user.id && isBlocked(user.id, snap.authorId))) throw new HttpError(404, 'not_found');
    if (snap.authorId === user.id) throw new HttpError(400, 'cannot_report_self');
    if (q('SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ?').get(user.id, targetType, String(targetId))) {
      throw new HttpError(409, 'already_reported');
    }
    deps.quota(user.id, 'reports');
    const row = q(`INSERT INTO reports (reporter_id, target_type, target_id, target_user_id, reason, details, good_faith, snapshot, status, created_at, created_ip)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'open', ?, ?) RETURNING id`)
      .get(user.id, targetType, String(targetId), snap.authorId, reason, details, frozen(snap), Date.now(), ip);
    return { id: row.id };
  }

  /** Adresse d'une page d'AlbumMania → contenu signalé quand c'est possible (critique, post, liste, profil). */
  function resolveUrl(raw) {
    let url;
    try {
      url = new URL(raw, config.appUrl);
    } catch {
      return null;
    }
    // Le site en ligne, une adresse locale de test, ou un chemin seul (« /review/12 »).
    const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
    if (url.host !== new URL(config.appUrl).host && !local) return null;
    let path;
    try {
      path = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
    } catch {
      return null;
    }
    const hashReview = /^#review-(\d+)$/.exec(url.hash);
    let m;
    if ((m = /^\/review\/(\d+)$/.exec(path))) return { path, targetType: 'review', targetId: Number(m[1]) };
    if ((m = /^\/post\/(\d+)$/.exec(path))) return { path, targetType: 'post', targetId: Number(m[1]) };
    if ((m = /^\/list\/(\d+)(?:\/edit)?$/.exec(path))) return { path, targetType: 'list', targetId: Number(m[1]) };
    if (hashReview && /^\/(album|track)\//.test(path)) return { path: `${path}${url.hash}`, targetType: 'review', targetId: Number(hashReview[1]) };
    if ((m = /^\/u\/([^/]+)/.exec(path))) {
      const u = q('SELECT id FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(m[1]);
      if (u) return { path, targetType: 'user', targetId: u.id };
    }
    return { path: `${path}${url.search}${url.hash}`.slice(0, 500), targetType: 'url', targetId: null };
  }

  /** Notification publique (DSA art. 16), sans compte : POST /api/public/report. */
  async function publicReport(body, ip = null) {
    const incomplete = (field) => {
      throw new HttpError(400, 'notice_incomplete', { field });
    };
    const lang = body.lang === 'en' ? 'en' : 'fr';
    const name = typeof body.name === 'string' ? body.name.trim().normalize('NFC') : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
    const details = typeof body.details === 'string' ? body.details.trim().normalize('NFC') : '';
    if ([...name].length < 2 || [...name].length > 100) incomplete('name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) incomplete('email');
    if (!rawUrl || rawUrl.length > 500) incomplete('url');
    if (!REPORT_REASONS.includes(body.reason)) incomplete('reason');
    if ([...details].length < 10 || [...details].length > DETAILS_MAX) incomplete('details');
    if (body.goodFaith !== true) incomplete('goodFaith');
    const target = resolveUrl(rawUrl);
    if (!target) incomplete('url');
    let snap = target.targetId ? snapshot(target.targetType, target.targetId) : null;
    let { targetType } = target;
    let targetId = target.targetId ? String(target.targetId) : target.path;
    // Adresse d'un contenu qui n'existe pas (ou plus) : signalement de l'adresse elle-même, examiné à la main.
    if (target.targetId && !snap) {
      targetType = 'url';
      targetId = target.path;
    }
    const stored = targetType === 'url' ? json({ type: 'url', url: target.path }) : frozen(snap);
    const row = q(`INSERT INTO reports (reporter_id, reporter_email, reporter_name, target_type, target_id, target_user_id, reason, details,
        good_faith, snapshot, status, created_at, created_ip)
      VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'open', ?, ?) RETURNING id`)
      .get(email, name, targetType, targetId, targetType === 'url' ? null : snap?.authorId ?? null, body.reason, details, stored, Date.now(), ip);
    const L = MAIL[lang];
    await sendMail(email, L.ackSubject, L.ack(name, `${config.appUrl}${target.path}`));
    return { id: row.id };
  }

  // ----- décisions ------------------------------------------------------------------------------------

  const actionView = (a) => ({
    id: a.id,
    action: a.action,
    ground: a.ground,
    statement: a.statement,
    targetType: a.target_type,
    targetId: a.target_id,
    reportId: a.report_id ?? null,
    createdAt: a.created_at,
    appeal: a.appealed_at ? { at: a.appealed_at, text: a.appeal_text, decision: a.appeal_decision, decidedAt: a.appeal_decided_at } : null,
  });

  const reportView = (r) => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    reason: r.reason,
    details: r.details,
    goodFaith: !!r.good_faith,
    status: r.status,
    createdAt: r.created_at,
    handledAt: r.handled_at,
    decision: r.decision,
    // Formulaire public : nom et adresse de la personne (visibles de l'admin seulement).
    public: r.reporter_id == null && !!r.reporter_email,
    reporterName: r.reporter_id == null ? r.reporter_name : null,
    reporterEmail: r.reporter_id == null ? r.reporter_email : null,
  });

  /** Décision reçue : { action, ground, statement, suspendDays } validés (exposé des motifs obligatoire sauf classement). */
  function checkDecision(body) {
    const action = validate.oneOf(body.action, DECISIONS, { field: 'action', code: 'invalid_action' });
    const ground = action === 'dismiss' && (body.ground == null || body.ground === '')
      ? 'rules:none'
      : validate.str(body.ground, { max: 44, field: 'ground', code: 'invalid_ground' });
    if (!GROUND_RE.test(ground)) throw new HttpError(400, 'invalid_ground');
    const statement = action === 'dismiss'
      ? validate.str(body.statement, { max: STATEMENT_MAX, optional: true, fallback: '', field: 'statement' })
      : validate.str(body.statement, { min: 1, max: STATEMENT_MAX, field: 'statement', code: 'statement_required' });
    const suspendDays = action === 'suspend'
      ? validate.oneOf(Number(body.suspendDays), SUSPEND_DAYS, { field: 'suspendDays', code: 'invalid_duration' })
      : null;
    return { action, ground, statement, suspendDays };
  }

  /** Élément noté (album, morceau) d'une copie de critique, pour les textes « ta critique de Discovery ». */
  function itemOf(snapText) {
    const s = parse(snapText, null);
    return s?.itemType && s?.itemId ? { itemType: s.itemType, itemId: s.itemId } : {};
  }

  /** Les auteurs des signalements clos par une décision apprennent son résultat (notification, ou e-mail). */
  function notifyReporters(targetType, targetId, actionRow) {
    const rows = q(`SELECT id, reporter_id, reporter_email, reporter_name, reason, created_at FROM reports
      WHERE target_type = ? AND target_id = ? AND handled_at = ? AND decision = ?`).all(targetType, targetId, actionRow.created_at, actionRow.action);
    const outcome = actionRow.action === 'dismiss' ? 'dismissed' : 'actioned';
    for (const r of rows) {
      if (r.reporter_id) {
        deps.notify?.(r.reporter_id, 'report_resolved', {
          targetType, targetId,
          data: { reportId: r.id, outcome, reason: r.reason, reportedAt: r.created_at, ...itemOf(actionRow.snapshot) },
        });
      } else if (r.reporter_email) {
        const url = targetType === 'url' ? `${config.appUrl}${targetId}` : `${config.appUrl}/${targetType}/${targetId}`;
        sendMail(r.reporter_email, MAIL.fr.doneSubject, MAIL.fr[outcome](r.reporter_name || '', url));
      }
    }
  }

  /**
   * Applique une décision sur un contenu (avec ou sans signalement). `admin` : ligne users de l'admin ; `report` :
   * ligne reports, ou null pour une décision prise sans signalement. Renvoie la ligne moderation_actions.
   */
  function decide(admin, { report: rep = null, targetType, targetId, action, ground, statement, suspendDays = null }) {
    const now = Date.now();
    const content = targetType in CONTENT_TABLES;
    const snap = targetType === 'url' ? null : snapshot(targetType, targetId);
    const authorId = snap?.authorId ?? rep?.target_user_id ?? null;
    if (targetType === 'url' && action !== 'dismiss') throw new HttpError(400, 'invalid_action');
    if (targetType === 'user' && (action === 'hide' || action === 'delete')) throw new HttpError(400, 'invalid_action');
    if ((action === 'hide' || action === 'delete') && !snap) throw new HttpError(409, 'target_gone');
    if ((action === 'warn' || action === 'suspend') && !authorId) throw new HttpError(409, 'target_gone');
    if (action === 'suspend' && services.isAdmin(services.getUser(authorId))) throw new HttpError(400, 'cannot_moderate_admin');
    let removed = false;
    const row = atomic(() => {
      // Suspendre pour un contenu le masque aussi.
      if (action === 'hide' || (action === 'suspend' && content && snap)) setHidden(targetType, targetId, true);
      if (action === 'delete') removed = deleteContent(targetType, targetId);
      if (action === 'suspend') {
        q('UPDATE users SET suspended_until = ?, suspension_reason = ? WHERE id = ?').run(now + suspendDays * DAY, statement.slice(0, 500), authorId);
      }
      const evidence = rep?.snapshot ?? frozen(snap);
      const a = q(`INSERT INTO moderation_actions (admin_id, report_id, target_type, target_id, author_id, action, ground, statement, snapshot, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
        .get(admin?.id ?? null, rep?.id ?? null, targetType, String(targetId), authorId, action, ground, statement, evidence, now);
      // Tous les signalements ouverts du même contenu sont clos par la même décision.
      q(`UPDATE reports SET status = ?, handled_by = ?, handled_at = ?, decision = ?
        WHERE target_type = ? AND target_id = ? AND status = 'open'`)
        .run(action === 'dismiss' ? 'dismissed' : 'actioned', admin?.id ?? null, now, action, targetType, String(targetId));
      services.audit(admin?.id ?? null, `moderation.${action}`, `${targetType}:${String(targetId).slice(0, 120)}`,
        { actionId: a.id, reportId: rep?.id ?? null, ground, ...(suspendDays ? { days: suspendDays } : {}) });
      return a;
    });
    if (removed) {
      purgeTarget(targetType, targetId);
      deps.bus.emit('content.removed', { targetType, targetId: Number(targetId), by: 'moderator' });
      if (targetType === 'list') deps.search?.remove?.('list', String(targetId));
    }
    if (authorId) services.forget?.(authorId);
    deps.bus.emit('moderation.action', { actionId: row.id, action, targetType, targetId: String(targetId), authorId });
    notifyReporters(targetType, String(targetId), row);
    return row;
  }

  function decideReport(admin, reportId, body) {
    const id = validate.int(reportId, { min: 1, field: 'id', code: 'not_found' });
    const rep = q('SELECT * FROM reports WHERE id = ?').get(id);
    if (!rep) throw new HttpError(404, 'not_found');
    if (rep.status !== 'open') throw new HttpError(409, 'already_decided');
    const decision = checkDecision(body);
    const row = decide(admin, { report: rep, targetType: rep.target_type, targetId: rep.target_id, ...decision });
    return { report: reportView(q('SELECT * FROM reports WHERE id = ?').get(id)), action: actionView(row) };
  }

  /** Décision sans signalement (critiques récentes, profil) : POST /api/admin/moderation/act. */
  function act(admin, body) {
    const targetType = validate.oneOf(body.targetType, REPORT_TARGETS, { field: 'targetType' });
    const targetId = validate.int(body.targetId, { min: 1, field: 'targetId' });
    const decision = checkDecision(body);
    if (decision.action === 'dismiss') throw new HttpError(400, 'invalid_action');
    return { action: actionView(decide(admin, { targetType, targetId, ...decision })) };
  }

  // ----- file d'attente (admin) ---------------------------------------------------------------------

  /** Décisions maintenues contre un auteur sur 90 jours (récidive : la file propose une suspension). */
  function priorActions(authorId) {
    if (!authorId) return { count: 0, suggestSuspend: false, suspendedUntil: null, items: [] };
    const rows = q(`SELECT id, action, ground, created_at, appeal_decision FROM moderation_actions
      WHERE author_id = ? AND action IN ('hide', 'delete', 'warn', 'suspend') AND created_at >= ?
      ORDER BY created_at DESC LIMIT 20`).all(authorId, Date.now() - REPEAT_WINDOW);
    const upheld = rows.filter((r) => r.appeal_decision !== 'reversed');
    const suspended = suspendedUntil(services.getUser(authorId));
    return {
      count: upheld.length,
      suggestSuspend: !suspended && upheld.length + 1 >= REPEAT_THRESHOLD,
      suspendedUntil: suspended,
      items: upheld.slice(0, 5).map((r) => ({ id: r.id, action: r.action, ground: r.ground, createdAt: r.created_at })),
    };
  }

  function counts() {
    const out = { open: 0, actioned: 0, dismissed: 0, appeals: 0 };
    for (const r of q('SELECT status, COUNT(*) AS n FROM reports GROUP BY status').all()) out[r.status] = r.n;
    out.appeals = q('SELECT COUNT(*) AS n FROM moderation_actions WHERE appealed_at IS NOT NULL AND appeal_decision IS NULL').get().n;
    return out;
  }

  /** Albums, morceaux et visuels des copies et des joueurs cités (références du catalogue de la réponse). */
  function refsOf(snaps, users) {
    const albumIds = [];
    const trackIds = [];
    for (const s of snaps) {
      if (s?.itemType === 'album') albumIds.push(s.itemId);
      if (s?.itemType === 'track') trackIds.push(s.itemId);
    }
    return deps.refs({ albumIds: [...albumIds, ...services.summaryAlbums(users)], trackIds });
  }

  function actionOfReport(r) {
    const a = q('SELECT * FROM moderation_actions WHERE target_type = ? AND target_id = ? AND created_at = ? ORDER BY id DESC LIMIT 1')
      .get(r.target_type, r.target_id, r.handled_at);
    return a ? actionView(a) : null;
  }

  /** File des signalements : GET /api/admin/reports?status=open|actioned|dismissed&reason=&type=&cursor=. */
  function listReports(admin, query) {
    const status = validate.oneOf(query.status, ['open', 'actioned', 'dismissed'], { optional: true, fallback: 'open', field: 'status' });
    const reason = validate.oneOf(query.reason, REPORT_REASONS, { optional: true, field: 'reason' });
    const type = validate.oneOf(query.type, [...REPORT_TARGETS, 'url'], { optional: true, field: 'type' });
    const limit = deps.paging.limitOf(query.limit, { def: PAGE, max: 50 });
    const where = ['r.status = ?'];
    const args = [status];
    if (reason) {
      where.push('r.reason = ?');
      args.push(reason);
    }
    if (type) {
      where.push('r.target_type = ?');
      args.push(type);
    }
    let page;
    if (status === 'open') {
      // Ouverts : les plus anciens d'abord, ceux des auteurs souvent classés sans suite en dernier.
      const offset = deps.paging.offsetOf(query.cursor, { cap: OPEN_CAP });
      const rows = q(`SELECT r.*, (r.reporter_id IS NOT NULL AND (SELECT COUNT(*) FROM reports d WHERE d.reporter_id = r.reporter_id
          AND d.status = 'dismissed' AND d.handled_at >= ?) >= ${LOW_TRUST_DISMISSED}) AS low_trust
        FROM reports r WHERE ${where.join(' AND ')} ORDER BY low_trust, r.created_at, r.id LIMIT ? OFFSET ?`)
        .all(Date.now() - LOW_TRUST_WINDOW, ...args, limit + 1, offset);
      page = deps.paging.offsetPage(rows, offset, limit, { cap: OPEN_CAP });
    } else {
      const after = deps.paging.decodeCursor(query.cursor, { length: 2 });
      const rows = q(`SELECT r.*, 0 AS low_trust FROM reports r WHERE ${where.join(' AND ')}
        ${after ? 'AND (r.handled_at, r.id) < (?, ?)' : ''} ORDER BY r.handled_at DESC, r.id DESC LIMIT ?`)
        .all(...args, ...(after ? [after[0], after[1]] : []), limit + 1);
      page = deps.paging.keysetPage(rows, limit, (r) => [r.handled_at, r.id]);
    }
    const userIds = new Set();
    for (const r of page.items) {
      if (r.target_user_id) userIds.add(r.target_user_id);
      if (r.reporter_id) userIds.add(r.reporter_id);
    }
    const users = services.userSummaries(userIds, admin.id, { hidden: new Set() });
    const priors = new Map();
    const snaps = [];
    const items = page.items.map((r) => {
      const snap = parse(r.snapshot, null);
      const current = r.target_type === 'url' ? null : snapshot(r.target_type, r.target_id);
      snaps.push(snap, current);
      if (r.target_user_id && !priors.has(r.target_user_id)) priors.set(r.target_user_id, priorActions(r.target_user_id));
      const sameTarget = q("SELECT COUNT(*) AS n FROM reports WHERE target_type = ? AND target_id = ? AND status = 'open'").get(r.target_type, r.target_id).n;
      return {
        report: { ...reportView(r), lowTrust: !!r.low_trust, sameTarget },
        snapshot: snap,
        current,
        author: users.get(r.target_user_id) || null,
        reporter: r.reporter_id ? users.get(r.reporter_id) || null : r.reporter_email ? { name: r.reporter_name, email: r.reporter_email } : null,
        priorActions: priors.get(r.target_user_id) || priorActions(null),
        action: r.status === 'open' ? null : actionOfReport(r),
      };
    });
    return { items, nextCursor: page.nextCursor, counts: counts(), catalog: refsOf(snaps, users.values()) };
  }

  /** Décisions contestées (en attente d'abord) : GET /api/admin/appeals?status=pending|decided. */
  function listAppeals(admin, query) {
    const status = validate.oneOf(query.status, ['pending', 'decided'], { optional: true, fallback: 'pending', field: 'status' });
    const limit = deps.paging.limitOf(query.limit, { def: PAGE, max: 50 });
    const after = deps.paging.decodeCursor(query.cursor, { length: 2 });
    const rows = q(`SELECT * FROM moderation_actions WHERE appealed_at IS NOT NULL AND appeal_decision IS ${status === 'pending' ? '' : 'NOT '}NULL
      ${after ? 'AND (appealed_at, id) < (?, ?)' : ''} ORDER BY appealed_at DESC, id DESC LIMIT ?`)
      .all(...(after ? [after[0], after[1]] : []), limit + 1);
    const page = deps.paging.keysetPage(rows, limit, (a) => [a.appealed_at, a.id]);
    const users = services.userSummaries(page.items.map((a) => a.author_id).filter(Boolean), admin.id, { hidden: new Set() });
    const snaps = [];
    const items = page.items.map((a) => {
      const snap = parse(a.snapshot, null);
      const current = a.target_type in CONTENT_TABLES || a.target_type === 'user' ? snapshot(a.target_type, a.target_id) : null;
      snaps.push(snap, current);
      return { action: actionView(a), author: users.get(a.author_id) || null, snapshot: snap, current };
    });
    return { items, nextCursor: page.nextCursor, counts: counts(), catalog: refsOf(snaps, users.values()) };
  }

  // ----- appels (DSA art. 17, contestation interne légère) -------------------------------------------

  /** Décisions sur mes contenus (GET /api/moderation/mine), avec ma suspension en cours. */
  function mine(userId) {
    const rows = q(`SELECT * FROM moderation_actions WHERE author_id = ? AND action IN ('hide', 'delete', 'warn', 'suspend', 'unsuspend')
      ORDER BY created_at DESC, id DESC LIMIT 50`).all(userId);
    const snaps = [];
    const items = rows.map((a) => {
      const snap = parse(a.snapshot, null);
      snaps.push(snap);
      return {
        ...actionView(a),
        appealable: AFFECTS_AUTHOR.has(a.action) && !a.appealed_at,
        item: snap ? { type: snap.type, itemType: snap.itemType ?? null, itemId: snap.itemId ?? null, excerpt: typeof snap.text === 'string' ? snap.text.slice(0, 160) : null } : null,
      };
    });
    const u = services.getUser(userId);
    const until = suspendedUntil(u);
    return { items, suspendedUntil: until, suspensionReason: until ? u.suspension_reason || null : null, catalog: refsOf(snaps, []) };
  }

  function appeal(userId, rawId, body) {
    const id = validate.int(rawId, { min: 1, field: 'id', code: 'not_found' });
    const a = q('SELECT * FROM moderation_actions WHERE id = ? AND author_id = ?').get(id, userId);
    if (!a) throw new HttpError(404, 'not_found');
    if (!AFFECTS_AUTHOR.has(a.action)) throw new HttpError(400, 'not_appealable');
    if (a.appealed_at) throw new HttpError(409, 'already_appealed');
    const text = validate.str(body.text, { min: 1, max: DETAILS_MAX, field: 'text', code: 'appeal_required' });
    q('UPDATE moderation_actions SET appealed_at = ?, appeal_text = ? WHERE id = ?').run(Date.now(), text, id);
    return { ok: true, item: actionView(q('SELECT * FROM moderation_actions WHERE id = ?').get(id)) };
  }

  function appealDecision(admin, rawId, body) {
    const id = validate.int(rawId, { min: 1, field: 'id', code: 'not_found' });
    const decision = validate.oneOf(body.decision, ['upheld', 'reversed'], { field: 'decision' });
    const note = validate.str(body.note, { max: STATEMENT_MAX, optional: true, fallback: null, field: 'note' });
    const a = q('SELECT * FROM moderation_actions WHERE id = ?').get(id);
    if (!a) throw new HttpError(404, 'not_found');
    if (!a.appealed_at) throw new HttpError(409, 'not_appealed');
    if (a.appeal_decision) throw new HttpError(409, 'already_decided');
    let restored = false;
    atomic(() => {
      q('UPDATE moderation_actions SET appeal_decision = ?, appeal_decided_at = ? WHERE id = ?').run(decision, Date.now(), id);
      if (decision === 'reversed') {
        // Annulation : le contenu masqué revient, la suspension est levée ; un contenu supprimé ne peut pas revenir.
        if ((a.action === 'hide' || a.action === 'suspend') && a.target_type in CONTENT_TABLES) restored = setHidden(a.target_type, a.target_id, false) > 0;
        if (a.action === 'suspend' && a.author_id) q('UPDATE users SET suspended_until = NULL, suspension_reason = NULL WHERE id = ?').run(a.author_id);
      }
      services.audit(admin.id, `appeal.${decision}`, `action:${id}`, note ? { note: note.slice(0, 200) } : null);
    });
    if (a.author_id) {
      services.forget?.(a.author_id);
      deps.notify?.(a.author_id, 'appeal_decided', {
        targetType: a.target_type, targetId: a.target_id,
        data: { actionId: id, action: a.action, decision, note, restored, ...itemOf(a.snapshot) },
      });
    }
    return { action: actionView(q('SELECT * FROM moderation_actions WHERE id = ?').get(id)) };
  }

  // ----- suspensions, pochettes, journal ---------------------------------------------------------------

  function suspendUser(admin, rawId, body) {
    const id = validate.int(rawId, { min: 1, field: 'id', code: 'user_not_found' });
    const target = services.getUser(id);
    if (!target || !target.email_verified_at) throw new HttpError(404, 'user_not_found');
    const { ground, statement, suspendDays } = checkDecision({ ...body, action: 'suspend', suspendDays: body.days ?? body.suspendDays });
    return { action: actionView(decide(admin, { targetType: 'user', targetId: id, action: 'suspend', ground, statement, suspendDays })) };
  }

  function unsuspendUser(admin, rawId, body) {
    const id = validate.int(rawId, { min: 1, field: 'id', code: 'user_not_found' });
    if (!services.getUser(id)) throw new HttpError(404, 'user_not_found');
    const ground = typeof body.ground === 'string' && GROUND_RE.test(body.ground) ? body.ground : 'rules:none';
    const statement = validate.str(body.statement, { max: STATEMENT_MAX, optional: true, fallback: '', field: 'statement' });
    const row = atomic(() => {
      q('UPDATE users SET suspended_until = NULL, suspension_reason = NULL WHERE id = ?').run(id);
      const a = q(`INSERT INTO moderation_actions (admin_id, target_type, target_id, author_id, action, ground, statement, created_at)
        VALUES (?, 'user', ?, ?, 'unsuspend', ?, ?, ?) RETURNING *`).get(admin.id, String(id), id, ground, statement, Date.now());
      services.audit(admin.id, 'moderation.unsuspend', `user:${id}`, { actionId: a.id });
      return a;
    });
    services.forget?.(id);
    deps.bus.emit('moderation.action', { actionId: row.id, action: 'unsuspend', targetType: 'user', targetId: String(id), authorId: id });
    return { action: actionView(row) };
  }

  function suspensions(admin) {
    const rows = q('SELECT id, suspended_until, suspension_reason FROM users WHERE suspended_until > ? ORDER BY suspended_until LIMIT 200').all(Date.now());
    const users = services.userSummaries(rows.map((r) => r.id), admin.id, { hidden: new Set() });
    return {
      items: rows.filter((r) => users.has(r.id)).map((r) => ({ user: users.get(r.id), until: r.suspended_until, reason: r.suspension_reason })),
      catalog: deps.refs({ albumIds: services.summaryAlbums(users.values()) }),
    };
  }

  /** Retrait (ou retour) de la vraie pochette d'un album : visuel généré partout à la fois (PLAN.md 7.1). */
  function coverTakedown(admin, rawAlbumId, body) {
    const albumId = validate.id(rawAlbumId);
    if (!albumId || !q('SELECT 1 FROM cat_albums WHERE id = ?').get(albumId)) throw new HttpError(404, 'unknown_album');
    const blocked = validate.bool(body.blocked);
    const note = validate.str(body.note, { max: 500, optional: true, fallback: '', field: 'note' });
    const ground = typeof body.ground === 'string' && GROUND_RE.test(body.ground) ? body.ground : 'law:copyright';
    atomic(() => {
      q('UPDATE cat_albums SET cover_blocked = ? WHERE id = ?').run(blocked ? 1 : 0, albumId);
      q(`INSERT INTO moderation_actions (admin_id, target_type, target_id, action, ground, statement, created_at)
        VALUES (?, 'album', ?, ?, ?, ?, ?)`).run(admin.id, albumId, blocked ? 'cover_block' : 'cover_unblock', ground, note, Date.now());
      services.audit(admin.id, blocked ? 'cover.block' : 'cover.unblock', `album:${albumId}`, note ? { note: note.slice(0, 200) } : null);
    });
    deps.catalog?.invalidate?.();
    return { albumId, blocked, catalog: deps.refs({ albumIds: [albumId] }) };
  }

  function blockedCovers() {
    const rows = q(`SELECT al.id, (SELECT MAX(created_at) FROM moderation_actions m WHERE m.target_type = 'album' AND m.target_id = al.id
        AND m.action = 'cover_block') AS at FROM cat_albums al WHERE al.cover_blocked = 1 ORDER BY at DESC LIMIT 200`).all();
    return { items: rows.map((r) => ({ albumId: r.id, at: r.at })), catalog: deps.refs({ albumIds: rows.map((r) => r.id) }) };
  }

  function auditLog(admin, query) {
    const limit = deps.paging.limitOf(query.limit, { def: 50, max: 100 });
    const after = deps.paging.decodeCursor(query.cursor, { length: 2 });
    const rows = q(`SELECT * FROM admin_audit ${after ? 'WHERE (created_at, id) < (?, ?)' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...(after ? [after[0], after[1]] : []), limit + 1);
    const page = deps.paging.keysetPage(rows, limit, (r) => [r.created_at, r.id]);
    const users = services.userSummaries(page.items.map((r) => r.admin_id).filter(Boolean), admin.id, { hidden: new Set() });
    return {
      items: page.items.map((r) => ({ id: r.id, admin: users.get(r.admin_id) || null, action: r.action, target: r.target, payload: parse(r.payload, null), createdAt: r.created_at })),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Critiques récentes (GET /api/admin/reviews, même forme qu'avant) avec, en plus, l'identifiant de la critique et
   * son état masqué, pour agir sans signalement.
   */
  function recentReviews(admin) {
    const rows = q(`SELECT id, user_id, item_type, item_id, score, review, updated_at, hidden_at FROM ratings
      WHERE review IS NOT NULL ORDER BY updated_at DESC LIMIT 60`).all();
    const users = services.userSummaries(rows.map((r) => r.user_id), admin.id, { hidden: new Set() });
    const items = rows.filter((r) => users.has(r.user_id)).map((r) => ({
      user: users.get(r.user_id), type: r.item_type, id: r.item_id, ratingId: r.id, score: r.score, review: r.review,
      updatedAt: r.updated_at, hidden: !!r.hidden_at,
    }));
    return { items, catalog: refsOf(items.map((i) => ({ itemType: i.type, itemId: i.id })), users.values()) };
  }

  return {
    access, purgeTarget, snapshot, forgetUser, block, unblock, listBlocks, report, publicReport, decide, decideReport, act,
    listReports, listAppeals, mine, appeal, appealDecision, suspendUser, unsuspendUser, suspensions, coverTakedown,
    blockedCovers, auditLog, recentReviews, counts, resolveUrl,
  };
}

export function routes(r, deps) {
  const { limits } = deps;
  const api = () => deps.moderation;

  r.post('/reports', limits.write, (req, res) => res.status(201).json(api().report(req.user, req.body, req.ip)));

  r.get('/blocks', limits.read, (req, res) => res.json(api().listBlocks(req.user.id)));
  r.put('/blocks/:userId', limits.write, (req, res) => res.json(api().block(req.user.id, req.params.userId)));
  r.delete('/blocks/:userId', limits.write, (req, res) => res.json(api().unblock(req.user.id, req.params.userId)));

  r.get('/moderation/mine', limits.read, (req, res) => res.json(api().mine(req.user.id)));
  r.post('/moderation/:actionId/appeal', limits.write, (req, res) => res.json(api().appeal(req.user.id, req.params.actionId, req.body)));
}

export function publicRoutes(r, deps) {
  // Formulaire public (DSA art. 16) : ouvert à tous, 5 envois par heure et par adresse IP.
  r.post('/public/report', deps.limits.guestForm, async (req, res) => res.status(201).json(await deps.moderation.publicReport(req.body, req.ip)));
}

export function adminRoutes(r, deps) {
  const api = () => deps.moderation;
  r.get('/reports', (req, res) => res.json(api().listReports(req.user, req.query)));
  r.post('/reports/:id/decision', (req, res) => res.json(api().decideReport(req.user, req.params.id, req.body)));
  r.get('/appeals', (req, res) => res.json(api().listAppeals(req.user, req.query)));
  r.post('/moderation/act', (req, res) => res.json(api().act(req.user, req.body)));
  r.post('/moderation/:actionId/appeal-decision', (req, res) => res.json(api().appealDecision(req.user, req.params.actionId, req.body)));
  r.get('/suspensions', (req, res) => res.json(api().suspensions(req.user)));
  r.post('/users/:id/suspend', (req, res) => res.json(api().suspendUser(req.user, req.params.id, req.body)));
  r.post('/users/:id/unsuspend', (req, res) => res.json(api().unsuspendUser(req.user, req.params.id, req.body)));
  r.get('/albums/blocked-covers', (req, res) => res.json(api().blockedCovers()));
  r.post('/albums/:id/cover', (req, res) => res.json(api().coverTakedown(req.user, req.params.id, req.body)));
  r.get('/audit', (req, res) => res.json(api().auditLog(req.user, req.query)));
  // Anciennes routes des critiques (toujours là) : la liste porte en plus l'identifiant de la critique ; la suppression
  // passe par une décision de modération (motif, exposé des motifs, notification de l'auteur, journal).
  r.get('/reviews', (req, res) => res.json(api().recentReviews(req.user)));
  r.delete('/reviews/:userId/:type/:id', (req, res) => {
    const row = deps.db.prepare('SELECT id FROM ratings WHERE user_id = ? AND item_type = ? AND item_id = ? AND review IS NOT NULL')
      .get(Number(req.params.userId) || 0, String(req.params.type), String(req.params.id));
    if (!row) throw new deps.HttpError(404, 'review_not_found');
    api().decide(req.user, {
      targetType: 'review', targetId: row.id, action: 'delete', ground: 'rules:respect',
      statement: 'Ta critique a été retirée par la modération : elle ne respecte pas les règles de la communauté AlbumMania.',
    });
    res.json(api().recentReviews(req.user));
  });
}

export const jobs = [
  {
    // Adresses IP des signalements, posts et commentaires : gardées un an (décret 2021-1362), puis effacées.
    name: 'purge-reports-ip',
    run({ db }) {
      const before = Date.now() - 365 * DAY;
      const out = {};
      for (const table of ['reports', 'posts', 'comments']) {
        out[table] = db.prepare(`UPDATE ${table} SET created_ip = NULL WHERE created_ip IS NOT NULL AND created_at < ?`).run(before).changes;
      }
      return out;
    },
  },
];
