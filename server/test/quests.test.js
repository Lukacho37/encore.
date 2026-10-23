// Quêtes (PLAN.md 5.6, 6.7, chantier P1-F) : périodes de Paris (changements d'heure compris), tirage déterministe,
// chaque métrique avec sa règle anti-abus, réclamation une seule fois, période finie, relance unique, bonus du jour et
// de la semaine, « Premiers pas », coût de la lecture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';
import { dayKey, weekKey, periodBounds, currentPeriod, parisMidnight } from '../../shared/periods.js';
import { FIRST_STEPS, QUESTS, parseQuest, reviewCounts, rollQuests, rerollQuest, BONUS_SLOT } from '../../shared/quests.js';

const app = await startApp();
test.after(() => app.close());
const { db, deps } = app;

let n = 0;
const player = (name) => signupVerified(app, { username: name || `qs_${++n}` });
const call = (who, method, path, body) => api(app.base, who?.cookie || '', method, path, body);
const enc = encodeURIComponent;
const today = () => currentPeriod('daily');
const week = () => currentPeriod('weekly');
/** Un instant dans la période du jour (après le début, avant maintenant). */
const inToday = () => Math.max(today().start + 1000, Date.now() - 60_000);
const yesterday = () => today().start - 3_600_000;
const progress = (who, questId, key = today().key) => deps.quests.progress(who.user.id, questId, key);
const tracksOf = (albumId) => db.prepare('SELECT id, rarity, genre, year FROM cat_tracks WHERE album_id = ? ORDER BY n').all(albumId);
const albums = db.prepare('SELECT id, artist_id, genre, year FROM cat_albums ORDER BY id').all();
/** Force la quête d'un slot de la période (après la première lecture qui l'a tirée). */
const setQuest = (who, key, slot, questId) => db.prepare('UPDATE user_quests SET quest_id = ? WHERE user_id = ? AND period_key = ? AND slot = ?')
  .run(questId, who.user.id, key, slot);
const befriend = (a, b) => db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)")
  .run(a.user.id, b.user.id, Date.now(), Date.now());
const rate = (who, type, id, at, review = null) => db.prepare(`INSERT INTO ratings (user_id, item_type, item_id, score, review, review_at, created_at, updated_at)
  VALUES (?, ?, ?, 8, ?, ?, ?, ?)`).run(who.user.id, type, id, review, review ? at : null, at, at);
const card = (who, trackId, variant, at) => db.prepare(`INSERT INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, ?, ?, 1, ?)
  ON CONFLICT (user_id, track_id, variant) DO NOTHING`).run(who.user.id, trackId, variant, at);

const LONG = 'Un album qui a changé ma façon d’écouter la musique électronique : chaque morceau raconte quelque chose de différent, '
  + 'les basses sont rondes, les voix trafiquées restent humaines et la production vieillit étonnamment bien.';

test('périodes de Paris : minuit à minuit, semaine ISO, changements d’heure', () => {
  // 29 mars 2026 : passage à l'heure d'été (jour de 23 h) ; 25 octobre 2026 : retour à l'heure d'hiver (25 h).
  const spring = periodBounds('d:2026-03-29');
  assert.equal(spring.end - spring.start, 23 * 3_600_000);
  assert.equal(new Date(spring.start).toISOString(), '2026-03-28T23:00:00.000Z');
  const autumn = periodBounds('d:2026-10-25');
  assert.equal(autumn.end - autumn.start, 25 * 3_600_000);
  assert.equal(new Date(autumn.start).toISOString(), '2026-10-24T22:00:00.000Z');
  // 23 h 59 à Paris est encore la veille ; minuit pile est le jour suivant.
  assert.equal(dayKey(parisMidnight(2026, 10, 6) - 1), 'd:2026-10-05');
  assert.equal(dayKey(parisMidnight(2026, 10, 6)), 'd:2026-10-06');
  // Semaine ISO : du lundi 00:00 au lundi suivant (semaine du changement d'heure : 7 jours moins une heure).
  const w = periodBounds('w:2026-W13');
  assert.equal(new Date(w.start).toISOString(), '2026-03-22T23:00:00.000Z');
  assert.equal(w.end - w.start, 7 * 86_400_000 - 3_600_000);
  assert.equal(weekKey(parisMidnight(2026, 1, 1)), 'w:2026-W01');
  assert.equal(weekKey(parisMidnight(2027, 1, 1)), 'w:2026-W53');
});

