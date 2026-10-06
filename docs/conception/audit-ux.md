# AlbumMania: visual and UX audit of the current site

Date: 2026-10-06. Build: current working tree at commit `2bdb681` (production build served by `vite preview` through the API proxy, API on the 20,020-album fixture).
Accounts: `boss` (admin, 30 boosters plus about 25 more opened during the tour), `joueur` (new player, 1 booster), `melodie` (pending friend request). Seeded data: friendship boss and joueur, ratings and reviews on Discovery, Moon Safari, Thriller and dz1000004, 2 completed albums, Discovery at 13/14, a showcase of 5 cards.
Screenshots: `shots-current/` (`d-*` = desktop 1440×900 @1x, `m-*` = mobile 390×844 @2x; `-full` = full page; `-pN` = mobile scroll positions). Native-resolution crops: `crops/`.
Per-screen text measurements (size, family, weight, computed contrast against the real background): `audit-tools/metrics/*.json`. Scripts: `audit-tools/` (tour1 = guest and new player, tour2 = collector, reveal, a11y).

Sandbox caveats: Deezer and Spotify are blocked, so every cover is the generated fallback art. That is expected; in production imported albums show real covers. Full-page captures show sticky bars in the middle of the page (`m-20-bt-intro`, `m-21-bt-round`). That is a capture artifact, not a bug.

---

## 1. Numbers first

Across 72 measured screens I counted **9,538 visible text nodes**:

| Measure | Count | Share |
|---|---|---|
| Text under 13 px | 3,547 | **37 %** |
| Text under 11.5 px | 2,497 | **26 %** |
| Text under 10 px | 1,670 | **17.5 %** |
| Text under 4.5:1 contrast (after removing clipped and gradient false positives) | 599 | 6.3 % |
| Text under 3:1 contrast | 40 | |
| Distinct rendered font sizes | **57** | |
| Distinct declared px sizes between 11 and 16 px | 10 (11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16) | |
| Distinct `border-radius` values in the CSS | 20 | |
| Text set in Martian Mono / Figtree / Archivo | 3,529 / 3,524 / 2,110 | 37 % / 37 % / 22 % |

Worst screens (whole DOM, including content below the fold):

| Screen | Text nodes | < 13 px | < 11.5 px | Smallest size | < 4.5:1 |
|---|---|---|---|---|---|
| m-50-coll-cards | 331 | 296 (89 %) | 283 (85 %) | 7 px | 16 |
| d-50-coll-cards | 353 | 253 (72 %) | 235 (67 %) | 8.5 px | 14 |
| m-60-album-discovery | 131 | 92 (70 %) | 84 (64 %) | 7.5 px | 12 |
| m-63-album-imported | 148 | 104 (70 %) | 74 (50 %) | 7.5 px | 23 |
| m-01-login | 28 | 18 (64 %) | 16 (57 %) | 7 px | 4 |
| d-60-album-discovery | 135 | 77 (57 %) | 67 (50 %) | 9 px | 9 |
| m-70-profile | 105 | 58 (55 %) | 38 (36 %) | 7.5 px | 17 |
| d-70-profile | 109 | 52 (48 %) | 30 (28 %) | 8.5 px | 14 |
| m-44-summary | 223 | 90 (40 %) | 71 (32 %) | 6.5 px | 9 |
| d-30-home | 176 | 60 (34 %) | 38 (22 %) | 7.5 px | 8 |
| d-80-admin | 203 | 47 (23 %) | 28 (14 %) | 10.5 px | 6 |

Main sources of small text (all screens combined):
- `card__rarity` and `card__pop` (Martian Mono): 7.5 to 10 px, 430 occurrences each.
- `card__artist`: 8.5 to 12 px, 428 occurrences.
- `card__num` (`07/14`): 8 to 11 px, 348 occurrences.
- `card__title` (Archivo 760): 10 to 12 px, 263 occurrences.
- `rarity-bar__label`: 12 px.
- `coll-chip__n` and `eyebrow`: 11 px mono.
- `album-tile__info`: 12.5 px.
- `pill__timer`: 11.5 px mono.

Card text is sized with `max(8px, 5.6cqi)`-style container units, so the floors (7 to 10 px) are what the player actually sees in every grid.

