# AlbumMania: master plan

> **ORCHESTRATOR DECISIONS (2026-10-06) — override every conflicting line below:** read `design/DESIGN-OVERRIDE.md` section
> « Décisions de l'orchestrateur ». In short: (1) NO booster sheet at all (`BoosterSheet.jsx` is not created; the Boosters tab and the
> packs pill link to `/`, where the booster hero stays literally unchanged); (2) navigation = phone tab bar **Boosters (`/`) ·
> Découvrir · Collection · Amis · Studio**, desktop top bar **Boosters · Découvrir · Collection · Amis · Studio** + search + the
> unchanged packs/royalties pills + FR/EN and sound kept in the bar at ≥ 1280 px (account menu below) + bell + avatar; Blind test
> lives in Découvrir and in the Home row; (3) `CATALOG_IMPORT` default stays `deezer` (owner wants ~20,000 albums; keep the legal
> risk documented, do not switch it off); (4) the currency stays « royalties ».


Status: **single source of truth for the implementation**, written 2026-10-06 against HEAD `5d6dd5e` (working tree clean at the time),
revised the same day after the owner's design decision (sections 0–3 revised, sections 4–10 added).
Inputs: `brief/vision.md` (owner brief), **`design/DESIGN-OVERRIDE.md` (owner decision, overrides every other input)**,
`design/design-system-current.md` (the current AlbumMania identity formalised as tokens and components: **the only design reference**,
with its validated mock and canonical new-component CSS in `design/current-v2/`),
`design/owner-reference-current-ui.webp` and `design/shots-current/` (what "current UI" means), `design/server-map.md`,
`design/client-map.md`, `design/ux-audit.md`, `design/game-legal.md`, `design/schema-proto/`.

**Cancelled, never apply:** `design/design-system.md` ("Disquaire": Gloock, Newsreader, Schibsted Grotesk, serif voice, obi, "ink and
paper only") and the three direction mocks in `design/direction-{A,B,C}/`. The owner rejected them: « ne vise pas cette UI, celle que
t'avais au départ est largement meilleure, reviens à cette UI ». Where `ux-audit.md` §2 recommends new typefaces, it is overruled too;
its other findings (sizes, contrast, layout, reachability) still apply inside the current identity.

Implementation agents follow this document literally. When the code has moved since this snapshot (other agents were fixing bugs
in parallel), re-read the file you own before editing it and keep the intent of this plan. When the plan and the code disagree on a
detail that the plan does not justify, prefer the code and note it in your final report.

---

## 0. Rules for every implementer

1. **Never delete a working feature.** Every current feature (boosters, album booster, shop, recycling, pressing, collection tabs,
   album/artist pages, ratings and reviews, friends, blind test, Studio showcase, vinyl shelf, turntable, rarity guide, admin tools,
   demo build) must still be reachable after each priority level. Section 2.4 says where each one moves.
2. **Extend, do not duplicate.** Reuse the tables, helpers and components named in this plan. A second paged-list hook, a second
   search box, a second `AlbumTile` or a second "badges" table is a bug.
3. **File ownership is strict inside a priority level** (section 9). Only the owner edits a file. Need a change in someone
   else's file? Use the contract (props, hook events, state extenders, i18n overrides) or ask the owner through the orchestrator.
4. **Strings:** new strings go only in your own `client/src/i18n/areas/<area>.js`. After P0, `fr.js` and `en.js` are frozen. To change an
   existing string, override its key from your area file (the deep `merge()` in `i18n/index.jsx` lets an area override base keys).
   New error codes go under `errors.*` in your area file. Every key exists in FR and EN. French typography: a narrow no-break space
   (U+202F) before `; : ! ? %` and inside « ». Use tutoiement.
5. **Styles:** after P0, `styles/app.css` is frozen. Each workstream styles its own components in its own CSS file, imported by the
   component, using the tokens of `design-system-current.md` only (no hex literals, no raw `font-size` under 12 px, no `font-family`
   outside `:root`). `scripts/css-lint.mjs` (P0-B) enforces this.
6. **API responses that mention albums, tracks or artists carry `catalog` refs** built with `refs()`. Responses that mention users
   carry `UserSummary` objects built in one batched query (never one query per row).
7. **Every new endpoint has a twin in the demo mock** (`client/src/demo/mock/<module>.js`). `npm run build:demo` must pass.
8. **Tests:** server features get `server/test/<module>.test.js` (node:test, in-memory DB, real HTTP). `npm test` stays green.
   Browser checks go in `scripts/e2e/<id>.mjs` (desktop 1440×900 and phone 390×844, zero console errors).
9. **Processes:** use your own ports (section 9.0), your own copy of `fixture20k.db`, and kill every process you start. Never
   `pkill -f` with a pattern that matches your own command.
10. **Legal first** (section 7.1). No audio files, no lyrics, no cover files copied or proxied, no Spotify Web API, no overlays on real
    covers, no real cover as avatar or prize, odds disclosed for every random draw, nothing sold for real money.
11. **Keep the current look** (`DESIGN-OVERRIDE.md`). Fonts stay Archivo (titles, 800–900, wide), Figtree (text) and Martian Mono
    (labels, counters, `AM-xxx` codes); no new family, no serif. Palette stays the plum ink (`--ink`, `--stage*`, `--line*`), ivory
    `--paper`, `--haze`, teal `--cue`, `--gold` and the rarity colours. The logo (colour disc + white « Album » + orange→red « Mania »),
    ivory pill primary buttons, ghost buttons, top-bar counter pills (boosters, royalties), rounded panels (14/22 px) with their light
    gradient, the collection cards (rarity frames, holo, PROMO ribbon, vinyl back), the vinyl shelf, the turntable and the booster
    opening animation are kept. **The Home booster hero and the Boutique / Doublons / Blind test row stay literally as in
    `owner-reference-current-ui.webp`** (the hero is never turned into a sheet or a card and keeps its layout; the booster sheet of 2.2
    is only an extra shortcut); new Home blocks go below the hero and the row. Every new page or component
    must look as if it had always been part of this UI: reuse `.panel`, `.btn`, `.pill`, `.chip`, `.album-tile`, `.card`, `.eyebrow`,
    Archivo headings and the components listed in `design-system-current.md` before writing new CSS.
    Precedence when documents disagree: `DESIGN-OVERRIDE.md` > the legal rules of 7.1 > `design-system-current.md` (anything visual)
    > this plan (scope, data, API, file ownership).

---

## 1. Product vision and core loops

### 1.1 Positioning

AlbumMania turns a love of music into a **social collection game**: the Letterboxd of albums (rate, review, lists, friends first),
crossed with a Panini album (one card per track, 7 rarities, holo, album completion → vinyl), with Spotify-Wrapped-style statistics
(Passport, yearly "Rétro") and light discovery games (blind test in clue mode, album battles).
It never distributes music: listening goes through official links and click-to-load embeds.

Target first session (the owner's acceptance sentence): « Je veux créer mon compte, noter mes albums et commencer ma collection. »
→ sign up → verify → onboarding (genres, artists, 9 albums, 5 quick ratings) → first themed boosters → a Home that already shows
recommendations, a quest and suggested friends.

### 1.2 The four pillars and their loops

```
                 ┌─────────────────────────── DISCOVER ───────────────────────────┐
                 │ Discover sections · search · similar albums · battles ·        │
                 │ friends' activity · blind test · rankings · events             │
                 └──────┬──────────────────────────────┬──────────────────────────┘
                        │ finds an album / track       │ finds a person / list
                        ▼                              ▼
   ┌──────────── COLLECT ─────────────┐     ┌───────────── RATE ──────────────┐
   │ boosters (free regen, quests,    │────▶│ stars with halves or /10,       │
   │ levels, themed) → cards →        │     │ reviews, likes, replies,        │
   │ wishlist focus → album booster / │◀────│ track ratings → Deluxe vinyl    │
   │ pressing → album complete →      │     │ (complete + rate album + rate   │
   │ vinyl, Pressage n°, badge        │     │ all tracks)                     │
   └──────────────┬───────────────────┘     └───────────────┬─────────────────┘
                  │ completion, rare pull, badge             │ review, list, Mes 9 albums
                  ▼                                          ▼
                 ┌──────────────────────────── SHARE ────────────────────────────┐
                 │ feed (friends first) · posts with album/track/artist cards ·  │
                 │ Studio · Mes 9 albums image · Taste Match card · Passport ·   │
                 │ Rétro · notifications → friends come back → DISCOVER          │
                 └────────────────────────────────────────────────────────────────┘
```

Daily loop (5 minutes): open the free booster → claim/advance 3 daily quests (one collect, one rate, one discover) → vote in a few
battles → read friends' feed, like/reply. Weekly loop: weekly quests, a themed booster, an album completed, a list updated.
Seasonal loop: an event (two weeks), its set, its badge and frame. Yearly loop: Rétro.

### 1.3 How features connect (no feature island)

Every feature must take input from at least one other pillar and feed at least one other pillar.

| Feature | Fed by | Feeds |
|---|---|---|
| Boosters / cards | regen, quests, levels, onboarding, events | collection progress, quests, badges, feed (rare pull), Passport |
| Wishlist ("Albums recherchés") | album page, search, Discover | booster focus (25 % of slots), Studio block, friends' Studio, taste signals |
| Album completion | cards, album booster, pressing | vinyl shelf, Pressage n°, badge, feed, quest, Deluxe nudge (rate it), share card, Discover "à compléter" |
| Ratings / reviews | album/track pages, onboarding quick ratings, tracklist | rating_stats (community average, trending, rankings of "culte"), taste match, Discover, feed, quests, badges, Deluxe |
| Likes / replies | feed, review pages, posts, lists | notifications, feed engagement boost, badges (critique populaire) |
| Posts | composer on Home, album/track/artist pages, share buttons | feed, album page "Discussions", notifications |
| Lists + Mes 9 albums | album page "Ajouter à une liste", search, onboarding (9 albums) | Studio, search, album page "Listes qui le contiennent", taste match (favourite albums), share image, feed |
| Battles | Discover, Home widget, album page | rankings, quests, badges, XP, album page "Classements" |
| Taste match | ratings, favourites, collection | friend suggestions, profile figure, Home card, share card, Discover "très apprécié par tes amis" |
| Quests | every action above (computed from source tables) | XP, royalties, boosters, badges (assidu), Home chip |
| Badges | collection, rating, social, play | Studio trophy shelf, cosmetics, feed, notifications |
| Cosmetics | levels, badges, events, sets | Studio, showcase cards, share images |
| Discover | ratings, collection, friends, rating_stats, battles, events | album pages → collect/rate |
| Passport / Rétro | everything (read only) | share images, Studio stats block |
| Events | code calendar | quests, sets, battles category, themed booster, badge, frame |
| Search | catalogue, users, lists | every page |
| Notifications | likes, replies, friends, badges, moderation | brings the user back to the object |
| Moderation | reports from every UGC object | statements of reasons (notifications), suspension |

### 1.4 Product principles (apply to every screen)

1. The current "recording studio at night" identity: plum ink surfaces, ivory text and ivory pill buttons, teal `--cue` for links,
   focus and progress, `--gold` for completions and achievements; strong colour comes from covers, rarities, the booster and the logo.
   Unread counts use the existing `.count-badge` / `.dot-badge` (no new signal colour).
2. Archivo for titles and big numbers, Figtree for all reading text (reviews, posts, comments), Martian Mono for labels, counters and
   catalogue codes (fewer decorative uppercase mono labels where they hurt reading). Nothing under 12 px in the interface; card
   micro-labels ≥ 10 px, hiding elements on very small cards rather than shrinking them.
3. Progressive disclosure: one "?" per concept, no manual-style hint boxes, a one-line footer.
4. Progress is measured against what the player started (wishlist, next album, this week), never "0,1 % of 240 261".
5. Friends first, then the AlbumMania community, on every social surface.
6. Motion rewards (reveal, completion, like), it never decorates. Reduced motion respected everywhere.
7. Ludique sans être enfantin, never casino: no paid randomness, no fake scarcity, no streak punishment, odds always disclosed.

### 1.5 Names (FR / EN) fixed by this plan

| Concept | FR | EN | Code |
|---|---|---|---|
| Home (booster hero on top) | Accueil | Home | `/` |
| Profile | Mon Studio / Studio de @x | My Studio / @x's Studio | `/studio`, `/u/:username` |
| Pack | Booster | Booster (EN UI keeps "pack" where it says so today) | `packs`, `bonus_packs`, `user_boosters` |
| Soft currency | **royalties** (unchanged) | **royalties** | `users.royalties` |
| Completed album trophy | Vinyle | Vinyl | `achievements.key = 'album:<id>'` |
| Nth player to complete | Pressage n° 37 | Pressing #37 | `achievements.rank` |
| Album + album rating + all tracks rated | Édition deluxe | Deluxe edition | `achievements.key = 'deluxe:<id>'` |
| Wishlist | Albums recherchés | Wanted albums | `lists.kind = 'wishlist'` |
| 3×3 favourite albums | Mes 9 albums | My 9 albums | `lists.kind = 'grid9'` |
| Collection book | Coffret | Box set | `sets` |
| Yearly recap | AlbumMania Rétro 2026 (never "Replay", "Wrapped") | AlbumMania Rétro 2026 | `/retro/:year` |
| Statistics page | Passeport musical | Music passport | `/passport` |
| Ranking duel | Battle | Battle | `battle_votes` |

The currency keeps its name **royalties** (owner decision, 2026-10-06; no « Sillons » rename anywhere: names table, i18n, icons).
The legal separation the brief asks for is handled by wording instead (section 7.1): the interface never glosses royalties as
« droits d'auteur » (the one string that does, `home.royaltiesHint`, is overridden in P0-B), and the footer and rarity guide state that
royalties are an AlbumMania game currency with no link to artists' rights.

---

## 2. Information architecture

### 2.1 Routes

All private routes render inside the shell (top bar, tab bar on phones). Guest routes render without the shell.
`client/src/routes.jsx` (created by the P0 kick-off K0, section 9.1; owned by P0-D in P0) declares every route below from day one.
Pages are resolved by file name, so a page that belongs to a later level renders `NotFound` until its workstream creates the file,
and **no navigation entry points to it before it works**.

| Path | Page file (`client/src/pages/`) | Level | Who sees it | Nav entry / back target |
|---|---|---|---|---|
| `/` | `Home.jsx` (booster hero + row unchanged on top, social blocks below) | P0 tokens only, P1 feed below the row | logged in | tab Accueil (the Boosters tab and the packs pill open the booster sheet shortcut) |
| `/search?q=&type=` | `SearchPage.jsx` | P0 | logged in | top-bar search "Voir les N résultats" |
| `/discover` | `Discover.jsx` | P0 hub (P0-D), P1 full (P1-E) | logged in | tab Découvrir |
| `/collection`, `/collection/:tab` (`albums`, `cards`, `artists`, `promos`, `genres`, `decades`, `sets` P2) | `Collection.jsx` | existing | logged in | tab Collection |
| `/album/:id` | `AlbumPage.jsx` | existing, P0 restyle, P1 v2 | logged in | back = history, fallback Collection |
| `/track/:id` (id URL-encoded, contains `:`) | `TrackPage.jsx` | P0 | logged in | back = history, fallback album |
| `/artist/:id` | `ArtistPage.jsx` | existing | logged in | back = history |
| `/studio` | `Profile.jsx` (self) | P0 restyle, P1 Studio | logged in | tab Studio |
| `/profile` | redirect → `/studio` | P0 | — | — |
| `/u/:username`, `/u/:username/:tab` (`reviews`, `lists`, `vinyls`, `badges`, `posts`) | `Profile.jsx` | P1 tabs | logged in | from any avatar/name |
| `/u/:username/nine` | `GridEditor.jsx` (read mode) | P1 | logged in | Studio block |
| `/nine` | `GridEditor.jsx` (edit my 9 albums, my9games-like) | P1 | logged in | Studio block, Lists, onboarding |
| `/friends` | `Friends.jsx` | existing, P0 member search, P1 suggestions | logged in | Studio header, account menu, bell (requests) |
| `/notifications` | `Notifications.jsx` | P0 (friend requests, moderation notices), P1 social kinds | logged in | bell |
| `/post/:id` | `PostPage.jsx` | P1 | logged in (visibility rules) | feed item, notification |
| `/review/:id` | `ReviewPage.jsx` | P1 | logged in | review card "N réponses", notification |
| `/lists` | `Lists.jsx` (mine, friends', popular) | P1 | logged in | Discover, Studio |
| `/lists/new`, `/list/:id/edit` | `ListEditor.jsx` | P1 | owner | Lists, "Ajouter à une liste" |
| `/list/:id` | `ListPage.jsx` | P1 | visibility rules | search, Studio, album page |
| `/battles` | `Battles.jsx` | P1 | logged in | Discover, Home widget, album page |
| `/rankings`, `/rankings/:category` | `Rankings.jsx` | P1 | logged in | Discover, Battles, album page |
| `/match/:username` | `TasteMatch.jsx` | P1 | logged in, not blocked | Studio of another user, user cards, Home card |
| `/quests` | `Quests.jsx` | P1 | logged in | Home quest chip, account menu |
| `/badges` | `Badges.jsx` (own: earned + progress) | P1 | logged in | Studio trophy shelf, account menu |
| `/welcome` | `Onboarding.jsx` | P1 | logged in, once | automatic after first verify; Settings "Refaire mon profil musical" |
| `/settings` | `Settings.jsx` | P0 (incl. blocked members, export, deletion), P1 Studio privacy | logged in | account menu |
| `/passport`, `/u/:username/passport` | `Passport.jsx` | P2 | logged in (privacy rules) | Studio stats block, Discover |
| `/retro/:year` | `Retro.jsx` | P2 | logged in | Home chip in December–January, Passport |
| `/events`, `/events/:slug` | `Events.jsx` | P2 | logged in | Home event chip, Discover |
| `/sets/:id` | `SetPage.jsx` | P2 | logged in | Collection tab Coffrets, events |
| `/blindtest` | `BlindTest.jsx` | existing | logged in | Discover |
| `/admin`, `/admin/:tab` (`overview`, `moderation` P0, `catalog`, `covers`, `tools`) | `Admin.jsx` (lazy) | existing, P0 moderation | owner only | account menu |
| `/legal/:page` (`mentions`, `terms`, `privacy`, `rules`, `cookies`) | `Legal.jsx` | P0 | everyone (guest too) | footer, signup, Settings |
| `/report` | `Report.jsx` (public notice form, DSA art. 16) | P0 | everyone (guest too) | footer, Legal pages, "Signaler" when logged out |
| `/login` `/signup` `/check-email` `/verify` `/forgot` `/reset` | `Auth.jsx` | existing | guests (verify/reset also logged in) | — |
| `/dev/mailbox` | `Mailbox.jsx` | existing | only when the server says `devMailbox` | — |
| `*` | `NotFound.jsx` ("Cette face n'existe pas" + search) | P0 | — | — |

Login keeps the requested page: the guest catch-all stores `state.from`, and `Login` navigates to it after success (bug fix, P0-D).

### 2.2 Navigation

This section follows `design-system-current.md` §4.14 (the design reference). The bars keep their current look (`.topbar`,
`.topnav__link`, `.pill`, `.tabbar__link`, `.count-badge`, `.dot-badge`, blurred ink top bar, breakpoint 860 px); only the items change.

**Desktop / tablet top bar (≥ 860 px, sticky, blurred ink, unchanged height):**
logo (disc + « Album » + « Mania » gradient) → nav **Accueil · Découvrir · Collection · Studio** → global search (inline field
`.gsearch` from 1080 px, 180–360 px wide, placeholder « Album, morceau, artiste… », `/` and Ctrl/⌘ K focus it; 860–1079 px: search icon
opening the same panel) → **`.pill--packs`** (unchanged look: stock + countdown; opens the booster sheet shortcut) →
**`.pill--royalties`** (unchanged) → **bell** (`.icon-btn` + `.count-badge`: unread notifications) → avatar (unchanged; its
`.dot-badge` shows pending friend requests, as today) → account menu. The FR/EN switch and the sound toggle leave the bar (they already
exist in the account menu); their slot is where the search goes. Amis move to the Studio header and the account menu. Blind test
moves to Découvrir and stays one tap away in the Home row.

**Account menu (unchanged style):** header (avatar, @handle, level, royalties) → Mon Studio · Amis (count) · Quêtes (P1) · Badges (P1)
· Paramètres · Langue (segmented FR/EN, as today) · Échelle de notation (as today) · Effets sonores (as today) · Admin (owner only) ·
Se déconnecter. The duplicate "Mon profil & Studio" link is removed. The demo-only "unlock admin" item stays (`__DEMO__` only).

**Booster sheet (a shortcut, not a replacement).** `.sheet` (480 px modal on desktop, bottom sheet on phones, `design-system-current`
§4.13): a small hero (the real `.pack` at 96 px, « N boosters disponibles », mono timer), the ivory « Ouvrir un booster », rows
« Acheter un booster · 120 » and « Recycler N doublons », and the admin « Ouvrir ×10 ». It opens the unchanged `PackOpening` overlay
through the same booster flow as the Home hero. **The Home hero and the Boutique / Doublons / Blind test row stay exactly where and as
they are and remain the main entry** (`DESIGN-OVERRIDE.md`); the sheet only saves a trip to Home from other pages.

**Phone (< 860 px):**
- Top bar (current height, opaque): logo (scaled down under 400 px, never hidden) · search icon (opens the full-screen
  `.search-sheet`) · bell · avatar. The packs pill stays between 641 and 859 px; at ≤ 640 px its count moves to the Boosters tab.
  Royalties show in the booster sheet and the account menu head (they are already hidden at ≤ 640 px today).
- **Bottom tab bar** (current `.tabbar` style: icon + label, opaque `--ink`, 5 columns, 12 px labels, safe-area padding):
  **Accueil · Découvrir · Boosters · Collection · Studio**. Boosters is a normal tab whose icon is a miniature of the real booster
  (`.mini-pack`) with an ivory mono count chip when boosters are ready (greyed when none); a tap opens the booster sheet. No raised
  disc, no FAB. The Studio icon carries the `.dot-badge` for friend requests. `app.css` changes the grid from `repeat(4, 1fr)` to
  `repeat(5, 1fr)` (P0-B).
- Blind test, Battles, Classements, Listes, Passport, Événements live in **Découvrir** (Blind test also stays in the Home row).
  Amis live in the Studio header and the account menu. Notifications: the bell opens `/notifications` on phones (a dropdown on desktop).
  Quests: the status row under the Home row (P1).

### 2.3 Reachability matrix (every feature, every entry point)

| Feature | Primary entry | Secondary entries |
|---|---|---|
| Open a free booster | Home booster hero « Ouvrir un booster » (unchanged, main entry) | booster sheet from the Boosters tab (phone) or the packs pill (desktop) |
| Bought / bonus boosters | Home booster hero (counted in « N boosters disponibles », as today) | booster sheet, blind test result « Ouvrir mes boosters » |
| Themed / special boosters P1 | Home « Boosters spéciaux » panel, shown under the row only when the inventory is not empty | quest reward toast « Ouvrir », onboarding result |
| Album booster | album page primary action (unchanged) | « Presque complets » rows on Home (link to the album) |
| Buy a booster | Home Boutique panel (unchanged) | booster sheet row « Acheter un booster » |
| Recycle duplicates | Home Doublons panel (unchanged) | booster sheet row, Collection Cartes tab toolbar « Recycler les doublons · +N » |
| Press a missing card | track row chip / card modal / track page | album page batch "Presser les 4 manquantes" |
| Vernir (holo) P2 | card modal / track page (owned std card) | — |
| Wishlist P1 | album page toggle "Recherché" | album tiles (Collection, search page), Studio block edit |
| Collection tabs | tab Collection | Studio stats links |
| Sets P2 | Collection tab Coffrets | event page, Discover |
| Album / track / artist pages | search, tiles, rows | feed object cards, lists, rankings, notifications |
| Rate / review | album & track pages | tracklist stars, onboarding, card modal, Discover cards (quick rate) |
| Review permalink + replies P1 | "N réponses" on a review card | notification, feed |
| Posts P1 | Home composer | "Publier" on album/track/artist pages, "Partager" on reviews/lists/completion |
| Likes / comments P1 | every post/review/list/comment | — |
| Notifications P0 (friend requests, moderation), P1 social | bell | — |
| Friends | Studio header « N amis » | account menu, bell (requests), avatar dot, search (members), suggestions on Home/Friends (P1) |
| Taste match P1 | another Studio "Comparer nos goûts" | user cards in search/friends ("87 %"), Home card |
| Lists P1 | Discover "Listes" | Studio tab, album page "Ajouter à une liste" / "Listes qui le contiennent", search |
| Mes 9 albums P1 | Studio block | onboarding step 3, Lists page, Discover tile |
| Battles P1 | Discover tile | Home widget, album/track page "Classements", quest |
| Rankings P1 | Discover / Battles | album page "Classements" |
| Quests P1 | Home status row (quest chips, under the booster row) | account menu, reward toasts |
| Badges P1 | Studio trophy shelf | account menu, badge toast, notification |
| Cosmetics P1 | Studio "Modifier le Studio" | level-up toast, badge page |
| Passport P2 | Studio stats block | Discover tile |
| Rétro P2 | Home chip (Dec–Jan) | Passport |
| Events P2 | Home event chip | Discover |
| Blind test | Home Blind test panel (unchanged) | Discover tile, quest (if rolled) |
| Settings | account menu | — |
| Legal pages | footer | signup checkbox, Settings |
| Report (public form) P0 | footer | Legal pages, « Signaler » menu on every piece of UGC |
| Admin | account menu (owner) | — |
| Onboarding P1 | automatic once | Settings |

### 2.4 Today's Home ("Boosters" page): what stays and what changes

The owner's precision (`DESIGN-OVERRIDE.md`): « même le booster garde comme il l'est sur le screenshot ». Nothing above the fold moves.

| Today on Home | After P0 | After P1 |
|---|---|---|
| Pack hero (`PackArt`, « ALBUMMANIA PACK · 5 MORCEAUX », « N boosters disponibles », stock line, « Comment marchent les raretés ? », ivory « Ouvrir un booster », admin « Ouvrir ×10 ») | **unchanged** (tokens only) | **unchanged** |
| Row Boutique / Doublons / Blind test | **unchanged** (empty Doublons copy fixed: no promise of trading) | **unchanged** |
| PackOpening overlay | unchanged (driven by the existing flow) | unchanged |
| "Albums en cours" shelf | stays, below the row | becomes the « Presque complets » aside of the feed layout (desktop) / section (phone) |
| "Deux façons de finir un album" | stays | moves into the rarity guide « ? » (progressive disclosure) |
| "Derniers morceaux obtenus" | stays | stays (also a Studio block) |
| Discover teaser shelf | stays | « Pour toi » feed tab + Discover page |
| Friends' ratings feed | stays, restyled, with an empty state « Le studio est calme · Trouver des amis » | full feed (composer + tabs) below the row |
| Rarity guide button | stays in the hero | stays |
| (new) Booster sheet | shortcut from the Boosters tab and the packs pill; the hero and row stay the main entry | unchanged |

### 2.5 Page compositions

Each page is built from the tokens and components of `design-system-current.md` and reuses the classes that exist today (`.panel`,
`.btn`, `.pill`, `.chip`, `.album-tile`, `.card`, `.eyebrow`, Archivo `h1`/`h2`, `.page-head`); this section fixes **content and order**.

**Home (`/`)**
1. **Booster hero, literally as today** (`owner-reference-current-ui.webp`): pack art left, eyebrow « ALBUMMANIA PACK · 5 MORCEAUX »,
   Archivo title « N boosters disponibles », stock line, « Comment marchent les raretés ? », ivory pill « Ouvrir un booster »
   (+ « Ouvrir ×10 » for the admin). The hero gets `id="booster"` (anchor for links such as « Ouvrir mes boosters »). Nothing else
   changes in it.
2. **Row Boutique / Doublons / Blind test, literally as today** (`id="boutique"` on the Boutique panel).
3. « Boosters spéciaux » panel (P1-D), only when the player holds themed or album boosters (`user_boosters`), same `.panel` style.
4. Status row (P1-F, `.status-row`, max 3 chips; one scrolling line on phones): quest chips (`.quest-chip` with its progress ring,
   « Quête du jour · Note 3 albums · 1/3 »), event chip and Rétro chip (P2-B). `design-system-current` §4.8 says « under the hero »:
   per the override it goes under the hero **and** its row.
5. Feed: P0 = existing friends' ratings, restyled with tokens, with an empty state « Le studio est calme · Trouver des amis ».
   P1 = composer + tabs **Tes amis · Pour toi · Communauté** + infinite list (P1-A).
6. Aside (≥ 1080 px; stacked after the feed's first page on phones): Presque complets (3 rows with track segments, replaces
   "Albums en cours"), Taste Match card (P1-E, best-matching friend), Battle widget (P1-F), suggested friends (P1-E, when < 3 friends).
7. "Derniers morceaux obtenus" card row (existing).

**Album (`/album/:id`)** (brief order; P0 restyles what exists, P1 adds the rest)
1. Header: the current `.album-head` (soft gradient from the album palette, as on `.panel`), cover (disc peeking when completed,
   as today), eyebrow "Album · Électro · 2001 · 14 morceaux", Archivo `h1` title, artist link + mastery chip, "13/14" with clickable track segments, actions: `Booster d'album` (primary),
   `Presser · N` (secondary), `Recherché` toggle (P1), `Ajouter à une liste` (P1), `Partager` (P1, completed only).
   `ListenPanel` (click-to-load Deezer widget + official links).
2. Completion line (P1): "Complété le 4 oct. 2026 · Pressage n° 37" and "Complété par 214 joueurs · 3 amis"
   (P2 adds "Édition deluxe : note les 3 morceaux restants").
3. Tracklist (default view, `TrackRow`, my stars per track, press chips) with the `Titres / Cartes` segmented control.
   Desktop ≥ 1080 px: tracklist on the left two thirds, friends' reviews on the right third.
4. Ma note (review editor).
5. Notes de tes amis (avatars + stars).
6. Note de la communauté (Archivo average, count, the existing `RatingHistogram`).
7. Critiques de tes amis.
8. Critiques de la communauté (sort Récentes / Populaires, cursor pagination) (P1).
9. Discussions: posts that mention this album + "Publier à propos de cet album" (P1).
10. Statistiques: completion count, ratings, average of friends (P1).
11. Albums similaires (P1).
12. Autour de l'album: rankings where it appears + "Voter" (P1), lists that contain it (P1).

**Track (`/track/:id`)** (P0 core, P1 social blocks)
Header (240 px cover, eyebrow "Morceau · piste 6 · Discovery" (album link), Archivo title, artist, year, `RarityGem` + label, the
existing popularity icon) → my card (the existing `Card` at its large size; ghost card + `Presser · N` when missing; `Vernir` P2) → `ListenPanel` (track widget) → my rating →
friends' scores → community summary → friends' reviews → community reviews → discussions (P1) → "Meilleur morceau de l'album"
battle CTA (P1) → other tracks of the album (`TrackRow` list). Facts: "Obtenue le 21 sept. 2026 · booster du jour", copies owned,
"Possédée par 1 284 joueurs · 3 amis".

**Studio (`/studio`, `/u/:username`)** (P0 restyle, P1 redesign)
Header: the current `.profile-head` (avatar with its frame cosmetic, Archivo name, @handle, title cosmetic, bio ≤ 280, the existing
level bar), "N amis", Taste Match figure
(others), actions (Ajouter / Ami ✓ / Demande envoyée · Comparer nos goûts · ⋯ Signaler / Bloquer), "Modifier le Studio" (self).
Tabs: Vue d'ensemble · Critiques · Listes · Vinyles · Badges · Posts.
Overview blocks (each can be hidden and reordered in edit mode; defaults in this order): Mes 9 albums (+ Partager) · Vitrine
(showcase cards, 6 slots +1 at levels 10 and 30) · Vinyle mis en avant + vinyl shelf · Trophées (8 medals) · Albums recherchés ·
Artistes favoris · Morceaux favoris · Critiques récentes · Listes épinglées (≤ 3) · Derniers morceaux obtenus · Activité récente ·
Statistiques (mini Passport, link to `/passport` in P2). Privacy: `public` (all logged-in users), `friends` (others see header only),
`private` (header only). Reviews stay visible on album pages whatever the setting (published contributions).

**Discover (`/discover`)**
P0 hub: Albums populaires shelf, Par genre chips (→ `/collection/albums?genre=`), Par décennie chips, Blind test tile, search CTA.
P1: personalised sections (section 5.5) + tiles Battles · Classements · Listes · Mes 9 albums · Blind test (+ Passport, Événements,
Coffrets in P2). Each section has a one-line reason ("Parce que tu as aimé Discovery").

**Collection (`/collection/:tab`)**
The current `.page-head` with `h1` "Collection" + one progress line "214 cartes · 12 albums commencés · 2 complétés · Stats" (Stats opens a sheet with the
global totals, rarity bar and the rarity guide). Tabs Albums · Cartes · Artistes · Promos · Genres · Décennies (Genres/Décennies move
into the Passport in P2, the tabs then redirect) · Coffrets (P2). Filters: inline bar on desktop, one "Filtres" button opening a sheet
on phones. Albums tab: `SearchCombobox` (the owner's request) above the grid. Phone card grid: 2 columns (3 between 520 and 640 px).

**Search results (`/search`)**: field + category tabs Tout · Albums · Morceaux · Artistes · Membres · Listes with counts; "Tout" shows
the groups; typed tabs paginate (24 per page, infinite scroll); albums as a tile grid, others as rows.

**Notifications (`/notifications`)** (P0-F, social kinds in P1): grouped rows ("Camille et 3 autres ont aimé ta critique de Discovery"), unread first-class,
"Tout marquer comme lu", tap → object.

**Friends (`/friends`)**: tabs Amis · Demandes (count) · Suggestions (P1); member search (global search scoped to users, P0-E); each row =
`UserCard` with Taste Match figure (P1).

**Lists (`/lists`)**: tabs Mes listes · Amis · Populaires; "Nouvelle liste"; "Mes 9 albums" pinned card.
**List page (`/list/:id`)**: title, owner, description, ranked numbers or grid, like, comments, share, "Copier dans mes listes" (P2).
**List editor**: title, description, ranked switch, visibility (Publique / Amis / Privée), add via search combobox (albums/tracks),
drag to reorder (keyboard: ↑/↓ buttons), note per item (≤ 280), ≤ 250 items.
**Mes 9 albums editor (`/nine`)**: my9games-style. 3×3 grid of slots; tap a slot → search sheet (albums) → pick; drag to swap; title
"Mes 9 albums" (editable); format chooser 4:5 / carré / story; theme Encre / Papier (both from the current palette, `design-system-current` §4.6); "Générer l'image" → preview → Partager /
Télécharger. Footer of the image: "AlbumMania" wordmark (no URL yet). Read mode at `/u/:username/nine`.

**Battles (`/battles`)**: one duel at a time: two covers, titles, artist, year; "Je préfère" under each; "Je ne connais pas l'un des
deux" (skip); context label ("Meilleur album de Daft Punk"); after the vote, the two rating deltas animate and the next duel slides in;
daily counter "12 votes aujourd'hui · +60 XP"; links "Écouter" → album page (never an embed inside the battle).
**Rankings (`/rankings/:category`)**: hub of categories (Global, Décennies, Genres, Années, Pays (when data exists), Artistes) and a
ranked list with votes and "provisoire" badges under 50 votes.

**Taste match (`/match/:username`)**: big "87 %" (Archivo 900), confidence, components bars with plain explanations, shared albums,
shared artists, shared tracks, genres in common, "Différences intéressantes", "@x te recommande" and "Tu recommandes à @x",
Partager (share card).

**Quests (`/quests`)**: Du jour (3 + bonus booster when all claimed, 1 free reroll a day) · De la semaine (3 + themed booster) ·
Événement (P2) · Premiers pas (onboarding line, until done). Each quest: progress ring, reward, "Réclamer".

**Badges (`/badges`)**: medal grid by family; earned with date; locked with progress "7/10".

**Passport (`/passport`)** P2: totals, favourites (artist, best-rated album, genre), distributions (genres, decades, countries,
rarities), timeline (cards, ratings, completions per month), taste evolution, share card.

**Onboarding (`/welcome`)** P1: 5 steps, skippable at each: genres (≥ 3 of 14) → artists (3–10) → 9 albums (becomes Mes 9 albums)
→ 5 quick ratings (stars or "Pas écouté") → result: musical profile, first recommendations, suggested friends, welcome boosters
skewed to the chosen genres, first quest line.

**Settings (`/settings`)**: Langue · Échelle de notation · Son · Plateforme d'écoute préférée (Deezer / Spotify / Apple Music) ·
Lecteurs intégrés (reset "Toujours charger") · Membres bloqués · Exporter mes données · Supprimer mon compte (P0-F) ·
P1: Confidentialité du Studio (P1-B) · Refaire mon profil musical (P1-E) · Liens légaux · Se déconnecter.

**Legal (`/legal/:page`)**: mentions légales (editor, host, contact from server config), CGU, confidentialité, règles de la
communauté, cookies. Footer line on every page: "Données et pochettes : Deezer · AlbumMania n'est affilié à aucun artiste, label
ni plateforme · Mentions".

---

## 3. Global database schema (designed once for P0–P3)

The DDL below is **validated**: `design/schema-proto/schema.mjs` + `run.mjs` apply it (a) to a database created with the HEAD
schema and (b) to a copy of the populated perf database (5,000 users, 786k cards, 341k ratings, 50k friendships, 20,020 albums,
240,261 tracks). Copy it from `schema.mjs` rather than retyping it. P0-A puts all of it in `server/db.js` in P0, including the tables
that only later levels use, so no later workstream needs a schema change.

### 3.1 Conventions

- **Ids:** users, posts, comments, lists, reports… are `INTEGER PRIMARY KEY`. Catalogue entities keep their TEXT ids (`discovery`,
  `dz1000001`, `discovery:01`). New catalogue rows created by a non-Deezer source (P2-C) get neutral ids `al_<base36>`, `tr_…`,
  `ar_…` from `shared/ids.js`; provider ids live in `external_ids`.
- **Timestamps:** ms since epoch, INTEGER. Day and week boundaries for quests and stats use **Europe/Paris** (`shared/periods.js`).
- **Polymorphic references** use `(target_type TEXT, target_id …)` with a CHECK on the type. `target_id` is INTEGER when every possible
  target has an integer id (comments, likes: post, review = `ratings.id`, comment, list) and TEXT when catalogue ids are possible
  (notifications, activity, reports, external_ids). Integrity of polymorphic references is enforced in code: the service that deletes
  a target calls `purgeTarget(type, id)` (P0-F, `server/moderation.js`) which removes likes, comments, notifications and activity rows pointing to it.
- **Counters** (`like_count`, `comment_count`, `reply_count`, `item_count`, `users.unique_cards`) are denormalised and updated in the
  same transaction as the row they count. Account deletion recomputes the counters of the targets the user liked or commented.
- **Soft vs hard delete:** content deleted by its author is **hard-deleted** (with its likes, replies, notifications, activity).
  A comment with replies is soft-deleted (`deleted_at`, body replaced by "Commentaire supprimé" on read). Content removed by
  moderation is **hidden** (`hidden_at`) and kept as evidence; `moderation_actions.snapshot` keeps a copy independent of the content.
- **JSON** lives in TEXT columns, always written with `JSON.stringify` and read with a try/catch `parse` that falls back to the default.
- **Visibility values** everywhere: `public` (any logged-in user), `friends`, `private`.

### 3.2 Migration mechanism (replaces the add-column-only `MIGRATIONS`)

`server/db.js` gets four ordered parts. The existing `MIGRATIONS` array becomes `COLUMNS` (its two entries are kept first).

```js
export function openDb(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
           PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY; PRAGMA mmap_size = 268435456; PRAGMA cache_size = -32000;`);
  db.exec(SCHEMA);            // 1. CREATE TABLE IF NOT EXISTS only (old tables, ratings in its v2 shape, every new table). No indexes.
  addColumns(db, COLUMNS);    // 2. idempotent ALTER TABLE … ADD COLUMN (PRAGMA table_info check), constant defaults only, no CHECK
  runSteps(db, STEPS);        // 3. ordered one-time data/structure steps, PRAGMA user_version = step.v after each
  db.exec(INDEXES);           // 4. every CREATE [UNIQUE] INDEX IF NOT EXISTS, after the columns they need exist
  db.exec('PRAGMA optimize = 0x10002');
  return db;
}

function runSteps(db, steps) {
  for (const step of steps) {
    if (db.prepare('PRAGMA user_version').get().user_version >= step.v) continue;
    if (step.fkOff) db.exec('PRAGMA foreign_keys = OFF');        // must be outside the transaction
    db.exec('BEGIN IMMEDIATE');
    try { step.run(db); db.exec(`PRAGMA user_version = ${step.v}`); db.exec('COMMIT'); }
    catch (err) { db.exec('ROLLBACK'); throw err; }
    finally {
      if (step.fkOff) {
        if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error(`foreign_key_check failed after ${step.name}`);
        db.exec('PRAGMA foreign_keys = ON');
      }
    }
  }
}
```

Rules:
- Every step **detects its own state** and is a no-op on a fresh database (fresh databases already have the v2 shapes). It still bumps
  `user_version`, so the version is identical on fresh and migrated databases.
- A step that needs an index creates it itself (`CREATE INDEX IF NOT EXISTS`) because `INDEXES` runs after the steps.
- Steps are **append-only**. A later level that really needs a schema change appends `v10+` through that level's schema owner
  (P1: P1-D, P2: P2-C). Never edit a released step.
- The search index is not a step: `server/search.js` builds it at boot when `kv['search:version']` differs from its
  `SEARCH_VERSION` (≈ 8 s for 268k documents, once).
- `scripts/purge-catalog.js` keeps working (it must also delete `search_docs`/FTS rows, `external_ids`, `set_albums`, `list_items` and
  `rating_stats` of the purged items; P0-E). P2-C replaces it with `scripts/detach-provider.js` (section 7.1).

Measured one-time migration on the populated perf copy: ratings rebuild 2.4 s, rating_stats 0.4 s, user_album_progress 4.7 s,
unique_cards 0.1 s, ranks 0.05 s, external ids 0.7 s, rarity freeze 3.5 s, indexes 2.6 s: **15 s total, once**; a real production
database is much smaller. A second boot costs 1 ms.

### 3.3 Changes to existing tables

**`ratings` gets a surrogate id** (likes, replies and permalinks need a stable review id; `VACUUM` can renumber implicit rowids).
`SCHEMA` declares the v2 shape; step v1 rebuilds old databases. `ON CONFLICT (user_id, item_type, item_id)` in existing code keeps
working because the triple becomes a UNIQUE constraint.

```sql
CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('album','track')),
  item_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
  review TEXT,
  review_at INTEGER,
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  hidden_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, item_type, item_id)
);
```

New columns on existing tables (`COLUMNS`, idempotent `ADD COLUMN`):

| Table.column | Type / default | Purpose | First used by |
|---|---|---|---|
| `users.bio` | TEXT | Studio bio (≤ 280, validated in code) | P1-B |
| `users.onboarded_at` | INTEGER | NULL = show onboarding; step v8 sets it for existing users | P1-E |
| `users.terms_accepted_at`, `users.terms_version` | INTEGER, TEXT | CGU + "15 ans ou plus" consent (section 7.1) | P0-A |
| `users.profile_visibility` | TEXT 'public' | `public` / `friends` / `private` | P1-B |
| `users.studio` | TEXT '{}' | JSON `{blocks:[{id,on}], featuredVinyl, featuredLists:[ids]}` | P1-B |
| `users.cosmetics` | TEXT '{}' | JSON selected `{frame, vinyl, theme, title}` | P1-D/B |
| `users.prefs` | TEXT '{}' | JSON `{listen:'deezer'\|'spotify'\|'apple', emailDigest:false}` | P0-A |
| `users.suspended_until`, `users.suspension_reason` | INTEGER, TEXT | moderation suspension (read-only account until then) | P0-F |
| `users.pity` | INTEGER 0 | boosters since the last ultra-or-better hit (soft pity) | P1-D |
| `users.unique_cards` | INTEGER 0 | distinct tracks owned; kills the per-row COUNT in `summary()` / `listFriends` | P0-A |
| `users.avatar_color` (existing) | value `'auto'` | step v7 turns the old default `#ff4f7e` into `auto` = deterministic colour from the user id | P0-A/B |
| `achievements.rank` | INTEGER | "Pressage n°": Nth player to complete that album (set on insert, step v5 backfills) | P0-A |
| `achievements.data` | TEXT | optional JSON (badge tier details) | P1-F |
| `cards.pulled_rarity` | TEXT | rarity at the time of the pull ("1re édition" stamp if a yearly re-rate happens) | P1-D |
| `cat_artists.status`, `cat_albums.status`, `cat_tracks.status` | TEXT 'active' | `active` / `withdrawn` (provider detached: hidden from browsing and boosters, kept in collections) | P2-C |
| `cat_artists.country_source` | TEXT | `seed` / `musicbrainz` / `manual` | P2-C |
| `cat_albums.cover_blocked` | INTEGER 0 | per-album cover takedown: generated art everywhere at once | P0-F (admin), P0-B (CoverArt honours it) |
| `cat_tracks.rarity_locked`, `cat_tracks.rarity_edition`, `cat_tracks.pop_source` | INTEGER 0, INTEGER, TEXT | rarity freeze (step v9 locks every existing track) | P1-D |