test('tirage déterministe : même joueur et même période → mêmes quêtes ; une par catégorie ; pas de social sans ami', () => {
  const a = rollQuests(42, 'd:2026-10-06', 'daily', { hasFriends: false, genres: ['rock'] });
  const b = rollQuests(42, 'd:2026-10-06', 'daily', { hasFriends: false, genres: ['rock'] });
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((x) => x.slot), [0, 1, 2]);
  assert.deepEqual(a.map((x) => parseQuest(x.questId).def.category), ['collect', 'rate', 'discover']);
  // Sur 300 joueurs : jamais de quête sociale sans ami, des tirages variés, des genres pris dans les goûts.
  const seen = new Set();
  for (let u = 1; u <= 300; u++) {
    for (const scope of ['daily', 'weekly']) {
      const key = scope === 'daily' ? 'd:2026-10-06' : 'w:2026-W41';
      for (const r of rollQuests(u, key, scope, { hasFriends: false, genres: ['jazz'] })) {
        const p = parseQuest(r.questId);
        assert.ok(p, r.questId);
        assert.ok(!p.def.social, `quête sociale tirée sans ami : ${r.questId}`);
        if (p.vars.genre) assert.equal(p.vars.genre, 'jazz');
        seen.add(p.def.id);
      }
    }
  }
  assert.ok(seen.size >= 15, `tirages trop peu variés (${seen.size})`);
  const social = new Set();
  for (let u = 1; u <= 300; u++) for (const r of rollQuests(u, 'd:2026-10-07', 'daily', { hasFriends: true })) social.add(parseQuest(r.questId).def.id);
  assert.ok(social.has('d-post') || social.has('d-comment'), 'avec des amis, les quêtes sociales sont possibles');
  // Une relance donne une autre quête de la même catégorie, toujours la même pour ce joueur et ce jour.
  const re = rerollQuest(42, 'd:2026-10-06', 'daily', 1, a[1].questId, {});
  assert.notEqual(parseQuest(re).def.id, parseQuest(a[1].questId).def.id);
  assert.equal(parseQuest(re).def.category, 'rate');
  assert.equal(rerollQuest(42, 'd:2026-10-06', 'daily', 1, a[1].questId, {}), re);
  // Toutes les définitions sont lisibles ; les récompenses suivent PLAN.md 6.7.
  for (const q of QUESTS) assert.ok(q.reward.royalties > 0 && q.reward.xp > 0, q.id);
  assert.equal(FIRST_STEPS.reduce((s, q) => s + q.reward.royalties, 0), 300);
  assert.equal(FIRST_STEPS.reduce((s, q) => s + (q.reward.boosters || 0), 0), 2);
});