Colour tokens against the four background levels (`ink` / `stage` / `stage-2` / `stage-3`):

| Token | Contrast (ink / stage / stage-2 / stage-3) | Verdict |
|---|---|---|
| `--haze` #a79fb5 | 7.6 / 7.2 / 6.7 / 5.9 | OK |
| **`--haze-2` #7d7590** | **4.45 / 4.19 / 3.89 / 3.46** | Fails AA on every surface. Used for meta lines, placeholders ("Prochain indice…"), the histogram axis, the footer and "0 / 5 ★" |
| `--r-promo` #ef3b3b | 4.9 / 4.7 / 4.3 / 3.9 | Measured 3.4 to 4.1 on promo card feet, where it sits on 9 px text |
| Disabled or not-dirty primary button (grey fill, dark text) | about 3.0 | "Se connecter" before typing, "Envoyer la demande", "Mettre à jour", "Tout afficher", "Compléter « … »". Looks broken rather than disabled |
| `chip-btn` count, `coll-chip__n` | 1.6 to 4.2 | Fails |

---

## 2. Typography: why Archivo + Figtree + Martian Mono reads "AI-made"

1. **This is the default 2023–2025 AI landing-page trio.** The pattern is a wide grotesk display at heavy weight (Archivo 800, `font-stretch: 112%`), a friendly geometric sans for body (Figtree, chosen as the "not Inter" Inter), and a monospace for uppercase eyebrows and numbers. Thousands of generated sites (Vercel, Framer and shadcn templates) use exactly this stack. Nothing in it comes from music culture: no record-sleeve typography, no liner-note editorial voice, no Letterboxd-style serif for reviews.
2. **Mono is used as decoration, not for data.** It covers 37 % of all text: eyebrows ("MA COLLECTION", "TA NOTE", "ÉCOUTER SUR", "CRITIQUES", "PROGRESSION DES ALBUMS"), rarity labels, FR/EN buttons, level chips, the ADMIN badge, timers, pill counts, admin stats lines and the "Manche 1 / 5" counter. Uppercase mono at 11 px with 0.06–0.12 em tracking is the strongest single "template" signal, and it is what makes screens feel like a developer dashboard (`d-80-admin`, `d-50-coll-genres`).
3. **The display face is used too small.** Archivo 760 at 10 px on card titles loses all its character, and at 52 px in the hero it is just "big bold wide". The wide cut and tight tracking make long French headings feel shouty ("Admin : boosters illimités" in `d-30-home`, the login hero `d-01-login`).
4. **There is no scale.** 57 rendered sizes and half-pixel steps (12.5, 13.5, 14.5) mean every component picked its own size. Hierarchy comes from weight and colour fighting each other rather than from a rhythm.
5. **Three families with overlapping jobs.** Archivo and Figtree are both geometric-ish sans faces with similar x-heights, so the contrast between them is weak. Their pairing reads as "two sans faces", not "display plus text".
6. **What a fix needs (for the direction phase):**
   - One face with real personality for titles: an editorial serif or a condensed "sleeve" grotesk.
   - One workhorse UI face with tabular numerals.
   - Mono kept only for catalogue numbers (`AM-001`, `07/14`) or dropped entirely.
   - A 6–7 step scale (for example 12 / 14 / 16 / 20 / 28 / 40 / 56) with a hard floor of 12 px for meta and 11 px only for card micro-labels at the largest card size.

---

## 3. Prioritised UI problems

Levels: P0 = must fix as part of the redesign foundations, P1 = high value, P2 = important polish, P3 = later.

### P0

**P0-1. Card micro-typography is illegible.**
- **Where:** `m-50-coll-cards-p2`, `m-44-summary`, `d-46-summary-x10`, `m-63-album-imported-p2`, `m-70-profile-p2`, `d-90-focus-album-card`.
- **Problem:** On mobile the collection grid is 89 % text under 13 px. Rarity, popularity and number sit at 7–10 px; artist at 8.5 px; title at 10 px. With 3 columns at 390 px each card is about 110 css px wide, so the `cqi` floors kick in everywhere.
- **Direction:**
  - Use 2 columns on phones (card at least 160 px).
  - Raise the floors (title ≥ 13, artist ≥ 11, rarity label ≥ 10 bold) and drop elements progressively with container queries: popularity number first, then the artist line on tiny cards.
  - Keep the `07/14` badge but make it larger.