`friendships.status` gains the value `'declined'` (addressee declined; keeps the row for a 7-day cool-down; the requester's
"cancel" still deletes the row). No column change.

Kept as they are: `sessions`, `email_tokens`, `pack_openings` (gains `source` values `theme`, `album-pack`, `quest`, read by quests and
"Revoir l'ouverture"), `blindtest_games`, `cat_search` (still used by `/catalog/albums?q=` until P2-E retires it), `import_artists`,
`kv` (also stores `secret` for signed battle tokens, `search:version`, `battle:featured:<day>`), `covers`, `previews`, `dev_emails`.

Exact `COLUMNS` list (copy into db.js):

```js
export const COLUMNS = [
  ['users', 'rating_scale', "ALTER TABLE users ADD COLUMN rating_scale TEXT NOT NULL DEFAULT 'stars'"],
  ['users', 'signup_secret', 'ALTER TABLE users ADD COLUMN signup_secret TEXT'],
  ['users', 'bio', 'ALTER TABLE users ADD COLUMN bio TEXT'],
  ['users', 'onboarded_at', 'ALTER TABLE users ADD COLUMN onboarded_at INTEGER'],
  ['users', 'terms_accepted_at', 'ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER'],
  ['users', 'terms_version', 'ALTER TABLE users ADD COLUMN terms_version TEXT'],
  ['users', 'profile_visibility', "ALTER TABLE users ADD COLUMN profile_visibility TEXT NOT NULL DEFAULT 'public'"],
  ['users', 'studio', "ALTER TABLE users ADD COLUMN studio TEXT NOT NULL DEFAULT '{}'"],
  ['users', 'cosmetics', "ALTER TABLE users ADD COLUMN cosmetics TEXT NOT NULL DEFAULT '{}'"],
  ['users', 'prefs', "ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}'"],
  ['users', 'suspended_until', 'ALTER TABLE users ADD COLUMN suspended_until INTEGER'],
  ['users', 'suspension_reason', 'ALTER TABLE users ADD COLUMN suspension_reason TEXT'],
  ['users', 'pity', 'ALTER TABLE users ADD COLUMN pity INTEGER NOT NULL DEFAULT 0'],
  ['users', 'unique_cards', 'ALTER TABLE users ADD COLUMN unique_cards INTEGER NOT NULL DEFAULT 0'],
  ['achievements', 'rank', 'ALTER TABLE achievements ADD COLUMN rank INTEGER'],
  ['achievements', 'data', 'ALTER TABLE achievements ADD COLUMN data TEXT'],
  ['cards', 'pulled_rarity', 'ALTER TABLE cards ADD COLUMN pulled_rarity TEXT'],
  ['cat_artists', 'status', "ALTER TABLE cat_artists ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"],
  ['cat_artists', 'country_source', 'ALTER TABLE cat_artists ADD COLUMN country_source TEXT'],
  ['cat_albums', 'status', "ALTER TABLE cat_albums ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"],
  ['cat_albums', 'cover_blocked', 'ALTER TABLE cat_albums ADD COLUMN cover_blocked INTEGER NOT NULL DEFAULT 0'],
  ['cat_tracks', 'status', "ALTER TABLE cat_tracks ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"],
  ['cat_tracks', 'rarity_locked', 'ALTER TABLE cat_tracks ADD COLUMN rarity_locked INTEGER NOT NULL DEFAULT 0'],
  ['cat_tracks', 'rarity_edition', 'ALTER TABLE cat_tracks ADD COLUMN rarity_edition INTEGER'],
  ['cat_tracks', 'pop_source', 'ALTER TABLE cat_tracks ADD COLUMN pop_source TEXT'],
];
```

### 3.4 New tables

```sql
-- ===== Catalogue provenance and search =====
CREATE TABLE IF NOT EXISTS external_ids (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('artist','album','track')),
  entity_id   TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('deezer','spotify','apple','musicbrainz','wikidata','discogs','upc','isrc')),
  source_id   TEXT NOT NULL,
  url         TEXT,
  confidence  REAL NOT NULL DEFAULT 1,
  matched_by  TEXT NOT NULL DEFAULT 'import',
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_id, source, source_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS search_docs (
  id         INTEGER PRIMARY KEY,               -- = rowid in search_fts and search_tri
  kind       TEXT NOT NULL CHECK (kind IN ('album','track','artist','user','list')),
  ref_id     TEXT NOT NULL,                     -- catalogue id, or user/list id as text
  folded     TEXT NOT NULL,                     -- normalised name (shared/search.js normalize) for JS re-ranking
  weight     REAL NOT NULL DEFAULT 0,           -- popularity prior in [0,1]
  updated_at INTEGER NOT NULL,
  UNIQUE (kind, ref_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  name, context, k, content='', contentless_delete=1,
  tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);
CREATE VIRTUAL TABLE IF NOT EXISTS search_tri USING fts5(
  name, content='', contentless_delete=1,
  tokenize='trigram remove_diacritics 1'
);
CREATE VIRTUAL TABLE IF NOT EXISTS search_tri_vocab USING fts5vocab(search_tri, 'row');

-- ===== Rollups =====
CREATE TABLE IF NOT EXISTS rating_stats (
  item_type     TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  sum           INTEGER NOT NULL DEFAULT 0,
  review_count  INTEGER NOT NULL DEFAULT 0,
  dist          TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0]',
  last_rated_at INTEGER,
  PRIMARY KEY (item_type, item_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS user_album_progress (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id   TEXT NOT NULL,
  owned      INTEGER NOT NULL,
  holo       INTEGER NOT NULL DEFAULT 0,
  total      INTEGER NOT NULL,
  first_at   INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, album_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS user_stats_cache (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  data        TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS album_similar (
  album_id    TEXT NOT NULL,
  similar_id  TEXT NOT NULL,
  score       REAL NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('corated','artist','genre_decade')),
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (album_id, similar_id)
) WITHOUT ROWID;

-- ===== Profile and taste =====
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('artist','track','genre')),
  item_id    TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, item_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS taste_matches (
  user_a      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  confidence  TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  data        TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
) WITHOUT ROWID;

-- ===== Social =====
CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  item_type     TEXT CHECK (item_type IN ('album','track','artist','list','review')),
  item_id       TEXT,
  visibility    TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','friends')),
  like_count    INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  edited_at     INTEGER,
  hidden_at     INTEGER,
  created_ip    TEXT,
  CHECK ((item_type IS NULL) = (item_id IS NULL)),
  CHECK (length(body) > 0 OR item_type IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS comments (
  id               INTEGER PRIMARY KEY,
  target_type      TEXT NOT NULL CHECK (target_type IN ('post','review','list')),
  target_id        INTEGER NOT NULL,
  parent_id        INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reply_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body             TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  like_count       INTEGER NOT NULL DEFAULT 0,
  reply_count      INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  edited_at        INTEGER,
  deleted_at       INTEGER,
  hidden_at        INTEGER,
  created_ip       TEXT
);

CREATE TABLE IF NOT EXISTS likes (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post','review','comment','list')),
  target_id   INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  actor_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT,
  target_id   TEXT,
  group_key   TEXT,
  data        TEXT,
  created_at  INTEGER NOT NULL,
  read_at     INTEGER
);

CREATE TABLE IF NOT EXISTS activity (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verb        TEXT NOT NULL CHECK (verb IN ('post','review','rate','complete','deluxe','master','badge','pull','list','grid','friend','set')),
  object_type TEXT NOT NULL,
  object_id   TEXT NOT NULL,
  item_type   TEXT,
  item_id     TEXT,
  group_key   TEXT,
  data        TEXT,
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','friends','private')),
  engagement  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
) WITHOUT ROWID;

-- ===== Moderation, legal, audit =====
CREATE TABLE IF NOT EXISTS reports (
  id             INTEGER PRIMARY KEY,
  reporter_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reporter_email TEXT,
  reporter_name  TEXT,
  target_type    TEXT NOT NULL CHECK (target_type IN ('post','review','comment','list','user','url')),
  target_id      TEXT NOT NULL,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason         TEXT NOT NULL CHECK (reason IN ('illegal_hate','harassment','threat','copyright','personal_data','spam','sexual','other')),
  details        TEXT CHECK (details IS NULL OR length(details) <= 2000),
  good_faith     INTEGER NOT NULL DEFAULT 0,
  snapshot       TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  created_at     INTEGER NOT NULL,
  created_ip     TEXT,
  handled_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at     INTEGER,
  decision       TEXT
);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id               INTEGER PRIMARY KEY,
  admin_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  report_id        INTEGER REFERENCES reports(id) ON DELETE SET NULL,
  target_type      TEXT NOT NULL,
  target_id        TEXT NOT NULL,
  author_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action           TEXT NOT NULL CHECK (action IN ('hide','restore','delete','warn','suspend','unsuspend','dismiss','cover_block','cover_unblock')),
  ground           TEXT NOT NULL,
  statement        TEXT NOT NULL,
  snapshot         TEXT,
  created_at       INTEGER NOT NULL,
  appealed_at      INTEGER,
  appeal_text      TEXT,
  appeal_decision  TEXT CHECK (appeal_decision IS NULL OR appeal_decision IN ('upheld','reversed')),
  appeal_decided_at INTEGER
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id         INTEGER PRIMARY KEY,
  admin_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  payload    TEXT,
  created_at INTEGER NOT NULL
);

-- ===== Lists (incl. Mes 9 albums and the wishlist) =====
CREATE TABLE IF NOT EXISTS lists (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'list' CHECK (kind IN ('list','grid9','wishlist')),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  description   TEXT CHECK (description IS NULL OR length(description) <= 1000),
  ranked        INTEGER NOT NULL DEFAULT 0 CHECK (ranked IN (0,1)),
  item_type     TEXT NOT NULL DEFAULT 'album' CHECK (item_type IN ('album','track','mixed')),
  visibility    TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','friends','private')),
  item_count    INTEGER NOT NULL DEFAULT 0,
  like_count    INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  hidden_at     INTEGER
);

CREATE TABLE IF NOT EXISTS list_items (
  list_id   INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL CHECK (position >= 0),
  item_type TEXT NOT NULL CHECK (item_type IN ('album','track')),
  item_id   TEXT NOT NULL,
  note      TEXT CHECK (note IS NULL OR length(note) <= 280),
  added_at  INTEGER NOT NULL,
  PRIMARY KEY (list_id, position),
  UNIQUE (list_id, item_type, item_id)
) WITHOUT ROWID;

-- ===== Battles =====
CREATE TABLE IF NOT EXISTS battle_votes (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type  TEXT NOT NULL CHECK (item_type IN ('album','track')),
  a_id       TEXT NOT NULL,
  b_id       TEXT NOT NULL,
  winner_id  TEXT,
  context    TEXT NOT NULL,
  categories TEXT NOT NULL DEFAULT '[]',
  counted    INTEGER NOT NULL DEFAULT 1 CHECK (counted IN (0,1)),
  event_slug TEXT,
  created_at INTEGER NOT NULL,
  CHECK (a_id < b_id),
  CHECK (winner_id IS NULL OR winner_id = a_id OR winner_id = b_id),
  UNIQUE (user_id, item_type, a_id, b_id)
);

CREATE TABLE IF NOT EXISTS battle_ratings (
  category   TEXT NOT NULL,
  item_type  TEXT NOT NULL CHECK (item_type IN ('album','track')),
  item_id    TEXT NOT NULL,
  rating     REAL NOT NULL DEFAULT 1500,
  votes      INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (category, item_type, item_id)
) WITHOUT ROWID;

-- ===== Quests, boosters, cosmetics, sets =====
CREATE TABLE IF NOT EXISTS user_quests (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  slot       INTEGER NOT NULL,
  quest_id   TEXT NOT NULL,
  rerolled   INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  reward     TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, period_key, slot)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS user_boosters (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('theme','album')),
  theme      TEXT NOT NULL,
  source     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  opened_at  INTEGER
);

CREATE TABLE IF NOT EXISTS user_cosmetics (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cosmetic_id TEXT NOT NULL,
  source      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, cosmetic_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sets (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('editorial','generated','event')),
  title_fr    TEXT NOT NULL,
  title_en    TEXT NOT NULL,
  rule        TEXT,
  event_slug  TEXT,
  reward      TEXT,
  album_count INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  retired_at  INTEGER
);

CREATE TABLE IF NOT EXISTS set_albums (
  set_id   TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  album_id TEXT NOT NULL REFERENCES cat_albums(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (set_id, album_id)
) WITHOUT ROWID;
```

What each table is for (owner module in brackets):

| Table | Purpose | Written by | Read by |
|---|---|---|---|
| `external_ids` | provider ids for catalogue entities (Deezer backfilled, UPC/ISRC from the importer, MusicBrainz/Wikidata/Spotify/Apple later); `url` only when it cannot be derived from `(source, source_id)`; ISRC may map to several tracks | importer, step v6, `enrich.js` | ListenPanel (`/catalog/listen`), enrichment, detach-provider |
| `search_docs` + `search_fts` + `search_tri` (+ `search_tri_vocab`) | global search over albums, tracks, artists, users, public lists; contentless FTS5 (no text stored twice), `k` column = kind token (`kalbum`…) for per-kind queries | `search.js` (boot build + hooks) | `/api/search` |
| `rating_stats` | per item count, sum, review count, 11-bucket distribution: community average, histograms, trending, "culte", rankings without GROUP BY | `ratings.js` on every rate/unrate (recompute of that item: 2 ms for the most rated album) | album/track pages, Discover, search weight |
| `user_album_progress` | owned/holo/total per user and album: replaces the GROUP BYs over all cards (stats, focus, progress sort, almost complete, passport) | `services.addCards` (same tx), admin tools, step v3 | Collection, focus, Discover, passport, match |
| `user_stats_cache` | cached Passport / Rétro payloads (`passport`, `retro:2026`) | `passport.js` | `passport.js` |
| `album_similar` | precomputed similar albums (co-ratings, then artist, then genre+decade) | nightly job (P2-C) | album page, Discover |
| `user_favorites` | favourite artists, tracks, genres (≤ 5 each; albums = `grid9` list) | onboarding, Studio | Studio, match, Discover, booster themes |
| `taste_matches` | cached match per pair (`user_a < user_b`), TTL 6 h | `match.js` | match page, suggestions, user cards |
| `posts` | free posts, optionally attached to one album/track/artist/list/review | `social.js` | feed, post page, album/track/artist discussions, Studio |
| `comments` | replies on posts, reviews, lists; one nesting level (`parent_id` = top-level comment) | `social.js` | threads |
| `likes` | likes on posts, reviews, comments, lists | `social.js` | counts, notifications, feed engagement |
| `notifications` | per-user inbox; unread rows with the same `group_key` are merged on read | every module through `notify()` | bell, `/notifications` |
| `activity` | the feed index (one row per shareable event; `group_key` upserts aggregate "a noté 5 albums aujourd'hui") | `feed.js` hook handlers | feed, Studio activity |
| `blocks` | blocking in both directions | `moderation.js` | every social read, friends, search, match |
| `reports` | notices from users and from the public form (DSA art. 16), with a snapshot | `moderation.js` | admin queue |
| `moderation_actions` | decisions with ground and statement of reasons (DSA art. 17), appeals | `moderation.js` | admin, author notification |
| `admin_audit` | every admin action (grants, deletions, suspensions, cover blocks, imports) | `services.audit()` (admin routes), `moderation.js` | admin |
| `lists` + `list_items` | lists (ranked or not), **Mes 9 albums** (`kind='grid9'`, positions 0–8, empty slots = missing rows) and the **wishlist** (`kind='wishlist'`); one grid9 and one wishlist per user | `lists.js` (wishlist through `collection.js`) | lists pages, Studio, focus, match, search |
| `battle_votes` | one vote (or skip, `winner_id NULL`) per user and normalised pair (`a_id < b_id`) | `battles.js` | Elo, rankings, quests, badges |
| `battle_ratings` | Elo per generic category key (section 5.4) | `battles.js` | rankings, pairing |
| `user_quests` | the quests rolled for a period (slot → quest id), rerolls and claims; **progress is not stored** (computed from source tables, section 5.6) | `quests.js` | quests |
| `user_boosters` | special boosters inventory: themed (`genre:electro`, `decade:1990`, `taste`, `event:<slug>`) and album boosters (`album:<id>`, `album:choice`) | quests, onboarding, levels, events | Home « Boosters spéciaux » panel (P1-D) |
| `user_cosmetics` | cosmetics unlocked by badges, events, sets, quests (level unlocks are derived, never stored) | badges, events, sets | Studio editor |
| `sets` + `set_albums` | collection books (editorial, generated per genre × decade, event); album lists frozen at creation | `sets.js` (boot upsert of code definitions + generator) | Collection Coffrets, events, badges |