test('GET /api/quests : 3 + 3 quêtes tirées et gardées, Premiers pas, bornes de période', async () => {
  const me = await player();
  const r = await call(me, 'GET', '/quests');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { daily, weekly, firstSteps } = r.body;
  assert.equal(daily.periodKey, today().key);
  assert.equal(weekly.periodKey, week().key);
  assert.equal(daily.endsAt, today().end);
  assert.equal(daily.slots.length, 3);
  assert.equal(weekly.slots.length, 3);
  assert.equal(daily.rerollsLeft, 1);
  assert.equal(firstSteps.length, FIRST_STEPS.length);
  for (const quest of [...daily.slots, ...weekly.slots]) {
    assert.ok(Number.isInteger(quest.target) && quest.progress >= 0 && quest.progress <= quest.target, JSON.stringify(quest));
    assert.ok(quest.reward.royalties > 0);
    assert.equal(quest.claimed, false);
  }
  assert.deepEqual(daily.slots.map((s) => s.reward.royalties), [40, 50, 60]);
  assert.deepEqual(weekly.slots.map((s) => s.reward.xp), [100, 100, 100]);
  // Deuxième lecture : les mêmes quêtes (gardées en base), pas un nouveau tirage.
  const again = await call(me, 'GET', '/quests');
  assert.deepEqual(again.body.daily.slots.map((s) => s.id), daily.slots.map((s) => s.id));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_quests WHERE user_id = ?').get(me.user.id).n, 3 + 3 + FIRST_STEPS.length);
  // « Termine ton profil musical » : passer l'accueil ne la termine pas ; un profil rempli (genres favoris) si.
  assert.equal((await call(me, 'POST', '/onboarding', { skip: true })).status, 200);
  assert.ok(db.prepare('SELECT onboarded_at FROM users WHERE id = ?').get(me.user.id).onboarded_at);
  const skipped = await call(me, 'GET', '/quests');
  assert.equal(skipped.body.firstSteps[0].done, false, 'accueil passé : rien à réclamer');
  const early = await call(me, 'POST', '/quests/first/0/claim');
  assert.equal(early.status, 409, JSON.stringify(early.body));
  assert.equal((await call(me, 'POST', '/onboarding', { genres: ['electro', 'rock', 'pop'] })).status, 200);
  const third = await call(me, 'GET', '/quests');
  assert.equal(third.body.firstSteps[0].done, true);
});