**P0-2. No type system and the typeface trio feels generic.** See section 2.
- **Where:** every screen, especially `d-50-coll-albums`, `d-80-admin`, `d-30-home`, `d-01-login`.
- **Problem:** 57 sizes, 10 sizes between 11 and 16 px, mono for 37 % of text, uppercase tracked eyebrows on almost every section.
- **Direction:** define the tokens (scale, weights, line heights, tracking) once in `app.css` and replace all literal font sizes in the 7,361 lines of CSS.

**P0-3. Low-contrast greys and grey "disabled" buttons.**
- **Where:**
  - `--haze-2` fails AA on all surfaces: "Prochain indice…" in `d-21-bt-round`, the footer on every page, meta in `d-60` (crop `crops/d60-bottom.png`).
  - The disabled grey-filled pill is used for "Se connecter" (`d-01-login`, `m-01-login`), "Envoyer la demande" (`m-14-new-friends`), "Mettre à jour" (`crops/d60-bottom.png`), "Tout afficher" (`d-12-empty-search`) and "Compléter « storm storm 2136 »" (`crops/d10-mid.png`). At about 3:1 it reads as broken.
  - Promo red on 9 px text (`d-50-coll-promos`).
- **Direction:**
  - Raise `--haze-2` to at least #9089a3 (5.1:1 on stage-2, 4.5:1 on stage-3) or stop using it for text.
  - Show disabled as a ghost outline at 40 % opacity, not as a grey fill. Better still, keep the primary button enabled and validate on submit.

**P0-4. Global search and mobile navigation.**
- **Where:** `m-30-home`, `m-31-menu`, `m-50-coll-cards-p1`, `m-70-profile-p1`, `m-14-new-friends`, `d-30-home`.
- **Problems:**
  - There is **no global search** anywhere: not in the top bar, not on mobile. The only search lives inside the Collection Albums tab. This is the owner's explicit one-off request (autocomplete with cover thumbnails).
  - On mobile the 4 tabs are Boosters / Collection / Blind test / Amis. **Profile/Studio, a core pillar, is hidden behind the avatar menu**, while Blind test takes a primary slot.
  - The royalties balance is hidden on phones; only the pack pill is shown.
  - Collection tabs (Genres and Décennies are off-screen) and the rarity chip row scroll sideways with no fade or affordance (`m-50-coll-cards-p1`).
  - Page content bleeds through the 90 %-opaque tab bar and stays legible behind the tab labels (`m-70-profile-p1`, `m-14-new-friends`, `m-64-artist`).
- **Direction:**
  - Search icon in the top bar on both desktop and mobile, opening a full-screen sheet.
  - Tabs: Accueil · Collection · Découvrir/Recherche · Social · Studio. Blind test moves into Discover.
  - Make the tab bar opaque, or give it a fade edge.

**P0-5. Mobile layouts of Collection and Album bury the content.**
- **Collection:**
  - `m-50-coll-cards-p1`: the tabs start about 630 css px down. Before any card the player scrolls through 3 summary tiles, 7 rarity tiles and a "Comment marchent les raretés ?" link.
  - `m-50-coll-albums-p1`: the Albums tab adds a hint box, a search field, 2 selects, a toggle and 16 genre chips before the first album.
- **Album:**
  - `m-60-album-discovery`: the cover is 220 px and left-aligned, leaving half the screen empty, and the header reads as unfinished.
  - `m-63-album-imported-p2`: a dashed "Gratuit" press button under every missing card doubles the grid height.
- **Direction:**
  - Collapse the stats into one progress line plus a "Stats" sheet.
  - Turn filters into a single "Filtres" button that opens a bottom sheet.
  - Full-width cover on mobile.
  - Move "presser" into the card modal, or show it as a small corner badge.

### P1

