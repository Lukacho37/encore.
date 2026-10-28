// Module « events » : événements (PLAN.md 4.3, 6.9). Chantier : P2-B.
//
// Le calendrier est dans le code (shared/events.js) : fenêtres en jours civils de Paris, rien en table. L'état d'un
// joueur vit ailleurs : ses quêtes d'événement dans user_quests (période `e:<slug>`, server/quests.js), ses votes de
// battles dans battle_votes.event_slug (posé ici après chaque vote compté de la fenêtre dans la catégorie de
// l'événement), son coffret dans sets (server/sets.js), son badge dans achievements (`badge:event:<slug>:gold`) et son
// cadre dans user_cosmetics (source `event:<slug>`), donnés avec le bonus des 3 quêtes (quests.claimBonus).
// Pendant un événement, sa catégorie de battles devient la catégorie du jour (kv battle:featured:<jour>, écrit à
// l'avance pour aujourd'hui et les deux jours suivants : le module battles la lit sans rien calculer).
// Aperçu (démo, parcours de test) : EVENT_PREVIEW=<slug> montre cet événement « en cours » (commencé il y a deux jours,
// encore douze), jamais en production.
// API interne (deps.events) : calendar(now?), current(now?), bonusOf(slug), applyBonus(userId, slug, now) (dans la
// transaction du bonus), afterBonus(userId, slug, reward), view(userId, slug), overview(userId).
import {
  EVENT_BADGE_TIER, EVENT_SLOTS, UPCOMING_DAYS, daysUntil, eventBadgeKey, eventDef, eventPeriodKey, isEventSlug, resolveCalendar,
} from '../shared/events.js';
import { TIER_REWARDS } from '../shared/badges.js';

export const name = 'events';

/** Tâche de nuit : catégorie du jour des battles pendant les événements (aujourd'hui et les deux jours suivants). */
export const jobs = [{ name: 'events-calendar', run: (deps) => deps.events.prepare() }];

const DAY = 86_400_000;
const FEATURED_AHEAD_DAYS = 2;

