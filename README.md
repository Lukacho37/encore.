# encore.

Le jeu de collection de morceaux de musique : ouvre des boosters, collectionne les morceaux, complète les albums et deviens maître d'une discographie.

- **Morceau → Album → Artiste** : chaque carte est un morceau ; réunir toutes les pistes d'un album le complète ; compléter tous les albums et promos d'un artiste fait de toi son « Maître ».
- **Cartes Promo** : les morceaux sortis hors album (singles, bandes originales, collaborations) forment une rareté à part, comme les cartes promo Pokémon.
- **20 albums, 266 cartes** au lancement, dont *The College Dropout* de Kanye West.

## Fonctionnalités

| | |
|---|---|
| Comptes | Inscription par e-mail + nom d'utilisateur unique + mot de passe, **vérification de l'adresse e-mail**, connexion par e-mail ou pseudo, mot de passe oublié |
| Boosters | 1 booster gratuit toutes les 30 min (stock max 5), 5 cartes par booster, 7 raretés, variantes **holo** |
| Ouverture | Booster à déchirer, cartes retournées une à une, halo d'anticipation selon la rareté, rayons + confettis pour les grosses cartes, **effets sonores** synthétisés (aucun fichier audio) |
| Collection | Albums, artistes, promos, progression par genre / décennie / pays, recyclage des doublons en royalties, **pressage** d'une carte manquante |
| Mon profil & Studio | Accessible via la photo de profil en haut à droite. Mur de **disques d'or** (albums complétés) et **sélection** de 6 cartes exposées |
| Photo de profil | Initiale + couleur, ou **pochette d'un album que tu as complété** |
| Amis | Ajout par nom d'utilisateur, demandes reçues / envoyées, visite du Studio de ses amis |
| Blind test | Choix du genre (rap, pop, rock, électro…), 5 manches chronométrées, jusqu'à **3 boosters** gagnés (3 parties récompensées par jour) |
| Langues | Français et anglais (sélecteur en haut à droite) |
| Admin | Boosters illimités, ouverture par lots de 10 ou 50, vider / compléter sa collection, préparer un album presque complet, liste des joueurs, dons de boosters et de royalties, tableau des probabilités |

## Démarrer en local

Prérequis : **Node.js 22.13 ou plus récent** (la base SQLite est intégrée à Node, rien d'autre à installer).

```bash
npm install
npm run dev
```

Ouvre <http://localhost:5173>.

- Sans serveur SMTP configuré, les e-mails de vérification arrivent dans la **boîte de test** : <http://localhost:5173/dev/mailbox>.
- En développement, **le premier compte créé est admin** : tu peux ouvrir autant de boosters que tu veux.

## Version démo (sans serveur)

```bash
npm run build:demo
```

Produit `dist-demo/encore-demo.html` : tout le jeu dans un seul fichier, avec un faux serveur qui tourne dans le navigateur (données dans le `localStorage`, e-mail de confirmation affiché à l'écran, joueurs fictifs pour tester les amis). Pratique pour montrer le jeu à quelqu'un.

## Mettre en ligne

```bash
npm install
npm run build      # compile le site dans dist/
npm start          # sert le site et l'API sur le port $PORT
```

Copie `.env.example` en `.env` (ou renseigne les variables chez ton hébergeur). À régler au minimum :

| Variable | Rôle |
|---|---|
| `APP_URL` | Adresse publique du site, utilisée dans les liens des e-mails |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Envoi des e-mails (Brevo, Resend, Mailgun, OVH…) |
| `ADMIN_EMAILS` | Adresses qui reçoivent le rôle admin à l'inscription |
| `DATABASE_FILE` | Fichier SQLite, à placer sur un **disque persistant** |
| `TRUST_PROXY=true` | Derrière un reverse proxy (Render, Railway, Nginx…) |

Hébergeurs possibles : Render, Railway, Fly.io ou un petit VPS, tant qu'un disque persistant est disponible pour la base.

Donner ou retirer le rôle admin à un compte existant :

```bash
npm run admin -- nom_utilisateur
npm run admin -- nom_utilisateur --remove
```

## Régler le jeu

- **Catalogue** : `shared/catalog.js`. Ajouter un album = ajouter un objet avec sa tracklist et la rareté de chaque piste :

  ```js
  {
    id: 'late-registration', artist: 'kanye-west', title: 'Late Registration', year: 2005, genre: 'rap',
    art: { palette: ['#2a1a10', '#c9a46a', '#f2e6d0'], motif: 'curtain' },
    tracks: [
      ['Wake Up Mr. West', 'C'],
      ['Heard \'Em Say', 'S', 'Adam Levine'],
      ['Touch the Sky', 'X', 'Lupe Fiasco'],
      ['Gold Digger', 'L', 'Jamie Foxx'],
      // …
    ],
  },
  ```

  Raretés : `C` commune · `U` peu commune · `R` rare · `S` super rare · `X` ultra rare · `L` légendaire. Les singles hors album vont dans `PROMOS`. Motifs de pochette disponibles : `bars`, `rings`, `sun`, `grid`, `shards`, `split`, `curtain`, `halftone`, `spotlight`, `waves`, `dots`, `stripes`, `orbit`, `arcs`, `burst`, `diamond`, `checker`.
- **Équilibrage** : `shared/rules.js` (probabilités par emplacement, chance de holo, valeur des doublons, coût du pressage, prix du booster, récompenses d'album et du blind test).
- **Rythme des boosters gratuits** : variables `PACK_REGEN_MINUTES` et `PACK_MAX_STOCK`.

## Droits d'auteur : ce que fait le jeu

- **Pochettes** : les visuels affichés sont **générés par le jeu** (palette + motif propres à chaque album). Aucune pochette officielle n'est reproduite, donc la photo de profil « pochette » utilise ces visuels originaux.
- **Métadonnées** : seuls les titres, artistes, années et ordres de pistes sont utilisés, à titre d'information. Les titres comportant une insulte sont censurés comme sur les plateformes (`B**** Please II`).
- **Écoute** : chaque carte propose des liens de recherche vers Spotify, Deezer, Apple Music et YouTube ; aucun fichier audio n'est hébergé.
- **Blind test** : avec `BLINDTEST_AUDIO=itunes`, le serveur récupère les extraits de 30 s fournis par l'API iTunes Search (ils restent hébergés par Apple). Ces extraits sont soumis aux conditions d'Apple : à faire valider avant une mise en ligne publique. Avec `BLINDTEST_AUDIO=off`, le blind test fonctionne en mode indices.

Avant un lancement public ou commercial, fais relire le projet par un juriste spécialisé en propriété intellectuelle, en particulier si tu veux afficher les vraies pochettes, utiliser des extraits audio ou ajouter de l'argent réel (achat de boosters, revente de cartes).

## Structure

```
shared/   catalogue musical et règles du jeu (utilisés par le serveur, le site et la démo)
server/   API Express + SQLite (node:sqlite) : comptes, boosters, amis, blind test, admin
client/   site React (Vite) : pages, composants, sons, traductions FR/EN
scripts/  emballage de la démo, parcours de test dans un vrai navigateur
```

## Tests

```bash
npm test                                   # tests de l'API (inscription, vérification, boosters, amis, blind test, admin)
BASE=http://localhost:3000 node scripts/e2e.mjs   # parcours complet dans Chromium avec captures d'écran (Playwright)
```

## Prochaines étapes

- Échanges de cartes entre amis, puis marché entre joueurs
- Tournois de blind test en multijoueur
- Boosters thématiques (par genre ou par décennie) et événements limités
- Pochettes et extraits officiels, si une licence le permet