test('métriques : comptées dans la fenêtre du jour, avec leurs règles anti-abus', async () => {
  const me = await player();
  const other = await player();
  const at = inToday();
  const before = yesterday();
  const [al1, al2, al3] = albums;
  const t1 = tracksOf(al1.id);
  // Boosters : les ouvertures comptent, un pressage non.
  const open = db.prepare('INSERT INTO pack_openings (user_id, source, cards, created_at) VALUES (?, ?, ?, ?)');
  open.run(me.user.id, 'pack', '[]', at);
  open.run(me.user.id, 'album-pack', '[]', at);
  open.run(me.user.id, 'press', '[]', at);
  open.run(me.user.id, 'pack', '[]', before);
  assert.equal(progress(me, 'd-open'), 2);
  // Nouvelles cartes : premier exemplaire seulement ; un holo d'une carte déjà possédée ne compte pas ; std + holo d'une
  // même nouvelle carte comptent une fois.
  card(me, t1[0].id, 'std', before);
  card(me, t1[0].id, 'holo', at);
  card(me, t1[1].id, 'std', at);
  card(me, t1[1].id, 'holo', at);
  card(me, t1[2].id, 'std', at);
  assert.equal(progress(me, 'd-cards'), 2);
  // Paramètres : genre, décennie, rareté.
  assert.equal(progress(me, `d-genre:${t1[1].genre}`), 2);
  const other1 = albums.find((a) => a.genre !== t1[1].genre);
  assert.equal(progress(me, `d-genre:${other1.genre}`), 0);
  const decade = Math.floor(t1[1].year / 10) * 10;
  if ([1960, 1970, 1980, 1990, 2000, 2010, 2020].includes(decade)) assert.equal(progress(me, `d-decade:${decade}`), 2);
  const rare = [t1[1], t1[2]].filter((t) => ['rare', 'super', 'ultra', 'legendary', 'promo'].includes(t.rarity)).length;
  assert.equal(progress(me, 'd-rare'), Math.min(2, rare));
  // Nouvel artiste : un album commencé aujourd'hui d'un artiste jamais commencé avant.
  const uap = db.prepare('INSERT OR REPLACE INTO user_album_progress (user_id, album_id, owned, holo, total, first_at, updated_at) VALUES (?, ?, 1, 0, 10, ?, ?)');
  uap.run(me.user.id, al1.id, before, at); // artiste de al1 déjà connu hier
  uap.run(me.user.id, al2.id, at, at);
  assert.equal(progress(me, 'd-artist'), al2.artist_id === al1.artist_id ? 0 : 1);
  // Album complété.
  db.prepare('INSERT INTO achievements (user_id, key, created_at) VALUES (?, ?, ?)').run(me.user.id, `album:${al3.id}`, at);
  db.prepare('INSERT INTO achievements (user_id, key, created_at) VALUES (?, ?, ?)').run(me.user.id, `artist:${al3.artist_id}`, at);
  assert.equal(progress(me, 'w-complete', week().key), 1);
  // Notes : toute note compte, hier non.
  rate(me, 'album', al1.id, at);
  rate(me, 'album', al2.id, at);
  rate(me, 'album', al3.id, before);
  rate(me, 'track', t1[0].id, at);
  assert.equal(progress(me, 'd-rate'), 2);
  assert.equal(progress(me, 'd-tracks'), 1);
  assert.equal(progress(me, 'd-genres'), new Set([al1.genre, al2.genre]).size);
  // Critique : longue et variée seulement.
  assert.equal(reviewCounts(LONG), true);
  assert.equal(reviewCounts('super '.repeat(40)), false, 'texte répétitif refusé');
  assert.equal(reviewCounts('Trop bien.'), false, 'trop court');
  rate(me, 'album', albums[3].id, at, 'super '.repeat(40));
  assert.equal(progress(me, 'd-review'), 0);
  rate(me, 'album', albums[4].id, at, LONG);
  assert.equal(progress(me, 'd-review'), 1);
  db.prepare('UPDATE ratings SET hidden_at = ? WHERE user_id = ? AND item_id = ?').run(at, me.user.id, albums[4].id);
  assert.equal(progress(me, 'd-review'), 0, 'une critique masquée par la modération ne compte plus');
  // Votes de battle : seuls les votes comptés (pas les « Je ne connais pas »).
  const vote = db.prepare(`INSERT INTO battle_votes (user_id, item_type, a_id, b_id, winner_id, context, categories, counted, created_at)
    VALUES (?, 'album', ?, ?, ?, 'global:album', '[]', ?, ?)`);
  const [x, y, z] = [albums[0].id, albums[1].id, albums[2].id].sort();
  vote.run(me.user.id, x, y, x, 1, at);
  vote.run(me.user.id, x, z, null, 0, at);
  assert.equal(progress(me, 'd-battles'), 1);
  // Blind test : parties finies ; ≥ 4/5 pour la quête de score.
  const game = db.prepare(`INSERT INTO blindtest_games (id, user_id, genre, questions, correct, created_at, finished_at) VALUES (?, ?, 'all', '[]', ?, ?, ?)`);
  game.run(`g1-${me.user.id}`, me.user.id, 2, at, at);
  game.run(`g2-${me.user.id}`, me.user.id, 4, at, at);
  game.run(`g3-${me.user.id}`, me.user.id, 5, at, null);
  assert.equal(progress(me, 'd-blindtest'), 1);
  assert.equal(progress(me, 'w-blindtest', week().key), 1);
  // Listes : mes listes et Mes 9 albums, pas la liste d'envies.
  const list = (kind) => Number(db.prepare(`INSERT INTO lists (user_id, kind, title, created_at, updated_at) VALUES (?, ?, 'L', ?, ?)`)
    .run(me.user.id, kind, at, at).lastInsertRowid);
  const item = db.prepare("INSERT INTO list_items (list_id, position, item_type, item_id, added_at) VALUES (?, ?, 'album', ?, ?)");
  const l1 = list('list');
  const lw = list('wishlist');
  item.run(l1, 0, al1.id, at);
  item.run(l1, 1, al2.id, before);
  item.run(lw, 0, al3.id, at);
  assert.equal(progress(me, 'd-list'), 1);
  // Posts et commentaires : ceux masqués par la modération ne comptent pas.
  const post = db.prepare('INSERT INTO posts (user_id, body, created_at, hidden_at) VALUES (?, ?, ?, ?)');
  post.run(me.user.id, 'Bonjour', at, null);
  post.run(me.user.id, 'Spam', at, at);
  assert.equal(progress(me, 'd-post'), 1);
  // Premiers pas : un ami accepté.
  assert.equal(progress(me, 'f-friend', 'first'), 0);
  befriend(me, other);
  assert.equal(progress(me, 'f-friend', 'first'), 1);
  // Bornes : la progression ne dépasse jamais la cible.
  for (let i = 0; i < 5; i++) open.run(me.user.id, 'pack', '[]', at);
  assert.equal(progress(me, 'd-open'), 3);
});

