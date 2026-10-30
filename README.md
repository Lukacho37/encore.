# AlbumMania

Le jeu de collection de morceaux de musique : ouvre des boosters, collectionne les morceaux, complète les albums pour presser leur vinyle, note tes disques préférés et deviens maître d'une discographie.

- **Morceau → Album → Artiste** : chaque carte est un morceau ; réunir toutes les pistes d'un album te donne son **vinyle** ; compléter tous les albums et promos d'un artiste fait de toi son « Maître ».
- **Raretés selon la popularité** : chaque morceau a un indice de popularité de 0 à 100, et sa rareté en découle : ⚪ commune, 🟢 peu commune, 🔵 rare, 🟣 super rare, 🟠 ultra rare, ⭐ légendaire. Un guide des raretés est disponible dans le jeu.
- **Notes et critiques**, façon Letterboxd : note les albums et les morceaux sur 5 étoiles (demi-étoiles) ou sur 10, au choix, et écris tes critiques.
- **Cartes Promo** : les morceaux sortis hors album (singles, bandes originales, collaborations) forment une rareté à part, comme les cartes promo Pokémon.
- **20 000 albums, environ 250 000 cartes** : 20 albums choisis à la main (dont *The College Dropout* de Kanye West), complétés automatiquement par le serveur avec les albums studio des artistes les plus écoutés sur Deezer, dans tous les genres.

## Fonctionnalités

