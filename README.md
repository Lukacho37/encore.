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
| Comptes | Inscription par e-mail + nom d'utilisateur unique + mot de passe, **vérification de l'adresse e-mail**, connexion par e-mail ou pseudo, mot de passe oublié |
| Boosters | 1 booster gratuit toutes les 30 min (stock max 5), 5 cartes par booster, 7 raretés, variantes **holo** ; une partie de chaque booster vise les albums que tu as commencés ; **booster d'album** (5 cartes d'un album choisi, 300 royalties) |
| Catalogue | Import automatique depuis l'API Deezer (albums studio, sans live ni compilation), recherche plein texte, filtres par genre et décennie, rareté calibrée sur la popularité réelle de chaque morceau |
| Raretés | Indice de popularité 0-100 affiché sur chaque carte, rareté calculée automatiquement, guide des raretés avec les chances par booster |
| Ouverture | Booster à déchirer, cartes retournées une à une, halo d'anticipation selon la rareté, rayons + confettis pour les grosses cartes, **effets sonores** synthétisés (aucun fichier audio) |
| Collection | Recherche dans les 20 000 albums, mes cartes, artistes commencés, promos, progression par genre / décennie, recyclage des doublons en royalties, **pressage** d'une carte manquante |
| Mon profil & Studio | Accessible via la photo de profil en haut à droite. **Vinylthèque** en tête du profil (un vinyle par album complété, édition holo si toutes ses cartes sont holo, platine tourne-disque au clic), **sélection** de 6 cartes, notes et critiques |
| Notes & critiques | Albums et morceaux, ★ sur 5 ou /10 selon ta préférence, moyenne et répartition des notes, critiques (celles de tes amis d'abord), tracklist notée, activité de tes amis sur l'accueil |
| Photo de profil | Initiale + couleur, ou **pochette d'un album que tu as complété** |
| Amis | Ajout par nom d'utilisateur, demandes reçues / envoyées, visite du Studio de ses amis |
| Blind test | Choix du genre (rap, pop, rock, électro…), 5 manches chronométrées, jusqu'à **3 boosters** gagnés (3 parties récompensées par jour) |
| Langues | Français et anglais (sélecteur en haut à droite) |
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
| `CATALOG_IMPORT`, `CATALOG_TARGET` | Import automatique du catalogue depuis Deezer (`deezer` par défaut, `off` pour s'en tenir aux 20 albums de base) et nombre d'albums visé (20000) |

Fichiers fournis : `render.yaml` (blueprint Render) et `Dockerfile` (Railway, Fly.io, VPS).

## Régler le jeu

- **Catalogue importé** : `server/importer.js` (genres suivis, filtres sur les titres, nombre d'albums par artiste, paliers de rareté `RANK_TIERS` en percentiles de popularité Deezer). Variables `CATALOG_TARGET`, `CATALOG_MIN_ARTIST_FANS`, `CATALOG_MIN_ALBUM_FANS`, `CATALOG_MAX_ALBUMS_PER_ARTIST`.
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

  La rareté se calcule toute seule : commune ≤ 34 · peu commune 35-54 · rare 55-69 · super rare 70-81 · ultra rare 82-91 · légendaire ≥ 92 (seuils dans `POP_TIERS`). Les singles hors album vont dans `PROMOS`. Motifs de pochette disponibles : `bars`, `rings`, `sun`, `grid`, `shards`, `split`, `curtain`, `halftone`, `spotlight`, `waves`, `dots`, `stripes`, `orbit`, `arcs`, `burst`, `diamond`, `checker`.
- **Équilibrage** : `shared/rules.js` (probabilités par emplacement, chance de holo, valeur des doublons, coût du pressage, prix du booster, récompenses d'album et du blind test).
- **Rythme des boosters gratuits** : variables `PACK_REGEN_MINUTES` et `PACK_MAX_STOCK`.

## Droits d'auteur : ce que fait le jeu

- **Pochettes** : le serveur récupère les vraies pochettes et les liens d'écoute auprès de Spotify (si `SPOTIFY_CLIENT_ID` et `SPOTIFY_CLIENT_SECRET` sont renseignés) ou de Deezer (sans clé). Seules les adresses sont gardées en base : les images restent hébergées par la plateforme, affichées sans modification, avec la source et un lien direct vers l'album ou le morceau. Une carte non obtenue garde le visuel généré. Attention : les conditions de Spotify (« Do not create a game, including trivia quizzes ») et de Deezer (usage privé) ne prévoient pas ce type de jeu ; `COVERS=off` coupe tout en cas de demande de retrait.
- **Critiques** : les textes sont écrits par les joueurs ; l'admin peut supprimer une critique depuis l'espace admin.
- **Catalogue** : les 20 000 albums viennent de l'API publique de Deezer (titres, artistes, années, ordre des pistes, popularité, adresses des pochettes et des pages Deezer). Chaque album et chaque morceau renvoie vers Deezer pour l'écoute, et la source est créditée en bas de page. Les conditions de Deezer réservent l'API aux usages non commerciaux et n'autorisent pas à recopier le catalogue : c'est un risque assumé, `CATALOG_IMPORT=off` arrête tout appel.
- **Métadonnées** : seuls les titres, artistes, années et ordres de pistes sont utilisés, à titre d'information. Les titres comportant une insulte sont censurés comme sur les plateformes (`B**** Please II`).
- **Écoute** : chaque carte propose un lien direct vers le morceau sur la plateforme qui fournit la pochette, puis des liens de recherche vers les autres (Spotify, Deezer, Apple Music, YouTube) ; aucun fichier audio n'est hébergé.
- **Blind test** : par défaut (`BLINDTEST_AUDIO=off`), il fonctionne en mode indices, sans audio. Le mode `itunes` récupère les extraits de 30 s de l'API iTunes Search, mais les conditions d'Apple les réservent à la promotion de l'iTunes Store (« not used for independent entertainment value ») : ne l'active pas sans autorisation écrite d'Apple.

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
npm test                                   # tests de l'API (comptes, boosters, amis, blind test, notes, admin réservé, import du catalogue avec un faux Deezer, jeu sur catalogue importé)
BASE=http://localhost:3000 node scripts/e2e.mjs   # parcours complet dans Chromium avec captures (serveur lancé avec ADMIN_EMAILS=luka@example.com)
```

## Prochaines étapes

- Échanges de cartes entre amis, puis marché entre joueurs
- Tournois de blind test en multijoueur
- Boosters thématiques (par genre ou par décennie) et événements limités, maintenant que le catalogue est assez grand
- Extraits audio officiels, si une licence le permet
