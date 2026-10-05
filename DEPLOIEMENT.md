# Mettre AlbumMania en ligne

Compte une heure la première fois. Tu auras besoin de trois comptes gratuits ou presque : **GitHub** (tu l'as déjà), **Render** pour héberger le site, **Brevo** pour envoyer les e-mails de vérification.

## 1. Envoi des e-mails avec Brevo

Sans serveur d'envoi, les e-mails de vérification ne partent pas.

1. Crée un compte sur <https://www.brevo.com> (offre gratuite : 300 e-mails par jour).
2. Menu **Expéditeurs, domaines et IP dédiées → Expéditeurs** : ajoute l'adresse qui enverra les e-mails (par exemple ton adresse) et valide-la avec le lien reçu.
3. Menu **SMTP et API → SMTP** : génère une clé SMTP. Note :
   - le serveur : `smtp-relay.brevo.com`, port `587` ;
   - l'identifiant (login) ;
   - la clé SMTP (c'est le mot de passe).

Plus tard, avec un nom de domaine à toi, authentifie-le dans Brevo (SPF, DKIM) : les e-mails arriveront moins souvent dans les indésirables.

## 2. Hébergement avec Render

1. Crée un compte sur <https://render.com> et connecte-le à GitHub.
2. Clique sur **New → Blueprint**, choisis le dépôt du jeu et la branche qui contient le code.
3. Render lit le fichier `render.yaml` et te demande les valeurs manquantes :

   | Variable | Quoi mettre |
   |---|---|
   | `APP_URL` | L'adresse du site, par exemple `https://albummania.onrender.com` (tu peux la corriger après la création) |
   | `ADMIN_EMAILS` | **Ton adresse e-mail**, celle que tu utiliseras pour créer ton compte AlbumMania |
   | `SMTP_HOST` | `smtp-relay.brevo.com` |
   | `SMTP_USER` | L'identifiant SMTP Brevo |
   | `SMTP_PASS` | La clé SMTP Brevo |
   | `MAIL_FROM` | `AlbumMania <ton-adresse-validee@exemple.fr>` (l'expéditeur validé à l'étape 1) |

4. Valide. Render installe, compile et lance le site (quelques minutes). Le blueprint choisit l'offre **Starter** (environ 7 $ par mois) parce que la base de données a besoin d'un **disque persistant** : sur l'offre gratuite, toutes les données seraient effacées à chaque redémarrage.
5. Une fois le site en ligne, vérifie que `APP_URL` correspond bien à l'adresse affichée par Render ; sinon corrige-la dans **Environment** (les liens des e-mails en dépendent).

## 3. Créer ton compte admin

1. Ouvre le site et crée ton compte **avec l'adresse mise dans `ADMIN_EMAILS`**.
2. Clique sur le lien reçu par e-mail.
3. Le badge **Admin** apparaît sur ton profil et l'entrée **Admin** dans le menu de ta photo de profil.

Personne d'autre ne peut devenir admin : le serveur compare l'adresse vérifiée du compte à `ADMIN_EMAILS` à chaque requête. Il n'y a ni bouton « passer admin », ni rôle stocké en base qu'on pourrait modifier.

## 4. Le catalogue : 20 000 albums, tout seul

Rien à faire : au premier démarrage, le serveur commence à importer des albums depuis l'**API publique de Deezer** (sans clé), jusqu'à **20 000 albums** (environ 250 000 cartes) :

- il part des classements Deezer de chaque genre (rap, pop, rock, métal, électro, R&B, jazz, reggae, chanson, latino, country, classique, musiques de film, musiques du monde), puis suit les artistes proches ;
- il ne garde que les **albums studio** (pas de live, de compilation ni de best-of ; une seule version quand il existe une réédition « Deluxe ») des artistes suivis par au moins 15 000 fans ;
- chaque album importé arrive avec sa tracklist, sa pochette, ses liens Deezer et un **indice de popularité** par morceau, d'où découle la rareté (les 0,5 % de morceaux les plus écoutés sont légendaires, les 60 % les moins écoutés sont communs) ; les singles hors album deviennent des cartes **Promo**.

Compte **environ 3 heures** pour les 20 000 albums (le serveur ménage l'API de Deezer). Le jeu est jouable pendant ce temps : les nouveaux albums apparaissent au fur et à mesure dans la collection et les boosters. L'import reprend où il en était après un redémarrage, puis le serveur vérifie une fois par jour les nouvelles sorties.

Dans l'espace **Admin**, le bloc **Catalogue** montre l'avancement (albums importés, artistes en file, dernière erreur) avec des boutons pour mettre en pause ou relancer. Réglages possibles dans **Environment** : `CATALOG_TARGET` (nombre d'albums, 20000 par défaut) et `CATALOG_IMPORT=off` pour s'en tenir aux 20 albums de base.

Avec autant d'albums, deux choses aident les joueurs à en finir un : une partie de chaque booster gratuit est tirée dans les **albums qu'ils ont commencés**, et chaque page d'album propose un **booster d'album** (5 cartes de cet album, celles qui manquent d'abord, contre 300 royalties).

> Les conditions de l'API Deezer réservent son usage aux applications non commerciales et n'autorisent pas à recopier son catalogue dans sa propre base. Importer 20 000 albums est donc, comme les pochettes, un risque que tu choisis de prendre : en cas de demande de Deezer, mets `CATALOG_IMPORT=off` (plus aucun appel), puis retire les albums importés depuis le **Shell** de Render avec `npm run catalog:purge -- --yes`, puis redémarre le service (**Manual Deploy → Restart**) ; les 20 albums de base restent.

## 5. Pochettes et liens Spotify (facultatif)

Sans rien configurer, le serveur récupère les vraies pochettes et les liens d'écoute auprès de **Deezer** (API publique, sans clé) quelques secondes après le démarrage, puis une fois par jour. Pour passer à **Spotify**, avec un bouton « Écouter sur Spotify » qui ouvre directement chaque morceau :

1. Va sur [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), connecte-toi avec ton compte Spotify et clique sur **Create app**. Depuis février 2026, Spotify exige un abonnement **Premium actif** pour le propriétaire d'une application de développement : sans lui, l'API refuse les requêtes et le site reste sur Deezer (l'espace admin affiche alors l'erreur « spotify 403 »).
2. Nom : `AlbumMania` ; description : au choix ; *Redirect URI* : l'adresse de ton site (elle n'est pas utilisée) ; coche **Web API**, accepte les conditions et enregistre.
3. Dans **Settings**, copie le **Client ID** et le **Client secret**.
4. Sur Render, dans **Environment**, ajoute `SPOTIFY_CLIENT_ID` et `SPOTIFY_CLIENT_SECRET`, puis enregistre (le site redémarre).
5. Dans l'espace **Admin**, le bloc **Pochettes** indique combien de pochettes ont été trouvées et lesquelles manquent ; le bouton **Actualiser les pochettes** relance la recherche.

Les images ne sont jamais copiées sur ton serveur : le site affiche celles hébergées par Spotify ou Deezer, sans les modifier, avec la mention de la source et un lien vers la plateforme. Une carte pas encore obtenue garde le visuel généré. Pour tout couper (par exemple si une plateforme ou un ayant droit le demande), mets `COVERS=off` : le site revient aux visuels générés.

> Les conditions de Spotify interdisent les jeux et les quiz (« Do not create a game, including trivia quizzes »), et celles de Deezer limitent l'API à un usage privé. Afficher les vraies pochettes dans AlbumMania reste donc un risque que tu choisis de prendre : en cas de demande de retrait, coupe-les avec `COVERS=off`.

## 6. Nom de domaine (facultatif)

Dans Render : **Settings → Custom Domains**, ajoute ton domaine et suis les instructions DNS. Mets ensuite à jour `APP_URL` avec la nouvelle adresse.

## Autres hébergeurs

Le fichier `Dockerfile` permet de déployer partout où Docker est accepté (Railway, Fly.io, un VPS). Il faut seulement :

- monter un volume persistant sur `/data` (la base y est créée) ;
- renseigner les mêmes variables d'environnement que ci-dessus, plus `TRUST_PROXY=true` derrière un proxy.

## Sauvegardes

Toute la base tient dans un seul fichier, `albummania.db` (une centaine de Mo avec le catalogue complet), sur le disque persistant. Render propose des instantanés du disque ; tu peux aussi télécharger le fichier de temps en temps depuis le **Shell** de Render.