test('réclamer : quête pas finie 409, récompense une seule fois, période finie 410, clés illisibles 400', async () => {
  const me = await player();
  const r = await call(me, 'GET', '/quests');
  const key = r.body.daily.periodKey;
  setQuest(me, key, 1, 'd-rate');
  const notDone = await call(me, 'POST', `/quests/${enc(key)}/1/claim`);
  assert.equal(notDone.status, 409);
  assert.equal(notDone.body.error, 'quest_not_done');
  for (const id of albums.slice(0, 3).map((a) => a.id)) {
    const put = await call(me, 'PUT', `/ratings/album/${id}`, { score: 7 });
    assert.equal(put.status, 200, JSON.stringify(put.body));
  }
  const user0 = db.prepare('SELECT royalties, xp FROM users WHERE id = ?').get(me.user.id);
  const ok = await call(me, 'POST', `/quests/${enc(key)}/1/claim`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.reward, { royalties: 50, xp: 30 });
  assert.equal(ok.body.quest.claimed, true);
  assert.equal(ok.body.state.partial, true);
  const user1 = db.prepare('SELECT royalties, xp FROM users WHERE id = ?').get(me.user.id);
  assert.equal(user1.royalties - user0.royalties, 50);
  assert.equal(user1.xp - user0.xp, 30);
  const twice = await call(me, 'POST', `/quests/${enc(key)}/1/claim`);
  assert.equal(twice.status, 409);
  assert.equal(twice.body.error, 'already_claimed');
  assert.equal(db.prepare('SELECT royalties FROM users WHERE id = ?').get(me.user.id).royalties, user1.royalties);
  // Période finie (hier) ou pas commencée : 410 ; clé illisible : 400 ; slot inconnu : 404.
  const past = dayKey(Date.now() - 2 * 86_400_000);
  assert.equal((await call(me, 'POST', `/quests/${enc(past)}/0/claim`)).status, 410);
  assert.equal((await call(me, 'POST', `/quests/${enc('w:2020-W01')}/0/claim`)).status, 410);
  assert.equal((await call(me, 'POST', `/quests/${enc('x:nope')}/0/claim`)).status, 400);
  assert.equal((await call(me, 'POST', `/quests/${enc(key)}/7/claim`)).status, 404);
  // Sans en-tête anti-CSRF : refusé.
  const res = await fetch(`${app.base}/api/quests/${enc(key)}/0/claim`, { method: 'POST', headers: { Cookie: me.cookie } });
  assert.equal(res.status, 403);
});

test('réclamations simultanées : une seule récompense', async () => {
  const me = await player();
  const key = (await call(me, 'GET', '/quests')).body.daily.periodKey;
  setQuest(me, key, 0, 'd-open');
  const open = db.prepare("INSERT INTO pack_openings (user_id, source, cards, created_at) VALUES (?, 'pack', '[]', ?)");
  for (let i = 0; i < 3; i++) open.run(me.user.id, inToday());
  const before = db.prepare('SELECT royalties FROM users WHERE id = ?').get(me.user.id).royalties;
  const results = await Promise.all([1, 2, 3, 4].map(() => call(me, 'POST', `/quests/${enc(key)}/0/claim`)));
  assert.equal(results.filter((x) => x.status === 200).length, 1);
  assert.ok(results.filter((x) => x.status !== 200).every((x) => x.body.error === 'already_claimed'));
  assert.equal(db.prepare('SELECT royalties FROM users WHERE id = ?').get(me.user.id).royalties - before, 40);
});

