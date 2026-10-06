# DÉCISION DU PROPRIÉTAIRE (prioritaire sur tout le reste) — 2026-10-06

Le propriétaire a vu les maquettes des trois directions (A « Disquaire éditorial », B « Affiche », C « Vitrine ») et les REFUSE :
« ne vise pas cette UI, celle que t'avais au départ est largement meilleure, reviens à cette UI ».
Référence visuelle fournie : `design/owner-reference-current-ui.webp` (la page Boosters actuelle).

## Règle
**On garde l'identité visuelle ACTUELLE d'AlbumMania, telle qu'elle est dans `client/src/styles/app.css` aujourd'hui.**
`design/design-system.md` (Disquaire : Gloock / Newsreader / Schibsted Grotesk, obi, papier) est ANNULÉ. Ne jamais l'appliquer.

À conserver à l'identique :
- Polices : **Archivo** (titres, poids 800–900, largeur étendue), **Figtree** (texte), **Martian Mono** (étiquettes, compteurs, codes AM-xxx). Pas de nouvelle famille de polices, pas de serif.
- Palette : encre prune (`--ink` #0f0c15, `--stage`, `--stage-2`, `--stage-3`, `--line`), papier ivoire (`--paper`), `--haze`, accent turquoise `--cue`, `--gold`, couleurs de rareté actuelles.
- Logo : disque coloré + « Album » blanc + « Mania » en dégradé orange→rouge.
- Booster : visuel du paquet actuel (dégradé rose→violet→bleu, vinyle, bandes argentées, « SÉRIE 01 »), héros « N boosters disponibles », gros bouton pilule ivoire « Ouvrir un booster ».
- Boutons pilules ivoires (primaire), boutons fantômes, pastilles de compteurs dans la barre du haut (boosters, royalties), panneaux arrondis (rayons 14/22 px) avec léger dégradé, cartes de collection actuelles (cadres par rareté, holo, ruban PROMO, dos vinyle), animation d'ouverture de booster, étagère de vinyles, platine.
- Monnaie : le nom reste **royalties** (pas de renommage en « Sillons »).

## Ce qui reste autorisé (dans cette identité)
- Cohérence : transformer en jetons (variables CSS) les valeurs déjà utilisées (échelle de tailles, espacements, rayons, ombres, durées) sans changer le rendu général.
- Lisibilité : aucun texte d'interface sous 12 px ; micro-étiquettes des cartes ≥ 10 px (masquer progressivement des éléments sur les très petites cartes plutôt que de les rapetisser) ; grille de cartes à 2 colonnes sur téléphone.
- Contraste : remonter `--haze-2` (≈ #948ca6) pour passer AA ; boutons désactivés en contour atténué plutôt qu'en gris plein.
- Moins de majuscules en monospace décoratives là où elles gênent la lecture, mais le style (Martian Mono pour étiquettes/compteurs) reste.
- Nouvelles pages et nouveaux composants (recherche avec autocomplétion, page morceau, fil social, notifications, listes, « Mes 9 albums », Taste Match, battles, quêtes, badges, passeport, onboarding…) : ils doivent avoir l'air d'avoir toujours fait partie de l'UI actuelle — réutiliser `.panel`, `.btn`, `.pill`, `.chip`, `.album-tile`, `.card`, `.eyebrow`, les titres Archivo, etc.
- Navigation : ajouter la recherche globale dans la barre du haut (et une icône sur mobile), une cloche de notifications, mettre Mon Studio dans la barre du bas sur mobile — avec le style actuel des onglets et pastilles.
- L'accueil peut devenir plus social (fil, quête du jour, presque complets…) mais le héros Boosters actuel (paquet + « N boosters disponibles » + bouton) reste en tête, à l'identique.

## Précision du propriétaire (2026-10-06, après la décision)
« Oui, même le booster garde comme il l'est sur le screenshot (littéralement ce que t'as fait au début). »
→ La page/le bloc Boosters reste **littéralement** comme sur `owner-reference-current-ui.webp` : paquet coloré à gauche, étiquette
« ALBUMMANIA PACK · 5 MORCEAUX », gros titre « N boosters disponibles », texte d'état du stock, lien « Comment marchent les raretés ? »,
gros bouton pilule ivoire « Ouvrir un booster » (+ « Ouvrir ×10 » admin), puis la rangée Boutique / Doublons / Blind test.
Ne pas le déplacer dans une « feuille booster », ne pas le réduire en carte, ne pas changer son visuel ni sa mise en page.
Les nouveaux blocs sociaux (fil, quêtes, presque complets…) viennent EN DESSOUS de ce héros et de cette rangée, sur la page d'accueil.
L'animation d'ouverture (PackOpening) reste identique.

## Décisions de l'orchestrateur (2026-10-06, appliquent la consigne « littéralement » — prioritaires sur PLAN.md et design-system-current.md)
1. **Pas de « booster sheet ».** Aucun panneau/feuille booster, même en raccourci (veto Q13 appliqué). Le bouton/onglet Boosters et
   la pastille des boosters mènent à `/`, où le héros Boosters est en tête, inchangé. `BoosterSheet.jsx` n'est pas créé.
2. **Navigation** (style actuel des onglets et pastilles) :
   - Barre du bas sur téléphone, 5 onglets : **Boosters** (`/`, icône actuelle) · **Découvrir** · **Collection** · **Amis** · **Studio**.
     (Pas d'onglet « Accueil » séparé : l'accueil EST la page Boosters, avec les blocs sociaux sous le héros et la rangée.)
   - Barre du haut sur ordinateur : logo · **Boosters · Découvrir · Collection · Amis · Studio** · recherche globale · pastilles
     boosters et royalties (inchangées) · FR/EN et son (gardés dans la barre sur grand écran ≥ 1280 px comme aujourd'hui ; dans le
     menu du compte en dessous) · cloche · avatar.
   - Le Blind test est dans Découvrir et reste dans la rangée Boutique / Doublons / Blind test de l'accueil.
3. **Catalogue** : `CATALOG_IMPORT` reste `deezer` par défaut (le propriétaire veut ~20 000 albums). Le risque juridique reste
   documenté (DEPLOIEMENT.md) ; ne pas changer la valeur par défaut.
4. **Monnaie** : « royalties » partout (aucun « Sillons »).