**P1-6. Dashboard look and demotivating progression maths.**
- **Where:** `d-50-coll-albums`, `d-50-coll-genres`, `d-70-profile` (crop `crops/d70-top.png`), `m-70-profile-p3`, `d-30-home`.
- **Problems:**
  - Ten stat tiles above the collection.
  - The Genres and Décennies tabs are rows of full-width bars at 0.08 %.
  - The profile has four KPI tiles plus a "Notes 6 / Albums notés 4 / Critiques 2 / Moyenne 4,4" block.
  - Home has a row of three equal cards (Boutique / Doublons / Blind test).
  - With 20,020 albums, every denominator is crushing: "231 / 240 261 morceaux · 0,1 %", "2 / 20 020 albums", "85 / 143 881". That is the opposite of the brief's "vraie sensation de progression".
- **Direction:**
  - Measure progress against albums the player has started, the next album to complete, this week's gains, and badges.
  - Keep the global totals in a secondary "Passport" view.

**P1-7. The UI reads like a manual.** Explanatory copy everywhere:
- "Deux façons de finir un album" (home, `crops/d10-mid.png`).
- "Deux façons de compléter un album…" hint box (collection, `d-50-coll-albums`).
- "Récompense +280 royalties, +210 XP…" box plus the "Booster d'album … gratuit et illimité pour l'admin" banner (album, `d-60-album-discovery`).
- The "Comment marchent les raretés ?" link repeated in the home hero, the collection header and the pack summary.
- Two paragraphs of legal footer on every page. On mobile that is a full screen (`m-30-home-p5`, `m-14-new-friends`, `m-20-bt-intro`).
- **Direction:** progressive disclosure (one "?" per concept, first-run tooltips), and a one-line footer with the provider credit and a "Mentions" link.

**P1-8. Inconsistent components.**
- **Pills and chips:** at least 9 styles (`.chip`, `.chip-btn`, `.pill`, `.tag`, `.count-badge`, `.level-chip`, `.master-tag`, `.coll-chip`, `.seg`).
  - Heights 18, 28, 32 and 34 px; mono or body font; radius 999 or 8.
  - Examples: "ADMIN" (mono teal), "Niveau 9" (mono teal), "Maître Miles Davis" (body gold, 18 px tall), "2 vinyles" (grey), "Dans tes amis" (teal body), "NOUVEAU" (teal caps), "Vinyle" (gold).
- **Radii:** 20 distinct values.
- **Buttons:**
  - The destructive "Vider ma collection" looks like every other button (`d-80-admin`).
  - The card modal stacks 5 outline buttons with no hierarchy (`d-33-card-modal`).
  - The star input carries a cryptic "0" button (`crops/d60-bottom.png`, `m-33b-card-modal-scrolled`).
- **Direction:** define one chip component with 3 tones and 2 sizes, a 4-step radius scale (6 / 12 / 20 / pill), and button roles (primary, secondary, quiet, danger).

**P1-9. Too many colours at once, and identical avatars.**
- **Problems:**
  - The palette runs 7 rarity hues, cue teal, gold, danger red, a rainbow logo disc, an orange-to-red "Mania" gradient wordmark, a pink-purple-blue booster gradient, and a pink default avatar.
  - The collection header shows all of them simultaneously (`d-50-coll-albums`).
  - **Every user gets the same default avatar colour #ff4f7e**, so boss, joueur and melodie are three identical pink circles in the feed, friends list and reviews (`crops/d10-bot.png`, `m-30-home-p5`, `m-14-new-friends`, `crops/d60-bottom.png`). Social screens become hard to scan.
- **Direction:** a neutral UI with a single accent; rarity colour only on cards and rarity-specific UI; a deterministic avatar colour per user from a curated set.

**P1-10. The album page is not yet "one of the best pages".**
- **Where:** `d-60-album-discovery`, `d-60-album-discovery-full`, `crops/d60-bottom.png`, `d-63-album-imported-full`.
- **Problems:**
  - The header is small and cold: 280 px cover, no backdrop tinted from the cover, rating shown as a small pill.
  - Friends' and community ratings sit below 14 cards (about 1,300 px down).
  - The tracklist is hidden behind a Cartes / Tracklist toggle.
  - The card grid is a wall of 14 identical artworks: the card art is the album cover (`d-90-focus-album-card`).
  - Reviews are flat boxes with no likes or replies.
  - Track rows do not open a track page.