test('relance : une gratuite par jour, jamais une quête réclamée, pas pour la semaine', async () => {
  const me = await player();
  const r = await call(me, 'GET', '/quests');
  const key = r.body.daily.periodKey;
  const before = r.body.daily.slots[2];
  const re = await call(me, 'POST', `/quests/${enc(key)}/2/reroll`);
  assert.equal(re.status, 200, JSON.stringify(re.body));
  assert.notEqual(parseQuest(re.body.quest.id).def.id, before.defId);
  assert.equal(re.body.quest.category, 'discover');
  assert.equal(re.body.quest.rerolled, true);
  assert.equal(re.body.rerollsLeft, 0);
  const again = await call(me, 'POST', `/quests/${enc(key)}/0/reroll`);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'no_reroll');
  assert.equal((await call(me, 'GET', '/quests')).body.daily.rerollsLeft, 0);
  const wk = (await call(me, 'POST', `/quests/${enc(r.body.weekly.periodKey)}/0/reroll`));
  assert.equal(wk.status, 409);
  assert.equal(wk.body.error, 'no_reroll');
  // Une quête réclamée ne se relance pas.
  const other = await player();
  const k2 = (await call(other, 'GET', '/quests')).body.daily.periodKey;
  setQuest(other, k2, 0, 'd-open');
  db.prepare("INSERT INTO pack_openings (user_id, source, cards, created_at) VALUES (?, 'pack', '[]', ?), (?, 'pack', '[]', ?), (?, 'pack', '[]', ?)")
    .run(other.user.id, inToday(), other.user.id, inToday(), other.user.id, inToday());
  assert.equal((await call(other, 'POST', `/quests/${enc(k2)}/0/claim`)).status, 200);
  const claimed = await call(other, 'POST', `/quests/${enc(k2)}/0/reroll`);
  assert.equal(claimed.status, 409);
  assert.equal(claimed.body.error, 'already_claimed');
});

/** Rend les trois quêtes de la période faisables tout de suite (ouvertures de boosters), puis les réclame. */
async function claimAll(me, key, ids) {
  for (const [slot, id] of ids.entries()) setQuest(me, key, slot, id);
  const open = db.prepare("INSERT INTO pack_openings (user_id, source, cards, created_at) VALUES (?, 'pack', '[]', ?)");
  for (let i = 0; i < 15; i++) open.run(me.user.id, inToday());
  for (const slot of [0, 1, 2]) {
    const r = await call(me, 'POST', `/quests/${enc(key)}/${slot}/claim`);
    assert.equal(r.status, 200, `${slot} ${JSON.stringify(r.body)}`);
  }
}

test('bonus du jour : verrouillé tant que les 3 quêtes ne sont pas réclamées, puis +1 booster, une seule fois', async () => {
  const me = await player();
  const r = await call(me, 'GET', '/quests');
  const key = r.body.daily.periodKey;
  const locked = await call(me, 'POST', `/quests/bonus/${enc(key)}`);
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error, 'bonus_locked');
  // Les trois slots deviennent des quêtes d'ouverture de boosters (faisables d'un coup).
  await claimAll(me, key, ['d-open', 'd-open', 'd-open']);
  const view = (await call(me, 'GET', '/quests')).body.daily;
  assert.equal(view.bonus.claimable, true);
  const packs = db.prepare('SELECT bonus_packs FROM users WHERE id = ?').get(me.user.id).bonus_packs;
  const ok = await call(me, 'POST', `/quests/bonus/${enc(key)}`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.reward, { boosters: 1 });
  assert.equal(db.prepare('SELECT bonus_packs FROM users WHERE id = ?').get(me.user.id).bonus_packs - packs, 1);
  assert.equal((await call(me, 'POST', `/quests/bonus/${enc(key)}`)).body.error, 'already_claimed');
  const after = (await call(me, 'GET', '/quests')).body.daily;
  assert.equal(after.bonus.claimed, true);
  assert.equal(after.bonus.claimable, false);
  assert.ok(db.prepare('SELECT 1 FROM user_quests WHERE user_id = ? AND period_key = ? AND slot = ?').get(me.user.id, key, BONUS_SLOT));
});