export function init(deps) {
  const { db, config, periods, HttpError } = deps;
  const statements = new Map();
  /** Requête préparée une fois par texte SQL. */
  const q = (sql) => {
    let st = statements.get(sql);
    if (!st) {
      st = db.prepare(sql);
      statements.set(sql, st);
    }
    return st;
  };
  const parse = (text, fallback) => {
    try {
      return text ? JSON.parse(text) : fallback;
    } catch {
      return fallback;
    }
  };

  // Aperçu d'un événement (démo, tests dans un navigateur) : jamais en production ; fenêtre ancrée au démarrage.
  const preview = !config.isProd && isEventSlug(process.env.EVENT_PREVIEW) ? process.env.EVENT_PREVIEW : null;
  const previewAnchor = Date.now();

  /** Calendrier résolu à `now` : [{ ...définition, start, end, status, preview }]. */
  const calendar = (now = Date.now()) => resolveCalendar({ now, preview, previewAnchor });
  const current = (now = Date.now()) => calendar(now).filter((e) => e.status === 'current');
  const find = (slug, now = Date.now()) => calendar(now).find((e) => e.slug === slug) || null;

  // ----- battles ----------------------------------------------------------------------------------------------

  /**
   * Catégorie du jour des battles : pour aujourd'hui et les deux jours suivants qui tombent dans un événement à
   * catégorie, kv battle:featured:<AAAA-MM-JJ> (INSERT OR IGNORE : une catégorie déjà tirée pour ce jour reste).
   */
  function prepare(now = Date.now()) {
    let written = 0;
    const events = calendar(now).filter((e) => e.battle && e.status !== 'past');
    for (let i = 0; i <= FEATURED_AHEAD_DAYS; i++) {
      const at = periods.dayStart(now) + i * DAY + 12 * 3_600_000;
      const ev = events.find((e) => at >= e.start && at < e.end);
      if (!ev) continue;
      const day = periods.dayKey(at).slice(2);
      written += q('INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)').run(`battle:featured:${day}`, ev.battle).changes;
    }
    return { written };
  }

  // Un vote compté dans la catégorie d'un événement en cours, pendant sa fenêtre : il porte le slug de l'événement
  // (les quêtes « vote dans les battles de l'événement » le comptent).
  deps.bus.on('battle.voted', ({ voteId, counted }) => {
    if (!counted || !voteId) return;
    const vote = q('SELECT categories, created_at, event_slug FROM battle_votes WHERE id = ?').get(voteId);
    if (!vote || vote.event_slug) return;
    const categories = parse(vote.categories, []);
    const ev = calendar(vote.created_at).find((e) => e.status === 'current' && e.battle && categories.includes(e.battle));
    if (ev) q('UPDATE battle_votes SET event_slug = ? WHERE id = ? AND event_slug IS NULL').run(ev.slug, voteId);
  });

  // ----- bonus des 3 quêtes ------------------------------------------------------------------------------------

  /**
   * Bonus d'un événement (les 3 quêtes réclamées) : badge or de l'événement (sa récompense de palier : XP, booster
   * bonus), cadre quand l'événement en a un, booster thématique. Forme d'une récompense de quête (quests.grant) :
   * { xp, royalties, boosters, theme, themed, badge, frame }.
   */
  function bonusOf(slug) {
    const ev = eventDef(slug);
    if (!ev) return null;
    const tier = TIER_REWARDS[EVENT_BADGE_TIER] || {};
    return {
      xp: tier.xp || 0,
      royalties: tier.royalties || 0,
      ...(tier.boosters ? { boosters: tier.boosters } : {}),
      ...(ev.booster ? { theme: ev.booster, themed: 1 } : {}),
      badge: eventBadgeKey(ev.slug),
      ...(ev.frame ? { frame: ev.frame } : {}),
    };
  }

  /** Dans la transaction du bonus (quests.claimBonus) : le badge et le cadre de l'événement. */
  function applyBonus(userId, slug, now = Date.now()) {
    const bonus = bonusOf(slug);
    if (!bonus) return;
    q('INSERT OR IGNORE INTO achievements (user_id, key, created_at, data) VALUES (?, ?, ?, ?)')
      .run(userId, bonus.badge, now, JSON.stringify({ value: EVENT_SLOTS, at: now, event: slug }));
    if (bonus.frame) deps.collection?.grantCosmetic?.(userId, bonus.frame, `event:${slug}`);
  }

  /**
   * Après la transaction du bonus : notification et événements du bus (event.completed, et badge.earned : le badge est
   * une médaille de la page Badges, famille externe « event », que le fil publie comme les autres médailles d'or).
   */
  function afterBonus(userId, slug, reward) {
    deps.notify?.(userId, 'event_reward', { groupKey: `event:${slug}`, data: { slug, badge: reward?.badge || null, frame: reward?.frame || null } });
    deps.bus.emit('event.completed', { userId, slug });
    if (reward?.badge) deps.bus.emit('badge.earned', { userId, key: reward.badge, family: 'event', variant: slug, tier: EVENT_BADGE_TIER });
  }

  // ----- vues --------------------------------------------------------------------------------------------------

  /** Badge et cadre déjà gagnés pour un événement : { badgeAt, frameAt }. */
  function earnedOf(userId, ev) {
    const badge = q('SELECT created_at FROM achievements WHERE user_id = ? AND key = ?').get(userId, eventBadgeKey(ev.slug));
    const frame = ev.frame ? q('SELECT created_at FROM user_cosmetics WHERE user_id = ? AND cosmetic_id = ?').get(userId, ev.frame) : null;
    return { badgeAt: badge?.created_at ?? null, frameAt: frame?.created_at ?? null };
  }

  /** Quêtes de l'événement réclamées par le joueur (sans recompter la progression) : { claimed, total }. */
  function claimedOf(userId, ev) {
    const n = q(`SELECT COUNT(*) AS n FROM user_quests WHERE user_id = ? AND period_key = ? AND slot < ? AND claimed_at IS NOT NULL`)
      .get(userId, eventPeriodKey(ev.slug), EVENT_SLOTS).n;
    return { claimed: n, total: ev.quests.length };
  }

  /** Résumé d'un événement : { slug, kind, titles, year?, start, end, status, preview, daysLeft, startsIn, battle, ... }. */
  function summaryOf(ev, userId, now = Date.now()) {
    return {
      slug: ev.slug,
      kind: ev.kind,
      titles: ev.title,
      ...(ev.year ? { year: ev.year } : {}),
      icon: ev.icon,
      start: ev.start,
      end: ev.end,
      status: ev.status,
      preview: ev.preview,
      daysLeft: ev.status === 'current' ? daysUntil(ev.end, now) : null,
      startsIn: ev.status === 'upcoming' ? daysUntil(ev.start, now) : null,
      battle: ev.battle,
      setId: ev.setId,
      frame: ev.frame,
      booster: ev.booster,
      badge: eventBadgeKey(ev.slug),
      quests: userId ? claimedOf(userId, ev) : { claimed: 0, total: ev.quests.length },
      earned: userId ? earnedOf(userId, ev) : { badgeAt: null, frameAt: null },
    };
  }

  /**
   * GET /api/events → { current, upcoming, past, soon, serverTime } : chaque liste de résumés ; `soon` = l'événement à
   * venir le plus proche s'il commence dans moins de 21 jours (pastille de l'accueil), sinon null.
   */
  function overview(userId, now = Date.now()) {
    const all = calendar(now).map((ev) => summaryOf(ev, userId, now));
    const upcoming = all.filter((e) => e.status === 'upcoming');
    const next = upcoming.filter((e) => e.kind === 'event').sort((a, b) => a.start - b.start)[0];
    return {
      current: all.filter((e) => e.status === 'current'),
      upcoming,
      past: all.filter((e) => e.status === 'past').reverse(),
      soon: next && next.startsIn <= UPCOMING_DAYS ? next : null,
      serverTime: now,
    };
  }

  /**
   * GET /api/events/:slug → { event, quests, set, battle, rewards, catalog } : quêtes (progression comptée dans la
   * fenêtre ; à venir : sans progression), coffret de l'événement, catégorie de battles, récompenses du bonus.
   */
  function view(userId, slug, now = Date.now()) {
    const ev = isEventSlug(slug) ? find(slug, now) : null;
    if (!ev) throw new HttpError(404, 'event_not_found');
    const quests = deps.quests?.eventView?.(userId, ev.slug) ?? null;
    const set = ev.setId ? deps.sets?.summaryFor?.(userId, ev.setId) ?? null : null;
    const featured = ev.battle ? q('SELECT value FROM kv WHERE key = ?').get(`battle:featured:${periods.dayKey(now).slice(2)}`)?.value === ev.battle : false;
    return {
      event: summaryOf(ev, userId, now),
      quests,
      set,
      battle: ev.battle ? { category: ev.battle, featured: ev.status === 'current' && featured } : null,
      rewards: bonusOf(ev.slug),
      catalog: deps.refs({ albumIds: set?.covers || [] }),
    };
  }

  prepare();

  return { calendar, current, find, prepare, bonusOf, applyBonus, afterBonus, overview, view };
}

