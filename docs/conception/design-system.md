# AlbumMania design system: the current identity, formalised

Date: 2026-10-06. Status: **the reference for every UI change from now on.** It replaces `design/design-system.md` (the « Disquaire » direction: Gloock, Newsreader, Schibsted Grotesk, obi, paper). That direction is **cancelled** and must never be applied (owner decision, `design/DESIGN-OVERRIDE.md`).

What this document does: it writes down the UI that ships today in `client/src/styles/app.css` (5,902 lines) and the five area stylesheets, turns its values into tokens, applies only the legibility fixes the owner allowed, and designs the new components in that same style.

Validated by a static mock that loads the real stylesheets: `design/current-v2/index.html`. Screenshots are listed in §7.

---

## 0. Rules (read before touching CSS)

1. **Nothing changes in the look.** Keep the plum ink surfaces and ivory paper, the Archivo 800–900 extended titles, Figtree body text, Martian Mono counters, the ivory pill primary button, the colourful booster, the rarity frames, the vinyl shelf and the turntable. If a screen looks different from `design/owner-reference-current-ui.webp` once you are done, you have gone too far.
2. **No new font family, no serif, no new accent colour.** The only colour added is `--like` (#ff4f7e), and it is not new: it is the pink already used in the booster gradient, the pack vinyl label, the holo foil and the default avatar.
3. **Colour belongs to the music.** Covers, rarities and the booster carry the colour. The UI stays ink and ivory, with turquoise `--cue` for focus, links, "new" and "active".
4. **One ivory pill per view.** The primary button (`.btn--primary`) marks the main action of a screen or of a card. Use ghost, quiet or `.act-btn` for everything else.
5. **Reuse before you add.** New screens are built from `.panel`, `.btn`, `.pill`, `.chip`, `.seg`, `.tabs`, `.eyebrow`, `.album-tile`, `.card`, `.menu`, `.modal`, `.progress`, `.avatar`, `.artist-badge` and the Archivo headings. Each new class in §4 exists because none of these fits.
6. **The currency stays "royalties"**, with the gold token icon. The plan's « Sillons » rename is dropped.
7. **Mono is for data.** Martian Mono is used for counters (`13/14`, `×2`, `87 %`), codes (`AM-001`, FR/EN), timers, card feet and page kickers. Do not use it for sentences or for section sub-titles (§2.6).

---

## 1. Tokens

### 1.1 Colour (exact current values)

| Token | Value | Role | Contrast (ink / stage / stage-2 / stage-3) |
|---|---|---|---|
| `--ink` | `#0f0c15` | page background, inputs, opaque tab bar | — |
| `--stage` | `#17131f` | panels, list cards, menus, modals | — |
| `--stage-2` | `#1f1a29` | hover, sub-blocks, pills, segments | — |
| `--stage-3` | `#2a2336` | neutral chips, progress tracks | — |
| `--line` | `#3a3149` | strong borders (menus, ghost buttons, inputs) | — |
| `--line-soft` | `#272033` | soft borders (panels, bars) | — |
| `--paper` | `#f4eee3` | main text, primary button fill | 16.8 / 15.8 / 14.7 / 13.1 |
| `--paper-dim` | `#d8d0de` | strong secondary text | 12.9 / 12.2 / 11.3 / 10.1 |
| `--haze` | `#a79fb5` | meta, labels, inactive nav | 7.6 / 7.2 / 6.7 / 5.9 |
| `--haze-2` | **`#948ca6`** (was `#7d7590`) | faint meta, placeholders, footer | **6.1 / 5.7 / 5.3 / 4.7** (was 4.45 / 4.19 / 3.89 / 3.46) |
| `--cue` | `#3fd6c4` | focus, links, new, active dot | 10.7 / 10.1 / 9.4 / 8.4 |
| `--gold` | `#ffd35a` | completed, mastery, royalties | 13.6 / … |
| `--ok` | `#7fd36b` | owned, success | 10.6 / … |
| `--danger` | `#ff6b6b` | errors, destructive | 7.0 / 6.6 / 6.1 / 5.4 |
| `--like` (new alias) | `#ff4f7e` | active "J'aime" heart | 6.2 / 5.8 / 5.4 / 4.8 |
| `--star` / `--star-empty` | `#ffd35a` / `#3a3149` | rating stars | — |

Rarities are unchanged: `--r-common #e6e1ec`, `--r-uncommon #7fd36b`, `--r-rare #4f9dff`, `--r-super #b17dff`, `--r-ultra #ff8b3d`, `--r-legendary #ffd35a`, `--r-promo #ef3b3b`.
One text-only companion is added, `--r-promo-text #ff5a5a`. It is the same red, lightened for **text** on the promo card foot (5.8:1 instead of 4.6:1 at 10 px). Frames, ribbons and fills keep `--r-promo`.

Signature gradients, written once as tokens (values copied from the current rules):

| Token | Used by today | Value |
|---|---|---|
| `--grad-booster` | `.pack__body` | `linear-gradient(158deg, #ff4f7e 0%, #c26bff 34%, #4f9dff 66%, #3fd6c4 100%)` |
| `--grad-wordmark` | `.logo__mania` | `linear-gradient(100deg, var(--r-legendary), var(--r-ultra) 55%, var(--r-promo))` |
| `--grad-disc` | `.logo__mark`, `.card-back__label` | conic gradient promo → ultra → legendary → uncommon → rare → super |
| `--grad-foil` | `.pack__top/__bottom` | silver crimp `#cfc7d9 → #fff → #b9afc6 → #fff → #d4cbe0` |
| `--grad-gold` | `.progress--done` | `#b8862a → gold → #fff1bf → gold` |
| `--grad-holo` | `.tag--holo` | `#ff4f7e → #ffd35a → #3fd6c4 → #b17dff` |
| `--grad-panel` | `.studio__desk` | `linear-gradient(180deg, var(--stage-2), var(--stage))` |
| `--grad-hero` | `.hero` (+ `var(--stage)`) | violet glow top-left 22 % + teal glow bottom-left 12 % |
| `--grad-skeleton` | `.card--loading`, skeletons | `linear-gradient(110deg, #1a1522 30%, #2a2233 50%, #1a1522 70%)` |
| `--grooves` | vinyl textures | `repeating-radial-gradient(circle, #17121e 0 2px, #1d1726 2px 4px)` |

### 1.2 Typography

Fonts are unchanged and loaded with the **same URL as `client/index.html`**:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Figtree:wght@400;500;600;700;800&family=Martian+Mono:wdth,wght@75..112.5,400..700&display=swap" />
```

| Family | Token | Job |
|---|---|---|
| Archivo (variable width) | `--font-display` | headings, names, album and track titles, big numbers, the logo, the booster brand |
| Figtree | `--font-body` | text, buttons, navigation, chips, meta |
| Martian Mono (variable width) | `--font-mono` | counters, codes, timers, card feet, page kickers (`.eyebrow`), group headers in menus |

**Scale: 7 UI steps plus 4 fluid display steps, replacing 57 rendered sizes.** The steps are today's most frequent sizes. The counts below come from the declared sizes in the six stylesheets.

| Token | Size | Replaces (count of declarations today) | Used for |
|---|---|---|---|
| `--fs-12` · `--fs-meta` | 12 px | 10.5 (1), 11 (16), 11.5 (7), 12 (14) | eyebrow, counters, small chips, timers, tab bar labels, table headers, axis |
| `--fs-13` · `--fs-small` | 13 px | 12.5 (11), 13 (25), 13.5 used as meta | secondary text, chips, `btn--sm`, hints, errors, footer |
| `--fs-14` · `--fs-ui` | 14 px | 13.5 used as prose (feed review, hint box), 14 (23) | buttons, menus, list rows, toasts, comments |
| `--fs-15` · `--fs-body` | 15 px | 14.5 (4: top nav, tabs, track title), 15 (9) | body (`body { font: 400 15px/1.5 }`), names, dropdown titles |
| `--fs-16` · `--fs-lead` | 16 px | 16 (8) | h3, tile and row titles, `btn--xl` |
| `--fs-18` · `--fs-title` | 18 px | 18 (5), 19 (1), 20 used as a title (1) | panel and modal titles, header artist line |
| `--fs-22` · `--fs-stat` | 22 px | 20 used as a number (1), 22 (4) | stat values, community score |
| `--fs-h2` | `clamp(19px, 2.2vw, 24px)` | h2, 24 (2) | section titles |
| `--fs-display-sm` | `clamp(22px, 3vw, 32px)` | card-detail title (24–32), opening summary (24–34), Studio head (22–30), crash (22–30) | display titles inside pages |
| `--fs-h1` | `clamp(26px, 3.6vw, 40px)` | h1 | page titles, track page, Taste Match figure |
| `--fs-hero` | `clamp(30px, 4.6vw, 52px)` | hero (30–52), album title (28–50) | Boosters hero, album title |

Exceptions, kept on purpose because they are objects rather than UI text: the logo (21 px, `logo--sm` 16 px, `logo--lg` 26–36 px), the booster artwork (sizes in `calc(var(--pw) * …)`), and the cards (container units with floors, §1.2.1).

**Floors.** No UI text is smaller than 12 px. Card micro-labels are at least 10 px.

#### 1.2.1 Cards: floors and progressive hiding

`.card` is already a size container (`container-type: inline-size`). Its text keeps its `cqi` sizing with higher floors:

| Element | Before | After |
|---|---|---|
| `.card__title` | `max(10px, 8.6cqi)` | `var(--fs-card-title)` = `max(12px, 8.6cqi)` |
| `.card__artist` | `max(8.5px, 6.3cqi)` | `var(--fs-card-artist)` = `max(11px, 6.3cqi)` |
| `.card__foot` (rarity, code, popularity) | `max(7.5px, 5.2cqi)` | `var(--fs-card-micro)` = `max(10px, 5.2cqi)` |
| `.card__num`, `.card__count` | `max(8px, 5.6cqi)` | `var(--fs-card-num)` = `max(10px, 5.6cqi)` |
| `.card__badge` | `max(8.5px, 5.8cqi)` | `max(10px, 5.8cqi)` |

Rather than shrinking, small cards drop elements, in this order:

| Card width | Hidden | Still visible |
|---|---|---|
| < 150 px | popularity (`.card__pop`) | number, art, title, artist, rarity |
| < 130 px | artist line, code; the foot is centred | number, art, title, rarity |
| < 110 px | number, PROMO ribbon (the foot already says PROMO) | art, title, rarity |
| < 90 px | title, foot, top row | art and rarity frame only (thumbnails, reveal tray, mini cards) |

Each hidden item stays readable in the card modal and on the track page.

#### 1.2.2 Weights, line heights, tracking

| Weights | Value | Replaces |
|---|---|---|
| `--fw-regular` | 400 | body |
| `--fw-medium` | 500 | meta, secondary counters |
| `--fw-semi` | 600 | labels, chips, links (also replaces the one 550) |
| `--fw-ui` | 650 | buttons, nav, tabs |
| `--fw-bold` | 700 | h3, names, values |
| `--fw-title` | 750 | h2, tile and card titles (720 / 750 / 760) |
| `--fw-display` | 800 | h1, hero, big numbers (also replaces the avatar's 850) |
| `--fw-black` | 900 | logo, booster brand |

Line heights: `--lh-display 1` (hero), `--lh-title 1.1` (h1 1.05, h2 1.15), `--lh-snug 1.2` (names, tiles, buttons), `--lh-ui 1.3` (eyebrow, labels), `--lh-body 1.5`.

The Archivo display look is kept as it is: tracking `--ls-logo -0.035em`, `--ls-display -0.02em` (h1, hero), `--ls-title -0.01em` (h2, card titles); width `--fst-hero 115%`, `--fst-display 112%`, `--fst-title 108%`. Mono keeps `--ls-mono -0.01em`, `--fst-mono 85%` (numbers) and `--fst-label 90%` (eyebrow, segments). Caps tracking: `--ls-eyebrow 0.08em`, `--ls-caps 0.05em`.

### 1.3 Spacing

These are today's values; by frequency the top ones are 10, 8, 6, 12, 4, 14 and 16 px. The tokens are `--s-2`, `--s-4`, `--s-6`, `--s-8`, `--s-10`, `--s-12`, `--s-14`, `--s-16`, `--s-20`, `--s-24`, `--s-28`, `--s-32`, `--s-40`, `--s-56`.

The patterns to keep:

| Context | Value |
|---|---|
| Panel padding | 20 (hero 24–48 × 24–64, Studio desk 20 × 16–28) |
| List card / row padding | 12–14 × 14–16 |
| Gap inside a row of chips or buttons | 6–10 |
| Gap between cards of a list | 8–12 |
| Grid gap: home panels / album grid / card grid | 16 / 22 × 18 / 18 × 16 (phone: 16 × 12) |
| Section rhythm | `.section` margin-top 40, `.section__head` margin-bottom 16, `.page-head` margin-bottom 24 |
| Page | `--page 1180px`, `--gutter clamp(16px, 4vw, 32px)`, page padding 20–36 top, 56 bottom |

### 1.4 Radii: 20 values become 5 plus pill

| Token | Value | Replaces | Used by |
|---|---|---|---|
| `--rad-xs` | 6 px | 2, 3, 4, 5, 6 | thumbnails ≤ 40 px, focus ring, keyboard keys |
| `--rad-sm` | 10 px | 8, 10 | menu rows, 56–72 px covers, rating buttons |
| `--rad-md` = `--radius` | 14 px | 12, 14, 16 | rows, reviews, posts, toasts, inputs, album tile covers |
| `--rad-lg` = `--radius-lg` | 22 px | 20, 22, 24 | panels, modals, sheets, Studio desk |
| `--rad-xl` | 28 px | 28 | Boosters hero, profile header |
| `--rad-pill` | 999 px | 99 px, 999 px | buttons, pills, chips, segments |

Two radii are derived rather than new steps. `--rad-menu` = `calc(var(--rad-sm) + 8px)` = 18 px: menus and dropdowns follow the "outer = inner + padding" rule, which is why today's 18 px menu looks right. `50%` stays for discs and avatars. Objects keep their own radii: cards `7cqi`, the booster 2–3 px.

### 1.5 Shadows, layers, motion, breakpoints

| Shadow token | Value | Today on |
|---|---|---|
| `--shadow-cover-sm` | `0 10px 22px -12px rgba(0,0,0,.9)` | small covers (top albums) |
| `--shadow-cover` | `0 14px 30px -14px rgba(0,0,0,.8)` | `.album-tile__cover` |
| `--shadow-cover-lg` | `0 30px 60px -24px rgba(0,0,0,.9)` | `.album-head__cover` |
| `--shadow-pop` | `0 24px 60px -12px rgba(0,0,0,.7)` | `.menu` |
| `--shadow-modal` | `0 40px 100px -20px rgba(0,0,0,.8)` | `.modal` |
| `--shadow-toast` | `0 16px 40px -10px rgba(0,0,0,.6)` | `.toast` |
| `--shadow-chip` | `0 4px 14px rgba(0,0,0,.5)` | `.tag` on cards |
| `--shadow-pack` | `drop-shadow(0 30px 34px rgba(0,0,0,.55))` (a `filter`) | `.pack` |
| `--ring-gold` | `0 0 0 2px gold, 0 14px 30px -12px rgba(255,211,90,.35)` | completed album |
| `--ring-focus` | `0 0 0 3px` cue at 22 % | `.input:focus` |

Layers: `--z-raised 1` (1–6 inside components), `--z-sticky 30` (top bar, tab bar), `--z-dropdown 40` (account menu, search, notifications), `--z-opening 60` (pack opening), `--z-sheet 70` (new: phone search sheet, booster sheet), `--z-modal 80`, `--z-toast 100`.

Motion, from the current animations:

| Duration | Value | Use |
|---|---|---|
| `--dur-press` | 0.12 s | button press |
| `--dur-hover` | 0.15 s | colour, border and background on hover |
| `--dur-fade` | 0.18 s | backdrop fade, card hover |
| `--dur-pop` | 0.22 s | modal and dropdown (the menu uses 0.16 s) |
| `--dur-rise` | 0.25 s | toast |
| `--dur-slow` | 0.6 s | logo spin, vinyl slide |
| `--dur-fill` | 0.8 s | progress fill |

| Easing | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | progress fills, rise |
| `--ease-pop` | `cubic-bezier(.2,.9,.3,1.2)` | modal, deal |
| `--ease-spring` | `cubic-bezier(.2,.9,.3,1.3)` | achievement, like |
| `--ease-logo` | `cubic-bezier(.3,.7,.3,1)` | logo |

The existing keyframes are kept: `pop`, `rise`, `fade-in`, `deal`, `spin`, `float`, `sheen`, `holo`, `tease`, `eq`, `card-loading`. One is added: `like-pop`. The global `prefers-reduced-motion` rule stays.

Breakpoints. Today's 1020, 860 and 640 are kept; the stray 700 and 600 fold into them.

| Breakpoint | What changes |
|---|---|
| **1080** (new) | inline search field in the top bar; below it, a search icon |
| 1020 | tablet: 2-column album row, single-column home |
| 860 | phone navigation: the tab bar appears and the top nav is hidden |
| 640 | phone layouts |
| 520 | 3-column card grid between 520 and 640 |
| Cards | `@container` (§1.2.1) |

### 1.6 Block A: the `:root` to paste

Paste this **in place of** the first `:root { … }` block of `client/src/styles/app.css` (lines 4–38) and delete the small `:root { --star; --star-empty }` block (around line 4427), which is now included. Every existing variable name is still defined, and the new tokens are additions, so nothing breaks. The block also repeats the existing 860 px override of `--topbar` and `--tabbar`, so it works wherever it is loaded.

```css
/* =====================================================================================================
   AlbumMania · jetons du design system (identité ACTUELLE, formalisée — aucun changement de look).
   À coller À LA PLACE du premier bloc :root d'app.css (lignes 4-38) et du bloc :root « notes » (--star).
   Tous les anciens noms (--ink, --stage…, --radius, --radius-lg, --page, --topbar, --tabbar, --gutter,
   --star, --star-empty) restent définis : rien ne casse.
   ===================================================================================================== */
:root {
  color-scheme: dark;

  /* ---------- surfaces : encre prune ---------- */
  --ink: #0f0c15;          /* fond de page, champs */
  --stage: #17131f;        /* panneaux, cartes de liste, menus, modales */
  --stage-2: #1f1a29;      /* survol, sous-blocs, pastilles */
  --stage-3: #2a2336;      /* chips neutres, pistes de progression */
  --line: #3a3149;         /* bordures fortes (menus, boutons fantômes, champs) */
  --line-soft: #272033;    /* bordures douces (panneaux, barres) */

  /* ---------- texte : papier ivoire ---------- */
  --paper: #f4eee3;        /* texte principal, bouton primaire (16.8:1 sur ink) */
  --paper-dim: #d8d0de;    /* texte secondaire fort (11.3:1 sur stage-2) */
  --haze: #a79fb5;         /* méta, libellés (6.7:1 sur stage-2) */
  --haze-2: #948ca6;       /* était #7d7590 (3.89:1) → 5.30:1 sur stage-2, 4.71:1 sur stage-3 */

  /* ---------- signaux ---------- */
  --cue: #3fd6c4;          /* accent : focus, liens, nouveau, actif */
  --gold: #ffd35a;         /* complété, maîtrise, royalties */
  --ok: #7fd36b;
  --danger: #ff6b6b;
  --like: #ff4f7e;         /* rose du booster : cœur « J'aime » actif (5.4:1 sur stage-2) */
  --star: #ffd35a;
  --star-empty: #3a3149;

  /* ---------- raretés (inchangées) ---------- */
  --r-common: #e6e1ec;
  --r-uncommon: #7fd36b;
  --r-rare: #4f9dff;
  --r-super: #b17dff;
  --r-ultra: #ff8b3d;
  --r-legendary: #ffd35a;
  --r-promo: #ef3b3b;
  --r-promo-text: #ff5a5a; /* même rouge, éclairci pour le TEXTE seulement (5.8:1 sur le pied de carte promo) */

  /* ---------- dégradés signature ---------- */
  --grad-booster: linear-gradient(158deg, #ff4f7e 0%, #c26bff 34%, #4f9dff 66%, #3fd6c4 100%);
  --grad-wordmark: linear-gradient(100deg, var(--r-legendary), var(--r-ultra) 55%, var(--r-promo));
  --grad-disc: conic-gradient(var(--r-promo), var(--r-ultra), var(--r-legendary), var(--r-uncommon), var(--r-rare), var(--r-super), var(--r-promo));
  --grad-foil: linear-gradient(90deg, #cfc7d9, #ffffff 30%, #b9afc6 55%, #fff 80%, #d4cbe0);
  --grad-gold: linear-gradient(90deg, #b8862a, var(--gold), #fff1bf, var(--gold));
  --grad-holo: linear-gradient(90deg, #ff4f7e, #ffd35a, #3fd6c4, #b17dff);
  --grad-panel: linear-gradient(180deg, var(--stage-2), var(--stage));
  --glow-violet: rgba(194, 107, 255, 0.22);
  --glow-cue: rgba(63, 214, 196, 0.12);
  --grad-hero:
    radial-gradient(ellipse 50% 90% at 18% 0%, var(--glow-violet), transparent 70%),
    radial-gradient(ellipse 40% 70% at 0% 100%, var(--glow-cue), transparent 70%);
  --grad-skeleton: linear-gradient(110deg, #1a1522 30%, #2a2233 50%, #1a1522 70%);
  --grooves: repeating-radial-gradient(circle, #17121e 0 2px, #1d1726 2px 4px);

  /* ---------- polices (même URL Google Fonts que client/index.html) ---------- */
  --font-display: 'Archivo', 'Arial Black', 'Helvetica Neue', system-ui, sans-serif;
  --font-body: 'Figtree', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'Martian Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;

  /* ---------- échelle typographique : 7 paliers d'interface + 4 paliers d'affichage fluides ---------- */
  --fs-12: 12px;   /* méta, eyebrow, compteurs, chips S        (remplace 10.5 / 11 / 11.5 / 12)        */
  --fs-13: 13px;   /* texte secondaire, chips, boutons S, aides (remplace 12.5 / 13 / 13.5 méta)       */
  --fs-14: 14px;   /* UI : boutons, menus, listes, onglets     (remplace 13.5 prose / 14 / 14.5)       */
  --fs-15: 15px;   /* corps de texte (body)                                                             */
  --fs-16: 16px;   /* h3, noms, titres de vignette, bouton XL                                          */
  --fs-18: 18px;   /* titres de panneau / modale, artiste d'en-tête (remplace 18 / 19 / 20)            */
  --fs-22: 22px;   /* chiffres de statistiques, note communauté (remplace 20 / 22)                     */
  --fs-h2: clamp(19px, 2.2vw, 24px);         /* h2, titres de section */
  --fs-display-sm: clamp(22px, 3vw, 32px);   /* titre de fiche carte, résumé d'ouverture, « Mon Studio » (22-34) */
  --fs-h1: clamp(26px, 3.6vw, 40px);         /* h1 de page, page morceau, Taste Match */
  --fs-hero: clamp(30px, 4.6vw, 52px);       /* héros Boosters, titre d'album (28-52) */
  /* alias sémantiques */
  --fs-meta: var(--fs-12);
  --fs-small: var(--fs-13);
  --fs-ui: var(--fs-14);
  --fs-body: var(--fs-15);
  --fs-lead: var(--fs-16);
  --fs-title: var(--fs-18);
  --fs-stat: var(--fs-22);
  /* cartes : unités de conteneur avec planchers (le conteneur est .card) */
  --fs-card-title: max(12px, 8.6cqi);
  --fs-card-artist: max(11px, 6.3cqi);
  --fs-card-micro: max(10px, 5.2cqi);
  --fs-card-num: max(10px, 5.6cqi);

  /* ---------- graisses (polices variables) ---------- */
  --fw-regular: 400;
  --fw-medium: 500;   /* méta, compteurs secondaires */
  --fw-semi: 600;     /* libellés, chips, liens */
  --fw-ui: 650;       /* boutons, navigation, onglets */
  --fw-bold: 700;     /* h3, noms, valeurs */
  --fw-title: 750;    /* h2, titres de vignette (720 / 750 / 760) */
  --fw-display: 800;  /* h1, héros, chiffres XL */
  --fw-black: 900;    /* logo, marque du booster */

  /* ---------- interlignes ---------- */
  --lh-display: 1;     /* héros */
  --lh-title: 1.1;     /* h1 1.05 / h2 1.15 */
  --lh-snug: 1.2;      /* noms, titres de vignette, boutons */
  --lh-ui: 1.3;        /* eyebrow, libellés, listes */
  --lh-body: 1.5;      /* paragraphes */

  /* ---------- approche & chasse (look Archivo étendu conservé) ---------- */
  --ls-logo: -0.035em;
  --ls-display: -0.02em;   /* h1, héros */
  --ls-title: -0.01em;     /* h2, titres de carte */
  --ls-mono: -0.01em;      /* .mono (chiffres) */
  --ls-caps: 0.05em;       /* majuscules courtes (pied de carte, NOUVEAU) */
  --ls-eyebrow: 0.08em;    /* eyebrow mono */
  --fst-hero: 115%;        /* font-stretch du héros, avatar */
  --fst-display: 112%;     /* h1, logo */
  --fst-title: 108%;       /* h2 */
  --fst-mono: 85%;         /* chiffres mono */
  --fst-label: 90%;        /* eyebrow, segments */

  /* ---------- espacements (valeurs déjà utilisées, par ordre de fréquence : 10, 8, 6, 12, 4, 14, 16) ---------- */
  --s-2: 2px;
  --s-4: 4px;
  --s-6: 6px;
  --s-8: 8px;
  --s-10: 10px;
  --s-12: 12px;
  --s-14: 14px;
  --s-16: 16px;
  --s-20: 20px;
  --s-24: 24px;
  --s-28: 28px;
  --s-32: 32px;
  --s-40: 40px;
  --s-56: 56px;

  /* ---------- rayons : 5 paliers + pilule (les cartes gardent leur 7cqi, le booster ses 2-3 px) ---------- */
  --rad-xs: 6px;     /* vignettes ≤ 40 px, focus, étiquettes carrées, histogramme   (2 / 3 / 4 / 5 / 6) */
  --rad-sm: 10px;    /* lignes de menu, petites pochettes 56-72 px, boutons de note (8 / 10)            */
  --rad-md: 14px;    /* = --radius : lignes, critiques, toasts, champs, vignettes d'album (12 / 14 / 16) */
  --rad-lg: 22px;    /* = --radius-lg : panneaux, modales, bureau du Studio (20 / 22 / 24)              */
  --rad-xl: 28px;    /* héros Boosters, en-tête de profil                                              */
  --rad-pill: 999px; /* boutons, pastilles, chips, segments (99px / 999px)                              */
  --rad-menu: calc(var(--rad-sm) + 8px); /* 18 px : menu / liste déroulante = rayon interne + padding 8 */
  --radius: var(--rad-md);
  --radius-lg: var(--rad-lg);

  /* ---------- ombres ---------- */
  --shadow-cover-sm: 0 10px 22px -12px rgba(0, 0, 0, 0.9);  /* pochettes ≤ 120 px */
  --shadow-cover: 0 14px 30px -14px rgba(0, 0, 0, 0.8);     /* vignette d'album */
  --shadow-cover-lg: 0 30px 60px -24px rgba(0, 0, 0, 0.9);  /* pochette d'en-tête */
  --shadow-pop: 0 24px 60px -12px rgba(0, 0, 0, 0.7);       /* menu, liste déroulante, panneau de notifications */
  --shadow-modal: 0 40px 100px -20px rgba(0, 0, 0, 0.8);
  --shadow-toast: 0 16px 40px -10px rgba(0, 0, 0, 0.6);
  --shadow-chip: 0 4px 14px rgba(0, 0, 0, 0.5);             /* étiquettes posées sur une carte */
  --shadow-pack: drop-shadow(0 30px 34px rgba(0, 0, 0, 0.55)); /* filter: */
  --ring-gold: 0 0 0 2px var(--gold), 0 14px 30px -12px rgba(255, 211, 90, 0.35);
  --ring-focus: 0 0 0 3px color-mix(in oklab, var(--cue) 22%, transparent);

  /* ---------- couches ---------- */
  --z-raised: 1;       /* 1-6 : empilements internes aux composants (carte, booster) */
  --z-sticky: 30;      /* barre du haut, barre d'onglets */
  --z-dropdown: 40;    /* menu du compte, recherche, notifications */
  --z-opening: 60;     /* écran d'ouverture de booster */
  --z-sheet: 70;       /* feuille de recherche plein écran, feuille Boosters (téléphone) */
  --z-modal: 80;
  --z-toast: 100;

  /* ---------- mouvement ---------- */
  --dur-press: 0.12s;   /* appui bouton */
  --dur-hover: 0.15s;   /* couleur / bordure / fond au survol */
  --dur-fade: 0.18s;    /* fondu de voile, survol de carte */
  --dur-pop: 0.22s;     /* modale, liste déroulante (menu : 0.16s) */
  --dur-rise: 0.25s;    /* toast */
  --dur-slow: 0.6s;     /* rotation du logo, sortie du vinyle */
  --dur-fill: 0.8s;     /* remplissage des barres de progression */
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-pop: cubic-bezier(0.2, 0.9, 0.3, 1.2);
  --ease-spring: cubic-bezier(0.2, 0.9, 0.3, 1.3);
  --ease-logo: cubic-bezier(0.3, 0.7, 0.3, 1);

  /* ---------- mise en page ---------- */
  --page: 1180px;
  --topbar: 64px;
  --tabbar: 0px;
  --gutter: clamp(16px, 4vw, 32px);
  /* points de rupture (constantes, non utilisables dans @media) : 1080 recherche en ligne · 1020 tablette ·
     860 navigation mobile (barre d'onglets) · 640 téléphone · 520 grille 3 colonnes · cartes : @container */
}

@media (max-width: 860px) {
  :root {
    --topbar: 58px;
    --tabbar: 64px;
  }
}
```

---

## 2. Fixes allowed by the override

### 2.0 Block B: append at the end of `app.css`

This block carries every fix in §2 plus the unified chip from §3.3. It was validated in the mock.

```css
/* =====================================================================================================
   Correctifs autorisés par la décision du propriétaire (même identité, lisibilité et cohérence).
   ===================================================================================================== */

/* 1 · Boutons désactivés : contour atténué au lieu d'un aplat gris (qui lisait « cassé » à 3:1). */
.btn:disabled,
.btn[aria-disabled='true'] {
  opacity: 1;
  background: transparent;
  border-color: color-mix(in oklab, var(--paper) 14%, transparent);
  color: var(--haze-2);
  cursor: not-allowed;
}

.btn:disabled svg,
.btn[aria-disabled='true'] svg {
  opacity: 0.7;
}

/* 1 bis · .btn--quiet seul héritait du fond gris du navigateur (<button> en color-scheme dark) : « Réinitialiser
   les filtres » de la Collection. Le fond devient transparent, le survol reprend celui des boutons fantômes. */
.btn--quiet {
  background: transparent;
}

.btn--quiet:hover:not(:disabled) {
  color: var(--paper);
  background: var(--stage-2);
}

/* 2 · Tailles minimales : rien sous 12 px dans l'interface. */
.eyebrow,
.pill__timer,
.count-badge,
.role-tag,
.master-tag,
.tag,
.histogram__axis,
.coll-chip__n,
.pf-chip__n,
.coll-more__n,
.pf-more__n,
.album-tile__badge,
.album-tile__progress .album-tile__badge,
.bt-choice__admin,
.cover-pick__lock,
.star-input__zero,
.points-input--compact .points-input__btn {
  font-size: var(--fs-12);
}

.field__hint,
.field__error,
.field__ok,
.field__pending,
.footer,
.album-tile__info,
.press-btn,
.crash__message,
.coll-summary__label {
  font-size: var(--fs-13);
}

.count-badge {
  min-width: 20px;
  height: 20px;
}

/* 3 · Cartes : planchers ≥ 10 px et effacement progressif sur les petites cartes (au lieu de rapetisser). */
.card__num { font-size: var(--fs-card-num); }
.card__foot { font-size: var(--fs-card-micro); }
.card__title { font-size: var(--fs-card-title); }
.card__artist { font-size: var(--fs-card-artist); }
.card__badge { font-size: max(10px, 5.8cqi); }
.card__count { font-size: var(--fs-card-num); }
.card--promo .card__rarity { color: var(--r-promo-text); }

@container (max-width: 149px) {
  .card__pop { display: none; }                 /* la popularité reste dans la fiche de la carte */
}

@container (max-width: 129px) {
  .card__artist,
  .card__code { display: none; }
  .card__foot { justify-content: center; }
}

@container (max-width: 109px) {
  .card__num { display: none; }                 /* le numéro reste dans la tracklist */
  .card__ribbon { display: none; }              /* PROMO est déjà écrit dans le pied */
}

@container (max-width: 89px) {
  .card__body,
  .card__foot,
  .card__top { display: none; }                 /* vignette : pochette + cadre de rareté seulement */
  .card__inner { padding: 6cqi; }
}

/* 4 · Grille de cartes : 2 colonnes sur téléphone (≈ 170 px par carte), 3 au-delà de 520 px. */
@media (max-width: 640px) {
  .card-grid,
  .card-grid--picker {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 12px;
  }
}

@media (min-width: 520px) and (max-width: 640px) {
  .card-grid,
  .card-grid--picker {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

/* 5 · Barre d'onglets opaque (le contenu ne transparaît plus) et 5 entrées. */
@media (max-width: 860px) {
  .tabbar {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    background: var(--ink);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .tabbar__link {
    font-size: var(--fs-12);
    color: var(--haze);
  }
}

/* 6 · Moins de majuscules mono décoratives : sous-titre de bloc en casse normale. L'eyebrow mono reste pour
   le surtitre de page, les codes (AM-001 · ÉLECTRO · 2001), les compteurs et les en-têtes de groupe des menus. */
.label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: var(--fw-semi) var(--fs-13) / var(--lh-ui) var(--font-body);
  color: var(--haze);
}

.studio__label {
  font: var(--fw-bold) var(--fs-16) / var(--lh-snug) var(--font-display);
  text-transform: none;
  letter-spacing: 0;
  color: var(--paper);
}

.tracklist th {
  font: var(--fw-semi) var(--fs-12) / 1 var(--font-body);
  letter-spacing: 0;
  text-transform: none;
}

/* =====================================================================================================
   Chip unique : remplace .chip / .chip-btn / .tag / .level-chip / .master-tag / .role-tag / .owned-chip /
   .friend-score / .coll-chip (tons × tailles), au rendu identique à l'existant.
   ===================================================================================================== */
.chip {
  --chip-h: 28px;
  --chip-px: 11px;
  --chip-fs: var(--fs-13);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--chip-h);
  padding: 0 var(--chip-px);
  border-radius: var(--rad-pill);
  border: 1px solid transparent;
  background: var(--stage-3);
  color: var(--paper-dim);
  font: var(--fw-semi) var(--chip-fs) / 1 var(--font-body);
  white-space: nowrap;
}

.chip--sm { --chip-h: 22px; --chip-px: 8px; --chip-fs: var(--fs-12); gap: 4px; }
.chip--lg { --chip-h: 34px; --chip-px: 14px; }

.chip--mono { font-family: var(--font-mono); font-size: var(--fs-12); font-stretch: var(--fst-label); font-variant-numeric: tabular-nums; }
.chip--caps { text-transform: uppercase; letter-spacing: var(--ls-caps); font-weight: var(--fw-display); }

.chip--quiet { background: var(--stage-2); }
.chip--new,
.chip--cue { background: color-mix(in oklab, var(--cue) 18%, transparent); color: var(--cue); }
.chip--gold { background: color-mix(in oklab, var(--gold) 18%, transparent); color: var(--gold); }
.chip--ok { background: color-mix(in oklab, var(--ok) 15%, transparent); color: var(--ok); }
.chip--danger { background: color-mix(in oklab, var(--danger) 16%, transparent); color: var(--danger); }
.chip--rarity { background: color-mix(in oklab, var(--rc) 14%, transparent); color: var(--rc); }
.chip--paper { background: var(--paper); color: var(--ink); }
.chip--gold-solid { background: var(--gold); color: var(--ink); font-weight: var(--fw-title); }
.chip--solid-cue { background: var(--cue); color: var(--ink); }
.chip--holo { background: var(--grad-holo); color: var(--ink); }

/* interactif (filtres) : l'ancien .chip-btn */
.chip--toggle {
  --chip-h: 34px;
  --chip-px: 14px;
  background: transparent;
  border-color: var(--line);
  color: var(--haze);
  cursor: pointer;
  transition: color var(--dur-hover), background-color var(--dur-hover), border-color var(--dur-hover);
}

.chip--toggle:hover { color: var(--paper); }

.chip--toggle.is-on,
.chip--toggle[aria-pressed='true'] {
  background: var(--paper);
  border-color: var(--paper);
  color: var(--ink);
}

.chip__n {
  font: var(--fw-medium) var(--fs-12) / 1 var(--font-mono);
  font-stretch: var(--fst-mono);
  font-variant-numeric: tabular-nums;
  color: var(--haze);
}

.chip--toggle.is-on .chip__n { color: color-mix(in oklab, var(--ink) 72%, transparent); }

@media (max-width: 640px) {
  .chip--toggle { --chip-h: 40px; } /* cible tactile */
}
```

What each part does:

1. **`--haze-2` contrast.** `#7d7590` becomes `#948ca6`, which gives 5.3:1 on `stage-2` and 4.7:1 on `stage-3`, so it now passes AA everywhere. It affects meta lines, placeholders, the histogram axis, the footer, "0 / 5 ★" and the blind-test "Prochain indice…" rows.
2. **Disabled buttons.** A disabled button is now a transparent pill with a 14 % paper outline and `--haze-2` text, with `cursor: not-allowed`. The old grey fill read as broken at 3:1 ("Se connecter", "Envoyer la demande", "Mettre à jour", "Tout afficher", "Compléter « … »"). It is visible in the mock on "Envoyer", "Générer l'image" and "Désactivé (contour)". The rule also covers `[aria-disabled="true"]`. Even better, where possible keep the primary enabled and validate on submit.
3. **Bug found while validating.** A `.btn--quiet` used on its own showed the browser's grey `<button>` background, because the colour scheme is dark and `.btn` sets no background. One case ships today: Collection's "Réinitialiser les filtres" (`btn btn--quiet btn--xs`, `Collection.jsx:579`). Block B gives `.btn--quiet` a transparent background and the ghost hover.
4. **Minimum sizes.** Every 10.5 / 11 / 11.5 px selector moves to 12 px: eyebrow, pill timer, count badge, role tag, master tag, `.tag`, histogram axis, `coll-chip__n`, `pf-chip__n`, `*-more__n`, album-tile badge, blind-test admin chip, cover lock, star "0", compact points buttons. Hints, errors, footer, album-tile info and the press button move from 12.5 to 13 px. Count badge: 20 × 20.
5. **Phone card grid: 2 columns.** At ≤ 640 px the grid uses `repeat(2, …)` with a 16 × 12 gap, giving cards of about 170 px, so titles render at 14–15 px. Between 520 and 640 px it uses 3 columns.
6. **Opaque tab bar.** At ≤ 860 px the bar background is `var(--ink)` with no blur, so page content no longer shows through. It has 5 columns, 12 px labels and `--haze` inactive labels (7.6:1 on ink instead of 4.45:1).
7. **Fewer decorative uppercase mono labels.**
   - `.eyebrow` (mono, uppercase, 12 px) stays for:
     - the kicker above a page or hero title ("BOOSTER ALBUMMANIA · 5 MORCEAUX", "AM-001 · ÉLECTRO · 2001");
     - the kicker of a mention card, which mirrors the album page;
     - group headers inside a dropdown ("ALBUMS", "MORCEAUX").
   - Sub-titles **inside** a panel become sentence-case `h3` (Archivo 700 16 px) or the new `.label` (Figtree 600 13 px, `--haze`). Concretely:
     - "NOTES DE TES AMIS" → `h3`;
     - "CRITIQUES" → `h2`;
     - "TA NOTE" → `h3`;
     - "ÉCOUTER SUR" → `.label`;
     - "RÉCOMPENSE" → `.label`;
     - `.studio__label` "MA SÉLECTION" → Archivo 16;
     - `.tracklist th` → Figtree 12.
   - Martian Mono stays for numbers, codes, timers, FR/EN and the card feet.

Fixes that are layout only (no new look), to do when each page is reworked:
- Touch targets ≥ 40 px on phones: toggle chips 40, `.act-btn` 40, `btn--sm` minimum 40 in toolbars.
- Collection filters in one "Filtres" sheet on phones.
- Full-width (centred) cover on the phone album and track headers.
- Bottom sheets instead of centred modals for the rarity guide and the card modal on phones.

---

## 3. Inventory of today's components (canonical = current `app.css`)

The rules below are canonical as they are; only Block B touches them. Line numbers refer to `client/src/styles/app.css` at commit `2bdb681`.

### 3.1 Buttons (`.btn`, l. 189)

Base: pill, `--bh` height, `0 18px` padding, Figtree 650 14 px, press `translateY(1px) scale(.98)`.

| Role | Class | Look |
|---|---|---|
| Primary | `.btn--primary` | ivory `--paper` fill, ink text; hover `#fff`. One per view. |
| Secondary | `.btn--ghost` | transparent, `--line` border, paper text; hover `--haze-2` border + `stage-2` fill |
| Quiet | `.btn--quiet` | no border, `--haze` text (transparent after Block B) |
| Destructive | `.btn--danger` | `--danger` fill, ink text. Use it only behind `ConfirmButton` or for "Vider ma collection". |
| Text link | `.link-btn` | cue, underlined, offset 3 |
| Icon | `.icon-btn` | 38 px circle, haze, hover `stage-2` |

Sizes: `--xs` 28 px / 12 px, `--sm` 34 / 13, default 42 / 14, `--lg` 50 / 15, `--xl` 56 / 16, `--block` full width. The hero CTA is `btn--primary btn--xl` with the pack icon.

### 3.2 Fields

- `.input`: 46 px, radius 12 → 14, `--ink` background, `--line` border; focus `--cue` border + `--ring-focus`.
- `.field`, `.field__label` (600 14), `.field__hint` / `__error` / `__ok` (13 after the fix).
- `.form-error` / `.form-ok` boxes.
- `.select select`: pill, 38 px, `stage` background.
- `.search`: the magnifier sits at 14 px; the input gets 42 px left padding.
- `.textarea`, `.switch` (34 × 20).
- Star input `.star-input` with a "0" button. A later change replaces that "0" button with a "Retirer ma note" quiet button.

### 3.3 Pills, chips, segments, badges: one chip component

The **pill** (`.pill`, l. 418) is the top-bar counter: 36 px (32 on phones), `stage-2`, `line-soft` border, 13 px. Variants: `--packs` (cue border and cue icon when boosters are ready, `pill__timer` mono) and `--royalties` (gold token + mono number). It stays a separate component.

The **chip** replaces 9 styles. Block B defines `.chip` with these modifiers; the base is exactly today's `.chip`: 28 px, `0 11px`, pill, `stage-3`, Figtree 600 13, `paper-dim`.

| Axis | Modifiers |
|---|---|
| Size | `--sm` (22 px, 12 px), default (28, 13), `--lg` (34, 13), `--toggle` (34; 40 on phones) |
| Tone | default neutral, `--quiet` (stage-2), `--cue` (= `--new`), `--gold`, `--ok`, `--danger`, `--rarity` (uses `--rc`), `--paper`, `--gold-solid`, `--solid-cue`, `--holo` |
| Type | `--mono` (Martian Mono 12, numbers and codes), `--caps` (uppercase 800, only for ADMIN / NOUVEAU / HOLO) |
| Interactive | `.chip--toggle` with `.is-on` or `[aria-pressed=true]` (ivory fill) and a `.chip__n` count (mono 12 `--haze`; on the ivory fill, ink at 72 %) |

Migration map. Each row renders like today; the only visible change is pill corners on the tags that were 6–8 px squares.

| Today | Becomes |
|---|---|
| `.chip` | `.chip` |
| `.chip--new` | `.chip.chip--cue` (alias kept) |
| `.chip-btn` (+ `.coll-chip__n`, `.pf-chip__n`) | `.chip.chip--toggle` + `.chip__n` |
| `.tag`, `.tag--new`, `.tag--holo` (reveal) | `.chip.chip--sm.chip--caps` + `--solid-cue` / `--holo`, plus `box-shadow: var(--shadow-chip)` on the reveal stage |
| `.level-chip` "Niveau 9" | `.chip.chip--cue.chip--mono` |
| `.master-tag` "Maître …" | `.chip.chip--sm.chip--gold` |
| `.role-tag` "ADMIN" | `.chip.chip--sm.chip--cue.chip--mono.chip--caps` |
| `.owned-chip` | `.chip.chip--sm.chip--ok` with `<span class="mono">×2</span>` (`--holo` variant for holo copies) |
| `.friend-score` | `.chip.chip--quiet` |
| `.home-how__price`, `.review__tag` | `.chip.chip--sm` / `.chip.chip--sm.chip--cue` |
| `.album-tile__badge` "Vinyle" | `.chip.chip--sm.chip--gold-solid` (absolute on the cover, as today) |
| `.count-badge` | stays: a notification count, red, 20 px |
| `.dot-badge` | stays: unread dot with ink ring |
| `.seg` / `.seg__btn` | stays: the segmented control (FR/EN mono; `.seg__btn--wide` in Figtree for words) |

Chips inside cards (`.card__tag`, `.card__badge`, `.card__count`) keep their `cqi` sizing, because they are part of the card object.

### 3.4 Navigation and tabs

- **Top nav** `.topnav__link` (l. 781): 38 px pill links, `--haze`; the active link is paper on `stage-2`. Font goes from 14.5 to 15 px.
- **Page tabs** `.tabs` / `.tabs__tab` (Collection): underline tabs with a 2 px paper bar. On phones they scroll with a fade mask (as `.coll-chips` does).
- **Segmented control** `.seg`: 3 px inset, the ivory thumb marks the active item. Use it for 2–4 mutually exclusive views (Cartes / Tracklist, Tes amis / Pour toi / Communauté, Format, Thème).

### 3.5 Surfaces

| Component | Class | Canonical |
|---|---|---|
| Panel | `.panel` (l. 1001) | `stage`, `line-soft` border, radius 22, padding 20, column gap 10. Optional glows: `.panel--bt`, `.home-how`. `.panel__title` 18 px with an 18 px icon. `.panel__row` pushes actions to the bottom. |
| Hero | `.hero` (l. 2115) | radius 28, `--grad-hero` over `stage`, grooved disc at top right, pack + panel grid. **Unchanged.** |
| Studio desk | `.studio__desk` | `--grad-panel`, radius 22 |
| Rows | `.row`, `.artist-row`, `.friend`, `.review`, `.feed__item`, `.mod-item`, `.reward-list li` | `stage` (or `stage-2`), `line-soft` border, radius 14–16 → 14, padding 12–14 × 14–16. Done state: gold border at 45 %. |
| Menu | `.menu` (l. 829) | 272 px, padding 8, radius 18, `stage`, `--line` border, `--shadow-pop`, `pop .16s`. `.menu__head` sits on `stage-2`. `.menu__item` is 42 px, radius 10, 14 / 550 → 600. `--danger` items use `#ffb4b4`. |
| Modal | `.modal-backdrop` + `.modal` (l. 2607) | backdrop `rgba(8,6,12,.74)` with 6 px blur. Modal 560 px (`--narrow` 440, `--wide` 900, `--card` 820), radius 22, `--line` border, `--shadow-modal`, `pop .22s` with `--ease-pop`. `.modal__head` 18 px. |
| Toast | `.toasts` / `.toast` (l. 3867) | bottom centre above the tab bar, ivory pill-ish (radius 14), ink 600 14. `--success` uses cue; `--error` is light red with dark text. |

### 3.6 Collection objects

| Object | Notes |
|---|---|
| Album tile | `.album-tile`, `.album-tile__cover` (radius 12 → 14, `--shadow-cover`, lifts 3 px on hover), `--done` (`--ring-gold`), `__title` (Archivo 720 → 750, 15), `__artist` (13 haze), `__info` (13), `__progress` (progress `xs` + mono `13/14`), skeleton `album-tile--loading` |
| Card | `.card` (l. 1099): 5:7 container with rarity frames (`--common` sober, `--super` and `--ultra` glow, `--legendary` gold conic, `--promo` red + ribbon), `--holo` foil, `--ghost` (stripes + "?"), `--tilt`, `--cover` (real cover, tags move to the foot), `.card-back`, `.card--loading`. Grids: `.card-grid` (150 px min; 2 columns on phones after the fix) and `.card-row` (horizontal snap). |
| Booster | `.pack` (`--float`, `--xl`, `--shake`, `--tear`, `--album`). **Unchanged.** |
| Vinyl and turntable | `.disc`, `.vinyl`, `.vinyl-shelf`, `.turntable`. **Unchanged.** |
| Progress | `.progress` 8 px (`--xs` 4, `--sm` 6, `--lg` 12), `--pc` colour, `--done` gold gradient, 0.8 s fill |
| Avatar | `.avatar` with `--ac`. Use a **deterministic colour per user** from `AVATAR_COLORS` (`shared/rules.js`) instead of the `#ff4f7e` default everyone gets today. |
| Artist badge | `.artist-badge`: round generated art with the initial |
| Empty state | `.empty` (dashed, radius 14, haze) and `.empty-page`. Always add one next action (`btn--primary` or `link-btn`). |
| Skeleton | `--grad-skeleton` + `card-loading 1.4s linear infinite` (cards, tiles, rows, covers), disabled when reduced motion is on |
| Stars | `.stars` (gold, half-star gradients) and `.rating-value` (mono average). `.histogram` 64 px, mine in gold. |
| Celebrations | `.achievement` (gold grooved disc, gold gradient border), opening `.summary`, `.delta` rows |

---

## 4. New components (in the current style)

All the CSS is in **`design/current-v2/components.css`**, the canonical source (1703 lines, French comments like the codebase). Copy it as `client/src/styles/social.css` (or split it per area) and import it next to `app.css`. Each component below lists its anatomy, states and behaviour; the CSS is reproduced in the appendix.

### 4.1 Global search: top bar field and autocomplete (the owner's request)

**Placement.** `.topbar__search.gsearch` goes after the nav, from 1080 px up. It is flexible, 180–360 px wide, about 270 px at 1440. Below 1080 px it becomes `.icon-btn.search-trigger`, which opens the panel (860–1079) or the full-screen sheet (< 860). Shortcuts: `/` and `Ctrl`/`⌘ K` focus the field.

**Field.** `.gsearch__input` is a 38 px pill on `stage-2` with a `line-soft` border (a sibling of `.pill` and `.select`), 14 px text, `--haze-2` placeholder "Album, morceau, artiste…". On focus or open it switches to an `--ink` background, a cue border and `--ring-focus`. A `/` key cap (`.gsearch__kbd`) shows while closed; a clear button (`.gsearch__clear`) shows when there is text.

**Panel.** `.gsearch__panel` is the `.menu` family:
- 560 px wide (`min(560px, 100vw − 32px)`), anchored to the field's left edge, 10 px below;
- padding 8, radius 18, `--line` border, `--shadow-pop`, `pop .16s`;
- maximum height `min(70vh, 620px)`, scrolling.

Groups appear in this order, with empty groups hidden:

| Group | Max rows | Notes |
|---|---|---|
| **Albums** | 2–3 | |
| **Morceaux** | 3 | |
| **Artistes · Membres · Listes** | 1 each | merged when the query is specific |

Each group header is an `.eyebrow` with "Tout voir · N" (cue) on the right. Groups are separated by a `line-soft` rule.

Option rows (`.gsearch__opt`, `role="option"`) are a 52 px grid: 40 px thumbnail | text | meta, radius 10.
- Hover and `.is-active` (keyboard): `stage-2` background, paper text; active also gets an inset `--line` ring.
- Title: Archivo 700 15 px, ellipsis. Sub-line: 13 px `--haze` with the type first ("Album · Daft Punk · 2001", "Morceau · Daft Punk · Discovery").
- The typed part is wrapped in `<mark class="hl">`: no background, underlined in cue 2 px at offset 3, the same language as `.link-btn`.

Thumbnails follow the brief: "une petite icône (pochette) de l'album à côté du titre de l'album ou du morceau".

| Result type | Thumbnail | Right side |
|---|---|---|
| Album | 40 px cover (`CoverArt`, real `thumb` or generated art), radius 6 | progress `xs` (rarity blue) + mono `13/14`, or "Pas commencé" |
| Track | the **album cover** + the rarity gem in its bottom-right corner when owned | `chip--sm chip--ok` mono `×2`, or "Manquante" |
| Artist | round `.artist-badge` with initial | `chip--gold` "★ Maître" when mastered |
| Member | `.avatar` | `chip--cue` mono "87 %" (Taste Match) |
| List | `.stack-thumb` (3 overlapping covers) | heart + mono count |

**Footer.** "Voir les 128 résultats pour « daft » ›" (cue, links to `/search?q=`) and keyboard hints with `.kbd` keys: ↑ ↓ naviguer · ↵ ouvrir · Échap.

**Behaviour.**
- Search runs from 2 characters, debounced 150 ms, and the previous request is aborted.
- Results are cached per query for the session.
- Focus with an empty query shows "Recherches récentes" (max 5, same rows, with a clock icon) and "Effacer".
- Typo tolerance shows a line `.gsearch__fuzzy`: "Résultats pour **daft punk** · Rechercher plutôt « dafft pnuk »".

**Keyboard and ARIA (combobox 1.2 pattern).**

| Part | ARIA |
|---|---|
| Input | `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, `aria-activedescendant` |
| Panel | `role="listbox"` |
| Rows | `role="option"` + `aria-selected` |

| Key | Action |
|---|---|
| ↑ ↓ | move across all groups (wraps) |
| Enter | open the active row, or the full results page when no row is active |
| Escape | close; a second Escape clears |
| Tab | closes and moves on |

**Phone sheet (`.search-sheet`).**
- Full screen on `--ink`, `z-sheet 70`.
- Header: field 46 px with **16 px** text (no iOS zoom) plus a quiet "Annuler".
- A row of `chip--toggle` tabs with counts (Tout · Albums · Morceaux · Artistes · Membres · Listes), scrolling with a fade mask.
- Rows are 62 px with 48 px thumbnails.
- The phone Back button closes the sheet (history entry).

### 4.2 Notifications

- **Bell.** `.icon-btn.bell` in the top bar (desktop and phone) with a `.count-badge` (ink ring).
- **Panel.** `.menu.notif-panel` is 380 px, with a head "Notifications" (18 px) and a "Tout marquer comme lu" `link-btn`.
- **Rows** (`.notif`) are a grid: 36 px avatar | text (14 px, names bold paper) + time (12 haze) | 40 px thumbnail or a `btn--primary btn--xs` action ("Accepter").
  - Type icons sit on the avatar: `.notif__icon` 18 px, pink heart for likes, cue for replies, gold for friends and badges.
  - Unread rows: cue tint 6 % plus a 6 px cue dot.
- Notifications are grouped ("camille et 3 autres ont aimé ta critique de Discovery").
- Footer: "Voir toutes les notifications".
- On phones, the bell opens `/notifications` (same rows, full page).

### 4.3 Feed: post, mention card, actions

- **`.post`** has the `.review` look (stage, `line-soft`, radius 14, padding 16 / 10 bottom). Head: 40 px avatar, name (Archivo 700 15) + optional `chip--sm chip--cue` "Dans tes amis", meta (13 haze "@camille · il y a 2 h"), and a `⋯` icon button (report, block, delete). Text is 15 / 1.5 paper.
- **`.mention`** is the interactive card linking to the album, track or artist page. It is a grid: 72 px cover (radius 10, `--shadow-cover-sm`, `--ring-gold` when completed) | body | chevron.
  - Body: `.eyebrow` kicker "Album · Électro · 2001" (mirrors the album page), title (Archivo 750 16), artist (14 paper-dim), and a line with stars + mono average + "· 214 notes" or progress.
  - Background `stage-2` with a `line-soft` border; on hover the border turns `--line` and the background goes a touch lighter.
  - Variants: `--track` (56 px cover with the rarity gem; line = rarity chip + popularity), `--artist` (round cover).
- **Actions** use `.act-btn`: a 34 px quiet pill (40 on phones), haze, Figtree 600 13, icon + mono count; hover `stage-2`. "J'aime" `.act-btn--like.is-on` uses `--like` with the heart filled and a `like-pop` 0.35 s spring. Order: like · comment · (right) share.
- **Feed tabs:** `.seg` with `.seg__btn--wide` (Tes amis · Pour toi · Communauté) in the section head.
- **Layout:** `.home-cols` puts the feed beside a 340 px aside (Taste Match, suggestions, almost complete) and becomes one column at ≤ 1020.

### 4.4 Reviews with likes and replies; comment thread

The existing `.review` gains:
- `.review__head` (author + `⋯`);
- `.review__album` (36 px cover + Archivo title + "Air · 1998") when shown outside the album page;
- `.review__foot` (like · "3 réponses" · Répondre).

The thread (`.thread`) is indented 16 px with a 2 px `line-soft` rule, like a groove.
- `.comment`: 28 px avatar | name (Archivo 700 14) + time (12) + text (14 paper-dim) + 28 px actions (J'aime, Répondre). Replies are one level deep; deeper replies quote "@name".
- `.composer`: 28 px avatar + pill input (40 px) + `btn--primary btn--sm` "Envoyer", disabled (dimmed outline) while empty.
- Friends' reviews come first ("Vos amis", then "Communauté AlbumMania"), as the brief asks.

### 4.5 User card, Taste Match, list card

- **`.user-card`**: row card (avatar 44 | name Archivo 16 + 13 sub | `.match-figure`). The figure is "81 %" in Archivo 800 22 cue over "goûts communs" (12 haze). On friend rows the add, accept and remove buttons go on the right.
- **`.match-card`** (inside a `.panel`):
  - 44 px avatar pair overlapping with a stage ring;
  - the figure "87 %" in Archivo 800 `--fs-h1` at `--fst-hero` width, over "Compatibilité musicale avec camille";
  - `.match-bars` (label | progress `sm` cue | mono value) for the plain-language components;
  - `.cover-row` of shared albums + "+12 en commun";
  - ghost "Comparer en détail".
  The full page reuses these blocks at a larger size, plus a share card.
- **`.list-card`**: 3 fanned covers (`.list-card__stack`, 72 px, scaled 1 / .94 / .88, shifted 20 px), title Archivo 750 16, meta "par @melodie · 12 albums · ♥ 31" or "privée".

### 4.6 « Mes 9 albums » editor and share image (my9games style)

- **Editor `.nine__desk`.** Same `--grad-panel` as the Studio desk. Head: `h3` + `.label` "8/9 · touche une case pour la remplacer".
- **Grid `.nine__grid`.** 3 × 3 with a 10 px gap.
  - Slots `.nine__slot` are square, radius 10, `--shadow-cover-sm`, lift on hover, `cursor: grab`.
  - Each slot carries a mono number chip `.nine__num` in the `card__num` style, and a remove button `.nine__remove` copied from `.showcase__remove`.
  - Empty slot `--empty`: a dashed `.showcase__empty` look with "+ Ajouter". Tapping it opens the search (albums only).
  - Drag to swap; the drop target gets `.is-target` (cue outline). On the keyboard, "Déplacer à gauche / à droite" buttons appear on focus.
- **Tools.**
  - `.nine__tool` = `.label` + `.seg` for Format (4:5 · Carré · Story) and Thème (Encre · Papier).
  - "Générer l'image" is `btn--primary`, **disabled until 9/9** (dimmed outline) with the hint "Encore 1 album à choisir".
  - Then come "Télécharger" (primary) and "Partager" (ghost, Web Share API with the PNG file, falling back to download).
- **Share image `.nine-share`.** The preview updates live; the PNG is drawn with `<canvas>` at 1080 × 1350 / 1080 × 1080 / 1080 × 1920 from the same layout.
  - Ink theme: `--grad-hero` over ink with the hero's grooved disc in the corner.
  - Title "Mes 9 albums" in Archivo 800 at 112 % width with `--ls-display` tracking, and "@leo" in mono.
  - 3 × 3 covers.
  - **Footer: the `AlbumMania` logo** (disc + "Album" + gradient "Mania"), centred over a rule. There is no URL yet, as the brief asks.
  - Paper theme `--paper`: ivory background, ink title and wordmark, gradient "Mania" kept.
  - Covers come from `cover_thumb` URLs proxied same-origin for the canvas (no tainting), or the generated art.

### 4.7 Battle duel

- **`.duel`.** A panel with the hero's two glows (violet top-left, teal bottom-right). Head: `.eyebrow` "Battle · Électro", `h2` "Meilleur album de Daft Punk", and a `chip--quiet` "12 votes aujourd'hui".
- **Arena.** Grid `minmax(0, 300px) auto minmax(0, 300px)`, centred.
  - Each `.duel__side` is a button: `stage-2` at 80 %, radius 20, cover (radius 14, `--shadow-cover`), title (Archivo 750 18, 2 lines), meta "Daft Punk · 2001", and a ghost "Je préfère" pushed to the bottom.
  - On hover the side lifts 3 px and its button turns ivory, so the choice is the primary action.
  - After the vote, the chosen side gets `--ring-gold` and shows a "+18" delta; the next duel slides in with `deal`.
- **VS medallion `.duel__vs`.** A 64 px vinyl (`--grooves`) with an ivory label and "VS" in Archivo 900. It ties the battle to the booster and the card back.
- **Phone.** Two columns kept; the medallion (52 px) is absolutely centred on the covers using container units.
- **Footer.** Quiet "Je ne connais pas l'un des deux" + `.label` "+5 XP par vote · classement provisoire, 214 votes".

### 4.8 Quests

- **Status chips** (`.status-row` under the hero, max 3; on phones one scrolling line with a fade):
  - `.quest-chip` is a 36 px pill in the `.pill` look with a `.q-ring` (20 px conic progress ring, cue), label "Quête du jour" (haze) + task + mono "1/3".
  - `--done`: gold ring and gold border, "Découvre un artiste · 🪙 +50 à réclamer".
  - `--event`: a `--grad-booster` dot with a glow, "French Touch Week · encore 3 jours".
- **Quest rows** `.quest` (in a panel): 44 px ring with an icon | title (Figtree 700 15) + reward chips (`chip--sm` "+40 XP", `chip--sm chip--gold` 🪙 "+30") | mono "1/3", or "Réclamer" (`btn--primary btn--sm`) when done (`--done` = gold border). The rule is no streak punishment, no casino.

### 4.9 Badge medal

`.medal__disc` is a 68 px grooved disc in the `.achievement__disc` style, set through variables `--m1 --m2 --m3 --mr`:

| Variant | Look |
|---|---|
| gold (default) | gold grooves |
| `--silver` | silver grooves |
| `--bronze` | bronze grooves |
| `--holo` | conic holo foil with a white ring |
| `--locked` | dark grooves, `--line` ring, lock icon, mono progress "7/10" |

Under the disc: name (Archivo 700 13) and date (12 haze). The grid is `.medals` (auto-fill, 96 px minimum). A badge earned in the moment uses the existing `.achievement` toast/card.

### 4.10 Passport stat blocks

- `.stat-grid` has 4 columns (2 at ≤ 1020) of `.stat-block`: `stage-2`, radius 14, `dt` (13 haze sentence case), `dd` (Archivo 800 `--fs-h2`, 108 % width, tabular figures) + `small` (13 haze).
- `--wide` spans 2 columns and holds `.stat-bars` (label | progress `sm` coloured by rarity hue | mono value) or the rarity count row in rarity colours.
- Progress is measured against what the player started ("231 / 1 284 commencés"), never "0,1 % of 240 261".

### 4.11 Onboarding steps

- **Progress.** `.steps`: 5 segments of 4 px (done = paper, current = cue, todo = `stage-3`) + mono "2/5".
- **Step body.** `h2` + one `.muted` sentence.
- **Pickers by step:**

| Step | Picker |
|---|---|
| Genres | the existing `.genre-btn` grid (the blind test's) |
| Artists | `.pick-artists`: 72 px `.artist-badge`; selected = cue ring + 24 px cue check |
| 9 albums | the `.nine` editor |
| Quick ratings | album tiles with the star input |

- **Footer.** `.onboard__foot` sticky: quiet "Passer" + `btn--primary btn--lg` "Continuer".

### 4.12 Track page header

- **Desktop.** `.track-head` is a grid: cover (140–220 px, radius 14, `--shadow-cover-lg`) | info | the card itself (168 px `.card`, tilt). On phones the card is hidden and everything is centred.
- **Info:**
  - `.eyebrow` "Morceau · piste 1 · 2001";
  - title `h1` at `--fs-h1`;
  - `.track-head__artist` 18 px "Daft Punk · Discovery" (two links);
  - chips: `chip--rarity` "★ Légendaire", `chip--ok` "Possédée ×2", and the existing `.album-head__score` pill (stars + mono average + count);
  - actions: `btn--primary` "Noter", ghost "Écouter sur Deezer ↗", ghost "Publier".
- **Missing card.** A ghost card with "Presser · N 🪙".

### 4.13 Booster sheet

`.sheet` is a modal (480 px) on desktop and a bottom sheet on phones (radius 22 22 0 0, `.sheet__handle`, `rise`).
- `.sheet__hero`: `--grad-hero` over `stage-2`, the real `.pack` at 96 px, and "10 boosters disponibles" (Archivo 800 22) + "Prochain gratuit dans `28:46`" (mono cue timer).
- `btn--primary btn--lg btn--block` "Ouvrir un booster".
- `.sheet__rows`: "Acheter un booster" (🪙 120, ghost) and "Recycler 3 doublons" (+35, ghost), using the 36 px icon squares of `.home-how__icon`.
- The admin "Ouvrir ×10" lives here for the owner.
- Opened from the tab bar Boosters item and from the top-bar packs pill. The home hero stays the main entry and is unchanged.

### 4.14 Navigation: top bar and 5-item tab bar

**Desktop top bar (≥ 860).** Logo · nav **Accueil · Découvrir · Collection · Studio** · search field (≥ 1080) or search icon · `.pill--packs` (opens the booster sheet) · `.pill--royalties` · bell · avatar (account menu).
- FR/EN and the sound toggle leave the bar; they are already in the account menu ("Langue", "Effets sonores").
- Amis move to the Studio header and the account menu (count on the avatar's `.dot-badge`, as today).
- Blind test moves to Découvrir.

**Phone top bar (< 860).** Logo · search icon · bell · avatar.
- The packs pill stays between 641 and 860 px and is hidden at ≤ 640, where its count moves to the Boosters tab.
- Royalties show in the booster sheet and the account menu head. Today they are hidden at ≤ 640 anyway.

**Phone tab bar** (`.tabbar`, 5 columns, opaque ink, 64 px + safe area): **Accueil · Découvrir · Boosters · Collection · Studio**.

Decision for Boosters: **a normal tab, emphasised only by its icon.**
- **Same structure.** Same height and label as the others, no raised disc and no FAB. The current bar is flat and a raised ivory disc would read as a second primary button next to the hero CTA.
- **The icon is a miniature of the real booster** (`.mini-pack`, 19 × 26 px): `--grad-booster` body, `--grad-foil` crimps, a vinyl peeking out, tilted −8°. It is the only colourful item in the bar, which is enough emphasis in an ink-and-ivory UI.
- **Count.** An ivory mono chip (`.tabbar__count`, styled like `.card__count`) shows when boosters are ready.
- **Empty.** With no booster available, the mini pack is greyed with the filter of `.hero__pack:disabled`.
- **Tap.** Opens the booster sheet; the item is `.active` while the sheet is open.
- **Shared rules.** Active items get a paper label and the existing cue dot. The Studio icon carries `.dot-badge` for friend requests.

---

## 5. Implementation order (for P0)

1. Paste Block A (tokens) and Block B (fixes + chip) into `app.css`. Visual diff: no screen should change except the fixed items: `--haze-2` text, disabled buttons, min sizes, phone card grid, opaque tab bar and the quiet button.
2. Replace literal values with tokens file by file (`font-size` → `--fs-*`, `border-radius` → `--rad-*`, shadows, z-index), using the mapping tables in §1. Do one stylesheet per commit and compare screenshots, desktop 1440 and mobile 390.
3. Migrate the chip variants (§3.3), then delete the old selectors.
4. Add `components.css` (§4) and build the top bar search (P0), the tab bar, the bell, the track page header and the booster sheet.
5. Swap section sub-titles from mono eyebrows to `h3` / `.label` (§2, item 7).
6. P1: feed, reviews v2, Mes 9 albums, Taste Match, battles, quests, badges. P2: passport, onboarding polish.

---

## 6. Do and don't

**Do:**
- ivory pill for the main action;
- ghost for secondary actions;
- `.act-btn` for social actions;
- Archivo for titles and names;
- mono for numbers;
- `--cue` for links, focus and "new";
- gold for completion and royalties;
- rarity colour only on cards and rarity UI;
- generated cover art when there is no real cover;
- a deterministic avatar colour per member.

**Don't:**
- new fonts or serif;
- new accent colours;
- grey-filled disabled buttons;
- text under 12 px (10 px inside cards);
- uppercase mono for sentences or panel sub-titles;
- translucent tab bar;
- raised FAB in the tab bar;
- renaming royalties;
- changing the booster, hero, logo, cards, vinyl shelf or turntable.

---

## 7. Validation

The mock is `design/current-v2/index.html`. It links the **real** `client/src/styles/app.css`, `home.css`, `album.css`, `profile.css` and `collection.css` (absolute `file://` paths), then `tokens.css` (Blocks A + B) and `components.css`. The markup copies today's components (topbar, `.hero` + `.pack`, `.pill`, `.seg`, `.review`, `.card`, `.artist-badge`), and the covers use a faithful port of `CoverArt.jsx`. Google Fonts were routed through curl (as `scripts/e2e.mjs` does with `ROUTE_FONTS_VIA_CURL`), and every capture confirms Archivo, Figtree and Martian Mono loaded. Script: `design/current-v2/shoot.mjs`.

| Screenshot | Content |
|---|---|
| `current-v2/desktop.png` (1440, full page) | top bar with the search **open** on "daft", hero, quest chips, feed (album post, review + replies, track post), Taste Match + suggestions, battle, Mes 9 albums + share image, track header, notifications, booster sheet, quests, badges, passport, lists, onboarding, unified chips and buttons |
| `current-v2/desktop-fold.png` (1440 × 900) | the first screen with the open dropdown |
| `current-v2/desktop-closed.png` (1440 × 900) | the same with search closed: the hero is identical to the owner's reference |
| `current-v2/compare-reference.png` | owner reference (top) and new top bar + unchanged hero (bottom) |
| `current-v2/mobile.png` (390, full page, @2x) | phone top bar (search icon, bell), hero, chips, feed, battle, Mes 9, gallery, 5-item tab bar |
| `current-v2/mobile-fold.png` (390 × 844) | the phone first screen with the tab bar |
| `current-v2/mobile-search.png` (390 × 844) | the full-screen search sheet |

Capture note: Chromium does not paint the absolute dropdown inside the sticky bar in a "full page" capture. `stitch.py` pastes the 1440 × 900 capture (which shows it) over the top of `desktop.png`, and the pixels are identical apart from the panel.

What was checked against `owner-reference-current-ui.webp` and `shots-current/`:
- the top bar keeps its logo, pill links, cue-bordered booster pill, royalties pill and round avatar;
- the hero is pixel-equivalent;
- new surfaces use the same `stage` panels, `line-soft` borders, 14 / 22 radii, ivory pills, Archivo headings and mono counters;
- `--haze-2` meta and disabled buttons read correctly;
- the tab bar is opaque.

Three issues were found and fixed during the iterations:
- a token cascade bug: re-declaring `--tabbar` after the 860 px media query hid the tab bar, so Block A now carries the media query;
- the native grey on `.btn--quiet`;
- duel side misalignment on phones.

---

## Appendix: new components CSS (`design/current-v2/components.css`)

```css
/* =====================================================================================================
   AlbumMania · nouveaux composants, dessinés dans le style ACTUEL (panneaux encre, pilules ivoire, Archivo,
   Martian Mono pour les compteurs). Se charge après app.css et tokens.css.
   ===================================================================================================== */

/* ---------- barre du haut : recherche, cloche ---------- */

.topbar__search {
  position: relative;
  flex: 1 1 240px;
  min-width: 180px;
  max-width: 360px;
}

.gsearch__field {
  position: relative;
  display: flex;
  align-items: center;
}

.gsearch__icon {
  position: absolute;
  left: 13px;
  color: var(--haze);
  pointer-events: none;
}

.gsearch__input {
  width: 100%;
  height: 38px;
  padding: 0 40px 0 38px;
  border-radius: var(--rad-pill);
  border: 1px solid var(--line-soft);
  background: var(--stage-2);
  color: var(--paper);
  font: var(--fw-medium) var(--fs-14) / 1 var(--font-body);
  transition: border-color var(--dur-hover), background-color var(--dur-hover);
}

.gsearch__input::placeholder { color: var(--haze-2); }
.gsearch__input:hover { border-color: var(--line); }

.gsearch__input:focus,
.gsearch.is-open .gsearch__input {
  outline: none;
  border-color: var(--cue);
  background: var(--ink);
  box-shadow: var(--ring-focus);
}

.gsearch__input::-webkit-search-cancel-button { -webkit-appearance: none; display: none; }

.gsearch__kbd,
.kbd {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: var(--rad-xs);
  border: 1px solid var(--line);
  background: var(--stage);
  color: var(--haze);
  font: var(--fw-semi) var(--fs-12) / 1 var(--font-mono);
  font-stretch: var(--fst-mono);
}

.gsearch__kbd {
  position: absolute;
  right: 8px;
}

.gsearch.is-open .gsearch__kbd { display: none; }

.gsearch__clear[hidden] { display: none; }

.gsearch__clear {
  position: absolute;
  right: 3px;
  width: 32px;
  height: 32px;
}

/* liste déroulante : même famille que .menu (encre, bordure forte, ombre, rayon 18 = 10 + 8) */
.gsearch__panel {
  position: absolute;
  z-index: var(--z-dropdown);
  top: calc(100% + 10px);
  left: 0;
  width: min(560px, calc(100vw - 32px));
  max-height: min(70vh, 620px);
  overflow-y: auto;
  padding: 8px;
  border-radius: var(--rad-menu);
  background: var(--stage);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-pop);
  animation: pop 0.16s ease-out;
}

.gsearch__group + .gsearch__group {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--line-soft);
}

.gsearch__group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 6px;
}

.gsearch__more {
  color: var(--cue);
  font: var(--fw-semi) var(--fs-13) / 1 var(--font-body);
}

.gsearch__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.gsearch__opt {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 6px 10px 6px 6px;
  border-radius: var(--rad-sm);
  color: var(--paper-dim);
  cursor: pointer;
}

.gsearch__opt:hover,
.gsearch__opt.is-active {
  background: var(--stage-2);
  color: var(--paper);
}

.gsearch__opt.is-active { box-shadow: inset 0 0 0 1px var(--line); }

.gsearch__thumb {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: var(--rad-xs);
  overflow: hidden;
  box-shadow: var(--shadow-cover-sm);
  background: var(--stage-3);
}

.gsearch__thumb--round { border-radius: 50%; }

.gsearch__thumb .gem,
.mention__cover .gem {
  position: absolute;
  right: 2px;
  bottom: 2px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
}

.gsearch__text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.gsearch__title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font: var(--fw-bold) var(--fs-15) / var(--lh-snug) var(--font-display);
  color: var(--paper);
}

.gsearch__sub {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--fs-13);
  color: var(--haze);
}

/* la partie tapée : soulignée en turquoise, comme les liens (.link-btn) */
.hl {
  background: none;
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--cue);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

.gsearch__meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--haze);
  font-size: var(--fs-13);
}

.gsearch__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  margin-top: 6px;
  padding: 12px 10px 6px;
  border-top: 1px solid var(--line-soft);
}

.gsearch__all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--cue);
  font: var(--fw-semi) var(--fs-14) / 1.2 var(--font-body);
}

.gsearch__keys {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--haze-2);
  font-size: var(--fs-12);
}

.gsearch__keys .kbd {
  min-width: 20px;
  height: 20px;
  padding: 0 4px;
}

.gsearch__keys .kbd + span { margin-right: 6px; }

.gsearch__fuzzy {
  padding: 6px 10px 2px;
  color: var(--haze);
  font-size: var(--fs-13);
}

.gsearch__fuzzy b { color: var(--paper); }

/* pochettes empilées (listes) */
.stack-thumb {
  position: relative;
  width: 40px;
  height: 40px;
}

.stack-thumb > span {
  position: absolute;
  width: 30px;
  height: 30px;
  border-radius: 5px;
  overflow: hidden;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.stack-thumb > span:nth-child(1) { left: 0; top: 0; }
.stack-thumb > span:nth-child(2) { left: 5px; top: 5px; }
.stack-thumb > span:nth-child(3) { left: 10px; top: 10px; }

/* cloche */
.bell {
  position: relative;
}

.bell .count-badge {
  position: absolute;
  top: 0;
  right: -2px;
  box-shadow: 0 0 0 2px var(--ink);
}

.topbar .pill { flex: none; }

/* ---------- feuille de recherche plein écran (téléphone) ---------- */

.search-sheet {
  position: fixed;
  inset: 0;
  z-index: var(--z-sheet);
  display: flex;
  flex-direction: column;
  background: var(--ink);
  animation: fade-in var(--dur-fade) ease-out;
}

.search-sheet__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: calc(10px + env(safe-area-inset-top, 0px)) 16px 10px;
  border-bottom: 1px solid var(--line-soft);
}

.search-sheet__head .gsearch__field { flex: 1; }

.search-sheet__head .gsearch__input {
  height: 46px;
  font-size: var(--fs-16); /* 16 px : pas de zoom automatique sur iOS */
}

.search-sheet__tabs {
  display: flex;
  gap: 6px;
  padding: 12px 16px 4px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
}

.search-sheet__tabs .chip { flex: none; }

.search-sheet__body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 24px;
}

.search-sheet .gsearch__opt {
  grid-template-columns: 48px minmax(0, 1fr) auto;
  min-height: 62px;
}

.search-sheet .gsearch__thumb {
  width: 48px;
  height: 48px;
}

/* ---------- panneau de notifications ---------- */

.notif-panel {
  width: 380px;
  padding: 8px;
}

.notif-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 8px 10px;
}

.notif-panel__head h2 { font-size: var(--fs-18); }

.notif-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}

.notif {
  position: relative;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px 10px 10px 14px;
  border-radius: var(--rad-sm);
  color: var(--paper-dim);
  font-size: var(--fs-14);
  line-height: 1.35;
}

.notif:hover { background: var(--stage-2); }

.notif.is-unread {
  background: color-mix(in oklab, var(--cue) 6%, var(--stage));
  color: var(--paper);
}

.notif.is-unread::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 50%;
  width: 6px;
  height: 6px;
  margin-top: -3px;
  border-radius: 50%;
  background: var(--cue);
}

.notif b { color: var(--paper); font-weight: var(--fw-bold); }

.notif__time {
  display: block;
  margin-top: 2px;
  color: var(--haze);
  font-size: var(--fs-12);
}

.notif__thumb {
  width: 40px;
  height: 40px;
  border-radius: var(--rad-xs);
  overflow: hidden;
}

.notif__icon {
  position: absolute;
  left: 38px;
  top: 34px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--like);
  color: #fff;
  box-shadow: 0 0 0 2px var(--stage);
}

.notif__icon--cue { background: var(--cue); color: var(--ink); }
.notif__icon--gold { background: var(--gold); color: var(--ink); }

.notif-panel__foot {
  display: flex;
  justify-content: center;
  padding: 10px 0 4px;
  margin-top: 4px;
  border-top: 1px solid var(--line-soft);
}

/* ---------- avatars : une couleur par membre (AVATAR_COLORS), plus jamais trois ronds roses ---------- */
.avatar--ring { box-shadow: 0 0 0 2px var(--stage); }

/* ---------- fil : post, carte de mention, actions ---------- */

.feed-v2 {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.post {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 16px 10px;
  border-radius: var(--rad-md);
  background: var(--stage);
  border: 1px solid var(--line-soft);
  min-width: 0;
}

.post__head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.post__who {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.post__name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font: var(--fw-bold) var(--fs-15) / var(--lh-snug) var(--font-display);
}

.post__meta {
  color: var(--haze);
  font-size: var(--fs-13);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.post__text {
  color: var(--paper);
  font-size: var(--fs-15);
  line-height: var(--lh-body);
  overflow-wrap: anywhere;
}

.post__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  margin: 0 -8px;
}

.post__actions .act-btn:last-child { margin-left: auto; }

/* carte de mention : album / morceau / artiste, cliquable vers sa page */
.mention {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 10px 14px 10px 10px;
  border-radius: var(--rad-md);
  background: var(--stage-2);
  border: 1px solid var(--line-soft);
  color: var(--paper);
  transition: border-color var(--dur-hover), background-color var(--dur-hover);
}

.mention:hover {
  border-color: var(--line);
  background: color-mix(in oklab, var(--stage-2) 60%, var(--stage-3));
}

.mention__cover {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: var(--rad-sm);
  overflow: hidden;
  box-shadow: var(--shadow-cover-sm);
}

.mention__cover.is-gold { box-shadow: var(--ring-gold); }

.mention__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.mention__title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font: var(--fw-title) var(--fs-16) / var(--lh-snug) var(--font-display);
}

.mention__artist {
  color: var(--paper-dim);
  font-size: var(--fs-14);
  font-weight: var(--fw-semi);
}

.mention__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin-top: 2px;
  color: var(--haze);
  font-size: var(--fs-13);
}

.mention__line .progress { flex: 0 1 90px; }

.mention__go { color: var(--haze); }

.mention--track { grid-template-columns: 56px minmax(0, 1fr) auto; }
.mention--track .mention__cover { width: 56px; height: 56px; }
.mention--artist .mention__cover { border-radius: 50%; }

/* boutons d'action discrets (J'aime, Répondre, Partager) */
.act-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--rad-pill);
  background: transparent;
  color: var(--haze);
  font: var(--fw-semi) var(--fs-13) / 1 var(--font-body);
  cursor: pointer;
  transition: color var(--dur-hover), background-color var(--dur-hover);
}

.act-btn:hover {
  background: var(--stage-2);
  color: var(--paper);
}

.act-btn .mono { font-size: var(--fs-13); }

.act-btn--like.is-on { color: var(--like); }
.act-btn--like.is-on svg { fill: currentColor; animation: like-pop 0.35s var(--ease-spring); }

@keyframes like-pop {
  40% { transform: scale(1.3); }
}

/* ---------- critique : J'aime, réponses, fil ---------- */

.review__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.review__album {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: var(--haze);
  font-size: var(--fs-13);
}

.review__album strong {
  color: var(--paper);
  font: var(--fw-bold) var(--fs-14) / 1.2 var(--font-display);
}

.review__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  margin: 2px -8px -6px;
}

.thread {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 4px 0 2px 16px;
  padding: 2px 0 2px 16px;
  border-left: 2px solid var(--line-soft);
}

.comment {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
}

.comment__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
}

.comment__name { font: var(--fw-bold) var(--fs-14) / 1.2 var(--font-display); }
.comment__time { color: var(--haze); font-size: var(--fs-12); }

.comment__text {
  margin-top: 3px;
  color: var(--paper-dim);
  font-size: var(--fs-14);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.comment__actions {
  display: flex;
  gap: 2px;
  margin: 2px -10px 0;
}

.comment__actions .act-btn { height: 28px; font-size: var(--fs-12); }

.composer {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.composer .input {
  min-height: 40px;
  border-radius: var(--rad-pill);
  font-size: var(--fs-14);
}

/* ---------- « Mes 9 albums » : éditeur 3×3 et image à partager ---------- */

.nine {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.nine__desk {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px clamp(16px, 3vw, 24px) 22px;
  border-radius: var(--rad-lg);
  background: var(--grad-panel);
  border: 1px solid var(--line-soft);
}

.nine__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 16px;
}

.nine__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.nine__slot {
  position: relative;
  display: block;
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  border-radius: var(--rad-sm);
  overflow: visible;
  background: var(--stage-3);
  box-shadow: var(--shadow-cover-sm);
  cursor: grab;
  transition: transform var(--dur-fade) ease;
}

.nine__slot:hover { transform: translateY(-2px); }

.nine__slot .cover {
  border-radius: var(--rad-sm);
  overflow: hidden;
}

.nine__num {
  position: absolute;
  z-index: 2;
  left: 6px;
  top: 6px;
  padding: 1px 7px;
  border-radius: var(--rad-pill);
  background: rgba(10, 8, 14, 0.66);
  backdrop-filter: blur(2px);
  color: #fff;
  font: var(--fw-semi) var(--fs-12) / 1.4 var(--font-mono);
  font-stretch: 80%;
}

.nine__remove {
  position: absolute;
  z-index: 3;
  top: -8px;
  right: -8px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid var(--stage);
  background: var(--stage-3);
  color: var(--paper);
  cursor: pointer;
}

.nine__slot--empty {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 4px;
  border: 1.5px dashed var(--line);
  background: rgba(255, 255, 255, 0.015);
  box-shadow: none;
  color: var(--haze);
  font: var(--fw-semi) var(--fs-13) / 1.2 var(--font-body);
  cursor: pointer;
}

.nine__slot--empty:hover {
  transform: none;
  color: var(--paper);
  border-color: var(--haze-2);
}

.nine__slot.is-target {
  outline: 2px solid var(--cue);
  outline-offset: 3px;
}

.nine__tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}

.nine__tool {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* image générée (PNG via canvas) : aperçu à l'écran */
.nine-share {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5%;
  aspect-ratio: 4 / 5;
  padding: 8% 8% 6%;
  border-radius: var(--rad-md);
  overflow: hidden;
  background: var(--grad-hero), var(--ink);
  border: 1px solid var(--line-soft);
  box-shadow: var(--shadow-cover-lg);
  container-type: inline-size;
}

.nine-share::after {
  content: '';
  position: absolute;
  right: -18%;
  top: -14%;
  width: 52%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: repeating-radial-gradient(circle, transparent 0 7px, rgba(255, 255, 255, 0.025) 7px 8px);
  pointer-events: none;
}

.nine-share__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 4cqi;
}

.nine-share__title {
  font: var(--fw-display) 8.4cqi / 1 var(--font-display);
  font-stretch: var(--fst-display);
  letter-spacing: var(--ls-display);
  color: var(--paper);
}

.nine-share__who {
  color: var(--haze);
  font: var(--fw-semi) 3.6cqi / 1 var(--font-mono);
  font-stretch: var(--fst-mono);
}

.nine-share__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2.4cqi;
}

.nine-share__grid > span {
  aspect-ratio: 1;
  border-radius: 1.6cqi;
  overflow: hidden;
  box-shadow: 0 2cqi 4cqi -2cqi rgba(0, 0, 0, 0.8);
}

.nine-share__foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3cqi;
  padding-top: 4cqi;
  border-top: 1px solid var(--line-soft);
}

.nine-share__foot .logo { font-size: 5.6cqi; }

.nine-share--paper {
  background: radial-gradient(ellipse 60% 80% at 15% 0%, rgba(194, 107, 255, 0.16), transparent 70%), var(--paper);
  border-color: transparent;
}

.nine-share--paper .nine-share__title,
.nine-share--paper .logo { color: var(--ink); }
.nine-share--paper .nine-share__who { color: #5a5068; }
.nine-share--paper .nine-share__foot { border-top-color: rgba(15, 12, 21, 0.14); }

/* ---------- battle ---------- */

.duel {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: clamp(18px, 3vw, 28px);
  border-radius: var(--rad-lg);
  background:
    radial-gradient(ellipse 50% 90% at 0% 0%, var(--glow-violet), transparent 70%),
    radial-gradient(ellipse 50% 80% at 100% 100%, var(--glow-cue), transparent 70%),
    var(--stage);
  border: 1px solid var(--line-soft);
  overflow: hidden;
}

.duel__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px 16px;
}

.duel__head h2 { margin-top: 6px; }

.duel__arena {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 300px) auto minmax(0, 300px);
  justify-content: center;
  align-items: center;
  gap: clamp(10px, 2.4vw, 28px);
}

.duel__side {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 12px 14px;
  border-radius: calc(var(--rad-md) + 6px);
  border: 1px solid var(--line-soft);
  background: color-mix(in oklab, var(--stage-2) 80%, transparent);
  color: var(--paper);
  text-align: left;
  cursor: pointer;
  transition: transform var(--dur-fade) ease, border-color var(--dur-hover), background-color var(--dur-hover);
}

.duel__side:hover {
  transform: translateY(-3px);
  border-color: var(--line);
}

.duel__side:hover .btn--ghost {
  background: var(--paper);
  border-color: var(--paper);
  color: var(--ink);
}

.duel__cover {
  aspect-ratio: 1;
  border-radius: var(--rad-md);
  overflow: hidden;
  box-shadow: var(--shadow-cover);
}

.duel__title {
  font: var(--fw-title) var(--fs-18) / var(--lh-snug) var(--font-display);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.duel__side .btn { margin-top: auto; }

.duel__meta {
  margin-top: -6px;
  color: var(--haze);
  font-size: var(--fs-14);
}

/* « VS » : un petit vinyle à étiquette ivoire */
.duel__vs {
  position: relative;
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--paper) 0 27px, transparent 27.5px), var(--grooves);
  box-shadow: inset 0 0 0 1px var(--line), 0 10px 26px rgba(0, 0, 0, 0.55);
  color: var(--ink);
  font: var(--fw-black) var(--fs-16) / 1 var(--font-display);
  font-stretch: var(--fst-hero);
  letter-spacing: -0.04em;
}

.duel__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
}

/* ---------- quêtes ---------- */

.status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.q-ring {
  --p: 0;
  --qc: var(--cue);
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: conic-gradient(var(--qc) calc(var(--p) * 1%), var(--stage-3) 0);
  -webkit-mask: radial-gradient(circle, transparent 0 5.5px, #000 6px);
  mask: radial-gradient(circle, transparent 0 5.5px, #000 6px);
}

.q-ring--lg {
  width: 44px;
  height: 44px;
  -webkit-mask: radial-gradient(circle, transparent 0 17px, #000 17.5px);
  mask: radial-gradient(circle, transparent 0 17px, #000 17.5px);
}

.quest-chip {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  height: 36px;
  padding: 0 14px 0 9px;
  border-radius: var(--rad-pill);
  background: var(--stage-2);
  border: 1px solid var(--line-soft);
  color: var(--paper);
  font: var(--fw-semi) var(--fs-13) / 1 var(--font-body);
  white-space: nowrap;
  cursor: pointer;
  transition: border-color var(--dur-hover);
}

.quest-chip:hover { border-color: var(--line); }

.quest-chip__label { color: var(--haze); font-weight: var(--fw-medium); }
.quest-chip .mono { color: var(--haze); font-size: var(--fs-12); }

.quest-chip--done {
  border-color: color-mix(in oklab, var(--gold) 45%, var(--line-soft));
}

.quest-chip--done .q-ring { --qc: var(--gold); }

.quest-chip--event {
  border-color: color-mix(in oklab, #c26bff 40%, var(--line-soft));
}

.quest-chip__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--grad-booster);
  box-shadow: 0 0 10px rgba(194, 107, 255, 0.6);
}

.quests {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.quest {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: var(--rad-md);
  background: var(--stage-2);
  border: 1px solid var(--line-soft);
}

.quest--done { border-color: color-mix(in oklab, var(--gold) 45%, var(--line-soft)); }
.quest--done .q-ring { --qc: var(--gold); }

.quest__ring {
  position: relative;
  display: grid;
  place-items: center;
}

.quest__ring svg {
  position: absolute;
  color: var(--haze);
}

.quest--done .quest__ring svg { color: var(--gold); }

.quest__title { font: var(--fw-bold) var(--fs-15) / 1.25 var(--font-body); }

.quest__rewards {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

/* ---------- médaille de badge ---------- */

.medals {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 16px 12px;
}

.medal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}

.medal__disc {
  --m1: #e6c46c;
  --m2: #c9a043;
  --m3: #b8862a;
  --mr: #ffe9a8;
  position: relative;
  display: grid;
  place-items: center;
  width: 68px;
  height: 68px;
  border-radius: 50%;
  color: var(--ink);
  background: radial-gradient(circle, transparent 0 30%, var(--m3) 30.5% 34%, transparent 34.5%),
    repeating-radial-gradient(circle, var(--m1) 0 1px, var(--m2) 1px 2.6px);
  box-shadow: 0 0 0 3px var(--mr), 0 8px 24px color-mix(in oklab, var(--m1) 35%, transparent);
}

.medal--silver .medal__disc { --m1: #e4dfea; --m2: #b9afc6; --m3: #8d8799; --mr: #f4eee3; }
.medal--bronze .medal__disc { --m1: #e0a77a; --m2: #b9774a; --m3: #8a5230; --mr: #f2c9a6; }
.medal--holo .medal__disc {
  background: radial-gradient(circle, transparent 0 30%, rgba(15, 12, 21, 0.4) 30.5% 34%, transparent 34.5%),
    conic-gradient(from 20deg, #ff9db8, #ffe9a8, #8ff0e2, #d5b8ff, #ff9db8);
  box-shadow: 0 0 0 3px #fff, 0 8px 24px rgba(177, 125, 255, 0.4);
}

.medal--locked .medal__disc {
  --m1: #2f283b;
  --m2: #241e2e;
  --m3: #3a3149;
  color: var(--haze);
  box-shadow: 0 0 0 3px var(--line);
}

.medal--locked .medal__name { color: var(--paper-dim); }

.medal__name { font: var(--fw-bold) var(--fs-13) / 1.2 var(--font-display); }
.medal__date { color: var(--haze); font-size: var(--fs-12); }

/* ---------- passeport : blocs de statistiques ---------- */

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.stat-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: var(--rad-md);
  background: var(--stage-2);
  border: 1px solid var(--line-soft);
  min-width: 0;
}

.stat-block dt {
  color: var(--haze);
  font-size: var(--fs-13);
  font-weight: var(--fw-semi);
}

.stat-block dd {
  margin: 0;
  font: var(--fw-display) var(--fs-h2) / 1 var(--font-display);
  font-stretch: var(--fst-title);
  font-variant-numeric: tabular-nums;
}

.stat-block dd small {
  color: var(--haze);
  font: var(--fw-medium) var(--fs-13) / 1 var(--font-body);
  letter-spacing: 0;
}

.stat-block--wide { grid-column: span 2; }

.stat-bars {
  display: grid;
  gap: 6px;
  margin-top: 4px;
}

.stat-bars li {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr) 30px;
  align-items: center;
  gap: 8px;
  color: var(--paper-dim);
  font-size: var(--fs-13);
}

.stat-bars .mono {
  text-align: right;
  color: var(--haze);
  font-size: var(--fs-12);
}

/* ---------- cartes : membre, liste, Taste Match ---------- */

.user-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--rad-md);
  background: var(--stage);
  border: 1px solid var(--line-soft);
}

.user-card__name { font: var(--fw-bold) var(--fs-16) / 1.2 var(--font-display); }
.user-card__sub { color: var(--haze); font-size: var(--fs-13); }

.match-figure {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.match-figure b {
  font: var(--fw-display) var(--fs-22) / 1 var(--font-display);
  font-stretch: var(--fst-title);
  color: var(--cue);
}

.match-figure span { color: var(--haze); font-size: var(--fs-12); }

.list-card {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  padding: 14px 16px 14px 14px;
  border-radius: var(--rad-md);
  background: var(--stage);
  border: 1px solid var(--line-soft);
  transition: border-color var(--dur-hover);
}

.list-card:hover { border-color: var(--line); }

.list-card__stack {
  position: relative;
  height: 72px;
}

.list-card__stack > span {
  position: absolute;
  top: 0;
  width: 72px;
  height: 72px;
  border-radius: var(--rad-xs);
  overflow: hidden;
  box-shadow: 6px 0 14px -4px rgba(0, 0, 0, 0.8);
}

.list-card__stack > span:nth-child(1) { left: 0; z-index: 3; }
.list-card__stack > span:nth-child(2) { left: 20px; z-index: 2; transform: scale(0.94); }
.list-card__stack > span:nth-child(3) { left: 40px; z-index: 1; transform: scale(0.88); }

.list-card__title { display: block; font: var(--fw-title) var(--fs-16) / 1.2 var(--font-display); }
.list-card__meta { display: block; margin-top: 4px; color: var(--haze); font-size: var(--fs-13); }
.list-card + .list-card { margin-top: 0; }

.match-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.match-card__top {
  display: flex;
  align-items: center;
  gap: 16px;
}

.match-card__pair { display: flex; }
.match-card__pair .avatar + .avatar { margin-left: -12px; box-shadow: 0 0 0 3px var(--stage); }

.match-card__pct {
  font: var(--fw-display) var(--fs-h1) / 1 var(--font-display);
  font-stretch: var(--fst-hero);
  letter-spacing: var(--ls-display);
}

.match-bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.match-bars li {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr) 40px;
  align-items: center;
  gap: 10px;
  color: var(--paper-dim);
  font-size: var(--fs-13);
}

.match-bars .mono { text-align: right; color: var(--haze); font-size: var(--fs-12); }

.cover-row {
  display: flex;
  gap: 6px;
}

.cover-row > span {
  width: 40px;
  height: 40px;
  border-radius: var(--rad-xs);
  overflow: hidden;
  box-shadow: var(--shadow-cover-sm);
}

/* ---------- en-tête de page morceau ---------- */

.track-head {
  display: grid;
  grid-template-columns: clamp(140px, 20vw, 220px) minmax(0, 1fr) auto;
  align-items: end;
  gap: clamp(18px, 3vw, 36px);
}

.track-head__cover {
  aspect-ratio: 1;
  border-radius: var(--rad-md);
  overflow: hidden;
  box-shadow: var(--shadow-cover-lg);
}

.track-head__info {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.track-head__info h1 { font-size: var(--fs-h1); }

.track-head__artist {
  color: var(--paper-dim);
  font-size: var(--fs-18);
  font-weight: var(--fw-ui);
}

.track-head__artist a:hover { color: var(--paper); text-decoration: underline; text-underline-offset: 4px; }

.track-head__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.track-head__card {
  width: 168px;
  display: flex;
}

/* ---------- feuille Boosters (modale sur ordinateur, feuille du bas sur téléphone) ---------- */

.sheet {
  width: 100%;
  max-width: 480px;
  padding: 10px 22px 22px;
  border-radius: var(--rad-lg);
  background: var(--stage);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-modal);
}

.sheet__handle {
  width: 40px;
  height: 4px;
  margin: 0 auto 12px;
  border-radius: 4px;
  background: var(--line);
}

.sheet__hero {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 18px;
  padding: 16px;
  margin-bottom: 14px;
  border-radius: var(--rad-md);
  background: var(--grad-hero), var(--stage-2);
}

.sheet__hero .pack { --pw: 96px; }

.sheet__title {
  font: var(--fw-display) var(--fs-22) / 1.05 var(--font-display);
  font-stretch: var(--fst-display);
  letter-spacing: var(--ls-display);
}

.sheet__rows {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.sheet__row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--rad-md);
  background: var(--stage-2);
}

.sheet__icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: rgba(255, 211, 90, 0.14);
  color: var(--gold);
}

.sheet__icon--cue { background: rgba(63, 214, 196, 0.14); color: var(--cue); }

/* ---------- onboarding ---------- */

.steps {
  display: flex;
  align-items: center;
  gap: 12px;
}

.steps__bar {
  display: flex;
  flex: 1;
  gap: 6px;
}

.steps__bar i {
  flex: 1;
  height: 4px;
  border-radius: 4px;
  background: var(--stage-3);
}

.steps__bar i.is-done { background: var(--paper); }
.steps__bar i.is-current { background: var(--cue); }

.pick-artists {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 14px 10px;
}

.pick-artist {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--paper-dim);
  font: var(--fw-semi) var(--fs-13) / 1.2 var(--font-body);
  text-align: center;
  cursor: pointer;
}

.pick-artist .artist-badge {
  width: 72px;
  height: 72px;
  box-shadow: 0 0 0 3px var(--stage-3);
  transition: box-shadow var(--dur-hover);
}

.pick-artist.is-on { color: var(--paper); }
.pick-artist.is-on .artist-badge { box-shadow: 0 0 0 3px var(--cue); }

.pick-artist__check {
  position: absolute;
  right: -2px;
  bottom: -2px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--cue);
  color: var(--ink);
  box-shadow: 0 0 0 3px var(--stage);
}

.onboard__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--line-soft);
}

/* ---------- barre d'onglets mobile : 5 entrées, Boosters légèrement mis en avant ---------- */

.tabbar__link { position: relative; }
.tabbar__icon { height: 26px; }

.mini-pack {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 19px;
  height: 26px;
  transform: rotate(-8deg);
  filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.55));
  transition: transform var(--dur-fade) ease;
}

.mini-pack::before,
.mini-pack::after {
  content: '';
  flex: none;
  height: 3px;
  border-radius: 1px;
  background: var(--grad-foil);
}

.mini-pack__body {
  position: relative;
  flex: 1;
  overflow: hidden;
  background: var(--grad-booster);
}

.mini-pack__body::after {
  content: '';
  position: absolute;
  right: -55%;
  bottom: -35%;
  width: 110%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle, var(--paper) 0 8%, #ff4f7e 9% 18%, transparent 19%), #1b1623;
}

.tabbar__link--boosters.active .mini-pack,
.tabbar__link--boosters:hover .mini-pack { transform: rotate(-8deg) translateY(-2px); }

.tabbar__link--boosters.is-empty .mini-pack { filter: grayscale(0.7) brightness(0.7); }

.tabbar__count {
  position: absolute;
  top: -7px;
  left: 13px;
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: var(--rad-pill);
  background: var(--paper);
  color: var(--ink);
  font: var(--fw-bold) var(--fs-12) / 1 var(--font-mono);
  font-stretch: 80%;
  box-shadow: 0 0 0 2px var(--ink);
}

.tabbar__link.active .tabbar__icon::after { bottom: -6px; }

/* ---------- responsive des nouveaux composants ---------- */

.only-mobile { display: none; }

@media (max-width: 1079px) {
  .topbar__search { display: none; }
  .topbar .search-trigger { display: inline-grid; }
}

@media (min-width: 1080px) {
  .topbar .search-trigger { display: none; }
}

@media (max-width: 1020px) {
  .nine { grid-template-columns: 1fr; }
  .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 860px) {
  .only-mobile { display: initial; }
  .topbar .pill--royalties,
  .topbar .seg { display: none; }
  .track-head { grid-template-columns: 1fr; justify-items: center; text-align: center; }
  .track-head__info { align-items: center; }
  .track-head__chips,
  .track-head .hero__actions { justify-content: center; }
  .track-head__cover { width: min(240px, 64vw); }
  .track-head__card { display: none; }
}

@media (max-width: 640px) {
  .status-row {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    margin-right: calc(-1 * var(--gutter));
    padding-right: 28px;
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
  }
  .status-row > * { flex: none; }
  .topbar .pill--packs { display: none; } /* le compte de boosters passe sur l'onglet Boosters */
  .post { padding: 14px 14px 8px; }
  .act-btn { height: 40px; } /* cible tactile */
  .mention { grid-template-columns: 60px minmax(0, 1fr) auto; gap: 12px; }
  .mention__cover { width: 60px; height: 60px; }
  .duel__arena { gap: 8px; }
  .duel__side { padding: 8px 8px 10px; gap: 8px; }
  .duel__title { font-size: var(--fs-15); }
  .duel__meta { font-size: var(--fs-13); }
  .duel__side .btn { --bh: 40px; padding: 0 10px; font-size: var(--fs-13); }
  .duel__vs {
    position: absolute;
    left: 50%;
    top: calc(8px + (50cqi - 4px - 16px) / 2 - 26px); /* centre des pochettes */
    z-index: 2;
    width: 52px;
    height: 52px;
    margin-left: -26px;
    background: radial-gradient(circle, var(--paper) 0 21px, transparent 21.5px), var(--grooves);
    font-size: var(--fs-14);
  }
  .duel__arena { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); container-type: inline-size; }
  .thread { margin-left: 6px; padding-left: 12px; }
  .match-bars li { grid-template-columns: 96px minmax(0, 1fr) 36px; }
  .list-card { grid-template-columns: 96px minmax(0, 1fr); }
  .notif-panel { width: auto; }
}

/* ---------- accueil : fil + colonne ---------- */

.home-cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 16px;
  align-items: start;
}

.home-aside {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

@media (max-width: 1020px) {
  .home-cols { grid-template-columns: 1fr; }
}

.nine-share__grid > .nine-share__empty {
  border: 1px dashed color-mix(in oklab, var(--paper) 22%, transparent);
  box-shadow: none;
  background: rgba(255, 255, 255, 0.02);
}
```