test('bonus de la semaine : un booster thématique de ton genre favori', async () => {
  const me = await player();
  const r = await call(me, 'GET', '/quests');
  const key = r.body.weekly.periodKey;
  db.prepare("INSERT INTO user_favorites (user_id, kind, item_id, position, created_at) VALUES (?, 'genre', 'jazz', 0, ?)").run(me.user.id, Date.now());
  await claimAll(me, key, ['w-open', 'w-open', 'w-open']);
  const ok = await call(me, 'POST', `/quests/bonus/${enc(key)}`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.reward.theme, 'genre:jazz');
  const booster = db.prepare('SELECT kind, theme, source FROM user_boosters WHERE user_id = ?').get(me.user.id);
  assert.deepEqual({ ...booster }, { kind: 'theme', theme: 'genre:jazz', source: 'quest:w:bonus' });
});

test('Premiers pas : réclamables une fois chacun, puis la liste disparaît', async () => {
  const me = await player();
  const other = await player();
  await call(me, 'GET', '/quests');
  // Profil musical rempli : un genre favori.
  db.prepare("INSERT INTO user_favorites (user_id, kind, item_id, position, created_at) VALUES (?, 'genre', 'electro', 0, ?)").run(me.user.id, Date.now());
  const r1 = await call(me, 'POST', '/quests/first/0/claim');
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.deepEqual(r1.body.reward, { royalties: 30, xp: 20 });
  // L'ami : récompense avec un booster bonus.
  assert.equal((await call(me, 'POST', '/quests/first/3/claim')).body.error, 'quest_not_done');
  befriend(me, other);
  const packs = db.prepare('SELECT bonus_packs FROM users WHERE id = ?').get(me.user.id).bonus_packs;
  const r3 = await call(me, 'POST', '/quests/first/3/claim');
  assert.equal(r3.status, 200);
  assert.equal(db.prepare('SELECT bonus_packs FROM users WHERE id = ?').get(me.user.id).bonus_packs - packs, 1);
  assert.equal((await call(me, 'POST', '/quests/first/3/claim')).body.error, 'already_claimed');
  // Tout réclamé : plus de Premiers pas.
  db.prepare("UPDATE user_quests SET claimed_at = ? WHERE user_id = ? AND period_key = 'first'").run(Date.now(), me.user.id);
  assert.deepEqual((await call(me, 'GET', '/quests')).body.firstSteps, []);
});

test('niveau gagné par une quête : levelUp dans la réponse (booster bonus du palier)', async () => {
  const me = await player();
  const key = (await call(me, 'GET', '/quests')).body.daily.periodKey;
  setQuest(me, key, 0, 'd-open');
  db.prepare('UPDATE users SET xp = 49 WHERE id = ?').run(me.user.id);
  const open = db.prepare("INSERT INTO pack_openings (user_id, source, cards, created_at) VALUES (?, 'pack', '[]', ?)");
  for (let i = 0; i < 3; i++) open.run(me.user.id, inToday());
  const r = await call(me, 'POST', `/quests/${enc(key)}/0/claim`);
  assert.equal(r.status, 200);
  assert.ok(r.body.levelUp && r.body.levelUp.to > r.body.levelUp.from, JSON.stringify(r.body.levelUp));
});

test('coût : GET /api/quests en quelques millisecondes', async () => {
  const me = await player();
  await call(me, 'GET', '/quests');
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) deps.quests.list(me.user.id);
  const each = (performance.now() - t0) / 20;
  assert.ok(each < 20, `GET /api/quests : ${each.toFixed(2)} ms`);
});