Events are **defined in code** (`shared/events.js`, date windows in Europe/Paris), not in a table. Their state lives in
`user_quests` (`period_key = 'e:<slug>'`), `battle_votes.event_slug`, `sets.event_slug` and `user_cosmetics`.

### 3.5 Indexes (`INDEXES`, executed after the steps)

```sql
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON email_tokens(user_id, purpose);
CREATE INDEX IF NOT EXISTS tokens_expires ON email_tokens(expires_at);
CREATE INDEX IF NOT EXISTS users_created ON users(created_at);
CREATE INDEX IF NOT EXISTS users_seen ON users(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_friend_addressee ON friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS friend_requester ON friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_openings_user ON pack_openings(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_blindtest_user ON blindtest_games(user_id, created_at);
CREATE INDEX IF NOT EXISTS blindtest_finished ON blindtest_games(user_id, finished_at) WHERE finished_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS cards_track ON cards(track_id);
CREATE INDEX IF NOT EXISTS cards_user_first ON cards(user_id, first_at);
CREATE INDEX IF NOT EXISTS ach_key ON achievements(key, created_at);
CREATE INDEX IF NOT EXISTS ach_user_time ON achievements(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ratings_item ON ratings(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_ratings_recent ON ratings(updated_at);
CREATE INDEX IF NOT EXISTS ratings_user_time ON ratings(user_id, created_at);
CREATE INDEX IF NOT EXISTS ratings_user_updated ON ratings(user_id, updated_at);
CREATE INDEX IF NOT EXISTS ratings_item_time ON ratings(item_type, created_at);
CREATE INDEX IF NOT EXISTS ratings_item_reviews ON ratings(item_type, item_id, updated_at) WHERE review IS NOT NULL AND hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS ratings_user_review ON ratings(user_id, review_at) WHERE review_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS cat_albums_created ON cat_albums(created_at);
CREATE INDEX IF NOT EXISTS cat_albums_title ON cat_albums(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS cat_albums_year_title ON cat_albums(year, title);
CREATE INDEX IF NOT EXISTS cat_artists_country ON cat_artists(country) WHERE country IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ext_source_unique ON external_ids(source, entity_type, source_id) WHERE source <> 'isrc';
CREATE INDEX IF NOT EXISTS ext_isrc ON external_ids(source_id) WHERE source = 'isrc';
CREATE INDEX IF NOT EXISTS search_docs_kind_weight ON search_docs(kind, weight);
CREATE INDEX IF NOT EXISTS rating_stats_top ON rating_stats(item_type, count);
CREATE INDEX IF NOT EXISTS uap_user_recent ON user_album_progress(user_id, updated_at);
CREATE INDEX IF NOT EXISTS album_similar_top ON album_similar(album_id, score);
CREATE INDEX IF NOT EXISTS favorites_item ON user_favorites(kind, item_id);
CREATE INDEX IF NOT EXISTS taste_b ON taste_matches(user_b);
CREATE INDEX IF NOT EXISTS posts_user ON posts(user_id, created_at);
CREATE INDEX IF NOT EXISTS posts_item ON posts(item_type, item_id, created_at) WHERE item_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_recent ON posts(created_at) WHERE hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS comments_target ON comments(target_type, target_id, parent_id, created_at);
CREATE INDEX IF NOT EXISTS comments_user ON comments(user_id, created_at);
CREATE INDEX IF NOT EXISTS likes_target ON likes(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS notif_unread ON notifications(user_id, group_key) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS activity_actor ON activity(actor_id, created_at);
CREATE INDEX IF NOT EXISTS activity_recent ON activity(created_at);
CREATE INDEX IF NOT EXISTS activity_object ON activity(object_type, object_id);
CREATE INDEX IF NOT EXISTS activity_item ON activity(item_type, item_id, created_at) WHERE item_type IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS activity_group ON activity(actor_id, group_key) WHERE group_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks(blocked_id);
CREATE INDEX IF NOT EXISTS reports_open ON reports(status, created_at);
CREATE INDEX IF NOT EXISTS reports_target ON reports(target_type, target_id);
CREATE UNIQUE INDEX IF NOT EXISTS reports_once ON reports(reporter_id, target_type, target_id) WHERE reporter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS modact_author ON moderation_actions(author_id, created_at);
CREATE INDEX IF NOT EXISTS modact_target ON moderation_actions(target_type, target_id);
CREATE INDEX IF NOT EXISTS admin_audit_recent ON admin_audit(created_at);
CREATE INDEX IF NOT EXISTS lists_user ON lists(user_id, updated_at);
CREATE INDEX IF NOT EXISTS lists_popular ON lists(like_count) WHERE visibility = 'public' AND hidden_at IS NULL AND kind = 'list';
CREATE UNIQUE INDEX IF NOT EXISTS lists_singleton ON lists(user_id, kind) WHERE kind IN ('grid9','wishlist');
CREATE INDEX IF NOT EXISTS list_items_item ON list_items(item_type, item_id);
CREATE INDEX IF NOT EXISTS battle_votes_user ON battle_votes(user_id, created_at);
CREATE INDEX IF NOT EXISTS battle_votes_pair ON battle_votes(item_type, a_id, b_id);
CREATE INDEX IF NOT EXISTS battle_ratings_rank ON battle_ratings(category, item_type, rating);
CREATE INDEX IF NOT EXISTS user_quests_claimed ON user_quests(user_id, claimed_at) WHERE claimed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_boosters_open ON user_boosters(user_id) WHERE opened_at IS NULL;
CREATE INDEX IF NOT EXISTS set_albums_album ON set_albums(album_id);
```

### 3.6 One-time steps (`STEPS`)

```js
const DIST = Array.from({ length: 11 }, (_, i) => `SUM(score = ${i})`).join(', ');

export const STEPS = [
  {
    v: 1, name: 'ratings-surrogate-id', fkOff: true,
    run(db) {
      const cols = db.prepare('PRAGMA table_info(ratings)').all().map((c) => c.name);
      if (cols.includes('id')) return;
      db.exec(RATINGS_V2.replace('CREATE TABLE IF NOT EXISTS ratings', 'CREATE TABLE ratings_v2'));
      db.exec(`INSERT INTO ratings_v2 (user_id, item_type, item_id, score, review, review_at, created_at, updated_at)
        SELECT user_id, item_type, item_id, score, review, CASE WHEN review IS NOT NULL THEN updated_at END, created_at, updated_at
        FROM ratings ORDER BY created_at, user_id`);
      db.exec('DROP TABLE ratings');
      db.exec('ALTER TABLE ratings_v2 RENAME TO ratings');
    },
  },
  {
    v: 2, name: 'rating-stats-backfill',
    run(db) {
      db.exec(`INSERT OR REPLACE INTO rating_stats (item_type, item_id, count, sum, review_count, dist, last_rated_at)
        SELECT item_type, item_id, COUNT(*), SUM(score), SUM(review IS NOT NULL), json_array(${DIST}), MAX(updated_at)
        FROM ratings GROUP BY item_type, item_id`);
    },
  },
  {
    v: 3, name: 'user-album-progress-backfill',
    run(db) {
      db.exec(`INSERT OR REPLACE INTO user_album_progress (user_id, album_id, owned, holo, total, first_at, updated_at)
        SELECT c.user_id, t.album_id, COUNT(DISTINCT c.track_id),
               COUNT(DISTINCT CASE WHEN c.variant = 'holo' THEN c.track_id END), al.track_count, MIN(c.first_at), MAX(c.first_at)
        FROM cards c JOIN cat_tracks t ON t.id = c.track_id JOIN cat_albums al ON al.id = t.album_id
        GROUP BY c.user_id, t.album_id`);
    },
  },
  {
    v: 4, name: 'unique-cards-counter',
    run(db) {
      db.exec(`UPDATE users SET unique_cards = COALESCE((SELECT COUNT(DISTINCT track_id) FROM cards WHERE cards.user_id = users.id), 0)`);
    },
  },
  {
    v: 5, name: 'achievements-rank',
    run(db) {
      db.exec(`UPDATE achievements SET rank = r.n FROM (
          SELECT user_id, key, ROW_NUMBER() OVER (PARTITION BY key ORDER BY created_at, user_id) AS n
          FROM achievements WHERE key LIKE 'album:%') AS r
        WHERE achievements.user_id = r.user_id AND achievements.key = r.key AND achievements.rank IS NULL`);
    },
  },
  {
    v: 6, name: 'external-ids-from-deezer-columns',
    run(db) {
      db.exec(`INSERT OR IGNORE INTO external_ids (entity_type, entity_id, source, source_id, url, matched_by, fetched_at)
        SELECT 'artist', id, 'deezer', deezer_id, NULL, 'backfill', created_at
        FROM cat_artists WHERE deezer_id IS NOT NULL`);
      db.exec(`INSERT OR IGNORE INTO external_ids (entity_type, entity_id, source, source_id, url, matched_by, fetched_at)
        SELECT 'album', id, 'deezer', deezer_id, NULL, 'backfill', created_at FROM cat_albums WHERE deezer_id IS NOT NULL`);
      db.exec(`INSERT OR IGNORE INTO external_ids (entity_type, entity_id, source, source_id, url, matched_by, fetched_at)
        SELECT 'track', id, 'deezer', deezer_id, NULL, 'backfill', created_at FROM cat_tracks WHERE deezer_id IS NOT NULL`);
      // Seed albums: the Deezer album id is in covers.url (https://www.deezer.com/album/<id>) when the provider is Deezer.
      const rows = db.prepare("SELECT item_key, url, fetched_at FROM covers WHERE provider = 'deezer' AND url IS NOT NULL").all();
      const ins = db.prepare(`INSERT OR IGNORE INTO external_ids (entity_type, entity_id, source, source_id, url, matched_by, fetched_at)
        VALUES (?, ?, 'deezer', ?, NULL, 'covers', ?)`);
      for (const r of rows) {
        const m = /deezer\.com\/(?:[a-z]{2}\/)?(album|track)\/(\d+)/.exec(r.url);
        if (m) ins.run(r.item_key.startsWith('promo:') ? 'track' : 'album', r.item_key, m[2], r.fetched_at);
      }
    },
  },
  {
    v: 7, name: 'avatar-color-auto',
    run(db) { db.exec("UPDATE users SET avatar_color = 'auto' WHERE avatar_color = '#ff4f7e'"); },
  },
  {
    v: 8, name: 'existing-users-onboarded',
    run(db) { db.exec('UPDATE users SET onboarded_at = created_at WHERE onboarded_at IS NULL'); },
  },
  {
    v: 9, name: 'rarity-freeze',
    run(db) {
      db.exec('UPDATE cat_tracks SET rarity_locked = 1 WHERE rarity_locked = 0');
      db.exec(`UPDATE cards SET pulled_rarity = t.rarity FROM cat_tracks t WHERE t.id = cards.track_id AND cards.pulled_rarity IS NULL`);
    },
  },
];
```

### 3.7 Deletion and cascade matrix

| Event | Database effect | Code effect |
|---|---|---|
| **Account deletion** (P0-F, `DELETE /api/account`) | `DELETE FROM users WHERE id = ?` cascades: sessions, tokens, cards, achievements, friendships, pack_openings, blindtest_games, ratings, uap, favourites, taste_matches, posts, comments (and replies under them), likes, notifications (as recipient and as actor), activity, blocks, lists (+ items), battle_votes, user_quests, user_boosters, user_cosmetics, user_stats_cache. `SET NULL`: reports.reporter_id/target_user_id/handled_by, moderation_actions.admin_id/author_id, admin_audit.admin_id, comments.reply_to_user_id | before the delete: collect liked/commented targets and rating items; after: recompute their counters and `rating_stats`, delete `search_docs` row (kind user + their lists), keep `battle_ratings` (aggregate, anonymous) |
| Post deleted by author | row deleted | `purgeTarget('post', id)`: likes, comments (+ their likes), notifications, activity |
| Review text cleared or rating deleted | rating row updated / deleted | when the review disappears: `purgeTarget('review', ratingId)`; `rating_stats` recomputed |
| Comment deleted by author | hard delete if no replies, else `deleted_at` | likes of the comment removed; parent `reply_count` / target `comment_count` updated |
| List deleted | `list_items` cascade | `purgeTarget('list', id)`, search doc removed |
| Content hidden by moderation | `hidden_at` set | excluded from every read (except author sees "masqué par la modération" + appeal); counters unchanged |
| Catalogue item withdrawn (P2-C) | `status='withdrawn'` | excluded from browse, search, boosters, battles pairing, Discover; still shown in collections, ratings, lists as "archivé" |
| Catalogue purge (legacy script, until P2-C) | deletes cat rows | also deletes search docs, external_ids, set_albums, list_items, rating_stats, ratings and cards of those items (current behaviour, documented as destructive) |

### 3.8 Retention and nightly jobs (`server/jobs.js`, 04:10 Europe/Paris, each job in its own try/catch)

| Job | Rule | Owner |
|---|---|---|
| `purge-auth` | expired `sessions` and `email_tokens`; unverified accounts older than 7 days (frees squatted usernames) | P0-A |
| `purge-dev-emails` | `dev_emails` older than 7 days | P0-A |
| `purge-openings` | `pack_openings` older than 400 days (Rétro needs the current year) | P0-A |
| `optimize` | `PRAGMA optimize` | P0-A |
| `search-weights` | refresh `search_docs.weight` from fans/pop/rating_stats/likes | P0-E |
| `purge-notifications` | read notifications older than 90 days, unread older than 180 days | P0-F |
| `purge-activity` | activity older than 180 days | P1-A |
| `purge-reports-ip` | `created_ip` of reports/posts/comments older than 1 year set to NULL (French decree 2021-1362 retention) | P0-F |
| `taste-cache` | delete `taste_matches` older than 7 days | P1-E |
| `sets-generate` | create missing generated sets (frozen once created) | P2-B |
| `album-similar` | recompute `album_similar` for albums with new co-ratings | P2-C |
| `enrich` | MusicBrainz country / ids at 1 request per second (background, resumable) | P2-C |

`jobs.js` also runs each job once at boot when its last run (`kv['job:<name>']`) is older than 26 h.

### 3.9 Deliberately not added (to avoid duplication)

- No `reviews` table: a review is a `ratings` row with text. No `badges` table: badges are `achievements` keys `badge:<family>:<tier>`.
- No `wishlist` or `favorite_albums` table: they are `lists` kinds. No `follows` table: friendships stay mutual (follow is P3 and would
  reuse `friendships` with a `kind` column).
- No `events` table, no `quests` definitions table, no `cosmetics` definitions table: code definitions in `shared/` shared by server,
  client and demo.
- No quest progress counters: progress is computed from `cards`, `ratings`, `achievements`, `pack_openings`, `blindtest_games`,
  `battle_votes`, `list_items` with time windows (exact, no drift, no double counting).
- No `media_assets` table yet: cover URLs stay on `cat_albums`/`covers`, with `cover_blocked` for takedowns (P3 if a second cover
  provider is added).
- No search-history table (recent searches stay in `localStorage`; trending = rating activity, not search logs).


---

## 4. API design

### 4.0 Conventions (every module follows them)

**Transport.** Base `/api`, JSON only. Every non-GET request carries `X-AlbumMania: 1` (existing CSRF guard). `req.body ??= {}`
(P0-A) so a request without `Content-Type` gets a validation error instead of a 500. Bodies ≤ 32 KB (exports and share images are
built in the browser, never uploaded).

**Access levels.**

| Level | Meaning | Implemented by |
|---|---|---|
| `public` | no session; IP rate limit | module `publicRoutes` |
| `user` | verified session (existing `requireUser`) | module `routes` (default) |
| `active` | `user` + not suspended + current CGU accepted; required by every UGC write (review text, post, comment, like, list, friend request) | `deps.access.assertActive(user)` (P0-F) → 403 `suspended {until}` / 403 `terms_required` |
| `owner` | `user` + owns the resource | checked in the handler → 404 `not_found` (never 403, to avoid leaking existence) |
| `admin` | verified + e-mail in `ADMIN_EMAILS`, recomputed per request; `users.role` is ignored | `/api/admin` sub-router with `requireAdmin` mounted **once** (P0-A), module `adminRoutes` |

**Errors.** `{ error: code, ...extra }` through `HttpError(status, code, extra)`. Every new code is listed with its endpoint below and
gets a FR/EN string under `errors.<code>` in the owning workstream's area file.

**Rate limits** (`server/security.js`, P0-A, exported as `limits`; in-memory fixed windows as today, raised ×1000 in tests):