- **Direction:** follow the brief's order (cover and info, progress, tracklist with my ratings, friends, community, reviews). Give the cards a compact "sleeve" mode on the album page so that number and rarity carry the variety instead of 14 copies of the same image.

**P1-11. Rating label bug (verified in code).**
- **Where:** `crops/d60-bottom.png`. The "Ta critique" stars show 4.5 but the label reads **"5 étoiles sur 5"**.
- **Cause:** `client/src/components/Rating.jsx`, `RatingValue`: `maximumFractionDigits: average ? 1 : 0` rounds personal half-star scores to whole stars. The visible label in `.review-editor__value::after { content: attr(aria-label) }` and the aria-label of every non-average rating are both wrong for half stars (3.5 is announced as "4 étoiles").
- **Fix:** use 1 decimal place for stars.

### P2

**P2-12. Touch targets under 44 px on mobile** (measured):
- Genre and rarity chips: 34 px.
- Cartes / Tracklist segment: 68×28.
- "Presser · Gratuit": 30 px.
- Star "0": 30×26.
- Studio remove "×": 28×28, overlapping card corners (`m-70-profile-p2`).
- `btn--sm`: 34 px.
- Inline links 17–21 px tall: feed album titles, "‹ Collection" back link, "Tout voir", the rarity guide link, the "Maître …" tag (18 px).

**P2-13. Modals on mobile.**
- Rarity guide (`m-32-rarity-guide`): the 5-column table is clipped (the "POPU…" column is cut off), the title is truncated ("Comment marchent les rar…"), and cells wrap to one word per line.
- Card modal (`m-33-card-modal`, `m-33b`): very long, with the main action at the very bottom.
- **Direction:** use bottom sheets, a stacked card layout for the rarity table, and a sticky action row.