| | |
|---|---|
| Navigation | Barre du haut : **Boosters · Découvrir · Collection · Amis · Studio**, recherche globale, pastilles des boosters et des royalties, FR/EN et son (à partir de 1280 px de large ; dans le menu du compte en dessous), cloche des notifications, menu du compte. Sur téléphone : barre d'onglets Boosters · Découvrir · Collection · Amis · Studio (le nombre de boosters prêts s'affiche sur l'onglet Boosters) |
| Comptes | Inscription par e-mail + nom d'utilisateur unique + mot de passe, case **« J'accepte les CGU et j'ai 15 ans ou plus »**, **vérification de l'adresse e-mail**, connexion par e-mail ou pseudo (freinée après 5 échecs en 15 minutes sur un même identifiant), mot de passe oublié ; une page demandée sans être connecté se rouvre après la connexion |
| Paramètres | Langue, échelle de notation, effets sonores, plateforme d'écoute préférée, lecteurs intégrés, membres bloqués, export des données, suppression du compte, liens légaux |
| Pages légales | Mentions légales, CGU, confidentialité, règles de la communauté, cookies (`/legal/…`), lisibles sans compte, en français et en anglais ; bandeau d'acceptation quand les CGU changent |
| Boosters | 1 booster gratuit toutes les 30 min (stock max 5), 5 cartes par booster, 7 raretés, variantes **holo** ; une partie de chaque booster vise les albums que tu as commencés ; **booster d'album** (5 cartes d'un album choisi, 300 royalties) ; chaque nouvelle carte rapporte des royalties, la monnaie du jeu (2 à 75 selon sa rareté) |
| Catalogue | Import automatique depuis l'API Deezer (albums studio, sans live ni compilation), recherche plein texte, filtres par genre et décennie, rareté calibrée sur la popularité réelle de chaque morceau |
| Raretés | Indice de popularité 0-100 affiché sur chaque carte, rareté calculée automatiquement, guide des raretés avec les chances par booster |
| Ouverture | Booster à déchirer, cartes retournées une à une, halo d'anticipation selon la rareté, rayons + confettis pour les grosses cartes, **effets sonores** synthétisés (aucun fichier audio) |
| Collection | Recherche dans les 20 000 albums, mes cartes, artistes commencés, promos, progression par genre / décennie, recyclage des doublons en royalties ; aucune carte ne s'achète à l'unité |
| Enchères et échanges | **Enchères** : mise en vente d'une carte (prix de départ, durée), offres en royalties ; **échanges** carte contre carte de même rareté, entre amis seulement |
| Studio | Onglet **Studio** (ou menu de la photo de profil). **Vinylthèque** en tête du profil (un vinyle par album complété, édition holo si toutes ses cartes sont holo, platine tourne-disque au clic), **sélection** de 6 cartes, notes et critiques |
| Notes & critiques | Albums et morceaux, ★ sur 5 ou /10 selon ta préférence, moyenne et répartition des notes, critiques (celles de tes amis d'abord), tracklist notée, activité de tes amis sur l'accueil |
| Photo de profil | Initiale + couleur, ou **pochette d'un album que tu as complété** |
| Amis | Ajout par nom d'utilisateur, demandes reçues / envoyées, visite du Studio de ses amis |
| Découvrir | Albums populaires, genres, décennies, blind test, recherche |
| Blind test | Choix du genre (rap, pop, rock, électro…), 5 manches chronométrées, jusqu'à **3 boosters** gagnés (3 parties récompensées par jour) |
| Langues | Français et anglais (sélecteur en haut à droite sur grand écran, menu du compte ou Paramètres) |
| Admin | **Réservé à l'adresse de `ADMIN_EMAILS`**. Boosters illimités, blind test récompensé sans limite avec la réponse affichée, pressage gratuit (promos comprises), toutes les pochettes en photo de profil, modération des critiques, outils de test, liste des joueurs |

## Démarrer en local

Prérequis : **Node.js 22.13 ou plus récent** (la base SQLite est intégrée à Node, rien d'autre à installer).

```bash
npm install
npm run dev
```

Ouvre <http://localhost:5173>.

- Sans serveur SMTP configuré, les e-mails de vérification arrivent dans la **boîte de test** : <http://localhost:5173/dev/mailbox>.
- Pour être admin en local, crée un fichier `.env` avec `ADMIN_EMAILS=ton@adresse.fr` puis inscris-toi avec cette adresse.

## Version démo (sans serveur)

```bash
npm run build:demo
```

Produit `dist-demo/albummania-demo.html` : tout le jeu dans un seul fichier, avec un faux serveur qui tourne dans le navigateur (données dans le `localStorage`, e-mail de confirmation affiché à l'écran, joueurs fictifs avec leurs notes pour tester les amis et les critiques). Dans la démo, l'accès admin se déverrouille avec un code secret (menu de la photo de profil).

Vraies pochettes dans la démo : une page hébergée sur claude.ai ne peut charger aucune image venue d'un autre site. Il faut donc intégrer des copies réduites des pochettes à la page, ce que le site en ligne ne fait jamais (il les affiche directement depuis Deezer) :

```bash
node scripts/demo-covers.mjs                               # cherche les 34 pochettes chez Deezer → data/demo-covers.json
DEMO_COVERS=data/demo-covers.json npm run build:demo      # démo avec ces pochettes (environ 5 Mo)
```

Le fichier reste hors du dépôt (`data/` n'est pas versionné) : les pochettes appartiennent à leurs ayants droit. Derrière un proxy, lance le script avec `NODE_USE_ENV_PROXY=1`. Sans `DEMO_COVERS`, la démo garde ses visuels générés.

## Grand catalogue (20 000 albums Deezer)

Le serveur l'importe tout seul en tâche de fond (`CATALOG_IMPORT=deezer`). Pour remplir une base sans lancer le site :

```bash
DATABASE_FILE=data/albummania.db node scripts/import-catalog.mjs --target 20000 --rps 8
```

Même code que l'import du serveur (`server/importer.js`) : genres et classements Deezer, artistes francophones (Wikidata), albums studio dédoublonnés, pistes avec durée, pochettes en adresse seulement. Options : `--francophone` met les artistes francophones en tête de file (catalogue déjà importé sans eux), `--recalibrate` recalcule toutes les raretés d'un catalogue déjà gelé (avant l'ouverture aux joueurs).

Raretés par prestige mondial (`shared/prestige.js`, signaux collectés par `server/prestige.js` après chaque import) : un album culte écouté dans le monde entier est bien plus dur à compléter qu'un album connu surtout dans un pays. Le score d'un album combine le nombre de langues dans lesquelles Wikipédia lui consacre un article (Wikidata), ses auditeurs dans le monde (ListenBrainz) et, avec un poids faible, ses fans Deezer ; celui d'un morceau ajoute sa place dans son album (ses tubes sont les plus rares). Les raretés suivent les percentiles de ce score. `PRESTIGE=off` coupe la collecte. Les 20 albums de base suivent la même logique : `DATABASE_FILE=… node scripts/seed-prestige.mjs --write` redistribue leurs indices dans `shared/catalog.js`. Relancé après une coupure, il reprend où il en était. Compter environ 4 à 5 heures. Derrière un proxy, ajoute `NODE_USE_ENV_PROXY=1`.

## Mettre en ligne

Le guide pas à pas est dans **[DEPLOIEMENT.md](DEPLOIEMENT.md)** (Render + Brevo, environ une heure). En résumé :

```bash
npm install
npm run build      # compile le site dans dist/
npm start          # sert le site et l'API sur le port $PORT
```

| Variable | Rôle |
|---|---|
| `APP_URL` | Adresse publique du site, utilisée dans les liens des e-mails |
| `ADMIN_EMAILS` | **Ton adresse** : le seul compte admin |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Envoi des e-mails (Brevo, Resend, Mailgun, OVH…) |
| `DATABASE_FILE` | Fichier SQLite, à placer sur un **disque persistant** |
| `TRUST_PROXY=true` | Derrière un reverse proxy (Render, Railway, Nginx…) |
| `CATALOG_IMPORT`, `CATALOG_TARGET` | Import automatique du catalogue depuis Deezer (`deezer` par défaut ; `off`, ou toute autre valeur, pour s'en tenir aux 20 albums de base) et nombre d'albums visé (20000) |
| `LEGAL_EDITOR_NAME`, `LEGAL_EDITOR_ADDRESS`, `LEGAL_EDITOR_EMAIL`, `LEGAL_PUBLICATION_DIRECTOR`, `LEGAL_HOST_NAME`, `LEGAL_HOST_ADDRESS`, `LEGAL_HOST_PHONE`, `LEGAL_CONTACT_EMAIL` | Coordonnées affichées dans les **mentions légales** (`/legal/mentions`, obligatoires en France) |
| `TERMS_VERSION`, `TERMS_UPDATED_AT` | Version (date) des CGU en vigueur ; la changer affiche le bandeau d'acceptation aux comptes existants |
| `COVERS` | Vraies pochettes : `auto` (par défaut, Deezer) ou `deezer`, `off` pour revenir aux visuels générés |
| `SHARE_COVERS` | Vraies pochettes dans les images partagées (par défaut, composées dans le navigateur) ; `off` : visuels générés |
| `DEV_MAILBOX=1` | Boîte e-mail de test (`/dev/mailbox`), seulement avec une adresse `APP_URL` locale (le serveur refuse de démarrer sinon) |

Fichiers fournis : `render.yaml` (blueprint Render) et `Dockerfile` (Railway, Fly.io, VPS).

## Régler le jeu

- **Catalogue importé** : `server/importer.js` (genres suivis, filtres sur les titres, nombre d'albums par artiste, paliers de rareté `RANK_TIERS` en percentiles de popularité Deezer, vérification quotidienne des nouvelles sorties). Variables `CATALOG_TARGET`, `CATALOG_MIN_ARTIST_FANS`, `CATALOG_MIN_ALBUM_FANS`, `CATALOG_MAX_ALBUMS_PER_ARTIST`. L'import reprend après un redémarrage ; si Deezer tombe en panne ou bloque le serveur, il s'arrête sans rien perdre et réessaie 10 minutes plus tard ; une pause demandée dans l'espace admin tient jusqu'au bouton « Lancer ».
- **Albums de base** : `shared/catalog.js` (insérés en base à chaque démarrage). Ajouter un album = ajouter un objet avec sa tracklist et l'indice de popularité (0-100) de chaque piste :

  ```js
  {
    id: 'late-registration', artist: 'kanye-west', title: 'Late Registration', year: 2005, genre: 'rap',
    art: { palette: ['#2a1a10', '#c9a46a', '#f2e6d0'], motif: 'curtain' },
    tracks: [
      ['Wake Up Mr. West', 6],
      ['Heard \'Em Say', 74, 'Adam Levine'],
      ['Touch the Sky', 84, 'Lupe Fiasco'],
      ['Gold Digger', 95, 'Jamie Foxx'],
      // …
    ],
  },
  ```

  Les albums de base gardent les numéros de catalogue 1 à 1000 (AM-001, AM-002…) ; les albums importés sont numérotés à partir de AM-1001, un nouvel album de base ne heurte donc jamais un album importé.

  La rareté se calcule toute seule : commune ≤ 34 · peu commune 35-54 · rare 55-69 · super rare 70-81 · ultra rare 82-91 · légendaire ≥ 92 (seuils dans `POP_TIERS`). Les singles hors album vont dans `PROMOS`. Motifs de pochette disponibles : `bars`, `rings`, `sun`, `grid`, `shards`, `split`, `curtain`, `halftone`, `spotlight`, `waves`, `dots`, `stripes`, `orbit`, `arcs`, `burst`, `diamond`, `checker`.
- **Équilibrage** : `shared/rules.js` (probabilités par emplacement, chance de holo, valeur des doublons, prix du booster, récompenses d'album et du blind test).
- **Rythme des boosters gratuits** : variables `PACK_REGEN_MINUTES` et `PACK_MAX_STOCK`.

## Droits d'auteur : ce que fait le jeu

- **Pochettes** : le serveur récupère les vraies pochettes et les liens d'écoute auprès de Deezer (sans clé). Seules les adresses sont gardées en base : les images restent hébergées par la plateforme, affichées sans modification, avec la source et un lien direct vers l'album ou le morceau. Une carte non obtenue garde le visuel généré. Le service des pochettes (`server/covers.js`) sait aussi utiliser Spotify si ses clés sont configurées (choix du propriétaire), mais cette version du serveur ignore `SPOTIFY_CLIENT_ID` et `SPOTIFY_CLIENT_SECRET` : les conditions de Spotify interdisent les jeux (« Do not create a game, including trivia quizzes »). Celles de Deezer limitent l'API à un usage privé ; `COVERS=off` coupe tout en cas de demande de retrait.
- **Critiques** : les textes sont écrits par les joueurs ; l'admin peut supprimer une critique depuis l'espace admin.
- **Catalogue** : les 20 000 albums viennent de l'API publique de Deezer (titres, artistes, années, ordre des pistes, popularité, adresses des pochettes et des pages Deezer). Chaque album et chaque morceau renvoie vers Deezer pour l'écoute, et la source est créditée en bas de page. Les conditions de Deezer réservent l'API aux usages non commerciaux et n'autorisent pas à recopier le catalogue : c'est un risque assumé, `CATALOG_IMPORT=off` arrête tout appel.
- **Métadonnées** : seuls les titres, artistes, années et ordres de pistes sont utilisés, à titre d'information. Les titres comportant une insulte sont censurés comme sur les plateformes (`B**** Please II`).
- **Écoute** : chaque carte propose un lien direct vers le morceau sur la plateforme qui fournit la pochette, puis des liens de recherche vers les autres (Spotify, Deezer, Apple Music, YouTube) ; aucun fichier audio n'est hébergé.
- **Blind test** : il fonctionne en mode indices, sans audio. L'ancien mode `BLINDTEST_AUDIO=itunes` (extraits iTunes de 30 s) est supprimé : les conditions d'Apple réservent ces extraits à la promotion de l'iTunes Store.
- **Pages légales et CGU** : mentions légales, CGU (les royalties et les éléments de jeu n'ont aucune valeur monétaire ni aucun lien avec les droits d'auteur), confidentialité, règles de la communauté et cookies sont dans `client/src/i18n/areas/legal.js` ; les coordonnées viennent des variables `LEGAL_*` (`GET /api/legal/info`). L'inscription exige l'acceptation des CGU et l'âge de 15 ans. La liste de vérification avant une ouverture publique est dans [DEPLOIEMENT.md](DEPLOIEMENT.md).

Avant un lancement public ou commercial, fais relire le projet par un juriste spécialisé en propriété intellectuelle, en particulier pour les vraies pochettes, les extraits audio ou ajouter de l'argent réel (achat de boosters, revente de cartes).

## Structure

```
shared/   20 albums de base, règles du jeu, catalogue statique de la démo (utilisés par le serveur, le site et la démo)
server/   API Express + SQLite (node:sqlite) : catalogue en base et import Deezer, comptes, boosters, amis, blind test, admin
client/   site React (Vite) : pages, composants, sons, traductions FR/EN
scripts/  emballage de la démo, parcours de test dans un vrai navigateur
```

## Tests

```bash
npm test                                   # tests de l'API (comptes, CGU et pages légales, boosters, amis, blind test, notes, admin réservé, import du catalogue avec un faux Deezer, jeu sur catalogue importé)
BASE=http://localhost:3000 node scripts/e2e.mjs   # parcours complet dans Chromium avec captures (serveur lancé avec ADMIN_EMAILS=luka@example.com)
BASE=http://localhost:5104 OUT=/tmp/shots node scripts/e2e/p0-d.mjs   # navigation, menu du compte, pages légales, retour après connexion
```

## Prochaines étapes

- Échanges de cartes entre amis, puis marché entre joueurs
- Tournois de blind test en multijoueur
- Boosters thématiques (par genre ou par décennie) et événements limités, maintenant que le catalogue est assez grand
- Extraits audio officiels, si une licence le permet