export function routes(r, deps) {
  const { limits, services } = deps;
  const api = () => deps.events;
  const partial = (req) => services.state(req.user.id, { partial: true });
  /** Badges gagnés pendant la requête (celui de l'événement avec le bonus), pour le message « Nouvelle médaille ! ». */
  const earned = (req, since) => deps.badges?.earnedSince?.(req.user.id, since) ?? [];
  r.get('/events', limits.read, (req, res) => res.json(api().overview(req.user.id)));
  r.get('/events/:slug', limits.read, (req, res) => res.json(api().view(req.user.id, req.params.slug)));
  // Réclamer une quête et le bonus d'un événement depuis sa page : mêmes règles et mêmes réponses que
  // /quests/e:<slug>/… (module quests).
  r.post('/events/:slug/quests/:slot/claim', limits.write, (req, res) => {
    if (!isEventSlug(req.params.slug)) throw new deps.HttpError(404, 'event_not_found');
    const since = Date.now();
    const result = deps.quests.claim(req.user.id, eventPeriodKey(req.params.slug), req.params.slot);
    res.json({ ...result, badgesEarned: earned(req, since), state: partial(req) });
  });
  r.post('/events/:slug/bonus', limits.write, (req, res) => {
    if (!isEventSlug(req.params.slug)) throw new deps.HttpError(404, 'event_not_found');
    const since = Date.now();
    const result = deps.quests.claimBonus(req.user.id, eventPeriodKey(req.params.slug));
    res.json({ ...result, badgesEarned: earned(req, since), state: partial(req) });
  });
}