**P2-14. Home hero priorities and copy.**
- `d-10-new-home`: the H1 is a pack count ("4 boosters disponibles", plus a confusing "dont 4 gagnés").
- `d-30-home`: the admin H1 reads "Admin : boosters illimités".
- The home page is a booster counter (casino emphasis) rather than a personal music home (friends' activity, album to finish, something to rate or discover).
- A new account gets no onboarding at all.

**P2-15. Flat empty states.**
- "Aucun album ne correspond à ces filtres." in a dashed box (`d-12-empty-search`).
- 6 identical dashed "Exposer une carte" slots (`d-13-new-profile`).
- A "Doublons" card with "Aucun doublon pour l'instant" and a disabled button taking a third of the row (`d-30-home`).
- Locked vinyls labelled "Bientôt", which is ambiguous for an album at 13/14 (`crops/d70-top.png`).
- **Direction:** illustrated empty states with a single next action.

**P2-16. Crowded desktop top bar.**
- **Where:** `d-30-home`, `d-31-menu`.
- **Problem:** the top bar packs five controls on the right (packs pill, royalties pill, FR/EN, sound, avatar). FR/EN and sound are duplicated in the account menu.
- **Direction:** keep currencies and the avatar in the bar; move settings into the menu; put search where FR/EN is now.

**P2-17. Generic iconography.**
- Thin 1.8-stroke Lucide-style icons at 18 px.
- The booster icon is ambiguous (it reads as a jar or a document, as in `pill--packs`), and the royalty coin is emoji-like.
- The icons share none of the card and vinyl visual language.

### P3

**P3-18. Generated fallback covers.** A small motif set repeats (spotlight figure, equalizer, vinyl rings, sunburst) and reads as clip art (`d-46-summary-x10`, `crops/d10-bot.png`). Only visible when no real cover exists, but with 20k imported albums that can be frequent on bad networks.

**P3-19. Motion outside pack opening.**
- Page changes, tab switches and list loads have no transitions, and hover states on cards are subtle (`d-91-hover-card`).
- Reduced motion is respected in every stylesheet.
- I could not trigger and capture the album completion moment in this tour.

**P3-20. Blind test (`d-20-bt-intro`, `d-21-bt-round`, `d-22-bt-answer`).** The flow is clear and the timer ring is good. However:
- The 5 hint rows render as greyed placeholders ("Prochain indice…", 3.4:1).
- The result card embeds a mini card with 7.5 px text.
- Rewards are shown as text rows with tally bars.

---

## 4. Strengths to preserve

- **The "recording studio at night" palette.** Plum ink with an ivory paper tone is a distinctive base, much better than the usual neutral grey or black dark mode. Keep the ink and ivory. The ivory pill primary CTA ("Ouvrir un booster", `d-30-home`) is a good signature.
- **Card objects.** Rarity frames, the gold legendary glow, the corner promo ribbon, the `07/14` number badge, the popularity signal icon, the vinyl-groove card back (`d-42-reveal-back`) and ghost cards with "?" for missing tracks (`d-50-coll-promos`, `m-63-album-imported-p2`). The concept is strong; only the micro-typography fails.
- **Pack-opening choreography.** Pack drop, tap, tear, a dealt stack with depth, flip, tease glow for rare-plus cards, rays and confetti for big pulls, a tray of rarity dots, then a summary with new and duplicate chips plus album progression rows (`d-40-pack` → `d-43c-front-big` → `d-44-summary`). This is the "dynamism" the owner liked, and the feature to build on.
- **Vinyl shelf and turntable** (`crops/d70-top.png`, `m-71-turntable`): wooden shelf rule, sleeve with the disc peeking out, A1/B1 side numbering, "33⅓ tours". This is the most "musical" UI in the product; extend that language to the Studio and the album pages.
- **Rarity guide content** (`d-32-rarity-guide`): clear, honest odds table (popularity range, chance per booster, card counts). The layout needs work on mobile only.
- **Friends-first reviews** with the "Dans tes amis" marker, half-star input with keyboard support (slider role, arrow keys), and a Letterboxd-style histogram. The right foundations for the rating pillar.
- **Accessibility basics.** A consistent 2 px teal `:focus-visible` ring on every control, including cards in grids (`d-90-focus-album-card`); a logical tab order (logo, nav, header, cards, rating, reviews); dialogs with `aria-modal`; `prefers-reduced-motion` handled in all 6 stylesheets.
- **Mobile basics already right.** A real bottom tab bar, safe-area insets, a 16 px gutter, no horizontal page scroll, a sticky top bar with blur, a full-screen pack opening on the phone (`m-43-front-c0`) and a 2-column blind-test genre grid (`m-20-bt-intro`).
- **The login page composition** (`d-01-login`): a fan of three real cards beside the form explains the product in one glance. Keep the idea; the type needs redoing.

---

## 5. Screen index (all in `shots-current/`)

- Guest: `d|m-01-login`, `-01b-login-focus`, `-01c-login-error`, `d|m-02-signup` (validation errors visible), `d|m-03-forgot`.
- New player: `d|m-10-new-home(-full)`, `d|m-11-new-coll-{albums,cards,artists,promos,genres,decades,mine}`, `d|m-12-empty-search`, `d|m-13-new-profile`, `d|m-14-new-friends`, `d|m-15-album-404`.
- Blind test: `d|m-20-bt-intro`, `-21-bt-round`, `-22-bt-answer`, `-23-bt-final`.
- Collector: `d-30-home(-full)`, `m-30-home-p1..p5`, `-31-menu`, `-32-rarity-guide` (`m-32b` scrolled), `-33-card-modal` (`m-33b` scrolled).
- Pack: `-40-pack`, `-41-pack-tear`, `-42-reveal-back`, `-42b-tease-*`, `-43-front-c0/c1`, `-43-reveal-front(-2..4)`, `-43c-front-big` (promo pull with rays), `-44-summary` (`m-44b` scrolled), `-45-pack-x10`, `-45b-x10-reveal`, `-46-summary-x10`.
- Collection: `-50-coll-{albums,cards,artists,promos,genres,decades}` (mobile `-pN`), `-51-coll-search`.
- Album and artist: `-60-album-discovery(-full|-pN)`, `-61-album-tracklist`, `-62-album-completed` (Moon Safari, vinyl), `-63-album-imported` (dz1000004), `-64-artist`, `-65-card-modal-album`.
- Profile and social: `-70-profile`, `-71-turntable`, `-72-avatar-picker`, `-73-profile-other` (joueur seen by boss), `-74-friends` (incoming request).
- Admin: `-80-admin`.
- Accessibility: `d-90-focus-album-card`, `d-91-hover-card`.