| Preset | Window | Max | Key | Used by |
|---|---|---|---|---|
| `read` | 60 s | 600 | user | catalogue browsing, pages (= today's `browseLimit`) |
| `write` | 60 s | 240 | user | every mutation (= today's `actionLimit`) |
| `search` | 60 s | 120 | user | `/api/search*` (client debounces at 150 ms and aborts the previous request) |
| `heavy` | 60 s | 20 | user | export, match batch, passport recompute |
| `guestRead` | 60 s | 120 | IP | public catalogue reads, `/api/legal/info` |
| `guestForm` | 1 h | 5 | IP | public notice form |

**Daily quotas** are persistent (they survive restarts): `deps.quota(userId, kind)` counts rows of the source table since Paris
midnight (`shared/periods.js`) with an indexed `COUNT(*)` and throws 429 `{error:'quota_exceeded', kind, resetAt}`:
posts 20 · comments 60 · new review texts 30 · friend requests 30 · reports 20 · lists created 20 · battle votes 200.

**Cursor pagination** (`server/paging.js`, P0-A). `?cursor=<opaque>&limit=<n>` → `{ items, nextCursor }` (`nextCursor` null at the
end). Default limit 20, max 50. The cursor is base64url JSON `[sortValue, id]`; queries use row values on an index:
`WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT n + 1`. Score-ranked lists (search, rankings) use an offset
cursor `[offset]` capped at 240 (search) or 500 (rankings). No endpoint returns an unbounded list.

**Catalogue references.** A response that mentions albums, tracks or artists returns ids in its items plus one
`catalog: { tracks, albums, artists }` built once with `refs()` (≤ 500 / 300 / 300). The client registers it (`absorbResponse`) and
components read the store, so no per-row fetch ever happens.

**Users.** `UserSummary = { id, username, avatar, avatarColor, level, uniqueCards, frame, title, relation }` where `relation` is
`'self' | 'friend' | 'incoming' | 'outgoing' | null` for the current viewer. Built by `services.userSummaries(ids, viewerId)` (P0-A)
with exactly two queries (users by `json_each`, friendships of the viewer among those ids). Items embed `user` / `actor` objects from
that map. Users blocked in either direction are dropped **before** hydration (`deps.access.hiddenIds(viewerId)`, a Set cached for the
request).

**State.** Mutations return a *partial* state plus their own delta (4.1.1); only `GET /api/state` returns the full state.

**Caching headers.** Default `Cache-Control: no-store` on `/api`. Exceptions: `/api/search/suggest` `private, max-age=30`;
`/api/legal/info` and `/api/covers` `public, max-age=3600 / 300`.

**Demo twin.** Every endpoint below exists in `client/src/demo/mock/<module>.js` with the same shapes (section 9.2).

**Server module contract** (`server/modules.js` registry, pre-wired in K0, section 9.1):

```js
// server/<module>.js
export const name = 'social';                    // key under which init()'s return value is exposed in deps
export function init(deps) { return {}; }        // subscribe to deps.bus, return the module's internal API (deps.social)
export function routes(r, deps) {}               // mounted on /api after requireUser; r.get('/posts/:id', deps.limits.read, h)
export function publicRoutes(r, deps) {}         // mounted on /api without requireUser (legal info, notice form)
export function adminRoutes(r, deps) {}          // mounted on /api/admin after requireAdmin
export const jobs = [];                          // [{ name, run(deps) }] run nightly by server/jobs.js (section 3.8)
```

`deps = { db, config, catalog, services, bus, limits, quota, refs, tx, HttpError, validate, paging, lru, periods, access,
notify, ...each module's init() result by name }`. A module never imports another module's file; it calls `deps.<name>.<fn>` and must
tolerate the K0 stub (no-op) of a module that is filled by another workstream of the same level.

**Domain events** (`server/bus.js`, P0-A). `bus.emit(event, payload)` is called **after** the transaction commits; handlers run
synchronously, each in its own try/catch (logged, never propagated), so a failing feed handler can never break a booster.

| Event | Payload | Emitted by |
|---|---|---|
| `user.verified` | `{userId}` | `auth.js` (P0-D) |
| `cards.added` | `{userId, source, cards:[{trackId, variant, rarity, newTrack, newVariant}], albumDeltas, artistDeltas, achievements, levelBefore, levelAfter}` | `services.addCards` (P0-A) |
| `album.completed` | `{userId, albumId, rank, at}` | `services.addCards` |
| `artist.mastered` | `{userId, artistId, at}` | `services.addCards` |
| `pack.opened` | `{userId, source, count}` | `services.openPacks/openAlbumPack` (+ special boosters P1-D) |
| `rating.saved` | `{userId, ratingId, itemType, itemId, score, isNew, hasReview, reviewChanged}` | `ratings.js` (P0-C) |
| `rating.deleted` | `{userId, ratingId, itemType, itemId, hadReview}` | `ratings.js` |
| `friend.requested` / `friend.accepted` | `{fromId, toId, requestId}` / `{userId, friendId}` | `services` (P0-A) |
| `blindtest.finished` | `{userId, gameId, correct, score, rewarded}` | `services` (P0-A) |
| `moderation.action` | `{actionId, action, targetType, targetId, authorId}` | `moderation.js` (P0-F) |
| `content.removed` | `{targetType, targetId, by: 'author'\|'moderator'\|'cascade'}` | owners of UGC (P0-C, P0-F, P1-A, P1-C) |
| `post.created`, `comment.created`, `like.created` | the new row + `ownerId` of the target | `social.js` (P1-A) |
| `list.saved` | `{listId, userId, kind, visibility, itemCount}` | `lists.js` (P1-C) |
| `battle.voted` | `{userId, voteId, itemType, counted}` | `battles.js` (P1-F) |
| `quest.claimed`, `badge.earned` | `{userId, periodKey, slot}`, `{userId, key, family, tier}` | `quests.js`, `badges.js` (P1-F) |
| `level.up` | `{userId, from, to}` | `deps.collection.addXp` (P1-D) |

### 4.1 P0 endpoints

#### 4.1.1 Core: state, profile, friends, admin, hardening (`server/app.js`, `server/services.js`, P0-A)

**`GET /api/state`** (user) returns the full state, same shape as today plus:

```
{ user: {...today, prefs: {listen}, onboarded: bool, termsOk: bool},
  packs, cards: [{t, v, c, at, r}], achievements: [{key, at, rank}], ratings: [{t, i, s}],
  counts: { pendingFriends, unread },                  // replaces the top-level pendingFriends (kept as an alias in P0)
  stats, catalog, serverTime, partial: false }
```

`last_seen_at` and the pack regeneration are written at most once a minute (they were written on every GET).

**Mutation responses** (`/packs/open`, `/packs/album`, `/shop/buy-pack`, `/collection/press`, `/profile/*`, ratings PUT/DELETE, blind
test final, admin `me/*`) return `{ ...result, state: PartialState }` with
`PartialState = { partial: true, user, packs, counts, stats: { summary }, serverTime }`. The delta is in the result fields that exist
today (`cards`, `albumDeltas`, `achievements`, `xp`, `royalties`) plus `artistDeltas` (new, from `addCards`) and, for ratings,
`rating: { type, id, score | null }`. Routes whose effect is not a delta keep returning the full state: `/collection/recycle`,
`/admin/me/reset`, `/admin/me/complete`, `/admin/me/almost`. The client merges every response centrally (`api.js` → `onApiResponse` →
`GameContext.mergeResponse`, pure function `client/src/state/mergeState.js`), so existing `applyState(data.state)` calls keep working.
Whale action payload: 4.6 MB → < 10 KB.

**`GET /api/users/:username`** (user, read): same payload, three fixes. The vinyl query limits first and reads holo counts from
`user_album_progress` (23,139 ms → 0.19 ms measured on the whale):

```sql
WITH v AS (SELECT key, created_at, rank FROM achievements
           WHERE user_id = ? AND key >= 'album:' AND key < 'album;' ORDER BY created_at DESC LIMIT 120)
SELECT substr(v.key, 7) AS album_id, v.created_at, v.rank, p.holo, p.total
FROM v LEFT JOIN user_album_progress p ON p.user_id = ? AND p.album_id = substr(v.key, 7);
```

`role` is removed from the payload; the response is cached 30 s per target in `server/lru.js`. P1-B replaces this route with the Studio
payload (4.2.3).

**`GET /api/friends`**: same shape; every `user` comes from one `userSummaries` call (`users.unique_cards` replaces the per-friend
`COUNT(DISTINCT)`): 33 ms → < 2 ms for 300 friends.

**`POST /api/friends/request`** (active, quota `friend_requests`): 409 `request_cooldown {until}` for 7 days after a decline (the
declined row is kept with `status = 'declined'`); a blocked pair answers 404 `user_not_found` (no leak); emits `friend.requested`.
**`POST /api/friends/:id/decline`** sets `declined` instead of deleting.

**`POST /api/profile/settings`**: also accepts `prefs: { listen: 'deezer' | 'spotify' | 'apple' }` → `users.prefs`.

**Admin** (`/api/admin/*`, one sub-router): `GET /overview?cursor=` paginated (50 users per page) with real totals from counters;
`POST /users/:id/grant` writes `admin_audit`; every admin mutation writes `admin_audit` (helper `deps.services.audit(adminId, action,
target, payload)`).

**Hardening:** `parseCookies` never throws (malformed cookie → ignored); `entity.too.large` → 413 `payload_too_large`;
`/api/dev/emails` and the dev mailbox only when `DEV_MAILBOX=1` **and** `APP_URL` is a localhost URL (with `DEV_MAILBOX=1` and a
non-localhost `APP_URL`, the server refuses to start); the iTunes preview switch (`BLINDTEST_AUDIO`) is removed (clue mode only, section 7.1); security headers (CSP, HSTS,
Permissions-Policy, COOP) in 7.2.

#### 4.1.2 Ratings and reviews (`server/ratings.js`, P0-C)

`ratings.js` re-registers the rating routes (module routes are mounted before the legacy block in `app.js`, so they shadow it;
P1-D deletes the dead legacy code in P1).

**`GET /api/ratings/:type/:id`** (user, read; `type ∈ album | track`, id must exist):

```
{ summary: { count, average, distribution: [11], reviewCount },          // one row of rating_stats
  mine: { id, score, review, reviewAt, updatedAt } | null,
  friends: { scores: [{ user, score, updatedAt }],                        // ≤ 24, most recent first
             reviews: [Review] },                                         // ≤ 10
  community: { reviews: [Review], nextCursor },                           // non-friends, 10 per page
  tracks?: { averages: { [trackId]: { avg, count } }, mine: { [trackId]: score } },   // album only (as today)
  reviews, friendScores,                                                  // legacy keys, removed by P1-A
  catalog }
Review = { id, user: UserSummary, score, review, reviewAt, updatedAt, likeCount, commentCount, liked, friend, moderated? }
```

`moderated: true` appears only for the author of a hidden review. Friends' reviews and community reviews are two LIMIT queries
(`ratings_item_reviews` partial index), not one `ORDER BY CASE … IN (…)` sort: 20 ms → < 2 ms on the most reviewed album.

**`GET /api/ratings/:type/:id/reviews?scope=friends|community&sort=recent|popular&cursor=`** → `{ items: [Review], nextCursor,
catalog }`. `recent` is keyset on `(updated_at, id)`; `popular` (meaningful once likes exist in P1) is an offset cursor ≤ 200 sorted by
`like_count` over that item's reviews.

**`PUT /api/ratings/:type/:id`** (user; `active` when the body sets review text) `{ score: int 0–10, review?: string | null }` →
`{ ...GET payload, rating: { type, id, score }, state }`. Review trimmed, ≤ 2,000 characters, empty → null; a new or changed text
counts toward the `reviews` quota, goes through `deps.access.linkPolicy` and is refused with 409 `duplicate_review` when identical to
one of the author's last 20 reviews. `review_at` is set when the text changes. `rating_stats` of the item is recomputed in the same
transaction (3.4 ms for the most rated album). Emits `rating.saved`.

**`DELETE /api/ratings/:type/:id`** → `{ ...GET payload, rating: { type, id, score: null }, state }`; when a review disappears,
`deps.moderation.purgeTarget('review', id)` and `content.removed`. Emits `rating.deleted`.

**`GET /api/ratings/feed`**: unchanged shape (Home in P0) plus the rating `id` on each item.

**`GET /api/users/:username/ratings`** → `{ stats, topAlbums[4], topTracks[5], recent[12], reviews: { items[10], nextCursor },
catalog }`; SQL aggregates and LIMITs instead of loading the whole history.

Internal API (`deps.ratings`): `rate(userId, type, id, score, review)` (used by onboarding quick ratings), `summaryOf(type, id)`.

#### 4.1.3 Track page (`server/tracks.js`, P0-C)

**`GET /api/catalog/tracks/:id`** (user, read; the client URL-encodes ids such as `discovery%3A01`) →

```
{ track: TrackView, album: AlbumView | null, artist: ArtistView,
  siblings: [trackId],                         // album tracks ordered by n (≤ 40), or ≤ 12 promos of the artist for a promo
  mine: { std: { count, firstAt } | null, holo: { count, firstAt } | null, pulledRarity } | null,
  owners: { count, friends: [UserSummary] },   // friends ≤ 8; count cached 5 min per track (lru)
  ratings: { summary, myScore },               // summary from rating_stats; reviews come from /api/ratings/track/:id
  albumCompletedBy,                            // COUNT(*) of achievements 'album:<albumId>' (0.02 ms)
  catalog }
```

404 `unknown_track`. Owners: `SELECT COUNT(DISTINCT user_id) FROM cards WHERE track_id = ?` (2.9 ms for 1,464 owners, `cards_track`).

#### 4.1.4 Global search (`server/search.js`, P0-E; algorithm in 5.1)

**`GET /api/search/suggest?q=&scope=all|album|track|artist|user|list`** (user, `search` limit) →

```
{ q, suggestion: 'Daft Punk' | null,                  // « Vouliez-vous dire… » only when nothing matched by prefix
  top: { kind, id } | null,
  groups: { album: [{ id, typo }], track: [{ id, typo }], artist: [{ id, typo }],
            user: [UserSummary], list: [{ id, title, kind, itemCount, user, coverAlbumId }] },
  counts: { album, track, artist, user, list },       // capped at 100 (UI shows « 99+ »)
  progress: { [albumId]: { owned, total } },          // viewer's progress for album rows (user_album_progress)
  catalog }
```

Quotas per group for `scope=all`: albums 4, tracks 4, artists 3, members 3, lists 2; a single scope returns 8. A normalised query
shorter than 2 characters returns empty groups (no error). `Cache-Control: private, max-age=30`.

**`GET /api/search?q=&type=album|track|artist|user|list&cursor=&limit=24`** → `{ items, nextCursor, total, progress, catalog }`
(offset cursor, at most 240 results, `total` capped at 240).

Admin: `GET /api/admin/search` → docs per kind, `SEARCH_VERSION`, last refresh; `POST /api/admin/search/rebuild`.
Internal API (`deps.search`): `upsert(kind, refId, name, context, weight)`, `remove(kind, refId)`, `refresh()`.

#### 4.1.5 Legal and terms (`server/legal.js` + `server/auth.js`, P0-D)

- **`GET /api/legal/info`** (public, `guestRead`) → `{ editor: { name, address, email }, publicationDirector, host: { name, address,
  phone }, contactEmail, termsVersion, termsUpdatedAt, shareCovers: false, providers: ['deezer'] }` from `LEGAL_*` env variables.
- **`POST /api/legal/accept`** (user) `{ version }` → `{ ok, state }` (existing users after a CGU version bump; 409 `terms_outdated` if
  the version is not current).
- **`POST /api/auth/signup`**: body adds `acceptTerms: true` and `age15: true` → 400 `terms_required` / `age_required`; stores
  `terms_accepted_at` and `terms_version`. The answer for an e-mail that already has a verified account becomes the same 201 as a
  success (a "someone tried to sign up with your address" e-mail is sent instead) to stop e-mail enumeration.
- `auth.js` emits `user.verified`; login gets a per-identifier throttle (5 failures per 15 min per identifier, on top of the IP
  limit) and scrypt cost N = 2^17 with rehash on login.
- `server/covers.js`: `COVERS=auto` means Deezer only; the Spotify Web API path is deleted (section 7.1).

#### 4.1.6 Safety: reports, blocks, moderation, suspension (`server/moderation.js`, P0-F)

| Method and path | Access | Request → response | Errors |
|---|---|---|---|
| `POST /api/reports` | user, quota `reports` | `{ targetType: review\|post\|comment\|list\|user, targetId, reason, details? ≤ 2000 }` → 201 `{ id }`; a snapshot of the target is copied | 404 `not_found`, 409 `already_reported` |
| `POST /api/public/report` | public, `guestForm` | DSA art. 16 notice `{ url, reason, details, name, email, goodFaith: true }` → 201 `{ id }`; `url` must be an AlbumMania path, resolved to a target when possible (`/review/12`), else `target_type = 'url'`; acknowledgement e-mail | 400 `notice_incomplete` |
| `GET /api/blocks` | user | → `{ items: [{ user, blockedAt }] }` | |
| `PUT /api/blocks/:userId` / `DELETE` | user | → `{ blocked }`; blocking removes the friendship and pending requests both ways and the cached taste match | 404 `user_not_found` |
| `GET /api/moderation/mine` | user | decisions about my content: `{ items: [{ id, action, ground, statement, targetType, targetId, createdAt, appeal }] }` | |
| `POST /api/moderation/:actionId/appeal` | author | `{ text ≤ 2000 }` → `{ ok }`, once per decision | 409 `already_appealed` |
| `GET /api/admin/reports?status=open\|actioned\|dismissed&cursor=` | admin | → `{ items: [{ report, snapshot, current, author: UserSummary, reporter, priorActions }], nextCursor, counts }` | |
| `POST /api/admin/reports/:id/decision` | admin | `{ action: hide\|delete\|warn\|suspend\|dismiss, ground: 'rules:<section>'\|'law:<ref>', statement, suspendDays?: 1\|7\|30\|365 }` → `{ report, action }`; writes `moderation_actions` + `admin_audit`, notifies the author (`moderation_action`, with the statement and an appeal link) and the notifier (`report_resolved`) | 409 `already_decided` |
| `POST /api/admin/moderation/:actionId/appeal-decision` | admin | `{ decision: upheld\|reversed, note }` → reversal restores hidden content and lifts the suspension | |
| `POST /api/admin/users/:id/suspend` · `/unsuspend` | admin | `{ days, ground, statement }` | |
| `POST /api/admin/albums/:id/cover` | admin | `{ blocked: bool, note }` → per-album cover takedown (`cat_albums.cover_blocked`), audit, cache bust | |
| `GET /api/admin/audit?cursor=` | admin | audit log | |

`GET /api/admin/reviews` and `DELETE /api/admin/reviews/...` keep working (they now create a `moderation_actions` row).

Internal API (`deps.moderation` and `deps.access`): `purgeTarget(type, id)` (likes, comments and their likes, notifications,
activity pointing at the target), `snapshot(type, id)`, `hiddenIds(viewerId)`, `isBlocked(a, b)`,
`canSee(viewerId, ownerId, visibility)`, `assertActive(user)`, `linkPolicy(text, user)` (strips links outside the allow-list, 400
`links_not_allowed` for accounts younger than 24 h or below level 3).

#### 4.1.7 Notifications (`server/notifications.js`, P0-F)

- **`GET /api/notifications?cursor=`** → `{ items: [Notification], nextCursor, unread }`. Unread rows sharing a `group_key` collapse
  into one item: `Notification = { id, kind, actors: [UserSummary ≤ 3], actorCount, target: { type, id }, data, createdAt, read }`,
  plus `catalog` for item targets.
- **`POST /api/notifications/read`** `{ ids?: [id], all?: true }` → `{ unread }`.
- `state.counts.unread` = number of unread groups (indexed by `notif_unread`, capped at 99).
- `deps.notify(userId, kind, { actorId, targetType, targetId, groupKey, data })`: never notifies yourself or across a block; keeps at
  most 50 unread rows per group.
- P0 kinds: `friend_request`, `friend_accept`, `moderation_action`, `report_resolved`, `appeal_decided`, `terms_updated`.
  P1 adds `like_review`, `like_post`, `like_comment`, `like_list`, `comment_post`, `comment_review`, `comment_list`, `reply_comment`
  (P1-A) and `badge_earned` (P1-F). The page renders any kind from `notify.<kind>` strings and a target → URL map
  (`review` → `/review/:id`, `post` → `/post/:id`, `list` → `/list/:id`, `user` → `/u/:username`, `album` → `/album/:id`).

#### 4.1.8 Data rights and account (`server/account.js`, P0-F)

- **`GET /api/account/export`** (user, `heavy`, 3 per day) → JSON attachment `albummania-<username>-<date>.json`: profile, settings,
  cards, achievements, ratings and reviews, friendships, blocks, lists and items, posts, comments, likes, battle votes, quests,
  notifications of the last 90 days, reports made, moderation decisions about the user. One query per section.
- **`DELETE /api/account`** (user) `{ password, confirm: <username> }` → `{ ok }`, cookie cleared. Transaction: collect the targets the
  user liked or commented and the items they rated → `DELETE FROM users` (cascades, section 3.7) → recompute those counters and
  `rating_stats` → remove search docs → `admin_audit` row `account_deleted` (no personal data in it).
- **`POST /api/account/password`** `{ current, next }` (kills the other sessions) · **`POST /api/account/sessions/revoke`** (log out
  other devices).

### 4.2 P1 endpoints

#### 4.2.1 Posts, comments, likes, review permalinks (`server/social.js`, P1-A)

`Post = { id, user, body, item: { type, id } | null, review?: Review, list?: ListSummary, visibility, likeCount, commentCount, liked,
createdAt, editedAt, mine }` ·
`Comment = { id, user, body | null, deleted, parentId, replyToUser, likeCount, liked, replyCount, replies?: [Comment ≤ 2], createdAt,
editedAt, mine }`.

| Method and path | Access | Request → response | Errors |
|---|---|---|---|
| `POST /api/posts` | active, quota `posts` | `{ body ≤ 1000, item?: { type: album\|track\|artist\|list\|review, id }, visibility: public\|friends }` → 201 `{ post, catalog }` | 400 `post_empty`, 404 `unknown_item`, 409 `duplicate_post` (same body in 24 h), 400 `links_not_allowed` |
| `GET /api/posts/:id` | user | → `{ post, comments: { items, nextCursor }, catalog }` | 404 `not_found` (hidden, blocked, friends-only) |
| `PATCH /api/posts/:id` · `DELETE` | owner | `{ body }` → `{ post }` (sets `edited_at`) · → `{ ok }` + `purgeTarget` | |
| `GET /api/users/:username/posts?cursor=` | user | Studio tab | |
| `GET /api/items/:type/:id/posts?cursor=` | user | album / track / artist « Discussions »: first page = friends' posts (≤ 5) then everyone's, keyset | |
| `GET /api/comments?target=post:12\|review:34\|list:5&cursor=` | user | top-level comments, oldest first, each with `replyCount` and its first 2 replies | 404 `not_found` |
| `GET /api/comments/:id/replies?cursor=` | user | replies, oldest first | |
| `POST /api/comments` | active, quota `comments` | `{ targetType, targetId, parentId?, body ≤ 1000 }` → 201 `{ comment }`; a reply to a reply attaches to its top-level parent with `reply_to_user_id`; notifies the target owner (`comment_<type>`) and the parent author (`reply_comment`), grouped by `comment:<type>:<id>` | 400 `comment_empty`, 409 `thread_locked` (target hidden) |
| `PATCH /api/comments/:id` · `DELETE` | owner (delete also by the target's owner) | hard delete without replies, soft (`deleted_at`) with replies | |
| `PUT /api/likes/:targetType/:targetId` · `DELETE` | active | idempotent → `{ liked, likeCount }`; notifies the owner (`like_<type>`, group `like:<type>:<id>`); bumps `activity.engagement` | 404 `not_found` |
| `GET /api/likes/:targetType/:targetId?cursor=` | user | who liked, friends first → `{ items: [UserSummary], nextCursor }` | |
| `GET /api/reviews/:id` | user | review permalink → `{ review, item: { type, id }, comments: { items, nextCursor }, catalog }` | 404 |

`liked` flags are filled with one query per response (`likes WHERE user_id = ? AND target_type = ? AND target_id IN (json_each)`).
P1-A also owns `ratings.js` in P1: it adds `liked` to `Review`, the `popular` sort and removes the legacy keys.

#### 4.2.2 Feed (`server/feed.js`, P1-A; ranking in 5.2)

- **`GET /api/feed?tab=friends|foryou|community&cursor=`** → `{ items: [FeedItem], nextCursor, catalog }` with
  `FeedItem = { id, verb, actor: UserSummary, object: { type, id }, item?, groupCount, data, post?, review?, list?, likeCount,
  commentCount, liked, reason: 'friend'|'taste'|'popular', createdAt, updatedAt }`.
- **`GET /api/users/:username/activity?cursor=`** (Studio « Activité récente »; respects Studio privacy).
- Write side: bus handlers fill `activity` (table in 5.2). On first boot of P1, a one-time backfill (kv flag) inserts activity rows for
  the last 30 days of reviews and completions so the feed is not empty on day one.

#### 4.2.3 Studio (`server/studio.js`, P1-B)

- **`GET /api/users/:username`** (replaces the P0 route) → `{ user: UserSummary + { bio, createdAt, friendsCount, visibility },
  relation, access: 'full' | 'header', blocks: [{ id, on }], showcase, vinyls: { items ≤ 24, total }, featuredVinyl, masters,
  favorites: { artists, tracks, genres }, stats, catalog }`. `access: 'header'` for `friends`/`private` profiles seen by others.
- **`GET /api/users/:username/vinyls?cursor=`** (keyset on `achievements.created_at`).
- **`PUT /api/me/profile`** `{ bio ≤ 280, visibility }` · **`PUT /api/me/studio`** `{ blocks: [{ id, on }], featuredVinyl,
  featuredLists ≤ 3 }` · **`PUT /api/me/favorites/:kind`** (`artist | track | genre`) `{ ids ≤ 5 }` · **`PUT /api/me/cosmetics`**
  `{ frame, vinyl, theme, title }` validated against `deps.collection.unlockedCosmetics(userId)` (409 `cosmetic_locked`).

#### 4.2.4 Lists, Mes 9 albums (`server/lists.js`, P1-C)

`ListSummary = { id, kind, title, user, itemCount, likeCount, commentCount, liked, visibility, ranked, coverAlbumIds ≤ 4, updatedAt }`.

| Method and path | Access | Request → response | Errors |
|---|---|---|---|
| `GET /api/lists?owner=me\|friends\|popular\|<username>&cursor=` | user | → `{ items: [ListSummary], nextCursor, catalog }`; popular uses `lists_popular` | |
| `POST /api/lists` | active, quota `lists` (≤ 200 lists per user) | `{ title, description?, ranked, itemType, visibility, items?: [{ type, id, note? }] }` → 201 `{ list }` | 400 `title_required`, 409 `too_many_lists` |
| `GET /api/lists/:id` | user (visibility) | → `{ list, description, items: [{ position, type, id, note }] (≤ 250), comments: { items, nextCursor }, catalog }` | 404 |
| `PATCH /api/lists/:id` | owner | `{ title?, description?, ranked?, visibility? }` | |
| `PUT /api/lists/:id/items` | owner | `{ items: [{ type, id, note? }] ≤ 250 }` replaces all positions in one transaction | 409 `list_full`, 404 `unknown_item` |
| `POST /api/lists/:id/items` · `DELETE /api/lists/:id/items/:type/:itemId` | owner | append (« Ajouter à une liste ») / remove | 409 `already_in_list` |
| `DELETE /api/lists/:id` | owner | `purgeTarget('list')`, search doc removed | |
| `GET /api/items/album/:id/lists?cursor=` | user | public lists containing the album (`list_items_item`) | |
| `GET /api/me/grid9` · `PUT /api/me/grid9` | user / active | `{ title?, slots: [albumId \| null] × 9 }` → `{ list, slots }` (row created lazily) | |
| `GET /api/users/:username/grid9` | user | read mode | |

The wishlist (`kind = 'wishlist'`) is refused by the generic routes (403 `use_wishlist_route`); it belongs to `collection.js`.
`list.saved` → `deps.search.upsert('list', …)` for public lists, `remove` otherwise. Internal API: `setGrid9(userId, slots)`.

#### 4.2.5 Collection game (`server/collection.js` + `services.js`, P1-D)

- **`PUT /api/me/wishlist/:albumId`** · `DELETE` → `{ wanted, count, max }`; 12 slots, +4 at levels 10, 25 and 50; 409 `wishlist_full`.
- **`GET /api/users/:username/wishlist`** → `{ items: [albumId], progress, catalog }`.
- **`GET /api/me/boosters`** → `{ items: [{ id, kind, theme, source, createdAt }] }` · **`POST /api/me/boosters/:id/open`** →
  same result as `/packs/open` + partial state · **`GET /api/boosters/odds?theme=`** → disclosed odds of that booster.
- **`GET /api/me/cosmetics`** → `{ unlocked: [{ id, source }], selected }`.
- **`GET /api/albums/:id/completion`** → `{ completedBy, friends: [UserSummary ≤ 8], mine: { at, rank, firstCardAt, days } | null }`.
- `addCards` results gain `levelUp: { from, to, boosters }` and `pity` (boosters since the last ultra-or-better).
- Internal API (`deps.collection`): `addXp(userId, xp, source)` (the only way modules add XP; applies level rewards and emits
  `level.up`), `grantBooster(userId, kind, theme, source)`, `unlockedCosmetics(userId)`, `grantCosmetic(userId, id, source)`.

#### 4.2.6 Quests, badges, battles, rankings (`server/quests.js`, `badges.js`, `battles.js`, P1-F)

| Method and path | Request → response | Errors |
|---|---|---|
| `GET /api/quests` | → `{ daily: { periodKey, endsAt, slots: [Quest], rerollsLeft, bonus: { claimable, claimed } }, weekly: {...}, event?: {...} (P2), firstSteps: [Quest] }`; `Quest = { slot, id, metric, target, progress, done, claimed, reward: { royalties, xp, booster? }, vars }`; missing slots are rolled on first read of a period | |
| `POST /api/quests/:periodKey/:slot/claim` | → `{ reward, quest, state }` | 409 `quest_not_done`, 409 `already_claimed`, 410 `period_over` |
| `POST /api/quests/:periodKey/:slot/reroll` | → `{ quest }` (one free daily reroll) | 409 `no_reroll` |
| `POST /api/quests/bonus/:periodKey` | daily bonus booster when the 3 dailies are claimed | 409 `bonus_locked` |
| `GET /api/badges` · `GET /api/users/:username/badges` | → `{ families: [{ id, variant?, tiers: [{ tier, earnedAt, progress, target }] }] }` (others: earned only) | |
| `GET /api/battles/next?category=&n=3` | → `{ duels: [{ token, category, label, itemType, a, b }], catalog }`; `token` = HMAC(kv secret, userId·a·b·category·expiry 30 min) | 404 `no_duel` |
| `POST /api/battles/vote` | `{ token, winner: 'a' \| 'b' \| null }` (null = « Je ne connais pas ») → `{ ratingA, ratingB, deltaA, deltaB, xp, todayCount, next? }` | 400 `bad_token`, 409 `already_voted`, 429 quota |
| `GET /api/rankings` | categories hub → `{ categories: [{ key, label, itemType, votes, top: [id ≤ 3] }], catalog }` | |
| `GET /api/rankings/:category?cursor=` | → `{ items: [{ rank, id, rating, votes, wins, provisional }], nextCursor, catalog }` (offset ≤ 500, cached 60 s) | 404 `unknown_category` |
| `GET /api/items/:type/:id/rankings` | categories where the item ranks (≤ 5) → album page « Autour de l'album » | |

#### 4.2.7 Taste match, onboarding, Discover (`server/match.js`, `onboarding.js`, `discover.js`, P1-E)

- **`GET /api/match/:username`** (user, `heavy` when uncached) → `{ score, confidence, components: [{ key, value, weight, vars }],
  shared: { albums, artists, tracks, genres }, differences: [{ type, id, mine, theirs }], recommendsToMe: [albumId],
  recommendsToThem: [albumId], user, computedAt, catalog }`; 403 `match_unavailable` (blocked, or private / friends-only profile of a
  non-friend). Cached in `taste_matches` 6 h.
- **`GET /api/match/batch?usernames=a,b,…`** (≤ 30) → `{ scores: { [username]: number | null } }` (cache hits plus at most 5 fresh
  computations per call).
- **`GET /api/match/suggestions`** → `{ items: [{ user, score, reason: 'taste' | 'friends_of_friends' | 'favorites', mutualFriends }] }`.
- **`GET /api/onboarding?genres=a,b,c`** → `{ genres, artists, albums, quickRate }`: the 14 genres, the most followed artists of the
  chosen genres, popular albums per genre, and 10 popular albums of those genres for quick ratings.
- **`POST /api/onboarding`** `{ genres ≥ 3, artists 3–10, grid9: [albumId ≤ 9], ratings: [{ albumId, score | null }] ≤ 10 }` or
  `{ skip: true }` → `{ result: { profile, recommendations, suggestedFriends, boosters, firstSteps }, state, catalog }`; sets
  `onboarded_at`; writes `user_favorites`, the grid9 (`deps.lists.setGrid9`), the wishlist (the 9 albums), quick ratings
  (`deps.ratings.rate`), welcome themed boosters (`deps.collection.grantBooster`).
- **`GET /api/discover`** → `{ sections: [{ id, kind, titleKey, reason: { key, vars }, items: [{ type: 'album', id }], moreCursor }],
  tiles, progress, catalog }`, cached 10 min per user. **`GET /api/discover/:sectionId?cursor=`** → more items.
- **`GET /api/albums/:id/similar`** → `{ items: [{ id, reason: 'corated' | 'artist' | 'genre_decade' }], catalog }`
  (`album_similar` once P2-C fills it, on-the-fly fallback before).

### 4.3 P2 endpoints

- **Passport, Rétro** (`server/passport.js`, P2-A): `GET /api/passport`, `GET /api/users/:username/passport` (privacy) →
  `{ totals, favorites, distributions: { genres, decades, countries, rarities }, timeline: [{ month, cards, ratings, completions }],
  evolution, computedAt, catalog }` (cached in `user_stats_cache` `passport`, 1 h); `GET /api/retro/:year` → Rétro payload (cached
  `retro:<year>`; the current year opens on 1 December).
- **Sets, events** (`server/sets.js`, `server/events.js`, P2-B): `GET /api/sets?kind=&cursor=`, `GET /api/sets/:id` (albums, my
  progress, reward); `GET /api/events` (current, upcoming, past from `shared/events.js`), `GET /api/events/:slug` (quests, set,
  battle category, rewards).
- **Workshop** (`server/workshop.js`, P2-D): `POST /api/collection/vernir { trackId, pay: 'royalties' | 'duplicates' }`,
  `POST /api/collection/comptoir { trackId }` (3 duplicates of rarity R → one chosen missing card of rarity R from a wishlisted
  album); Deluxe evaluated on `rating.saved` / `album.completed`.
- **Enrichment** (`server/enrich.js`, P2-C): `GET /api/catalog/listen/:type/:id` → `{ links: [{ provider, url }], embeds:
  [{ provider, src, height }] }` from `external_ids`; admin `GET /api/admin/enrich`, `POST /api/admin/enrich/start|pause`,
  `POST /api/admin/providers/:source/detach { dryRun }`.
- **Search v2** (P2-E): `/api/catalog/albums?q=` served from `search_docs` (retires `cat_search`), keyset pagination in `browseAlbums`.

### 4.4 Changes to existing endpoints (summary)

| Endpoint | Change | Owner |
|---|---|---|
| `GET /api/state` | `counts`, `prefs`, `onboarded`, `termsOk`, `rank` on achievements, throttled writes | P0-A |
| every mutation | partial state + deltas (`artistDeltas`, `rating`) | P0-A |
| `GET /api/users/:username` | vinyl query fix, no `role`, LRU 30 s → replaced by the Studio payload | P0-A → P1-B |
| `GET /api/friends`, friend request/decline | batched summaries, quota, 7-day cool-down, blocks | P0-A |
| `POST /api/profile/settings` | `prefs.listen` | P0-A |
| `/api/admin/*` | one guarded sub-router, audit log, paginated overview | P0-A |
| `/api/dev/emails` | `DEV_MAILBOX=1` + localhost only | P0-A |
| `GET/PUT/DELETE /api/ratings/:type/:id` | review ids, friends/community split, `rating_stats`, quota, link policy, events | P0-C |
| `GET /api/users/:username/ratings` | LIMITs, paginated reviews | P0-C |
| `GET /api/catalog/tracks/:id` | new (track page) | P0-C |
| `POST /api/auth/signup`, login | terms + age, no e-mail enumeration, per-identifier throttle, scrypt N = 2^17 | P0-D |
| `GET /api/covers` | Deezer only | P0-D |
| `/api/admin/reviews` | becomes a front for the moderation queue | P0-F |
| `POST /api/packs/open` (and every `addCards` caller) | wishlist focus, promo fix, soft pity, `pulled_rarity`, level rewards | P1-D |
| `GET /api/catalog/albums?q=` | `search_docs` instead of `cat_search` | P2-E |
| `POST /api/profile/avatar` | unchanged server side; `album:<id>` avatars render the generated AlbumMania art (client) | P0-B |

---

## 5. Algorithms

Every algorithm below is simple enough to explain in one sentence on screen, uses only indexed queries and has a measured or bounded
cost. Measurements come from `design/schema-proto/bench.mjs`, `search2.mjs` and an extra probe on the migrated populated copy
(`schema-proto/old.db`: 5,000 users, 786k cards, 341k ratings, 20,020 albums, 240,261 tracks; whale = user 1, typical = user 42).

### 5.1 Global search with typo tolerance (P0-E, prototyped in `schema-proto/search.mjs` and `search2.mjs`)

**Normalisation** (`shared/search.js`, shared by server, mock and client highlighter):
`normalize(s) = foldText(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()` (`foldText` already exists in `shared/rules.js`: NFD, strip marks,
lower case, `ø æ œ ß ł đ ð þ ı` mapped). At most 8 tokens.

**Index** (tables of section 3.4). `search_docs` keeps `kind`, `ref_id`, `folded` (for re-ranking) and `weight`; the two FTS5 tables
are contentless, so no display text is stored twice: results are hydrated from `refs()`, `userSummaries` and `lists`. (The prototype
database also had `name`/`context` columns for convenience; production does not.)

| Kind | `name` column | `context` column | `weight` ∈ [0, 1] |
|---|---|---|---|
| album | title | artist name, year | log10(1 + fans) / log10(1 + max album fans) |
| track | title (+ feat) | artist name, album title | pop / 100 |
| artist | name | main genre | log10(1 + fans) / log10(1 + max artist fans) |
| user (verified) | username | — | min(1, log10(1 + unique_cards) / 4) |
| list (public, not hidden) | title | owner username | 0.2 + 0.8 · min(1, log10(1 + likes) / 2) |

The `k` column holds `kalbum`, `ktrack`… so one table answers per-kind queries (`k:kalbum AND {name context}: (…)`).
Build: at boot, **before `listen()`**, when `kv['search:version'] ≠ SEARCH_VERSION` (≈ 8 s for 268k documents, once, one transaction).
Incremental: a 5-minute timer indexes catalogue rows and verified users created since the last indexed `created_at`; lists are
upserted on `list.saved` and removed on `content.removed`; `search-weights` (nightly job) refreshes weights; withdrawn catalogue items
(P2-C) are removed. `scripts/purge-catalog.js` deletes the docs of purged items.

**Query** (measured: 3.1 ms average, 14 ms worst, warm, on 268k docs):
1. `fq = normalize(q)`; fewer than 2 characters → empty result.
2. FTS body = each token as a quoted prefix: `"daft"* "pu"*`.
3. Per kind (for `scope=all`: album, track, artist, user, list): `search_fts MATCH 'k:k<kind> AND {name context}: (<body>)'` ordered by
   `bm25(search_fts, 10, 3)` (name weighs more than context), LIMIT 60. When `fq` has ≤ 3 characters, order by `weight` instead
   (prefix index `prefix='2 3'` keeps that fast: "da" → Daft Punk, The Dark Side of the Moon, Discovery).
4. Text score: exact name = 1; name starts with `fq` = 0.9; otherwise 0.5 + 0.3 × (share of tokens that prefix a word of the name).
   Context-only matches therefore rank below name matches.
5. **Typo fallback** when a kind has fewer rows than its quota and the query without spaces has ≥ 4 characters: take the query's
   trigrams, look up their document frequencies in `search_tri_vocab`, keep the 4 rarest, run
   `search_tri MATCH '"g1" OR "g2" OR "g3" OR "g4"' LIMIT 300`, and keep candidates whose similarity
   `sim = max(Jaccard(trigrams(fq), trigrams(name)), max over words ≥ 3 chars of Jaccard(trigrams(fq), trigrams(word)))` is ≥ 0.3.
   Their text score is 0.3 + 0.5 × sim and they carry `typo: true` (the row shows « ≈ »).
6. Final score = 0.75 × text + 0.20 × weight + 0.05 if the viewer owns cards of that album or artist (one `user_album_progress` lookup
   over ≤ 60 candidates). Users blocked either way, hidden or private lists and withdrawn items are filtered out.
7. `suggestion` (« Vouliez-vous dire Daft Punk ? ») = best typo candidate with sim ≥ 0.4 when no prefix match exists at all.
8. `top` = best first row across groups (text first, then score); `counts` = matches per kind capped at 100.

Acceptance set (all pass on the prototype, kept as `server/test/search.test.js` cases on the fixture): stromea → Stromae ·
daft pnuk → Daft Punk · dicovery → Discovery · kendrik → Kendrick Lamar · nevermnd → Nevermind · random acess memories → Random Access
Memories · thriler → Thriller · back to blak → Back to Black · racine carree → Racine carrée · abbey road beatles → Abbey Road first ·
get lucky → the track Get Lucky first · da → Daft Punk first · zzzzqx → nothing, no suggestion.

**Client behaviour** (`components/search/SearchCombobox.jsx`, generalising the admin `AlbumPicker`, which is the only accessible
combobox today; look and anatomy in `design-system-current.md` §4.1): debounce 150 ms with abort, minimum 2 characters, per-query cache (100 entries) and stale-response tickets, WAI-ARIA combobox
(`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `role="listbox"` with grouped `role="option"` rows),
↑ ↓ Enter Escape Tab. Rows: 40 px `CoverArt` (`sizes="40px"`, lazy, generated art fallback) + title with the matched prefix in
`<mark>` + a second line (album: artist · year · « 7/14 » progress chip; track: artist · album; artist: « Artiste » · genre; member:
level; list: owner · N albums). Footer « Voir les N résultats pour « q » » → `/search?q=`. Empty field: the 5 recent searches
(`localStorage`, try/catch). Enter with no active option: top bar → `/search?q=`; Collection Albums tab → applies the text as the grid
filter (today's `?q=` behaviour), so the owner's request works without breaking the existing filter.
Placements: top bar inline field `.gsearch` (≥ 1080 px), the same panel from a search icon (860–1079 px), full-screen `.search-sheet` on
phones (< 860 px, with kind tabs and counts), Collection Albums tab
(scope album + track), Friends page (scope user), list editor and Mes 9 albums picker (scope album, P1-C).
**Demo:** `mock/search.js` runs the same `shared/search.js` scoring (prefix + trigram Jaccard in JS) over the 20-album static catalogue
and the bots, so typos behave the same.

### 5.2 Feed ranking: friends first, explainable (P1-A)

**Write side** (bus handlers in `feed.js` → `activity`):

| Event | `verb` | `object` | `visibility` | Aggregation (`group_key`, upsert) |
|---|---|---|---|---|
| `post.created` | `post` | post | post visibility | — |
| `rating.saved` with new or changed review text | `review` | review (`ratings.id`) | public | — |
| `rating.saved` without text | `rate` | album or track | public | `rate:<user>:<parisDay>` (« a noté 5 albums aujourd'hui », ≤ 12 items in `data`) |
| `album.completed` | `complete` | album | public | — (`data.rank` for « Pressage n° 37 ») |
| `artist.mastered` | `master` | artist | public | — |
| `cards.added` with a new legendary or promo | `pull` | track | public | `pull:<user>:<parisDay>` |
| `badge.earned` (gold, platinum, first medal ever) | `badge` | badge key | public | — |
| `list.saved` (public; first publication or ≥ 3 new items) | `list` | list | list visibility | `list:<list>:<parisDay>` |
| Mes 9 albums saved | `grid` | list | public | `grid:<user>` |
| `friend.accepted` | `friend` | user | friends | `friend:<user>:<parisDay>` |

Hidden or deleted objects disappear through `purgeTarget`; Studio privacy `private` writes `visibility = 'private'` (never shown to
others).

**Read side** (`GET /api/feed`):
- **Tes amis** (default when a friend was active in the last 14 days): candidates = `activity` of friends ∪ me, visibility public or
  friends, keyset on `(updated_at, id)` via `activity_actor` (one range per friend merged by the planner; the equivalent ratings query
  takes 0.34 ms for a 300-friend whale), 60 candidates per page.
- **Pour toi**: public activity of non-friends in the last 7 days (`activity_recent`) whose album or artist matches my taste (album
  genre in my top 3 genres, artist in my favourites or among my 60 most collected artists), plus friends' reviews ≥ 8/10 of albums I
  have not rated; 200 candidates.
- **Communauté**: public activity of everyone in the last 7 days, 200 candidates.
- **Score** (shown as a reason chip: « Ami », « Proche de tes goûts », « Populaire »):
  `score = 0.5^(ageHours / 36) × (1 + affinity + engagement + kindBoost)` with affinity = 1 for a friend, 0.5 when the cached taste
  match with the actor is ≥ 70, else 0; engagement = min(1, log10(1 + likes + 2 × comments) / 2); kindBoost = complete 0.4, review 0.3,
  post 0.3, list 0.2, badge 0.2, pull 0.1, rate 0, friend 0.
- Pages follow the keyset (stable pagination); the score only re-orders inside each 60-candidate window. Diversity: never more than
  2 consecutive items from the same actor. Blocked actors are filtered before scoring. Hydration (posts, reviews, lists, users, liked
  flags, catalogue refs) is batched: budget < 15 ms per page.
- New account without friends: Communauté first, with a « Trouve des amis » card that links to `/friends` (suggestions).

### 5.3 Taste match: an explainable score and recommendations each way (P1-E)

Inputs (indexed): `ratings`, `user_album_progress` (cards per album, hence per artist, genre, decade), `user_favorites`, the grid9 list.
"Loved" albums = rated ≥ 8/10 or in Mes 9 albums.

| Component | Weight | Value in [0, 1] | Shown as |
|---|---|---|---|
| Rating agreement | 0.40 | co-rated items (albums and tracks), n ≥ 3: a = 1 − mean(abs(sA − sB)) / 10, shrunk toward 0.5: (n·a + 5 × 0.5) / (n + 5) | « 14 albums notés en commun, à 1,2 point près » |
| Loved albums | 0.20 | inter / (min(|L_A|, |L_B|) + 3) | « 6 albums adorés en commun » |
| Artists | 0.20 | cosine of artist vectors (cards per artist, top 60; favourites × 3; rating − 5 added for rated albums) | « Daft Punk, Justice et Air dans vos deux tops » |
| Genres | 0.10 | 1 − Jensen–Shannon divergence (base 2) of genre shares | « Électro et rap en commun » |
| Decades | 0.10 | same on decades | « Les années 2000 » |

`score = round(100 × Σ wᵢcᵢ / Σ wᵢ)` over the components that have data (missing components drop out and their weight is
redistributed). Confidence: **high** with ≥ 10 co-rated items and ≥ 50 cards each; **medium** with ≥ 3 co-rated items or ≥ 2 loved
albums in common; otherwise **low**, and the page says « estimation ». The constants live in `shared/match.js`; P1-E checks on the
populated copy that random pairs fall around 40–60 and pairs built from similar profiles above 80, and tunes only the constants.
- **Shared**: albums both rated ≥ 7 or both loved (≤ 12, by combined score), artists in both tops, tracks both rated ≥ 8, the 3 genres
  with the highest common share.
- **Différences intéressantes**: co-rated items with abs(sA − sB) ≥ 5 (≤ 5): « Tu as mis 5 étoiles à Nevermind, @leo 2 ».
- **@A te recommande**: albums A loved that B never rated and has not completed, ordered by A's score, then the Bayesian community
  average, with a bonus when the album's genre is in B's top genres; ≤ 6, at most 2 per artist. Symmetric for « Tu recommandes à @A ».
- **Cost**: co-rated join 0.07 ms, artist vector 0.45 ms typical / 4 ms whale, genre distribution 4 ms whale: < 15 ms per pair.
  Cached in `taste_matches` (pair stored with `user_a < user_b`) for 6 h, recomputed earlier when either user's rating count moved by
  ≥ 5 (counts kept in `data`); the `taste-cache` job deletes rows older than 7 days.
- **Privacy**: unavailable across a block; unavailable for a private profile, or a friends-only profile of a non-friend.
- **Friend suggestions**: candidates = users who rated ≥ 3 of my 30 most recent loved albums (`idx_ratings_item`, ≤ 200 candidates) ∪
  friends of friends (mutual count) ∪ users sharing ≥ 2 favourite artists (`favorites_item`); minus friends, pending, declined and
  blocked; compute the match for the 20 best candidates and return 8 with their reason.

### 5.4 Battles: pairing, Elo and ranking categories (P1-F)

**Category keys** (`shared/battles.js`): `global:album`, `artist:<artistId>` (≥ 2 albums), `decade:<1990>`, `genre:<electro>`,
`year:<2026>`, `genre_decade:<rap>:<1990>`, `country:<FR>` (only once ≥ 30 albums have a country, P2-C), `event:<slug>` (P2-B),
`album_tracks:<albumId>` and `artist_tracks:<artistId>` for track duels. A vote updates the Elo of **every** category containing both
items (`battle_votes.categories` stores the list), so one vote feeds global, decade, genre and artist rankings at once.

**Pairing** (`GET /api/battles/next`):
1. Category: the requested one, or a weighted mix: 50 % taste (a genre or decade from my top 3), 30 % global, 20 % an artist with ≥ 2
   albums I know; the daily featured category (`kv['battle:featured:<day>']`) appears first.
2. Pool: albums of the category that I rated, own cards of, favourited or put in Mes 9 albums, plus the 200 most popular of the
   category; each side is a "known" album with probability 0.7.
3. Pick two items with an Elo gap ≤ 150 when possible (informative duels); 30 % of the duels include an item with < 20 votes
   (exploration).
4. Exclude pairs I already voted or skipped (unique `(user, type, a, b)` with `a < b`) and withdrawn items. Return a signed token.

**Elo**: initial rating seeded from the community average so rankings are sensible before many votes:
`R0 = 1500 + 60 × (bayes − 6.5)`, clamped to ±200, with `bayes = (sum + 10 × 6.0) / (count + 10)` from `rating_stats`.
`E_A = 1 / (1 + 10^((R_B − R_A) / 400))`, `R_A' = R_A + K × (S_A − E_A)` with K = 32 under 30 votes, 24 under 100, 16 after.
Anti-brigading: after 10 votes involving the same item in a day by the same user, K × 0.25; accounts younger than 24 h vote at K × 0.5.
A skip records the pair (not shown again) and changes nothing. XP: 5 per counted vote, first 20 votes a day (100 XP).
**Rankings**: rating descending inside a category; « provisoire » under 50 votes; a category is listed once it has ≥ 20 rated items.
Album page « Autour de l'album »: up to 5 categories with the item's rank (`COUNT(*) WHERE category = ? AND rating > mine` + 1).

### 5.5 Discover sections (P1-E)

Up to 8 sections, 6–12 albums each, every one with a one-line reason; albums I completed or rated are excluded (except in
« À compléter »); empty sections are skipped; at most 2 albums per artist per section.

| # | Section | Rule | Cost |
|---|---|---|---|
| 1 | « Parce que tu as aimé *Discovery* » | seed = my most recent album rated ≥ 8 (or a Mes 9 album); items = `album_similar` (P2-C), before that: other albums of the artist, then same genre and decade by Bayesian average | < 5 ms |
| 2 | « Très apprécié par tes amis » (avatars in the reason) | friends' ratings ≥ 8 on albums I have not rated, by count then average | 0.4 ms typical, 20 ms whale (cached) |
| 3 | « Album culte que tu n'as jamais noté » | `rating_stats` count ≥ 20, Bayesian average (C = 10, m = 6.0), not rated by me | 3 ms |
| 4 | « À compléter » | wishlist first, then `user_album_progress` ≥ 50 % and not complete | 0.4 ms |
| 5 | « Découvre les années 90 » | the decade (≥ 200 albums) where my share of cards is lowest compared to its catalogue share; top by fans | < 5 ms |
| 6 | « Ton genre : électro » | my top genre, best Bayesian average not rated | < 5 ms |
| 7 | « Tendances AlbumMania » | most rated albums in the last 7 days | 38 ms, global cache 10 min |
| 8 | « Nouveau au catalogue » | albums added in the last 30 days | < 2 ms |

Tiles: Battles · Classements · Listes · Mes 9 albums · Blind test (+ Passeport, Événements, Coffrets in P2). Cold start (no ratings):
onboarding genres and favourite artists drive sections 1, 5 and 6, else popular albums. The whole payload is ≤ 60 ms uncached and
cached 10 min per user (`server/lru.js`).

### 5.6 Quest progress from source tables (P1-F)

Definitions (`shared/quests.js`): `{ id, scope: 'daily' | 'weekly' | 'event' | 'first', category: 'collect' | 'rate' | 'discover',
metric, target, params, reward: { royalties, xp, booster? }, weight }`. Periods (`shared/periods.js`, Europe/Paris): daily
`d:2026-10-06` (midnight to midnight), weekly `w:2026-W41` (Monday 00:00), event `e:<slug>` (the event window), `first` (no end).

**Rolling**: on the first `GET /api/quests` of a period, 3 slots are rolled (one per category) with a PRNG seeded by
`hash(userId, periodKey)`, skipping metrics that cannot apply (no friends → no social metric), and stored in `user_quests`. A reroll
replaces one slot (`rerolled = 1`); one free reroll a day.

**Progress = a bounded COUNT over the source table inside the period window** (`SELECT COUNT(*) FROM (… LIMIT :target)`, so the cost
stops at the target):

| Metric | Source (window on the timestamp) | Anti-abuse |
|---|---|---|
| `open_boosters` | `pack_openings.created_at`, sources `pack`, `album-pack`, `theme`, `quest` | — |
| `new_cards` (+ `decade`, `genre`, `rarity` params) | `cards.first_at` with no earlier variant of the same track (`NOT EXISTS`), joined to `cat_tracks` for params | first copy ever only |
| `new_artist` | `user_album_progress.first_at` with no earlier album of the same artist (25 ms whale, 3 ms typical) | — |
| `complete_album` | `achievements` `album:%` `created_at` | — |
| `rate_albums`, `rate_tracks` | `ratings.created_at` by `item_type` | any score counts (quests never ask for a score); farming by delete + re-rate is capped by the target |
| `write_review` | `ratings.review_at`, `length(review) ≥ 140`, then a JS check on ≤ target rows: distinct words / words ≥ 0.4 | repetitive text refused |
| `rate_genres` | distinct `cat_albums.genre` of albums rated in the window | — |
| `battle_votes` | `battle_votes.created_at`, `counted = 1` | daily quota |
| `blindtest_play`, `blindtest_score` (≥ 4/5) | `blindtest_games.finished_at` | — |
| `add_to_list` | `list_items.added_at` on my `list`/`grid9` lists | — |
| `post`, `comment` | `posts` / `comments` `created_at`, not hidden | capped by quotas |

Likes are never a quest metric (it would reward like spam). **Claim**: recompute progress; when ≥ target, in one transaction set
`claimed_at` and `reward`, add royalties and XP (`deps.collection.addXp`), add bonus boosters or a `user_boosters` row; emit
`quest.claimed`. When the 3 dailies are claimed, « Bonus du jour » gives one bonus booster. **Premiers pas** (scope `first`, shown until
done): finish onboarding, rate 5 albums, open a booster, add a friend, write a review, vote in 5 battles, complete an album.
**Cost**: `GET /api/quests` runs ≤ 7 bounded queries: < 5 ms typical, < 60 ms whale.

### 5.7 Curated badges (P1-F; ≈ 30 medals, each meaningful)

Badges are `achievements` rows with key `badge:<family>[:<variant>]:<tier>` and `data` JSON (`{ value, at }`); tiers Bronze, Argent,
Or, Platine. They are evaluated in `badges.js` by bus handlers that re-check only the families affected by the event, with indexed
counts; on the first `GET /api/badges` of a player, every family is evaluated once (backfill for existing players, flag in
`user_stats_cache` key `badges:v1`).

| Family (FR name) | Tiers / criterion | Event that re-evaluates |
|---|---|---|
| `vinyl` Vinyles | 1 · 10 · 50 · 250 completed albums | `album.completed` |
| `first_press` Premier pressage | complete an album as one of its first 10 players (`rank ≤ 10`) | `album.completed` |
| `master` Maître | 1 · 5 · 20 artists mastered | `artist.mastered` |
| `legendary` Collectionneur légendaire | 10 · 50 · 200 distinct legendary cards | `cards.added` |
| `promo` Chasseur de promos | 5 · 25 · 100 promo cards | `cards.added` |
| `explorer:<decade>` Explorateur des années 60 … 20 (7 variants) | Bronze: cards from 10 albums of the decade · Argent: 3 completions | `cards.added`, `album.completed` |
| `eclectic` Éclectique | cards in 10 · 14 genres | `cards.added` |
| `genre_fan:<genre>` Fan de jazz, de rap… | 5 completions in one genre (a variant per genre, only earned ones are shown) | `album.completed` |
| `critic` Chroniqueur | 25 · 100 · 500 albums rated | `rating.saved` |
| `pen` Plume | 10 · 50 reviews of ≥ 140 characters | `rating.saved` |
| `popular_review` Critique populaire | a review with 10 · 50 likes | `like.created` |
| `fine_ear` Oreille fine | every track of 1 · 10 albums rated | `rating.saved` |
| `curator` Curateur | a public list with 10 · 50 likes | `like.created` |
| `nine` Mes 9 albums | publish your 9 albums | `list.saved` |
| `friendly` Bonne entente | taste match ≥ 85 % with 3 friends | match computed |
| `blindtest` Blind-testeur | 5/5 once · 10 · 50 times | `blindtest.finished` |
| `judge` Juge | 50 · 250 · 1,000 battle votes | `battle.voted` |
| `steady` Assidu | all 3 dailies claimed on 7 · 30 different days (no streak) | `quest.claimed` |
| P2: `set:<id>` Coffret complété, `event:<slug>` (one per event), `deluxe` Édition deluxe ×1 · ×10 | | P2-B, P2-D |

Rewards: Bronze 50 XP · Argent 150 XP + 100 royalties · Or 400 XP + 1 bonus booster · Platine 1,000 XP + a cosmetic (section 6.6).
No badge rewards spending royalties. Earning a badge notifies (`badge_earned`), shows a toast, and Or/Platine create a feed item.

### 5.8 Passport and Rétro statistics (P2-A)

- **Passport**: unique cards, completed albums, mastered artists, distinct artists, genres, decades, countries (when the artist country
  is known; « données partielles » note until P2-C), ratings (count, average, distribution), reviews, lists, battle votes, rarity
  counts (cards × tracks, 49 ms whale → cached), favourite artist (cards + favourites + ratings), best-rated album, top genre, a
  12-month timeline (cards by `first_at`, ratings by `created_at`, completions), taste evolution (genre shares per quarter). Cached in
  `user_stats_cache` (`passport`) for 1 h.
- **AlbumMania Rétro <year>** (never "Replay" or "Wrapped"): the same metrics restricted to the year plus « moments »: first card of the
  year, first completion, rarest pull (`pack_openings`, kept 400 days), busiest month, top 5 rated albums, top artist, lowest Pressage
  n°, battle votes. Five 1080 × 1920 share slides through the share engine (section 7.1). Opens on 1 December for the current year;
  past years any time.

### 5.9 Onboarding result (P1-E)

Inputs: genres G (≥ 3 of 14), artists A (3–10), up to 9 albums, up to 10 quick ratings.
- **Musical profile**: top genres (G ordered by how many of A and the 9 albums fall in each), dominant decades of the 9 albums and
  ratings, and one sentence built from i18n parts (« Électro · années 2000 · plutôt albums cultes »).
- **Recommendations (12)**: other albums of A by popularity (not in the 9), top Bayesian albums of G not rated, similar albums of the 9;
  deduplicated, ≤ 2 per artist.
- **Suggested friends (≤ 6)**: friend suggestions of 5.3 computed with the fresh ratings and favourites.
- **Economy**: the existing 5 welcome boosters stay; plus 3 themed boosters `genre:<g>` for the top 3 genres (same odds per slot as the
  standard booster, pool filtered by genre) and one album booster `album:choice` usable on one of the 9 albums; the 9 albums pre-fill
  the wishlist (« Albums recherchés »), so wishlist focus (6.4) immediately steers boosters toward them.
- **Next steps**: the « Premiers pas » quest line; the result screen ends on « Ouvrir mes boosters » (Home hero).

---

## 6. Collection and game design

All mechanics follow the guardrails of `game-legal.md` A6: no real money buys randomness, nothing tradeable for value, odds disclosed
for every draw, no fake scarcity or countdown offers, streaks never punish, every goal has a deterministic route, cosmetics are
AlbumMania creations only, social rewards are capped and score-neutral. Visuals of every new reward use the current identity
(`.panel` gradients, rarity colours, `--gold` for achievements, the existing `Vinyl`, `Card` and `PackOpening` components).

### 6.1 Economy baseline (from `shared/rules.js` and the one-year simulation)

Casual player: ≈ 8 free boosters a day, ≈ 440 royalties a day (54 % new cards, 32 % completions, 14 % recycling), ≈ 735 XP a day
(level 22 after a month). Sinks: album booster 300, random booster 120, pressing 40–1,600. Completing a **chosen** album costs ≈ 3 album
boosters (900 royalties, about two days). Balances stay near zero (healthy). Every reward below is sized against these numbers.

### 6.2 The completion moment (P1-D; the brief's emotional core)

1. When an album completes (booster summary, pressing or album booster), the existing celebration plays (vinyl sliding out of its
   sleeve, `Vinyl.jsx` `vinyl--reveal`, `sound.complete`), unchanged.
2. Then a stats card in the same modal: « Complété le 6 oct. 2026 · **Pressage n° 37** · 6 jours après ta première carte » (rank =
   `achievements.rank`, set at insert as `COUNT(*) + 1` of that key in the same transaction, 0.02 ms; first card =
   `user_album_progress.first_at`).
3. Three actions: « Noter l'album » (opens the rating), « Mettre en avant sur mon Studio » (featured vinyl), « Partager » (share card
   with the generated album art, section 7.1).
4. Side effects: feed item `complete`, quest `complete_album`, badges `vinyl` / `first_press`, album page completion line
   (« Complété par 214 joueurs · 3 amis »), vinyl sleeve shows « Pressage n° 37 » in Martian Mono.
5. Reduced motion: the stats card appears without the slide. The artist-mastery celebration gets its own title (today it says
   « Vinyle débloqué » for both, a bug fixed in `Achievements.jsx`).

### 6.3 Deluxe edition (P2-D)

Album completed + album rated + every track rated → achievement `deluxe:<albumId>`, a « deluxe » vinyl colour (an AlbumMania colour,
never the cover) on the shelf and the turntable, +50 XP. It replaces the unreachable "every card holo" vinyl edition; players who
already have a holo edition keep it as « Édition holo ». Track rating stays one tap in the tracklist, so Deluxe ties collecting to
rating without grinding.

### 6.4 Wishlist focus and the promo fix (P1-D)

- **Albums recherchés** (`lists.kind = 'wishlist'`): 12 slots, +4 at levels 10, 25 and 50; toggle on album tiles, the album page and
  search rows; Studio block; pre-filled by onboarding.
- **Focus**: today's `FOCUS_CHANCE` 0.35 becomes `WISHLIST_FOCUS` 0.25 (missing tracks of wishlisted albums first) + `ADVANCED_FOCUS`
  0.10 (the 20 most advanced started albums ≥ 50 %, from `user_album_progress`, 0.4 ms instead of a 138 ms GROUP BY). With an empty
  wishlist the whole 0.35 goes to advanced albums. Both values are shown in the rarity guide.
- **Promo fix**: in the promo slot, 50 % of draws come from promos of artists the player owns cards of or wishlisted
  (`randomTrack({ rarity: 'promo', artistIds })`); promos become pressable for 1,200 royalties once the player completed one album of
  that artist. Artist mastery becomes reachable again. Disclosed in the rarity guide.

### 6.5 Soft pity and rarity freeze (P1-D)

- **Soft pity**: `users.pity` counts boosters since the last ultra-or-better card; at 10, the hit slot is drawn from ultra / legendary /
  promo only, keeping their relative weights (11 : 5 : 6 → 50 % / 23 % / 27 %). Reset on any ultra-or-better card. Disclosed.
- **Freeze**: `calibrate()` only assigns rarities to tracks with `rarity_locked = 0` (new imports), using the stored breaks; step v9
  locked every existing track. `cards.pulled_rarity` records the rarity at pull time (a « 1re édition » stamp if a yearly re-rate event
  ever happens, P3). A card pulled as Légendaire stays Légendaire.

### 6.6 Level reward track and cosmetics earned by play (P1-D; extras in P2-D)

Every level gained gives **+1 bonus booster** (granted by `deps.collection.addXp`, whatever the XP source). Milestones unlock
cosmetics derived from the level (never stored; only the selection is stored in `users.cosmetics`):

| Level | Unlock (all drawn in the current style) |
|---|---|
| 3 | avatar frame « Ivoire » (paper-tone ring) |
| 5 | vinyl colour « Prune » (translucent plum disc) |
| 8 | Studio accent « Turquoise » (`--cue` tint in the Studio header gradient) |
| 10 | +1 showcase slot, +4 wishlist slots |
| 15 | vinyl « Marbré » |
| 20 | avatar frame « Néon » (`--cue` glow) |
| 25 | +4 wishlist slots, title « Disquaire de quartier » |
| 30 | +1 showcase slot, avatar frame « Or » (`--gold`) |
| 40 | vinyl « Transparent » |
| 50 | avatar frame « Holo » (the card foil, on the ring only), +4 wishlist slots |
| 75 | Studio theme « Minuit » (deeper ink gradient) |
| 100 | title « Légende du bac » |

Rules: a frame decorates the **avatar ring and the outside of showcase cards**, never the rarity frame of a card (rarity must stay
readable) and never a cover. Vinyl colours apply to the `Disc` drawn on the shelf and the turntable. Studio themes are token-based
gradients from the current palette. Titles are short texts under the username. Badges (Platine tiers), sets and events (P2) grant
extra cosmetics into `user_cosmetics`. Cosmetics are never sold and never random.

### 6.7 Quest rewards tuned against the economy (P1-F, values in `shared/quests.js`)

| Source | Reward | Effect on a casual player |
|---|---|---|
| Daily quests (3: collect, rate, discover/social) | 40 + 50 + 60 royalties, 30 + 30 + 40 XP; all three → +1 bonus booster | +150 royalties (+34 %), +100 XP (+14 %), +1 booster a day |
| Weekly quests (3) | 100 royalties + 100 XP each; all three → 1 themed booster (my top genre) | +300 royalties, +300 XP, +1 themed booster a week |
| Premiers pas (once) | 7 small quests, ≈ 2 boosters + 300 royalties in total | a new account gets its first album completed fast |
| Battle votes | 5 XP, first 20 votes a day | ≤ 100 XP a day |
| Badges | 5.7 | occasional |
| Level up | +1 bonus booster | ≈ 21 boosters in the first month |

Net: income rises from ≈ 440 to ≈ 600 royalties a day, two album boosters a day instead of 1.5: a chosen album completes in about
1.5 days instead of 2. No daily punishment: an unclaimed day simply rolls over; nothing expires except the period's quests themselves.

### 6.8 Sets (« coffrets », P2-B)

Editorial sets in `shared/sets.js` (« French Touch », « Essentiels 1977 »…, 6–12 albums), generated sets (genre × decade, the 8 most
popular albums, frozen at creation by the `sets-generate` job) and event sets. Progress = completed albums of the set (from
`achievements`). Rewards: 6 of 8 → badge `set:<id>` Bronze; 8 of 8 → the set's frame cosmetic. Sets stay available forever, so they
turn « 0,1 % de 240 261 » into « 3/8 du coffret French Touch » without FOMO. Collection tab « Coffrets » and `/sets/:id`.

### 6.9 Events calendar in code (`shared/events.js`, P2-B)

| Slug | Window (Europe/Paris) | Theme | Event content |
|---|---|---|---|
| `french-touch` | 16–29 Nov 2026 | French electro | 3 event quests, set « French Touch », battle category `genre:electro` (+ `country:FR` when data exists), frame « French Touch » |
| `retro-2026` | 1 Dec 2026 – 31 Jan 2027 | AlbumMania Rétro | Rétro unlocked, Home chip, badge `event:retro-2026` |
| `annees-80` | 18–31 Jan 2027 | 1980s | quests on `new_cards{decade:1980}`, set « Années 80 », `decade:1980` battles |
| `rap-us-90` | 15–28 Feb 2027 | rap 1990s | `genre_decade:rap:1990` battles and set |
| `rock-legends` | 15–28 Mar 2027 | rock | set, battles, frame |
| `chansons-d-europe` | May 2027 (dates of the contest week) | European songs | named without the "Eurovision" trademark |
| `albums-de-l-ete` | 5–18 Jul 2027 | summer albums | community list challenge, battles |

Event state lives in `user_quests` (`e:<slug>`), `battle_votes.event_slug`, `sets.event_slug` and `user_cosmetics` (source
`event:<slug>`). Exclusive rewards are AlbumMania-made frames and badges (no artist names in the artwork, no logos, no covers, no
« officiel »). The event frame is time-limited; the event set's badge stays reachable later (no hard FOMO).

### 6.10 Special boosters (P1-D; purchase in P2-D)

Themed boosters (`genre:*`, `decade:*`, `taste`, `event:*`) and album boosters (`album:<id>`, `album:choice`) live in `user_boosters`
and are opened from the « Boosters spéciaux » panel under the Home row with the **unchanged** `PackOpening` animation. Odds per slot are
those of the standard booster, the pool is filtered by the theme; `GET /api/boosters/odds` discloses them. Sources: onboarding, weekly
quests, level milestones, events; optional purchase for 180 royalties in P2-D (never for money).

### 6.11 Comptoir and Vernir (P2-D)

- **Vernir**: turn an owned standard card holo for 4 × its recycle value in royalties, or for 3 duplicates of the same rarity.
- **Comptoir**: 3 duplicates of rarity R → 1 *chosen* missing card of rarity R from a wishlisted album (deterministic exchange with
  the system; no player-to-player trading before P3). The Doublons panel copy stops promising « échanges entre joueurs » in P0 and
  points to the Comptoir once it exists.

---

## 7. Legal, security, performance

### 7.1 Legal (referenced by rule 10)

This is product and engineering guidance, not legal advice; items marked ⚖ in `game-legal.md` need a French IT/IP lawyer before a
public launch.

**Music, lyrics, covers.**
- No audio file is hosted, cached or proxied; no preview MP3 is ever played by AlbumMania (the iTunes preview switch is removed in
  P0-A; the blind test stays in clue mode).
- No lyrics anywhere: no column, no API, no quiz. Community rules forbid posting full lyrics (short critical quotes are fine,
  CPI L122-5 3° a); the report reason `copyright` covers it.
- Covers are hotlinked from the provider CDN and never downloaded, cached, proxied or re-hosted by the server. They are shown only to
  **identify** an album (album and track pages, search rows, tiles, lists, feed cards), with the credit « Pochette : Deezer » and a link
  back on album and track pages. Resizing only: no crop beyond a square source, no filter, no blend, no overlay on the image area.
  The holo foil, rarity gems, « NOUVEAU » and the PROMO ribbon sit on the card **frame**, never over the artwork (P0-B, `Card.jsx`).
- A real cover is never an avatar, a cosmetic, a badge or a prize: `album:<id>` avatars (unlocked by completing the album, a feature
  kept) render the album's **generated AlbumMania art** (P0-B, `Avatar` in `ui.jsx`).
- Per-album takedown: the admin « Retirer la pochette » sets `cat_albums.cover_blocked`; `CoverArt` then draws the generated art
  everywhere at once, the request is logged (P0-F admin, P0-B `CoverArt`).
- The Spotify Web API path is deleted from `covers.js` (Spotify forbids games); `COVERS=auto` means Deezer only; plain
  `open.spotify.com` search links remain (no API use). The look-alike Spotify logo in `ProviderMark` becomes the text « Spotify »
  (P0-B).

**Listening: official, click-to-load (P0-C `ListenPanel`).**
- Links: the Deezer album or track page (`url` field), and search links for Spotify, Apple Music and YouTube, ordered by the
  « Plateforme d'écoute préférée » setting.
- Embed: the Deezer widget `https://widget.deezer.com/widget/dark/{album|track}/{deezerId}` (id parsed from the stored Deezer URL),
  behind a placeholder: « Écouter avec Deezer · Le lecteur Deezer dépose des cookies. [Charger le lecteur] [Toujours charger] »
  (choice per provider in `localStorage`, reset in Settings). Iframe attributes: `title="Lecteur Deezer : <titre>"`, `loading="lazy"`,
  `allow="encrypted-media; clipboard-write"`, `referrerpolicy="strict-origin-when-cross-origin"`. Never autoplay, never restyled or
  overlaid, never in the blind test, a booster opening or a battle (battles link to the album page). Spotify and Apple embeds only when
  an id comes from a CC0 source (Wikidata, MusicBrainz) in P2-C; never via the Spotify Search API.

**Share images: Mes 9 albums, Taste Match, Rétro, completion, badges (P1-C engine `client/src/share/`).**
- Default: each tile is the album's **generated AlbumMania art** with its title and artist set in Archivo/Figtree; footer « AlbumMania »
  wordmark (no URL yet, as the owner asked). Fully safe and recognisable thanks to the text.
- Real covers only when the owner sets `SHARE_COVERS=deezer` (off by default, exposed as `shareCovers` in `/api/legal/info`). Then the
  image is composed **in the user's browser only**: `img.crossOrigin = 'anonymous'`, `await img.decode()`, `drawImage`, then
  `canvas.toBlob()`. If loading fails or `toBlob` throws `SecurityError` (tainted canvas: the CDN sent no
  `Access-Control-Allow-Origin`), the engine redraws the canvas with generated art for the failing tiles and drops the covers from that
  image. When at least one real cover is drawn, the image carries « Pochettes © leurs ayants droit · via Deezer ». Never composed or
  stored on the server, never proxied to dodge CORS (this overrides the line of `design-system-current.md` §4.6 that mentions
  same-origin proxied cover thumbnails), never in Open Graph previews, never from Spotify.
- Generated art: the `CoverArt` SVG is serialised, turned into a same-origin Blob URL and drawn (no taint). Fonts are awaited
  (`document.fonts.load('900 64px Archivo')`, `'600 32px Figtree'`) with system fallbacks (demo).
- Formats: 1080 × 1350 (3 × 3 grid), 1080 × 1080, 1080 × 1920 (story). Output: `navigator.share({ files })` when available, else a
  download link from a Blob URL; in the demo sandbox (no downloads, no popups), the image is shown in a modal with « Appuie longuement
  pour enregistrer ».
- Taste Match cards show the other user's username only for a public profile or a friend, else their initials. The yearly feature is
  « AlbumMania Rétro <année> » (never "Wrapped" or "Replay").

**User content (DSA 2022/2065, LCEN as amended by SREN 2024-449, GDPR)**, built in P0-F before the P1 social features ship:
- « Signaler » on every review, post, comment, list and profile (`SafetyMenu`), plus a public notice form `/report` open to anyone
  (DSA art. 16: name, e-mail, exact URL, reason, explanation, good-faith statement) with an acknowledgement e-mail.
- Admin queue with snapshot and context, one-click hide / delete / warn / suspend / dismiss, and prefilled French statements of
  reasons per ground (community rule section or law); the author gets a notification with the decision, the ground and
  « Contester » (DSA art. 17, light internal appeal); the notifier is told the outcome. Threats to life or safety: documented admin
  procedure (report to the authorities, DSA art. 18) in `DEPLOIEMENT.md`.
- Repeat offenders: 3 upheld actions in 90 days → the queue suggests a suspension. Suspended accounts can log in, read, export,
  delete and appeal, but cannot write UGC.
- Links in UGC: allow-list only (`deezer.com`, `open.spotify.com`, `music.apple.com`, `youtube.com`, `youtu.be`, `bandcamp.com`,
  `musicbrainz.org`, `wikipedia.org`), other links are stripped server side and rendered as text; links are refused for accounts
  younger than 24 h or below level 3; allowed links render with `rel="nofollow ugc noopener noreferrer"` (`UgcText`, P0-F).
- Usernames: the reserved list in `shared/rules.js` grows (platform names, « officiel », admin variants, a short slur list).
- Retention: `created_ip` of posts, comments and reports kept one year (`purge-reports-ip`, decree 2021-1362 ⚖); moderation records
  kept and documented in the privacy policy (purge rule: open question, section 10).

**Terms, age, privacy pages (P0-D).**
- Signup checkbox « J'accepte les CGU et j'ai 15 ans ou plus » (link to the CGU); the API requires `acceptTerms` and `age15`. A CGU
  version bump shows a non-blocking banner; UGC writes need the current version (`terms_required`).
- `/legal/mentions` (editor, publication director, host, contact, from `LEGAL_*`), `/legal/terms` (service, accounts, licence on UGC,
  community rules, moderation and appeal, game items and **royalties have no monetary value and no link to authors' rights**, no
  transfer, termination, French law), `/legal/privacy` (data, purposes, legal bases, retention table, processors, cover images loaded
  from the Deezer CDN (IP sent to Deezer), embeds on click only, Google Fonts until self-hosting in P2-E, rights, CNIL), `/legal/rules`
  (community rules), `/legal/cookies` (session and signup cookies only, strictly necessary; third-party cookies only after loading an
  embed; no analytics).
- **Footer, one line on desktop** (wraps to two short lines on phones): « Données et pochettes : Deezer · AlbumMania n'est affilié à
  aucun artiste, label ni plateforme · Mentions · CGU · Confidentialité · Signaler ». The separation statement (« Raretés, cartes,
  royalties, badges et classements sont des éléments de jeu AlbumMania ; les œuvres, pochettes, noms et marques appartiennent à leurs
  ayants droit ») lives in the CGU and the rarity guide.
- Data export and account deletion (P0-F, 4.1.8); « Exporter mes données » and « Supprimer mon compte » in Settings.
- Trademarks: no provider logo look-alikes, no artist photos, no "Wrapped/Replay", event names without third-party marks.
- Deezer terms: the public API is non-commercial and restricts reuse of its content; keep `CATALOG_IMPORT` off in production until
  Deezer approves or the MusicBrainz migration (P2-C) is done, and never monetise before that (section 10).
- **Provider exit** (P2-C): `scripts/detach-provider.js` replaces the destructive `purge-catalog.js`. It stops calls to the provider,
  blocks its cover URLs, removes provider-only facts (rank, fans, provider ids) when asked, keeps every entity another source confirms
  (MusicBrainz match by UPC / ISRC or title and artist) and marks the rest `status = 'withdrawn'`: hidden from browsing, search,
  boosters, battles and Discover, still shown as « archivé » in collections, ratings and lists, so players never lose cards, reviews
  or vinyls. Game data (rarities, `AM-xxx` codes, sets, rankings, ratings) always points to AlbumMania ids, never to provider ids.

### 7.2 Security

**Permissions** (server enforced; the client only hides buttons):

| Resource | Read | Create | Edit / delete | Moderate |
|---|---|---|---|---|
| Profile / Studio | public: any user · friends: friends · private: self (header always) | — | self | admin (suspend) |
| Review | anyone not blocked (published contribution, whatever the Studio privacy) | active | author | admin hide/delete |
| Post | public: any user · friends: friends; never across a block | active | author | admin |
| Comment | whoever can read the target | active, not blocked by the target owner | author; target owner may delete | admin |
| Like | counts public; who-liked list: whoever can read the target | active | own like | — |
| List | public / friends / private | active | owner | admin |
| Notifications, quests, wishlist edits, settings, export | self | — | self | — |
| Admin routes | admin only (`ADMIN_EMAILS`) | | | |

**Validation**: `server/validate.js` (P0-A) helpers `str(v, { min, max, trim })`, `int(v, { min, max })`, `oneOf(v, list)`, `id(v)`
(today's `idOf`), `ids(list, max)`, `bool(v)`; unknown fields are ignored; every handler validates before touching the database; SQL
stays fully parameterised (`json_each` for lists).
**Output**: React escaping only; no `dangerouslySetInnerHTML`; UGC is rendered by `UgcText` (text + allow-listed links).
**Rate limits and quotas**: section 4.0. **Anti-spam**: duplicate-text checks (reviews, posts), link policy, new-account restrictions,
friend-request cool-down, reporters whose reports are dismissed 5 times in 30 days go to the bottom of the queue.
**Blocks**: both directions; hide each other's reviews, posts, comments, lists and profiles; no reply, like, mention, friend request or
taste match; an existing friendship and pending requests are removed; search never shows a blocked member.
**Admin strictly `ADMIN_EMAILS`**: `isAdmin = email verified && email ∈ ADMIN_EMAILS`, recomputed on every request; `users.role` is
ignored; one `/api/admin` sub-router guarded once; every admin mutation in `admin_audit`; `role` no longer exposed; the admin chunk
stays lazy; login is throttled per identifier (5 failures / 15 min) on top of the IP limit; scrypt N = 2^17 with rehash on login.
**Sessions**: `Secure` cookie whenever `APP_URL` is https (not only with `NODE_ENV=production`), expired sessions and tokens purged
nightly, « Se déconnecter des autres appareils ».
**Dev mailbox**: only with `DEV_MAILBOX=1` and a localhost `APP_URL`; `DEV_MAILBOX=1` with a public `APP_URL` refuses to start.
**Headers** (P0-A): `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.dzcdn.net https://coverartarchive.org
https://*.archive.org; frame-src https://widget.deezer.com https://open.spotify.com https://embed.music.apple.com; connect-src 'self';
frame-ancestors 'none'; base-uri 'self'; form-action 'self'` (the Google Fonts entries leave with self-hosting in P2-E),
`Strict-Transport-Security` in production, `Permissions-Policy: camera=(), microphone=(), geolocation=()`,
`Cross-Origin-Opener-Policy: same-origin`, plus the existing `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`.
**Secrets**: `kv['secret']` (32 random bytes, created at first boot) signs battle tokens; never sent to the client.
**Express 5 hardening**: missing body, malformed cookie, 413 (4.1.1).

### 7.3 Performance

**Budgets**: typical player API p95 < 50 ms, whale < 150 ms; no user-triggerable synchronous query above 100 ms (one process, one
synchronous SQLite connection: a slow query stalls everyone).

| Hot spot (server-map §12) | Fix | Measured after | Owner |
|---|---|---|---|
| `publicProfile` vinyls (23 s whale, also a DoS) | CTE LIMIT first + `user_album_progress.holo` + 30 s LRU | 0.19 ms | P0-A |
| `state()` on every action (4.6 MB whale) | partial state + deltas, full state only on `GET /api/state` | < 10 KB per action | P0-A |
| `catalog.stats` / `focusAlbums` GROUP BYs (177 / 138 ms whale) | `user_album_progress` maintained in `addCards` | 0.4 ms | P0-A, P1-D |
| `itemRatings` (20 ms) | `rating_stats` + two LIMIT queries | < 2 ms | P0-C |
| `listFriends` N+1 (33 ms) | `userSummaries` + `users.unique_cards` | < 2 ms | P0-A |
| `adminOverview` correlated counts | counters, pagination, real totals | < 5 ms | P0-A |
| trending / Discover aggregates (230 ms GROUP BY) | `rating_stats`, 10-minute caches | ≤ 3 ms cached | P1-E |
| quest progress | bounded COUNTs (`LIMIT target`) | < 5 ms typical | P1-F |
| `searchAlbums` sort/offset (43–163 ms) | `search_docs`, keyset, seeds first query | < 15 ms | P2-E |
| catalogue draw index (+106 MB heap, 0.9 s boot) | compact id arrays | < 30 MB | P2-E |
| `calibrate()` freezes during import | only unlocked tracks, chunked | no stall > 100 ms | P1-D |

- **Indexes**: section 3.5. `server/test/perf.test.js` (P0-A) asserts with `EXPLAIN QUERY PLAN` that the 12 hottest queries use an
  index (no `SCAN` of `cards`, `ratings`, `activity`, `notifications`); a heavier variant runs against `PERF_DB` (the populated copy)
  when that variable is set and is skipped otherwise.
- **Pagination**: keyset everywhere, limits capped (4.0).
- **Caching**: `server/lru.js` (P0-A): profile 30 s, track owners 5 min, Discover 10 min per user, trending 10 min, rankings 60 s;
  `rating_stats` is the cache for averages; `taste_matches` 6 h; `user_stats_cache` 1 h; search suggest cached by the client and with
  `Cache-Control: private, max-age=30`.
- **Client**: images `loading="lazy"`, `decoding="async"`, `srcset` from `thumb`/`cover` widths with `sizes` per use (40 px search rows,
  160–220 px tiles); skeletons for every list; infinite lists with `IntersectionObserver` and a « Voir plus » button fallback; pages
  lazy-loaded by `routes.jsx` (Home and Auth eager); partial-state merges avoid re-rendering the whole tree on each action.
- **Pragmas**: `synchronous = NORMAL`, `temp_store = MEMORY`, `mmap_size`, `cache_size`, `PRAGMA optimize` at boot and nightly
  (section 3.2).

---

## 8. Priorities and acceptance criteria

A level is done only when its **exit checklist** (9.8) passes. Owners in brackets refer to section 9.

### 8.1 P0: foundations (must ship first)

| # | Item | Acceptance criteria | Owner |
|---|---|---|---|
| P0.1 | **Current-identity design system applied without changing the look** | Tokens of `design-system-current.md` defined once in `app.css :root` (type scale, spacing, radii 14 / 22 / pill, shadows, durations, z-index) and used by every stylesheet; `npm run lint:css` passes (no hex outside `:root`, no `font-family` outside `:root`, no `font-size` under 12 px except card micro-labels ≥ 10 px). Audit script re-run on the 72 screens of `shots-current/`: 0 interface text nodes under 12 px, 0 card micro-labels under 10 px (elements hidden progressively on very small cards instead), 0 body texts under 4.5:1 (`--haze-2` ≥ #948ca6). Disabled buttons are a muted outline, not a grey fill. One chip component (`design-system-current` §3.3: `.chip` with size, tone, type and toggle modifiers) replaces the chip-like styles (`.chip-btn`, `.tag`, `.level-chip`, `.master-tag`, `.role-tag`, `.owned-chip`, `.friend-score`, `.album-tile__badge`…), with old selectors kept as aliases until every JSX use is migrated; `.pill`, `.seg`, `.count-badge`, `.dot-badge` stay separate components as specified there. Phone card grid 2 columns (3 between 520 and 640 px). **Visual parity**: Home hero and Boutique / Doublons / Blind test row at 1440 × 900 and 390 × 844 match `owner-reference-current-ui.webp` / `shots-current/d-30-home.png`, `m-30-home.png` (same fonts, colours, pack art, title size ± 2 px, ivory button, panels); PackOpening unchanged frame by frame. Holo foil never drawn over a real cover; `album:<id>` avatars show generated art | P0-B |
| P0.2 | **Global search with autocomplete** (owner's explicit request) | Top bar: inline field ≥ 1080 px, panel from a search icon at 860–1079 px, full-screen sheet with a search icon on phones; Collection Albums tab uses the same combobox. Typing 2+ characters shows clickable grouped rows (albums and tracks with 40 px cover thumbnails, artists, members, lists) in < 150 ms end to end on the fixture (server < 20 ms p95). The 13 acceptance queries of 5.1 return the expected first result, including typos, with « Vouliez-vous dire » when nothing matches by prefix. Keyboard (↑ ↓ Enter Escape) and screen reader (combobox pattern) work. « Voir les N résultats » opens `/search` with tabs and counts. Blocked members never appear. Index built at boot ≤ 10 s on the fixture and updated ≤ 5 min after an import. Works in the demo with the 20 albums | P0-E |
| P0.3 | **Full schema, migrations, jobs** | `server/db.js` = section 3 exactly (SCHEMA, COLUMNS, STEPS v1–v9, INDEXES); a fresh database and a migrated copy of the fixture and of the populated perf copy both end at `user_version = 9` with identical `sqlite_master`; a second boot is a no-op (< 50 ms); `jobs.js` runs the P0 jobs at 04:10 Paris and once at boot when stale; `npm test` green | P0-A |
| P0.4 | **Track page** | `/track/:id` shows header, my card (or ghost card + « Presser · N »), listening panel, my rating, friends' scores, community summary, friends' then community reviews, other tracks of the album; every track mention (tracklist titles, card modal « Voir la page du morceau », Home feed, rated-item links, search rows) links to it; unknown id → « Cette face n'existe pas »; works in the demo | P0-C |
| P0.5 | **Navigation update** | Desktop nav Accueil · Découvrir · Collection · Studio + search + packs pill + royalties pill + bell + avatar (FR/EN and sound in the account menu, Amis in the Studio header and the menu); phone top bar with search icon and bell; phone tab bar Accueil · Découvrir · Boosters · Collection · Studio (opaque, mini-pack icon with count, friend-request dot on Studio); the Boosters tab and the packs pill open the booster sheet shortcut, which opens the unchanged PackOpening; the Home hero and row are untouched; no horizontal scroll at 390 px; Blind test reachable from the Home row and Discover | P0-D |
| P0.6 | **`publicProfile` performance fix** | Whale profile (60k cards, 3,000 vinyls) answers in < 50 ms (was 23 s) in `perf.test.js` on the populated copy; payload has no `role`; profile of a typical player < 10 ms | P0-A |
| P0.7 | **Legal pages and one-line footer** | `/legal/mentions`, `/terms`, `/privacy`, `/rules`, `/cookies` in FR and EN, reachable as a guest, from the footer, the signup form and Settings; footer is one line at ≥ 1080 px; signup requires « J'accepte les CGU et j'ai 15 ans ou plus »; `GET /api/legal/info`; Spotify Web API code deleted (`COVERS=auto` = Deezer); no « droits d'auteur » gloss on royalties | P0-D (pages, auth), P0-B (wording, avatar, foil) |
| P0.8 | **Login redirect fix** | `/collection/cards` as a guest → `/login` → after login, back on `/collection/cards`; only internal paths are honoured (never `/login`, `/signup`, external URLs) | P0-D |
| P0.9 | **Ratings v2** | Reviews carry stable ids; album and track pages show « Vos amis » before « Communauté AlbumMania » with cursor pagination; averages from `rating_stats` match a full recount in tests; half-star labels read « 4,5 étoiles » (bug of `ux-audit` P1-11 fixed) | P0-C |
| P0.10 | **Safety base, pulled forward from P1** (the P1 social core depends on it, and reviews are already UGC) | « Signaler » on reviews, friend rows and member search rows; public notice form `/report` (guest); blocks enforced in reviews, friend requests and search; admin moderation queue with decisions, statements of reasons, appeals, suspension, cover takedown, audit log; bell + `/notifications` (friend requests, decisions); Settings: blocked members, « Exporter mes données » (JSON), « Supprimer mon compte » (cascade, counters recomputed) | P0-F |
| P0.11 | **State slimming and hardening** | Mutation responses carry a partial state + deltas (whale booster opening < 10 KB instead of 4.6 MB) and the client state after a sequence of actions equals a fresh `GET /api/state` (test on `mergeState`); missing body / malformed cookie / 33 KB body return 400 / 200 / 413, never 500; CSP and the other headers present; dev mailbox only with `DEV_MAILBOX=1` on localhost | P0-A |

### 8.2 P1: very high value

| # | Item | Acceptance criteria | Owner |
|---|---|---|---|
| P1.1 | **Social core** | Posts with optional album / track / artist / list / review mention rendered as an interactive card linking to its page; comments with one reply level; likes on posts, reviews, comments, lists; review permalinks `/review/:id` with replies; Home feed below the unchanged booster row with tabs Tes amis (default) · Pour toi · Communauté, friends first, infinite scroll, empty state; notifications for likes, comments and replies, grouped; album / track / artist « Discussions » | P1-A |
| P1.2 | **Studio redesign (current style)** | Header, tabs (Vue d'ensemble, Critiques, Listes, Vinyles, Badges, Posts), configurable blocks (hide / reorder) with the defaults of 2.5, bio, privacy (public / friends / private) enforced by the server, favourite artists and tracks, featured vinyl, cosmetics selection, « Comparer nos goûts », ⋯ Signaler / Bloquer; looks like the current profile page (same panels, vinyl shelf, showcase cards) | P1-B |
| P1.3 | **Lists and Mes 9 albums** | Lists (ranked or not, public / friends / private, ≤ 250 items, notes, likes, comments, « Ajouter à une liste » from album pages and search); `/nine` editor like my9games (3 × 3 slots, search to pick, drag or ↑ ↓ to swap, 3 formats, 2 themes); « Générer l'image » produces a PNG with generated art and the « AlbumMania » footer, shared or downloaded, with the CORS fallback of 7.1; read mode `/u/:username/nine` | P1-C |
| P1.4 | **Taste match** | `/match/:username` shows the score, confidence, component bars with plain explanations, shared albums / artists / tracks / genres, differences, recommendations each way, a share card; figure on user cards and the Studio; unavailable across blocks and private profiles; < 15 ms uncached | P1-E |
| P1.5 | **Battles and rankings** | One duel at a time with skip; signed tokens; Elo per category (global, artist, decade, genre, year, genre × decade, track duels); rankings hub and lists with « provisoire » under 50 votes; album page « Autour de l'album »; no embed in battles | P1-F |
| P1.6 | **Quests** | 3 daily + 3 weekly quests rolled per player (Paris periods), progress computed from source tables, claim and reroll, daily bonus booster, Premiers pas; Home status row (quest chips) under the booster row; rewards of 6.7 | P1-F |
| P1.7 | **Badges** | The P1 families of 5.7 evaluated on events and backfilled once for existing players; `/badges` with progress; Studio trophy shelf; toast + notification + feed item for Or / Platine | P1-F |
| P1.8 | **Onboarding** | `/welcome` after the first verification (5 skippable steps), result screen with profile, 12 recommendations, ≤ 6 suggested friends, welcome themed boosters, pre-filled wishlist; « Refaire mon profil musical » in Settings; a brand-new account's Home is not empty | P1-E |
| P1.9 | **Personalised Discover** | Sections of 5.5 with one-line reasons, tiles, cold-start behaviour; ≤ 60 ms uncached | P1-E |
| P1.10 | **Collection game** | Wishlist and focus split, promo fix (promo focus + pressable promos), soft pity, rarity freeze + `pulled_rarity`, completion moment with Pressage n°, level reward track (+1 booster per level, cosmetics of 6.6), « Boosters spéciaux » panel; rarity guide discloses every rule | P1-D |

### 8.3 P2: important improvements

| # | Item | Acceptance criteria | Owner |
|---|---|---|---|
| P2.1 | Music Passport | `/passport` and Studio stats block: totals, favourites, distributions, timeline, taste evolution, share card; cached 1 h | P2-A |
| P2.2 | AlbumMania Rétro | `/retro/:year` with 5 share slides, Home chip in December–January | P2-A |
| P2.3 | Events | Calendar of 6.9 in code; event quests, set, battle category, frame and badge; Home event chip | P2-B |
| P2.4 | Sets (coffrets) | Editorial and generated sets, Collection tab « Coffrets », `/sets/:id`, set badge and frame | P2-B |
| P2.5 | Collection extras and cosmetics extras | Deluxe edition, Vernir, Comptoir, themed booster purchase (180 royalties), extra cosmetics from sets and events; the Doublons panel points to the Comptoir | P2-D |
| P2.6 | Catalogue provenance and enrichment | Importer writes `external_ids` (Deezer, UPC, ISRC); MusicBrainz / Wikidata enrichment at 1 request per second (country, MBIDs, Spotify / Apple ids); `album_similar` job; Spotify / Apple embeds when ids exist; `scripts/detach-provider.js` replaces the destructive purge (users keep cards, ratings and vinyls of withdrawn items) | P2-C |
| P2.7 | Search v2, performance, fonts | `/catalog/albums?q=` on `search_docs` (`cat_search` retired), keyset browsing, compact draw index (< 30 MB), seed catalogue out of the main bundle, fonts self-hosted (same families and axes, no Google request), full second-pass e2e | P2-E |

### 8.4 P3: experimental, not scheduled

Friend trades with strict limits (level ≥ 10, friends ≥ 7 days, 1:1 same rarity, no promos or legendaries, 3 a day, atomic, audited);
follows in addition to mutual friends; read-only public pages for guests with Open Graph previews that never include covers; Apple
Music embed and a provider-independent popularity signal (ListenBrainz if its licence allows); installable PWA, opt-in web push and a
weekly e-mail digest; a yearly « Édition » re-rating event with « 1re édition » stamps; multiplayer blind test; more languages.

---

## 9. Implementation workstreams

Each level runs its workstreams **concurrently in the same working tree**. Inside a level, file ownership is strictly disjoint: a
file appears in exactly one list below. Ownership can change between levels (levels run one after the other). Shared files
(`server/app.js`, `server/modules.js`, `client/src/routes.jsx`, `client/src/App.jsx`, `client/src/i18n/areas/index.js`,
`client/src/demo/mockServer.js`, `client/src/demo/mock/index.js`, `package.json`) have one owner per level and an extension mechanism,
pre-wired once by the kick-off K0, so that no workstream ever needs to edit them to plug in.

### 9.0 Rules for concurrent agents, ports, databases

1. Edit only the files of your list. A new file not listed goes under your own folder (`components/<your-folder>/`) and is reported.
2. Never run git commands that change the tree or the index (`commit`, `stash`, `checkout`, `reset`, `merge`, `restore`); the
   orchestrator commits at the end of each level. `git diff` and `git status` are fine. Never reformat files you do not own. Never run
   `npm install` (dependencies are installed by K0 or by the level owner of `package.json`).
3. Ports (API `PORT`, Vite `WEB_PORT`, Vite proxy `API_URL=http://localhost:<api>`):

   | Level | A | B | C | D | E | F |
   |---|---|---|---|---|---|---|
   | K0 | 3100 / 5100 | | | | | |
   | P0 | 3101 / 5101 | 3102 / 5102 | 3103 / 5103 | 3104 / 5104 | 3105 / 5105 | 3106 / 5106 |
   | P1 | 3111 / 5111 | 3112 / 5112 | 3113 / 5113 | 3114 / 5114 | 3115 / 5115 | 3116 / 5116 |
   | P2 | 3121 / 5121 | 3122 / 5122 | 3123 / 5123 | 3124 / 5124 | 3125 / 5125 | |
   | P3 | 3131 / 5131 | 3132 / 5132 | 3133 / 5133 | 3134 / 5134 | | |

4. Databases: `mkdir -p /tmp/am-<id> && cp "$FIXTURE" /tmp/am-<id>/am.db` (`FIXTURE` = the scratchpad `fixture20k.db`, given by the
   orchestrator) and start the API with `DATABASE_FILE=/tmp/am-<id>/am.db ADMIN_EMAILS=luka@example.com DEV_MAILBOX=1
   APP_URL=http://localhost:<web> PORT=<api>`. Performance checks use `PERF_DB` (a copy of `design/schema-proto/old.db`, the populated
   5,000-user database), never the original.
5. Write your PIDs to `/tmp/am-<id>/*.pid` and stop them with `kill <pid>`; never `pkill -f` a pattern that matches your own command.
6. Tests: `node --test server/test/<module>.test.js` while working; `npm test`, `npm run build`, `npm run build:demo`,
   `npm run lint:css` and `node scripts/e2e/<id>.mjs` (with `BASE=http://localhost:<web>`) before reporting.
7. Final report: files changed, contracts implemented, deviations from this plan (with the reason), known issues.

**Per-workstream test triple** (mandatory): a server test file `server/test/<module>.test.js` (node:test, in-memory database, real
HTTP through `server/test/helpers.js`), the demo twin `client/src/demo/mock/<module>.js` (same shapes, bots seeding content so demo
pages are not empty), and a browser script `scripts/e2e/<id>.mjs` (desktop 1440 × 900 and phone 390 × 844, zero console errors,
screenshots in `$OUT`), built on `scripts/e2e/lib.mjs`.

### 9.1 K0: kick-off (sequential, one agent, before any P0 workstream starts; files then belong to P0-A unless stated)

1. `scripts/scaffold.mjs` (idempotent, never overwrites an existing file) generates every stub listed below; run it once.
2. **Server registry**: `server/modules.js` exports the ordered module list (`moderation, notifications, search, ratings, tracks,
   legal, account, lists, collection, social, feed, studio, match, onboarding, discover, quests, badges, battles, passport, sets,
   events, enrich, workshop`). `server/app.js` is refactored to build `deps` (4.0), call each `init(deps)` in that order
   (`deps[name] = result`; `deps.access = deps.moderation.access`; `deps.notify = deps.notifications.notify`), mount
   `publicRoutes` on `/api`, `routes` on the user router **before** the legacy routes, `adminRoutes` on one guarded `/api/admin`
   sub-router, and hand `jobs` to a minimal `server/jobs.js` (registration only; P0-A adds the scheduler). Also `server/bus.js`, `server/paging.js`, `server/lru.js`, `server/validate.js`,
   `shared/periods.js` (small, final versions).
3. **Server stubs** (`export const name; export function init(); export function routes()`), whose `init` returns working no-op
   APIs so a module filled by another workstream of the same level can already call them:
   P0 `ratings` (`rate` → 501 `not_ready`, `summaryOf` → null), `tracks`, `search` (`upsert/remove/refresh` no-op), `legal`,
   `moderation` (`purgeTarget` no-op, `snapshot` → null, `access` permissive: `hiddenIds` → empty Set, `isBlocked` → false,
   `canSee(v, o, vis)` → `vis === 'public' || v === o`, `assertActive` no-op, `linkPolicy(t)` → t), `notifications` (`notify` no-op,
   `unreadCount` → 0), `account`;
   P1 `social`, `feed`, `studio`, `lists` (`setGrid9` no-op), `collection` (`addXp` = plain `UPDATE users SET xp = xp + ?`,
   `grantBooster`/`grantCosmetic` no-op, `unlockedCosmetics` → []), `match` (`cachedScore` → null), `onboarding`, `discover`,
   `quests`, `badges`, `battles`; P2 `passport`, `sets`, `events`, `enrich`, `workshop`.
4. **Client routes**: `client/src/routes.jsx` declares every route of 2.1 as `{ path, page, guest?, eager? }`; pages resolve through
   `import.meta.glob('./pages/*.jsx')` (lazy; `Home` and `Auth` imported eagerly), and a missing page file renders `NotFound`. Adds
   `/studio`, `/profile → /studio`, `/search`, `/track/:id`, `/legal/:page`, `/report`, `/notifications`, `/settings`, `/discover`
   and the later routes. `client/src/pages/NotFound.jsx` (minimal). `App.jsx` is switched to `routes.jsx` with no other change.
   (`routes.jsx`, `NotFound.jsx`, `App.jsx` then belong to P0-D.)
5. **Mock registry**: `client/src/demo/mock/index.js` imports every module mock; `mockServer.js` checks module routes **before** its
   core routes (so a module can also override a core route), calls each module's `seed(db, ctx)` on a fresh demo database and
   `migrate(db)` on old saves, and exports `ctx = { db, me, userById, userByName, summaries(ids), refs, state, partialState, fail,
   save, now, rand, staticCatalog, TRACK, ALBUM, ARTIST }`. Mock stubs: `export const routes = []; export function seed() {}
   export function migrate() {}` for every module of item 3.
6. **i18n areas**: stubs `export default { fr: {}, en: {} }` for `track, shell, legal, search, safety, social, studio, lists, game,
   discover, play, passport, sets, enrich, workshop`; `areas/index.js` lists them after the existing five. Frozen afterwards.
7. **Slot component stubs** (render `null`, or the minimal fallback named here; header comment = owner + props of 9.2):
   P0 `components/search/GlobalSearch.jsx`, `components/safety/SafetyMenu.jsx`, `components/UgcText.jsx` (fallback: text with
   `white-space: pre-line`), `components/shell/NotificationBell.jsx` (fallback: `.icon-btn` bell linking to `/friends` with the
   pending-friends `.count-badge`), `components/settings/SafetySettings.jsx`, plus P0-B's shared pieces so P0-D and P0-E build
   from day one: `components/AlbumTile.jsx` (re-exports today's `AlbumTile` from `Home.jsx`), `state/boosterFlow.js` (hook returning
   no-ops and a null overlay);
   P1 `components/social/{Discussions,UserPosts,LikeButton}.jsx`, `components/lists/{AddToList,Grid9,UserLists}.jsx`,
   `share/{ShareSheet.jsx,renderImage.js}` (`renderImage` rejects with `not_ready`), `components/game/{WishlistToggle,SpecialBoosters}.jsx`,
   `components/discover/SimilarAlbums.jsx`, `components/match/{MatchFigure,HomeCards}.jsx`, `components/play/slots.jsx`
   (`QuestStrip`, `BattleWidget`, `TrophyShelf`, `AlbumRankings`), `components/settings/{StudioPrivacy,MusicProfileSettings}.jsx`;
   P2 `components/passport/StudioStats.jsx`, `components/sets/{SetsTab,EventChip}.jsx`, `components/game/VernirButton.jsx`.
8. **Tooling**: `package.json` scripts `lint:css`, `scaffold`, `owners`, `e2e` (`node scripts/e2e/run.mjs <level>`);
   `scripts/e2e/lib.mjs` (browser launch, `run(name, viewport, fn)`, console-error capture, login and admin helpers, screenshots,
   extracted from `scripts/e2e.mjs`, which keeps working), `scripts/e2e/run.mjs`; `server/test/helpers.js` (`startApp({ catalog })`
   on `:memory:` with port 0, `signupVerified`, `api(base, cookie, method, path, body)`); `scripts/owners.json` (file → workstream for
   each level, transcribed from 9.3–9.6) and `scripts/check-owners.mjs` (compares `git status --porcelain` with the owner list and
   prints any file touched outside it; the orchestrator runs it after each workstream).
9. Verify: `npm test`, `npm run build`, `npm run build:demo` (the glob and the stubs must survive the single-file demo packaging).

### 9.2 Shared contracts (all levels)

**Server**: module contract and `deps` (4.0), domain events (4.0), shapes `UserSummary`, `Review`, `Post`, `Comment`, `ListSummary`,
`FeedItem`, `Notification`, `Quest` (section 4), cursor format (4.0), partial state (4.1.1), error codes per endpoint.

**Client state and hooks**

| Contract | Where (owner) | Signature |
|---|---|---|
| Game state | `state/GameContext.jsx` (P0-A; frozen from P1) | `useGame()` → `{ status, user, packs, cards, counts: { pendingFriends, unread }, stats, owned, ownedSet, achievements, ratings, duplicates, albumProgress, artistProgress, isAdmin, ratingScale, applyState, now }`; `user.prefs`, `user.onboarded`, `user.termsOk` |
| Response merge | `api.js` + `state/mergeState.js` (P0-A) | `onApiResponse(fn)`; every response with `state` is merged (`partial` → merge + deltas) |
| Cached GET | `state/catalog.js` (existing, frozen) | `useApi(path)`, `clearApiCache(prefix)`, `useAlbum/useTrack/useArtist(id)` |
| Lists | `state/paged.js` (P0-B) | `usePagedList(path, opts)` (offset, moved from Collection), `useCursorList(path, { limit })` → `{ items, loading, error, hasMore, loadMore, reload, prepend, update(id, fn), remove(id) }`, `useDebounced(value, ms)` |
| Search | `state/search.js` (P0-E) | `useSearchSuggest(q, { scope })` → `{ data, loading }` (cache + stale tickets) |

**Shared components** (props are the contract; the owner may restyle, never rename props)

| Component | Path (owner) | Props |
|---|---|---|
| `AlbumTile` | `components/AlbumTile.jsx` (P0-B) | `{ album, progress?, to?, compact?, onClick? }` (union of the two current tiles; `Home.jsx` re-exports it for `ArtistPage`) |
| `EmptyState`, `ErrorBox`, `LoadMore`, `Skeleton` | `components/feedback.jsx` (P0-B) | `{ icon, title, body, action }`, `{ error, onRetry }`, `{ hasMore, loading, onClick }`, `{ kind: 'tile'\|'row'\|'card', count }` |
| `CoverArt`, `Card`, `Avatar`, `Icon` | existing (P0-B in P0) | unchanged; `CoverArt` honours `art.coverBlocked`; `Avatar` gains `frame` (P1-B); `Icon` gains `bell, heart, comment, share, list, trophy, flag, compass, home, more, quote` |
| `SearchCombobox` | `components/search/SearchCombobox.jsx` (P0-E) | `{ scope, placeholder, variant: 'bar'\|'sheet'\|'inline', onPick(result), onSubmit(q), autoFocus }`; `result = { kind, id }` |
| `GlobalSearch` | `components/search/GlobalSearch.jsx` (P0-E) | none; mounted by the shell in the top bar |
| `useBoosterFlow` | `state/boosterFlow.js` (P0-B) | `useBoosterFlow()` → `{ openFree(count), openAlbum(albumId), openSpecial(id), buy(), recycle(), overlay }` (`overlay` renders the unchanged `PackOpening`) |
| `BoosterSheet` | `components/shell/BoosterSheet.jsx` (P0-D) | `{ open, onClose }` |
| `ListenPanel` | `components/ListenPanel.jsx` (P0-C) | `{ kind: 'album'\|'track', item }` |
| `SafetyMenu` | `components/safety/SafetyMenu.jsx` (P0-F) | `{ target: { type, id }, user?: UserSummary }` (⋯ menu: Signaler, Bloquer / Débloquer) |
| `UgcText` | `components/UgcText.jsx` (P0-F) | `{ text, clamp? }` |
| `NotificationBell` | `components/shell/NotificationBell.jsx` (P0-F) | none |
| `LikeButton` | `components/social/LikeButton.jsx` (P1-A) | `{ targetType, targetId, liked, count }` |
| `ShareSheet`, `renderImage` | `share/` (P1-C) | `<ShareSheet spec title onClose />`; `renderImage(spec) → Promise<{ blob, usedCovers }>`; `spec = { format: 'portrait'\|'square'\|'story', theme: 'ink'\|'ivory', title, subtitle?, tiles: [{ albumId \| trackId, label?, sub? }], blocks?: [...], footer: 'AlbumMania' }` |

**Page slots** (the host page owner places the slot; the slot owner fills the stub created by K0):

| Slot | File (owner) | Host (owner) | Props |
|---|---|---|---|
| `Discussions` | `components/social/Discussions.jsx` (P1-A) | Album, Track, Artist pages (P1-B) | `{ itemType, itemId }` |
| `UserPosts` | `components/social/UserPosts.jsx` (P1-A) | Studio tab Posts (P1-B) | `{ username }` |
| `AddToListButton`, `AlbumListsBlock` | `components/lists/AddToList.jsx` (P1-C) | Album, Track pages, search rows (P1-B) | `{ item: { type, id } }`, `{ albumId }` |
| `Grid9Block`, `UserLists` | `components/lists/Grid9.jsx`, `UserLists.jsx` (P1-C) | Studio (P1-B) | `{ username, editable }` |
| `WishlistToggle`, `WishlistBlock` | `components/game/WishlistToggle.jsx` (P1-D) | Album page, tiles (P1-B), Studio | `{ albumId }`, `{ username }` |
| `SpecialBoosters` | `components/game/SpecialBoosters.jsx` (P1-D) | Home, under the row (P1-A) | none |
| `SimilarAlbums` | `components/discover/SimilarAlbums.jsx` (P1-E) | Album page (P1-B) | `{ albumId }` |
| `MatchFigure`, `TasteMatchCard`, `SuggestedFriends` | `components/match/*.jsx` (P1-E) | Studio header, Friends (P1-B), Home aside (P1-A) | `{ username }`, none, `{ limit }` |
| `QuestStrip`, `BattleWidget`, `TrophyShelf`, `AlbumRankings` | `components/play/slots.jsx` (P1-F) | Home (P1-A), Studio (P1-B), Album page (P1-B) | none, none, `{ username }`, `{ albumId }` |
| `SafetySettings`, `StudioPrivacy`, `MusicProfileSettings` | `components/settings/*.jsx` (P0-F, P1-B, P1-E) | Settings page (P0-D mounts all three in P0) | none |
| `StudioStats` | `components/passport/StudioStats.jsx` (P2-A) | Studio (mounted by P1-B in P1) | `{ username }` |
| `SetsTab`, `EventChip` | `components/sets/*.jsx` (P2-B) | Collection, Home (P2-B) | none |
| `VernirButton` | `components/game/VernirButton.jsx` (P2-D) | Card modal (P2-D), Track page (mounted by P1-B in P1) | `{ trackId }` |

The P1-B Studio and object pages mount the P2 slots `StudioStats` and `VernirButton` already in P1 (they render nothing until P2).

**i18n**: each area file owns its namespaces; a namespace has one owning area per level; a later level may override keys of an earlier
area from its own file, never delete them. Namespaces: `home` (P0-B) · `track`, `album` (P0-C) · `shell`, `nav`, `settings`, `hub`,
`legal`, `footer` (P0-D) · `search`, `collection` (P0-E) · `safety`, `report`, `notify`, `account`, `admin` (P0-F) · `social`, `feed`,
`post`, `comment`, `notify.<P1 kinds>` (P1-A, disjoint keys) · `studio`, `friends` (P1-B) · `lists`, `nine`, `share` (P1-C) · `game`,
`wishlist`, `cosmetics`, `rarityGuide` (P1-D) · `discover`, `match`, `onboarding` (P1-E) · `quests`, `badges`, `battles`, `rankings`
(P1-F) · `passport`, `retro` · `sets`, `events` · `enrich`, `listen` · `workshop`. New error codes go under `errors.<code>` in the area
of the workstream that throws them. French typography (U+202F before `; : ! ? %` and inside « »), tutoiement, every key in FR and EN.

**CSS**: one stylesheet per workstream, imported by its components, tokens only. The new components already designed in
`design/current-v2/components.css` keep their **canonical class names** and the owning workstream copies its sections into its own
stylesheet: top bar search + phone search sheet (`.gsearch*`, `.search-trigger`, `.search-sheet`, `.hl`, `.kbd`, `.stack-thumb`) →
P0-E `search.css` · notifications panel and bell (`.bell`, `.notif*`) → P0-F `safety.css` · booster sheet and 5-item tab bar
(`.sheet*`, `.mini-pack`, `.tabbar__count`) → P0-D `shell.css` · track page header (`.track-head*`) → P0-C `track.css` · post,
mention card, actions, review footer, thread, composer, home columns (`.post`, `.mention*`, `.act-btn*`, `.review__head/__album/__foot`,
`.thread`, `.comment`, `.composer`, `.home-cols`) → P1-A `social.css` · « Mes 9 albums » and list cards (`.nine*`, `.nine-share`,
`.list-card*`) → P1-C `lists.css` · member card, Taste Match, onboarding (`.user-card`, `.match-*`, `.cover-row`, `.steps`,
`.pick-artists`, `.onboard__foot`) → P1-E `discover.css` · battle, quests, medals (`.duel*`, `.status-row`, `.quest-chip`, `.q-ring`,
`.quest`, `.medal*`, `.medals`) → P1-F `play.css` · passport blocks (`.stat-grid`, `.stat-block`, `.stat-bars`) → P2-A `passport.css`;
the avatar colour rule and Blocks A and B go to `app.css` (P0-B). Any **other** new class uses the workstream prefix, declared on the
first line (`/* @prefix gs- */`) and checked by `css-lint`: P0-C `trk-`, P0-D `sh-`, P0-E `gs-`, P0-F `sf-`, P1-A `so-`, P1-B `st-`,
P1-C `ls-`, P1-D `gm-`, P1-E `dc-`, P1-F `pl-`, P2-A `pp-`, P2-B `set-`, P2-C `en-`, P2-D `ws-` (the lint allows the canonical names
listed above for their owner). Selectors may contain shared classes (`.panel`, `.btn`…) as ancestors or descendants but never restyle
them alone. `main.jsx` imports `app.css` first (P0-B), so area files override without specificity hacks.

### 9.3 P0 workstreams (after K0, all six in parallel)

Inside P0: P0-A lands `db.js` first (copied from `schema-proto/schema.mjs`), P0-B lands `AlbumTile.jsx`, `feedback.jsx`,
`state/paged.js` and `state/boosterFlow.js` first; everybody else codes against section 3 and 9.2 meanwhile.

#### P0-A · Schema, server foundations, partial state (3101 / 5101)
- **Scope**: section 3 in `db.js` (SCHEMA, COLUMNS, STEPS, INDEXES, pragmas, `runSteps`); `jobs.js` (scheduler 04:10 Paris, boot
  catch-up, `runJob(name)` for tests) with the P0 jobs `purge-auth`, `purge-dev-emails`, `purge-openings`, `optimize`;
  `services.js`: `addCards` maintains `user_album_progress`, `users.unique_cards`, `achievements.rank` in the same transaction and
  returns `artistDeltas`; `focusAlbums` from `user_album_progress`; `userSummaries`; `publicProfile` fix; `listFriends` without N+1;
  friend-request quota, cool-down, block check; `state(userId, { partial })`; throttled `last_seen_at`; admin audit and paginated
  overview; prefs; bus emits; iTunes preview path removed. `app.js`: partial states on mutation routes, headers (7.2), 413, body
  default, admin sub-router. `security.js`: cookie parsing, `limits`, `quota`. `config.js`: `DEV_MAILBOX`, `LEGAL_*`,
  `TERMS_VERSION`, `SHARE_COVERS`, `COVERS=auto` → Deezer. `mailer.js`: dev mailbox gate. Client: `api.js` response hook,
  `mergeState.js`, `GameContext.jsx` (`counts`, prefs, merge). Mock core (`mockServer.js`): partial state, counts, prefs, signup terms
  validation, friend cool-down. From K0 on, `server/test/helpers.js`, `api.test.js` and `scripts/e2e/lib.mjs` sign up with
  `acceptTerms: true, age15: true` (and tick the signup checkbox when present), so P0-D's terms check breaks no test.
- **Files**: `server/db.js`, `server/jobs.js`, `server/services.js`, `server/app.js`, `server/index.js`, `server/security.js`,
  `server/config.js`, `server/mailer.js`, `server/bus.js`, `server/paging.js`, `server/lru.js`, `server/validate.js`,
  `server/modules.js`, `shared/periods.js`, `client/src/api.js`, `client/src/state/GameContext.jsx`, `client/src/state/mergeState.js`,
  `client/src/demo/mockServer.js`, `client/src/demo/mock/index.js`, `package.json`, `scripts/scaffold.mjs`, `scripts/check-owners.mjs`,
  `scripts/owners.json`, `scripts/e2e/lib.mjs`, `scripts/e2e/run.mjs`, `server/test/helpers.js`, `server/test/schema.test.js`,
  `server/test/foundation.test.js`, `server/test/perf.test.js`, `server/test/api.test.js`, `server/test/scale.test.js`,
  `scripts/e2e/p0-a.mjs` (the K0 infrastructure files are written once in K0; P0-A's own session edits about 20 of them).
- **Provides**: schema, `deps`, bus events, `userSummaries`, partial state, `limits`/`quota`, `paging`, `lru`, `validate`, `periods`.
- **Tests**: `schema.test.js` (fresh vs migrated `sqlite_master` identical, `user_version = 9`, idempotent second boot, cascade of
  account deletion at the SQL level), `foundation.test.js` (partial state + `mergeState` equals a fresh full state after a scripted
  sequence; 400/413/cookie hardening; headers; dev mailbox gating; friend cool-down; `userSummaries` query count = 2),
  `perf.test.js` (`EXPLAIN QUERY PLAN` on the 12 hottest queries; with `PERF_DB`: whale profile < 50 ms, whale booster payload
  < 10 KB); mock core; e2e `p0-a.mjs` (booster opening and profile of a heavy account, network payload sizes).
- **Acceptance**: P0.3, P0.6, P0.11.

#### P0-B · Current-identity design system and shared UI (3102 / 5102)
- **Scope**: read `DESIGN-OVERRIDE.md` and `design-system-current.md` first (the override wins on any conflict) and follow its §5
  steps 1–3: paste Block A (tokens) and Block B (fixes + unified chip) into `app.css`, then replace literals with tokens in every
  existing stylesheet, one stylesheet at a time with screenshot comparison, **without changing the rendering**;
  fix the load order (`main.jsx` imports `app.css` first) and remove the specificity hacks; enforce ≥ 12 px interface text and
  ≥ 10 px card micro-labels with container queries that hide the popularity number first, then the artist line, on tiny cards;
  `--haze-2` = #948ca6; disabled buttons as a muted outline; `.btn--quiet` transparent; the unified `.chip` of §3.3 with the old
  selectors kept as aliases (JSX uses migrate when each page owner touches the file); deterministic avatar colour per user (`auto`); phone card grid 2 columns (3 between 520 and 640 px); tab bar grid `repeat(5, 1fr)` and opaque; fewer decorative uppercase mono labels
  where they hurt reading (CSS-only cases of §2 item 7: `.studio__label`, `.tracklist th`; the JSX swaps belong to each page owner:
  P0-C, P0-D, P0-E, P0-F); one skeleton shimmer; one `prefers-reduced-motion` block. Extract the booster opening state machine
  (today copied in `Home.jsx`, `AlbumPage.jsx`, `Admin.jsx`) into `state/boosterFlow.js` (`useBoosterFlow()`), used by the Home hero
  and by P0-D's booster sheet; the hero's markup and behaviour stay identical.
  Legal visuals: holo foil on the card frame only when the card shows a real cover (`card--cover`); `Avatar` with `album:<id>` draws
  the generated art; `ProviderMark` becomes text; `CoverArt` honours `art.coverBlocked` and carries the cover rules (7.1) as a
  comment. Shared components: `AlbumTile` (one tile replacing the two), `feedback.jsx`, `state/paged.js` (with `useCursorList`),
  new icons. Home: replace the local tile and feed link logic (`FeedItem` uses `useRatedItem`), empty friends-feed state
  « Le studio est calme · Trouver des amis », Doublons copy without the trading promise, `home.royaltiesHint` reworded (no
  « droits d'auteur »); **the booster hero and the row keep their markup and look**. Rarity guide: stacked layout on phones, the
  separation statement and « les royalties sont une monnaie de jeu ». `scripts/css-lint.mjs` (rules of 0.5 and 9.2).
- **Files**: `client/src/styles/app.css`, `home.css`, `collection.css`, `album.css`, `profile.css`, `admin.css`,
  `client/src/main.jsx`, `client/src/components/ui.jsx`, `Card.jsx`, `CoverArt.jsx`, `RarityGuide.jsx`, `AlbumTile.jsx` (new),
  `feedback.jsx` (new), `client/src/state/paged.js` (new), `client/src/state/boosterFlow.js` (new), `client/src/pages/Home.jsx`,
  `client/src/i18n/areas/home.js`, `scripts/css-lint.mjs`, `scripts/e2e/p0-b.mjs`.
- **Provides**: tokens, `AlbumTile`, `EmptyState`/`ErrorBox`/`LoadMore`/`Skeleton`, `usePagedList`/`useCursorList`/`useDebounced`,
  `useBoosterFlow`, icons (incl. `.mini-pack` markup helper for the tab bar), lint.
- **Tests**: no server module (UI only): `npm run lint:css`; e2e `p0-b.mjs` re-runs the audit measurements (`design/audit-tools`
  logic) on Home, Collection, Album, Profile, Blind test, pack opening at both viewports and saves side-by-side screenshots with
  `shots-current/` for the orchestrator's parity review; demo build checked.
- **Acceptance**: P0.1 (and the P0-B part of P0.7).

#### P0-C · Track page and ratings v2 (3103 / 5103)
- **Scope**: `server/ratings.js` (4.1.2: review ids, `rating_stats` maintenance, friends/community split, cursors, quota, link policy,
  duplicate check, events, `deps.ratings`), `server/tracks.js` (4.1.3). Client: `TrackPage.jsx` (composition of 2.5), `ListenPanel`
  (merges `listenLinks`, `ListenBlock`, `AlbumListen`; click-to-load Deezer widget, 7.1), `CardModal` (single title, « Voir la page du
  morceau », uses `ListenPanel`), `AlbumPage` (tracklist titles → track page, « Vos amis » then « Communauté AlbumMania » with
  « Voir plus », `ListenPanel`, `SafetyMenu` on reviews, completion date kept), `Rating.jsx` (`useRatedItem` → `/track/:id`, half-star
  labels with one decimal, `ReviewList` grouped, review anchors `id="review-<id>"`, `UgcText` for review text, unique textarea ids).
  `album.rewardBody` overridden: the avatar unlock shows « le visuel AlbumMania de l'album ».
- **Files**: `server/ratings.js`, `server/tracks.js`, `server/test/ratings.test.js`, `server/test/tracks.test.js`,
  `client/src/pages/TrackPage.jsx` (new), `client/src/pages/AlbumPage.jsx`, `client/src/components/Rating.jsx`,
  `client/src/components/CardModal.jsx`, `client/src/components/ListenPanel.jsx` (new), `client/src/styles/track.css` (new),
  `client/src/i18n/areas/track.js`, `client/src/i18n/areas/album.js`, `client/src/demo/mock/ratings.js`,
  `client/src/demo/mock/tracks.js`, `scripts/e2e/p0-c.mjs`.
- **Consumes**: `deps.access`, `deps.moderation.purgeTarget`, `userSummaries`, `SafetyMenu`, `UgcText`, `useCursorList`.
- **Tests**: `ratings.test.js` (stats equal a recount after random rate/unrate sequences; friends before community; cursor pages;
  quota 429; duplicate 409; blocked authors hidden), `tracks.test.js` (seed and imported tracks, promo siblings, owners, 404); mocks;
  e2e `p0-c.mjs` (open a track from the tracklist, the card modal, the feed; rate half stars; load the widget placeholder).
- **Acceptance**: P0.4, P0.9.

#### P0-D · Shell, navigation, auth, legal pages (3104 / 5104)
- **Scope**: split the shell out of `App.jsx` into `Header.jsx` (top bar, account menu, tab bar) and `Footer.jsx`; navigation of 2.2
  (mounts `GlobalSearch` and `NotificationBell`; Boosters tab with `.mini-pack` and count chip); the booster sheet shortcut
  (`BoosterSheet.jsx`, `design-system-current` §4.13, built on `useBoosterFlow`, opened by the Boosters tab and the packs pill); `routes.jsx` guest and private tables (`/studio`, redirects, guest access to
  `/legal/*` and `/report`); login redirect fix with `state.from` sanitised; signup checkbox; CGU banner for existing users;
  `Settings.jsx` (language, rating scale, sound, preferred listening platform, embed reset, and the three settings slots);
  `Legal.jsx` (5 pages, texts in `areas/legal.js`, editor data from `/api/legal/info`); `NotFound.jsx` (« Cette face n'existe pas » +
  search); `Discover.jsx` P0 hub (popular shelf, genre and decade chips, Blind test tile, search call to action). Server:
  `auth.js` (terms/age, no e-mail enumeration, per-identifier throttle, scrypt rehash, `user.verified`), `legal.js` (4.1.5),
  `covers.js` (Spotify path deleted). Docs: README and DEPLOIEMENT (new env variables, Spotify removal, legal checklist, DSA 18
  procedure).
- **Files**: `client/src/App.jsx`, `client/src/routes.jsx`, `client/src/components/shell/Header.jsx` (new),
  `client/src/components/shell/Footer.jsx` (new), `client/src/components/shell/BoosterSheet.jsx` (new), `client/src/pages/Auth.jsx`, `client/src/pages/Settings.jsx` (new),
  `client/src/pages/Legal.jsx` (new), `client/src/pages/NotFound.jsx`, `client/src/pages/Discover.jsx` (new),
  `client/src/styles/shell.css` (new), `client/src/i18n/areas/shell.js`, `client/src/i18n/areas/legal.js`, `server/auth.js`,
  `server/legal.js`, `server/covers.js`, `server/test/covers.test.js`, `server/test/legal.test.js`, `client/src/demo/mock/legal.js`,
  `scripts/e2e/p0-d.mjs`, `README.md`, `DEPLOIEMENT.md`.
- **Consumes**: `GlobalSearch` (P0-E), `NotificationBell`, `SafetySettings` (P0-F), `counts` (P0-A), tokens, `AlbumTile` and
  `useBoosterFlow` (P0-B). Applies §2 item 7 eyebrow swaps in `Auth.jsx`.
- **Tests**: `legal.test.js` (signup without terms → 400; enumeration-safe signup; per-identifier throttle; legal info), updated
  `covers.test.js` (Deezer only); mock signup terms (in P0-A's core, by contract); e2e `p0-d.mjs` (desktop and phone navigation, all
  tabs, account menu, guest legal pages, login redirect, no horizontal scroll at 390 px, footer one line at 1440 px).
- **Acceptance**: P0.5, P0.7 (pages, auth, covers), P0.8.

#### P0-E · Global search (3105 / 5105)
- **Scope**: `shared/search.js` (normalisation, trigrams, Jaccard, text score), `server/search.js` (index build, refresh timer,
  suggest and paginated endpoints, admin status/rebuild, `deps.search`), `scripts/purge-catalog.js` (also deletes search docs and the
  other dependent rows of 3.2). Client: `SearchCombobox`, `GlobalSearch` (bar, overlay, phone sheet, recent searches),
  `state/search.js`, `SearchPage.jsx` (tabs Tout · Albums · Morceaux · Artistes · Membres · Listes with counts, infinite scroll),
  `Collection.jsx` (combobox in the Albums tab with Enter-to-filter; local tile, paged hook and error box replaced by P0-B's; phone
  layout of 2.5: one progress line + Stats sheet, a « Filtres » button opening a sheet), `Friends.jsx` (member search through the
  combobox instead of exact username; `SafetyMenu` on rows).
- **Files**: `server/search.js`, `shared/search.js`, `server/test/search.test.js`, `scripts/purge-catalog.js`,
  `client/src/components/search/SearchCombobox.jsx` (new), `client/src/components/search/GlobalSearch.jsx`,
  `client/src/state/search.js` (new), `client/src/pages/SearchPage.jsx` (new), `client/src/pages/Collection.jsx`,
  `client/src/pages/Friends.jsx`, `client/src/styles/search.css` (new), `client/src/i18n/areas/search.js`,
  `client/src/i18n/areas/collection.js`, `client/src/demo/mock/search.js`, `scripts/e2e/p0-e.mjs`.
- **Tests**: `search.test.js` (the 13 acceptance queries on a fake-Deezer catalogue built with the fixture names, quotas, blocked
  members excluded, refresh after import, < 20 ms per query); `mock/search.js` with the same scoring; e2e `p0-e.mjs` (type in the top
  bar, pick an album and a track by keyboard and by tap, typo suggestion, Collection combobox + Enter filter, phone sheet).
- **Acceptance**: P0.2.

#### P0-F · Safety, notifications, data rights (3106 / 5106)
- **Scope**: `moderation.js` (4.1.6: reports, public notice form, blocks, queue, decisions with statements, appeals, suspension,
  cover takedown, audit list, `purgeTarget`, `access`, link policy) and its jobs `purge-notifications`, `purge-reports-ip`;
  `notifications.js` (4.1.7, P0 kinds, `notify` subscribed to `friend.requested`, `friend.accepted`, `moderation.action`);
  `account.js` (4.1.8). Client: `SafetyMenu` (report dialog with reasons, block / unblock), `UgcText`, `NotificationBell` (count
  from `state.counts`, dropdown of the last 5, link to the page), `Notifications.jsx`, `Report.jsx` (guest-accessible form),
  `SafetySettings` (blocked members, export, delete account with password confirmation), `Admin.jsx` (tab « Modération » with
  `ModerationTab`: queue, filters, context, actions, prefilled statements; users list paginated; audit view).
- **Files**: `server/moderation.js`, `server/notifications.js`, `server/account.js`, `server/test/moderation.test.js`,
  `server/test/notifications.test.js`, `server/test/account.test.js`, `client/src/pages/Notifications.jsx` (new),
  `client/src/pages/Report.jsx` (new), `client/src/pages/Admin.jsx`, `client/src/components/admin/ModerationTab.jsx` (new),
  `client/src/components/safety/SafetyMenu.jsx`, `client/src/components/shell/NotificationBell.jsx`,
  `client/src/components/settings/SafetySettings.jsx`, `client/src/components/UgcText.jsx`, `client/src/styles/safety.css` (new),
  `client/src/i18n/areas/safety.js`, `client/src/i18n/areas/admin.js`, `client/src/demo/mock/moderation.js`,
  `client/src/demo/mock/notifications.js`, `client/src/demo/mock/account.js`, `scripts/e2e/p0-f.mjs`.
- **Tests**: `moderation.test.js` (report → decision → author notified with the statement → appeal → reversal; blocks hide reviews
  both ways and refuse friend requests; suspended user gets 403 on writes but can export; admin routes refuse a non-admin even with
  `role = 'admin'` in the database; link policy), `notifications.test.js` (grouping, unread count, no self/blocked notifications),
  `account.test.js` (export contains every section; deletion cascades and recomputes `rating_stats` and counters); mocks with a bot
  that reports and a pending decision for the demo admin; e2e `p0-f.mjs` (report a review, guest notice form, admin decision, bell).
- **Acceptance**: P0.10.

### 9.4 P1 workstreams (six in parallel; no kick-off needed: stubs and registries exist since K0)

#### P1-A · Social core: posts, comments, likes, feed (3111 / 5111)
- **Scope**: `social.js` (4.2.1), `feed.js` (4.2.2 and 5.2, with the one-time backfill and the `purge-activity` job); `ratings.js` in
  P1 (`liked`, popular sort, legacy keys removed); Home below the unchanged hero and row: `SpecialBoosters` slot, `QuestStrip` slot,
  composer + tabs + infinite feed, aside (Presque complets, `TasteMatchCard`, `BattleWidget`, `SuggestedFriends`), « Derniers morceaux
  obtenus »; `PostPage`, `ReviewPage`; components `Composer` (text ≤ 1000, mention picker = `SearchCombobox` scope album / track /
  artist, visibility), `FeedList`, `PostCard` (with `MentionCard`), `CommentThread`, `LikeButton`, `Discussions`, `UserPosts`;
  `Rating.jsx` review footer (like, « N réponses » → `/review/:id`). Notification strings for the P1 kinds.
- **Files**: `server/social.js`, `server/feed.js`, `server/ratings.js`, `server/test/social.test.js`, `server/test/feed.test.js`,
  `client/src/pages/Home.jsx`, `client/src/pages/PostPage.jsx` (new), `client/src/pages/ReviewPage.jsx` (new),
  `client/src/components/Rating.jsx`, `client/src/components/social/Composer.jsx`, `FeedList.jsx`, `PostCard.jsx`,
  `CommentThread.jsx`, `LikeButton.jsx`, `Discussions.jsx`, `UserPosts.jsx`, `client/src/styles/social.css`,
  `client/src/i18n/areas/social.js`, `client/src/demo/mock/social.js`, `client/src/demo/mock/feed.js`, `scripts/e2e/p1-a.mjs`.
- **Tests**: `social.test.js` (visibility matrix, blocks, quotas, duplicate post, link policy, one reply level, soft delete with
  replies, counters, notifications grouped, `purgeTarget` on delete), `feed.test.js` (friends first, aggregation rows, diversity rule,
  stable cursor pagination, hidden content excluded); mocks with bots posting, liking and replying; e2e `p1-a.mjs` (post with an album
  mention, reply, like, open the review permalink, phone feed).
- **Acceptance**: P1.1.

#### P1-B · Studio, shell and object pages (3112 / 5112)
- **Scope**: `studio.js` (4.2.3); `Profile.jsx` rebuilt as the Studio of 2.5 in the current look (`StudioHeader`, `StudioBlocks`
  registry with the slots of 9.2, `StudioEditor` for hide / reorder / bio / privacy / cosmetics / favourites; showcase and vinyl shelf
  kept); `Avatar` frame prop; Album page v2 composition (order of 2.5 with the P1 slots: `WishlistToggle`, `AddToListButton`,
  `AlbumListsBlock`, `Discussions`, `SimilarAlbums`, `AlbumRankings`, completion line from `/api/albums/:id/completion`), Track page
  and Artist page slots (+ `VernirButton`, `StudioStats` P2 slots mounted early); `Friends.jsx` (tabs Amis · Demandes · Suggestions
  with `SuggestedFriends`, `MatchFigure` on rows); shell in P1: account menu entries Quêtes and Badges, onboarding redirect (when
  `user.onboarded === false`, once per session, to `/welcome`, except legal and settings pages); `StudioPrivacy` settings slot.
- **Files**: `server/studio.js`, `server/test/studio.test.js`, `client/src/pages/Profile.jsx`,
  `client/src/components/studio/StudioHeader.jsx` (new), `StudioBlocks.jsx` (new), `StudioEditor.jsx` (new),
  `client/src/components/ui.jsx`, `client/src/pages/AlbumPage.jsx`, `client/src/pages/TrackPage.jsx`,
  `client/src/pages/ArtistPage.jsx`, `client/src/pages/Friends.jsx`, `client/src/App.jsx`, `client/src/routes.jsx`,
  `client/src/components/shell/Header.jsx`, `client/src/components/settings/StudioPrivacy.jsx`, `client/src/styles/studio.css`,
  `client/src/i18n/areas/studio.js`, `client/src/demo/mock/studio.js`, `scripts/e2e/p1-b.mjs`.
- **Tests**: `studio.test.js` (privacy matrix incl. blocks, blocks config validation, favourites ≤ 5, locked cosmetic 409, payload
  bounded for the whale); mock Studio of the bots; e2e `p1-b.mjs` (edit the Studio, hide a block, private profile seen by another
  account, album page order on desktop and phone, onboarding redirect once).
- **Acceptance**: P1.2 and the page compositions of 2.5.

#### P1-C · Lists, Mes 9 albums, share images (3113 / 5113)
- **Scope**: `lists.js` (4.2.4, search sync, `setGrid9`); pages `Lists`, `ListPage`, `ListEditor` (combobox picker, drag and
  keyboard reorder, notes), `GridEditor` (`/nine` and read mode, my9games-like flow of 2.5); components `ListCard`, `AddToList`
  (button + sheet; `AlbumListsBlock`), `Grid9` (grid and `Grid9Block`), `UserLists`; the share engine `share/renderImage.js`,
  `share/artImage.js` (generated art → image), `share/ShareSheet.jsx` (preview, share, download, long-press fallback), with the legal
  rules of 7.1 (generated art by default, `SHARE_COVERS`, CORS fallback, attribution, « AlbumMania » footer).
- **Files**: `server/lists.js`, `server/test/lists.test.js`, `client/src/pages/Lists.jsx` (new), `ListPage.jsx` (new),
  `ListEditor.jsx` (new), `GridEditor.jsx` (new), `client/src/components/lists/ListCard.jsx` (new), `AddToList.jsx`, `Grid9.jsx`,
  `UserLists.jsx`, `client/src/share/renderImage.js`, `client/src/share/artImage.js` (new), `client/src/share/ShareSheet.jsx`,
  `client/src/styles/lists.css`, `client/src/i18n/areas/lists.js`, `client/src/demo/mock/lists.js`, `scripts/e2e/p1-c.mjs`.
- **Tests**: `lists.test.js` (visibility, ≤ 250 items, replace-all positions, duplicates, wishlist refused, grid9 singleton, search
  doc sync); mock lists of the bots; e2e `p1-c.mjs` (create a list, add from an album page, build Mes 9 albums, generate the image and
  check its size, dimensions and that the canvas export succeeds without real covers; the demo shows the long-press modal).
- **Acceptance**: P1.3.

#### P1-D · Collection game and economy (3114 / 5114; P1 owner of `services.js`, `app.js`, `mockServer.js`, `db.js` steps)
- **Scope**: 6.2 (completion moment in `Achievements.jsx` + Pressage n° on `Vinyl.jsx`), 6.4 (wishlist, focus split, promo fix,
  pressable promos), 6.5 (soft pity, `pulled_rarity`, calibration of unlocked tracks only in `importer.js`), 6.6 (`addXp`, level
  rewards, cosmetics definitions in `shared/cosmetics.js`, vinyl colours on `Disc`), 6.10 (`user_boosters` opening, odds endpoint,
  « Boosters spéciaux » panel), `collection.js` (4.2.5), rarity guide disclosure of every rule; cleanup of the legacy routes and
  service functions shadowed by P0 modules; demo core mirror (focus, pity, promos, level rewards); the level-up toast listens to
  `levelUp` in responses through `onApiResponse` (`GameContext.jsx` stays frozen).
- **Files**: `server/services.js`, `server/app.js`, `server/db.js` (only if a step v10+ is unavoidable), `server/catalog.js`,
  `server/importer.js`, `server/collection.js`, `shared/rules.js`, `shared/cosmetics.js` (new), `shared/staticCatalog.js`,
  `server/test/collection.test.js`, `server/test/importer.test.js`, `server/test/scale.test.js`, `server/test/api.test.js` (legacy
  cleanup only), `client/src/demo/mockServer.js`,
  `client/src/demo/mock/collection.js`, `client/src/components/game/WishlistToggle.jsx`,
  `client/src/components/game/SpecialBoosters.jsx`, `client/src/components/Achievements.jsx`, `client/src/components/Vinyl.jsx`,
  `client/src/components/RarityGuide.jsx`, `client/src/styles/game.css`, `client/src/i18n/areas/game.js`, `scripts/e2e/p1-d.mjs`.
- **Tests**: `collection.test.js` (wishlist limits by level; focus statistics over 2,000 simulated boosters: wishlist share ≈ 25 %
  ± 3; pity guarantees an ultra-or-better by booster 10; promo focus; pressable promo after one album; `pulled_rarity`; level-up
  boosters; Pressage n° ranks under concurrent completions), `importer.test.js` (locked rarities never change), `scale.test.js`
  updated; e2e `p1-d.mjs` (complete an album with the admin helper and see the completion moment; wishlist toggle; special booster
  opening with the unchanged animation).
- **Acceptance**: P1.10.

#### P1-E · Taste match, onboarding, Discover (3115 / 5115)
- **Scope**: `shared/match.js` + `match.js` (5.3, `taste-cache` job, suggestions), `onboarding.js` (5.9), `discover.js` (5.5,
  similar-album fallback); pages `TasteMatch` (with share card via `ShareSheet`), `Onboarding` (5 steps, skippable, reuses the
  genre grid, `AlbumTile`, `RatingInput`), `Discover` (rebuilt from the P0 hub); components `Shelf`, `SimilarAlbums`, `MatchFigure`,
  `HomeCards` (`TasteMatchCard`, `SuggestedFriends`), `MusicProfileSettings`.
- **Files**: `server/match.js`, `shared/match.js` (new), `server/onboarding.js`, `server/discover.js`, `server/test/match.test.js`,
  `server/test/onboarding.test.js`, `server/test/discover.test.js`, `client/src/pages/TasteMatch.jsx` (new),
  `client/src/pages/Onboarding.jsx` (new), `client/src/pages/Discover.jsx`, `client/src/components/discover/Shelf.jsx` (new),
  `client/src/components/discover/SimilarAlbums.jsx`, `client/src/components/match/MatchFigure.jsx`,
  `client/src/components/match/HomeCards.jsx`, `client/src/components/settings/MusicProfileSettings.jsx`,
  `client/src/styles/discover.css`, `client/src/i18n/areas/discover.js`, `client/src/demo/mock/match.js`,
  `client/src/demo/mock/onboarding.js`, `client/src/demo/mock/discover.js`, `scripts/e2e/p1-e.mjs`.
- **Tests**: `match.test.js` (identical profiles ≈ 100, disjoint ≈ low, symmetric, explanations, privacy and blocks, cache TTL,
  score distribution on `PERF_DB` when set), `onboarding.test.js` (result contents, boosters granted, wishlist and grid9 written,
  idempotent redo), `discover.test.js` (sections exclude rated/completed albums, reasons, cold start); mocks; e2e `p1-e.mjs` (new
  account → onboarding → result → Home not empty; taste match page; Discover sections).
- **Acceptance**: P1.4, P1.8, P1.9.

#### P1-F · Quests, badges, battles (3116 / 5116)
- **Scope**: `shared/quests.js` + `quests.js` (5.6, rewards of 6.7), `shared/badges.js` + `badges.js` (5.7, backfill),
  `shared/battles.js` + `battles.js` (5.4, tokens, Elo, rankings, item rankings); pages `Quests`, `Badges`, `Battles`, `Rankings`;
  `components/play/slots.jsx` (`QuestStrip`, `BattleWidget`, `TrophyShelf`, `AlbumRankings`).
- **Files**: `server/quests.js`, `shared/quests.js` (new), `server/badges.js`, `shared/badges.js` (new), `server/battles.js`,
  `shared/battles.js` (new), `server/test/quests.test.js`, `server/test/badges.test.js`, `server/test/battles.test.js`,
  `client/src/pages/Quests.jsx` (new), `client/src/pages/Badges.jsx` (new), `client/src/pages/Battles.jsx` (new),
  `client/src/pages/Rankings.jsx` (new), `client/src/components/play/slots.jsx`, `client/src/styles/play.css`,
  `client/src/i18n/areas/play.js`, `client/src/demo/mock/quests.js`, `client/src/demo/mock/badges.js`,
  `client/src/demo/mock/battles.js`, `scripts/e2e/p1-f.mjs`.
- **Tests**: `quests.test.js` (Paris boundaries incl. DST, deterministic roll, every metric with its anti-abuse rule, claim once,
  reroll once, daily bonus), `badges.test.js` (each family threshold, backfill once, no duplicate award, rewards), `battles.test.js`
  (token forgery refused, one vote per pair, Elo maths, multi-category updates, anti-brigading K, provisional flag, ranking order);
  mocks with bot votes so rankings exist in the demo; e2e `p1-f.mjs` (claim a quest, vote 5 duels, open a ranking, badges page).
- **Acceptance**: P1.5, P1.6, P1.7.

### 9.5 P2 workstreams (five in parallel)

#### P2-A · Passport and Rétro (3121 / 5121)
- **Files**: `server/passport.js`, `server/test/passport.test.js`, `client/src/pages/Passport.jsx` (new), `client/src/pages/Retro.jsx`
  (new), `client/src/components/passport/StudioStats.jsx`, `client/src/components/passport/charts.jsx` (new, plain SVG bars and
  timelines with tokens), `client/src/styles/passport.css`, `client/src/i18n/areas/passport.js`, `client/src/demo/mock/passport.js`,
  `scripts/e2e/p2-a.mjs`.
- **Scope**: 5.8, share slides through `ShareSheet`. **Acceptance**: P2.1, P2.2.

#### P2-B · Sets and events (3122 / 5122)
- **Files**: `server/sets.js`, `server/events.js`, `shared/sets.js` (new), `shared/events.js` (new), `server/quests.js` (event
  periods), `server/test/sets.test.js`, `server/test/events.test.js`, `client/src/pages/SetPage.jsx` (new),
  `client/src/pages/Events.jsx` (new), `client/src/pages/Collection.jsx` (tab Coffrets; Genres / Décennies link to the Passport),
  `client/src/pages/Home.jsx` (event and Rétro chips under the row), `client/src/components/sets/SetsTab.jsx`,
  `client/src/components/sets/EventChip.jsx`, `client/src/styles/sets.css`, `client/src/i18n/areas/sets.js`,
  `client/src/demo/mock/sets.js`, `client/src/demo/mock/events.js`, `scripts/e2e/p2-b.mjs`.
- **Scope**: 6.8, 6.9, `sets-generate` job. **Acceptance**: P2.3, P2.4.

#### P2-C · Catalogue provenance and enrichment (3123 / 5123; P2 schema owner)
- **Files**: `server/importer.js`, `server/enrich.js`, `shared/ids.js` (new), `scripts/detach-provider.js` (new),
  `scripts/purge-catalog.js`, `server/db.js` (steps v10+ only if needed), `server/test/enrich.test.js`,
  `server/test/detach.test.js`, `server/test/importer.test.js`, `client/src/components/ListenPanel.jsx`,
  `client/src/pages/Admin.jsx`, `client/src/components/admin/EnrichPanel.jsx` (new), `client/src/styles/enrich.css`,
  `client/src/i18n/areas/enrich.js`, `client/src/demo/mock/enrich.js`, `scripts/e2e/p2-c.mjs`.
- **Scope**: `external_ids` writes (Deezer, UPC, ISRC), neutral ids for non-Deezer rows, MusicBrainz / Wikidata enrichment at 1 request
  per second with a meaningful User-Agent (resumable `enrich` job), artist countries (`country_source`), `album-similar` job,
  `/api/catalog/listen`, Spotify / Apple embeds when ids exist, detach provider (withdrawn items stay in collections as « archivé »).
  The `status = 'active'` filters in browsing and the draw index are implemented by P2-E in `catalog.js` (contract).
  **Acceptance**: P2.6.

#### P2-D · Collection extras and cosmetics extras (3124 / 5124; P2 owner of `shared/rules.js`, `mockServer.js`, `studio.js`)
- **Files**: `server/workshop.js`, `server/studio.js` (deluxe and holo editions in vinyl payloads), `shared/rules.js` (Vernir and
  Comptoir rules, themed booster price; stop importing the seed catalogue module so it leaves the main bundle),
  `shared/cosmetics.js`, `server/test/workshop.test.js`, `client/src/components/game/VernirButton.jsx` (+ Comptoir sheet),
  `client/src/components/game/SpecialBoosters.jsx` (purchase), `client/src/components/CardModal.jsx`, `client/src/components/Vinyl.jsx`,
  `client/src/demo/mockServer.js`, `client/src/demo/mock/workshop.js`, `client/src/styles/workshop.css`,
  `client/src/i18n/areas/workshop.js`, `scripts/e2e/p2-d.mjs`.
- **Scope**: 6.3, 6.10 purchase, 6.11, extra cosmetics. **Acceptance**: P2.5.

#### P2-E · Search v2, performance, fonts, second pass (3125 / 5125; P2 owner of `services.js`, `catalog.js`, `search.js`)
- **Files**: `server/catalog.js`, `server/search.js`, `server/services.js`, `server/test/search.test.js`, `server/test/perf.test.js`,
  `client/src/state/catalog.js`, `client/src/main.jsx`, `client/index.html`, `client/src/styles/fonts.css` (new), `vite.config.js`,
  `scripts/package-demo.js`, `package.json`, `scripts/e2e/full.mjs` (new).
- **Scope**: `/catalog/albums?q=` on `search_docs`, keyset browsing, popular sort without a full scan (seed albums in a separate first
  query), withdrawn filters, compact draw index, Archivo / Figtree / Martian Mono self-hosted with the same axes (`@fontsource-variable`
  packages, OFL), Google Fonts removed from the CSP; the full second pass of the brief (dead links, console errors, responsive,
  permissions, duplicates) as `scripts/e2e/full.mjs`. **Acceptance**: P2.7.

### 9.6 P3 workstreams (experimental, scheduled only on the owner's request)

| Id | Scope | Files |
|---|---|---|
| P3-A · Trades (3131) | friend trades with the limits of 8.4; schema owner for P3 (`trades` table via a step) | `server/trades.js`, `server/db.js`, `server/test/trades.test.js`, `client/src/pages/Trades.jsx`, `client/src/components/trades/TradeSheet.jsx`, `client/src/styles/trades.css`, `client/src/i18n/areas/trades.js`, `client/src/demo/mock/trades.js`, `scripts/e2e/p3-a.mjs` |
| P3-B · Follows and guest pages (3132) | follow besides friends; read-only guest Studio and list pages with Open Graph previews (no covers) | `server/follows.js`, `server/share-pages.js`, `server/test/follows.test.js`, `client/src/pages/PublicProfile.jsx`, `client/src/routes.jsx`, `client/src/App.jsx`, `client/src/i18n/areas/follows.js`, `client/src/demo/mock/follows.js`, `scripts/e2e/p3-b.mjs` |
| P3-C · Listening and popularity providers (3133) | Apple Music embed, provider-independent popularity (ListenBrainz if licensed), yearly « Édition » re-rate tooling | `server/enrich.js`, `server/importer.js`, `client/src/components/ListenPanel.jsx`, `server/test/enrich.test.js`, `client/src/demo/mock/enrich.js` |
| P3-D · Out-of-app notifications (3134) | installable PWA (not in the demo), opt-in web push for requests and replies, weekly e-mail digest (`prefs.emailDigest`) | `server/push.js`, `server/digest.js`, `server/test/push.test.js`, `client/public/manifest.webmanifest`, `client/src/sw.js`, `client/src/components/settings/PushSettings.jsx`, `client/src/i18n/areas/push.js`, `client/src/demo/mock/push.js` |

P3 needs its own small kick-off (new registry entries, area files and settings slot), done by P3-A before the others.

### 9.7 Ownership changes between levels (quick reference)

| File | P0 | P1 | P2 |
|---|---|---|---|
| `server/services.js`, `server/app.js` | P0-A | P1-D | P2-E (services) |
| `client/src/demo/mockServer.js` | P0-A | P1-D | P2-D |
| `server/db.js` | P0-A | P1-D (steps only) | P2-C (steps only) |
| `server/ratings.js`, `client/src/components/Rating.jsx` | P0-C | P1-A | — |
| `client/src/pages/Home.jsx` | P0-B | P1-A | P2-B |
| `client/src/pages/AlbumPage.jsx`, `TrackPage.jsx` | P0-C | P1-B | — |
| `client/src/App.jsx`, `routes.jsx`, `components/shell/Header.jsx` | P0-D | P1-B | — |
| `client/src/pages/Friends.jsx` | P0-E | P1-B | — |
| `client/src/pages/Collection.jsx` | P0-E | — | P2-B |
| `server/search.js` | P0-E | — | P2-E |
| `client/src/pages/Admin.jsx` | P0-F | — | P2-C |
| `client/src/components/ListenPanel.jsx` | P0-C | — | P2-C |
| `client/src/components/CardModal.jsx` | P0-C | — | P2-D |
| `client/src/components/ui.jsx` | P0-B | P1-B | — |
| `client/src/components/RarityGuide.jsx`, `Vinyl.jsx` | P0-B (guide) | P1-D | P2-D (Vinyl) |
| `shared/rules.js`, `shared/cosmetics.js` | — | P1-D | P2-D |
| `server/catalog.js` | — | P1-D | P2-E |
| `server/importer.js` | — | P1-D | P2-C |
| `server/quests.js` | — | P1-F | P2-B |
| `server/studio.js` | — | P1-B | P2-D |
| `client/src/pages/Discover.jsx` | P0-D | P1-E | — |

### 9.8 Level exit checklist (run by the orchestrator)

1. `node scripts/check-owners.mjs <level>`: no file touched outside its owner list.
2. `npm test` green; `npm run lint:css` clean; `npm run build` and `npm run build:demo` pass (demo size reported).
3. `npm run e2e <level>`: every `scripts/e2e/<id>.mjs` of the level passes at 1440 × 900 and 390 × 844 with zero console errors.
4. `scripts/e2e.mjs` (the legacy end-to-end tour) still passes: no existing feature lost (rule 1).
5. Visual parity review of the Home hero and row against `owner-reference-current-ui.webp` (P0 and every level that touches Home).
6. The owner's sentence works end to end on a fresh account: « Je veux créer mon compte, noter mes albums et commencer ma
   collection. »
7. One commit per level with the attribution lines of the session.

---

## 10. Risks and open questions

### 10.1 Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | **The look drifts** away from the owner's reference while tokens are introduced or new pages are added (the owner already rejected three directions) | Rule 11; `design-system-current.md` is the only reference; P0-B's mandate is "same rendering"; visual parity review of the Home hero and row at every level (9.8); new pages reuse existing classes; `css-lint` forbids new families and raw colours |
| R2 | `design-system-current.md` was being written while this plan was revised, so a token or class name may differ from what 9.2 assumes | P0-B reads it first and reconciles; names in 9.2 that collide follow that document; `DESIGN-OVERRIDE.md` wins over both |
| R3 | **Concurrent agents in one tree** edit a file they do not own or step on each other's processes | Disjoint lists, K0 registries and slots so nobody needs shared files, `check-owners.mjs` after each workstream, per-workstream ports, databases and PID files, no git writes by agents |
| R4 | A module filled late leaves another module of the same level calling a stub (e.g. `deps.notify`, `deps.lists.setGrid9`) | Stubs return working no-ops; the level exit runs the full test suite and e2e with every module in place; contracts are listed in 4.0 and 9.2 |
| R5 | **Partial-state merge bugs** make the client state diverge from the server | Pure `mergeState.js` tested against a fresh `GET /api/state` after scripted sequences; non-delta routes still return the full state; a full refresh on focus after 10 minutes |
| R6 | Single-threaded SQLite: boot-time search build (≈ 8 s) and one-time migration (≈ 15 s on the populated copy) delay startup; a slow query stalls everyone | Both run before `listen()` and only once (version keys); `perf.test.js` plan assertions; bounded queries (`LIMIT target`, capped cursors); nightly jobs in their own transactions |
| R7 | **Deezer API terms** (personal, non-commercial, no reuse of content) and the EU database right on the imported catalogue | `CATALOG_IMPORT` off in production until Deezer approves or P2-C moves metadata to MusicBrainz/Wikidata (CC0); never monetise before that; detach-provider keeps user data if Deezer asks to stop |
| R8 | Cover art in shared PNGs is a reproduction (grey zone) and Deezer's CDN CORS behaviour is unverified | Generated AlbumMania art by default; `SHARE_COVERS` off; per-tile CORS fallback; never server-side; attribution line |
| R9 | UGC moderation load for a solo owner and DSA obligations | Safety base in P0 (before P1 social), quotas, link allow-list, new-account limits, prefilled statements, repeat-offender hints, public notice form |
| R10 | The demo (20 albums, no network, sandboxed iframe, MemoryRouter) makes new social and ranking pages look empty or break the single-file packaging | Every endpoint has a mock twin with bots seeding posts, likes, lists, votes and quests; `npm run build:demo` in every exit checklist; `import.meta.glob` lazy pages verified in K0; share images fall back to the long-press modal |
| R11 | Taste-match and feed constants feel wrong (scores too high or too low, feed too noisy) | Constants in `shared/match.js` and `feed.js`, checked on the populated copy (distribution targets in 5.3); explanations make the score auditable by users |
| R12 | Battle rankings manipulated (brigading, scripted votes) | Signed pair tokens, one vote per pair, daily quota, reduced K after 10 votes on the same item and for new accounts, « provisoire » under 50 votes |
| R13 | Quest farming (delete and re-rate, repetitive reviews) | Rewards bounded by targets, repetitive-text check, first-copy-only card metrics, likes never a metric |
| R14 | Google Fonts send visitors' IP addresses to Google until P2-E self-hosts the fonts | Disclosed in the privacy page from P0; P2-E self-hosts the same families and axes |
| R15 | Pulling the safety base into P0 (the computed task listed it under P1) makes P0 larger | P0-F is a separate workstream with its own files; nothing else in P0 waits for it (stubs); the user-visible social features themselves stay in P1 |
| R16 | Rarity freeze and the focus split change pack outcomes players are used to | Disclosed in the rarity guide before release; owned cards never change rarity; tests on simulated booster statistics |
| R17 | Removing FR/EN and sound from the top bar is a visible change to the reference screen | They stay one tap away in the account menu (where they already are); owner can veto (Q1) and the switch can stay at ≥ 1440 px |
| R18 | The booster sheet shortcut (design reference §4.13) could be read as the « feuille booster » the owner refused | It is additive only: the Home hero and row are untouched and stay the main entry; it reuses `useBoosterFlow` and the unchanged `PackOpening`; owner can veto (Q13), in which case the Boosters tab and the packs pill simply link to `/#booster` |
| R19 | `design-system-current.md` and this plan disagree on a detail | Order of precedence: `DESIGN-OVERRIDE.md` > legal rules of 7.1 > `design-system-current.md` for anything visual > this plan for scope, data, API and ownership. Known cases settled here: status row placed under the hero **and** its row (override), no proxied covers in share images (7.1) |

### 10.2 Open questions for the owner

1. **Top bar**: is it fine that FR/EN and the sound toggle move into the account menu to make room for the search field and the bell,
   and that « Amis » leaves the top nav and the phone tab bar (Studio header, account menu, bell) to make room for Studio and Boosters
   (everything else in the bar stays as on the reference screenshot)?
2. **First nav item**: « Accueil » (the page keeps the booster hero on top and gains social blocks below) or keep the label
   « Boosters »?
3. **Legal identity** for the mentions légales: editor name (individual or company), postal address or host-only disclosure, contact
   e-mail, publication director, host details.
4. **Share images**: keep generated AlbumMania art in exported images (default, safe) or accept the risk of real covers composed in the
   browser (`SHARE_COVERS=deezer`)?
5. **Catalogue in production**: ask Deezer for approval, or wait for the MusicBrainz/Wikidata migration (P2-C) before importing
   20,000 albums publicly?
6. **Default Studio privacy**: public for every logged-in member (proposed) or friends-only?
7. **Minimum age** 15 (French digital-consent age, proposed) or 13?
8. **Event names** that are trademarks (« Eurovision ») are renamed (« Chansons d'Europe »): agreed?
9. **Monetisation**: confirm that nothing will ever be sold for real money (it conditions the Deezer terms and the gambling analysis);
   if one day, only direct cosmetics at a known price.
10. **Moderation record retention**: 3 years after the decision (proposed), then purge?
11. **Trading between players** (P3): wanted at all, given the abuse surface? The « Doublons » panel stops promising it in P0.
12. **Follows** in addition to mutual friends (P3), or friends only?
13. **Booster sheet**: keep the small booster sheet opened by the Boosters tab and the packs pill as a shortcut (the Home hero stays
    exactly as it is), or have both simply scroll to the Home hero?
