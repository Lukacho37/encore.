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

## 4. Mentions légales et CGU

La loi française (LCEN) impose d'afficher qui édite et qui héberge le site. AlbumMania les affiche dans **Mentions légales** (`/legal/mentions`, lien en bas de chaque page), à partir de ces variables, à ajouter dans **Environment** :

| Variable | Quoi mettre |
|---|---|
| `LEGAL_EDITOR_NAME` | Ton nom (ou celui de ta société) |
| `LEGAL_EDITOR_ADDRESS` | Ton adresse postale (un particulier peut, sous conditions, ne donner que celle de son hébergeur : vérifie auprès d'un juriste) |
| `LEGAL_EDITOR_EMAIL` | Une adresse de contact |
| `LEGAL_PUBLICATION_DIRECTOR` | Le directeur de la publication (toi, en général) |
| `LEGAL_HOST_NAME`, `LEGAL_HOST_ADDRESS`, `LEGAL_HOST_PHONE` | L'hébergeur (pour Render : nom, adresse et téléphone indiqués dans ses conditions) |
| `LEGAL_CONTACT_EMAIL` | Adresse de contact pour les signalements et les demandes sur les données personnelles (par défaut : `LEGAL_EDITOR_EMAIL`) |
| `TERMS_VERSION` | Date de la version des CGU en vigueur, par exemple `2026-10-06` |
| `TERMS_UPDATED_AT` | Date affichée en tête des CGU (par défaut : `TERMS_VERSION`) |

Une valeur manquante s'affiche « non renseigné » (et, pour toi seulement, le nom de la variable à remplir).

Les textes (CGU, confidentialité, règles de la communauté, cookies) sont dans `client/src/i18n/areas/legal.js`, en français et en anglais. **Quand tu modifies les CGU**, change aussi `TERMS_VERSION` : chaque joueur voit alors un bandeau « Nos conditions d'utilisation ont changé » ; il peut continuer à jouer, mais doit accepter la nouvelle version pour publier (critiques, demandes d'ami). Les nouveaux comptes acceptent la version en vigueur à l'inscription, avec la case « J'accepte les CGU et j'ai 15 ans ou plus ».

## 5. Le catalogue : 20 000 albums, tout seul

Rien à faire : au premier démarrage, le serveur commence à importer des albums depuis l'**API publique de Deezer** (sans clé), jusqu'à **20 000 albums** (environ 250 000 cartes) :

- il part des classements Deezer de chaque genre (rap, pop, rock, métal, électro, R&B, jazz, reggae, chanson, latino, country, classique, musiques de film, musiques du monde), puis suit les artistes proches ;
- il ne garde que les **albums studio** (pas de live, de compilation ni de best-of ; une seule version quand il existe une réédition « Deluxe ») des artistes suivis par au moins 15 000 fans ;
- chaque album importé arrive avec sa tracklist, sa pochette, ses liens Deezer et un **indice de popularité** par morceau, d'où découle la rareté (les 0,5 % de morceaux les plus écoutés sont légendaires, les 60 % les moins écoutés sont communs) ; les singles hors album deviennent des cartes **Promo**.

Compte **environ 3 heures** pour les 20 000 albums (le serveur ménage l'API de Deezer). Le jeu est jouable pendant ce temps : les nouveaux albums apparaissent au fur et à mesure dans la collection (tout de suite) et dans les boosters (dans le quart d'heure qui suit). L'import reprend où il en était après un redémarrage.

Ensuite, une fois par jour, le serveur vérifie les **nouvelles sorties** des artistes déjà importés (300 artistes par jour, chacun revu au plus une fois par semaine, les plus suivis d'abord) : un nouvel album studio entre au catalogue s'il fait partie des 10 albums les plus écoutés de l'artiste (`CATALOG_MAX_ALBUMS_PER_ARTIST`), même une fois les 20 000 albums atteints.

Si Deezer tombe en panne ou bloque le serveur (erreurs 403, 5xx, quota, réseau coupé), l'import s'arrête sans rien perdre : les artistes restants gardent leur place dans la file, et le serveur réessaie toutes les 10 minutes. Un album introuvable chez Deezer est simplement passé.

Dans l'espace **Admin**, le bloc **Catalogue** montre l'avancement (albums importés, artistes en file, dernière erreur) avec deux boutons :

- **Mettre en pause** : l'import s'arrête après l'album en cours (l'artiste en cours reprendra là où il en était). La pause tient même après un redémarrage du serveur : plus rien ne part, ni l'import ni la vérification quotidienne, jusqu'au bouton suivant.
- **Lancer / reprendre l'import** : lève la pause et relance l'import (ou la vérification des nouvelles sorties si elle est due). Il fonctionne aussi avec `CATALOG_IMPORT=off`, pour un import ponctuel.

Réglages possibles dans **Environment** : `CATALOG_TARGET` (nombre d'albums, 20000 par défaut) et `CATALOG_IMPORT` : `deezer` (par défaut) ou `off` pour s'en tenir aux 20 albums de base. Toute autre valeur (faute de frappe comprise) coupe aussi l'import, avec un avertissement dans le journal au démarrage.

Avec autant d'albums, deux choses aident les joueurs à en finir un : une partie de chaque booster gratuit est tirée dans les **albums qu'ils ont commencés**, et chaque page d'album propose un **booster d'album** (5 cartes de cet album, celles qui manquent d'abord, contre 300 royalties).

> Les conditions de l'API Deezer réservent son usage aux applications non commerciales et n'autorisent pas à recopier son catalogue dans sa propre base. Importer 20 000 albums est donc, comme les pochettes, un risque que tu choisis de prendre : en cas de demande de Deezer, mets `CATALOG_IMPORT=off` (plus aucun appel), puis retire les albums importés depuis le **Shell** de Render avec `npm run catalog:purge -- --yes`, puis redémarre le service (**Manual Deploy → Restart**) ; les 20 albums de base restent.

## 6. Pochettes

Sans rien configurer, le serveur récupère les vraies pochettes et les liens d'écoute auprès de **Deezer** (API publique, sans clé) quelques secondes après le démarrage, puis une fois par jour. Dans l'espace **Admin**, le bloc **Pochettes** indique combien de pochettes ont été trouvées et lesquelles manquent ; le bouton **Actualiser les pochettes** relance la recherche.

Les images ne sont jamais copiées sur ton serveur : le site affiche celles hébergées par Deezer, sans les modifier, avec la mention de la source et un lien vers la plateforme. Une carte pas encore obtenue garde le visuel généré. Pour tout couper (par exemple si une plateforme ou un ayant droit le demande), mets `COVERS=off` : le site revient aux visuels générés.

`SHARE_COVERS=deezer` autorise les vraies pochettes dans les images à partager (« Mes 9 albums »…) : elles sont composées dans le navigateur du joueur, jamais sur ton serveur, avec repli sur le visuel généré quand une image ne peut pas être utilisée.

**Spotify.** Le service des pochettes sait utiliser l'API Web de Spotify quand ses clés sont configurées (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, application créée sur [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) avec un compte Premium actif), mais **cette version du serveur ignore ces clés** : les conditions de Spotify interdisent les jeux et les quiz (« Do not create a game, including trivia quizzes »). Les pochettes viennent donc de Deezer. Les liens « Écouter sur Spotify » (recherche sur open.spotify.com) restent proposés : ils n'utilisent pas l'API.

> Les conditions de Deezer limitent son API à un usage privé et non commercial. Afficher les vraies pochettes et importer le catalogue dans AlbumMania reste donc un risque que tu choisis de prendre : en cas de demande de retrait, coupe les pochettes avec `COVERS=off` (ou retire une seule pochette depuis l'espace admin) et l'import avec `CATALOG_IMPORT=off`.

## 7. Nom de domaine (facultatif)

Dans Render : **Settings → Custom Domains**, ajoute ton domaine et suis les instructions DNS. Mets ensuite à jour `APP_URL` avec la nouvelle adresse.

## Autres hébergeurs

Le fichier `Dockerfile` permet de déployer partout où Docker est accepté (Railway, Fly.io, un VPS). Il faut seulement :

- monter un volume persistant sur `/data` (la base y est créée) ;
- renseigner les mêmes variables d'environnement que ci-dessus, plus `TRUST_PROXY=true` derrière un proxy.

## Sauvegardes

Toute la base tient dans un seul fichier, `albummania.db` (une centaine de Mo avec le catalogue complet), sur le disque persistant. Render propose des instantanés du disque ; tu peux aussi télécharger le fichier de temps en temps depuis le **Shell** de Render.

## Avant d'ouvrir au public : liste de vérification

Ce n'est pas un avis juridique : fais relire le projet par un juriste spécialisé (propriété intellectuelle, données personnelles) avant un lancement public ou commercial.

- [ ] Les variables `LEGAL_*` sont remplies : `/legal/mentions` n'affiche plus « non renseigné ».
- [ ] Les CGU, la politique de confidentialité, les règles de la communauté et la page cookies (`client/src/i18n/areas/legal.js`) ont été relues et adaptées ; `TERMS_VERSION` correspond à la version publiée.
- [ ] `APP_URL` est en `https://` (les cookies de session passent alors en `Secure`) et `DEV_MAILBOX` n'est pas défini (le serveur refuse de démarrer avec `DEV_MAILBOX=1` et une adresse publique).
- [ ] Un vrai serveur d'envoi d'e-mails est configuré (`SMTP_*`) : confirmations, mots de passe, décisions de modération et accusés de réception des signalements en dépendent.
- [ ] `LEGAL_CONTACT_EMAIL` est une adresse que tu lis : c'est le point de contact des autorités et des utilisateurs (règlement européen sur les services numériques, DSA).
- [ ] Tu as testé le formulaire public de signalement (`/report`, lien « Signaler » en bas de page) et la file de modération de l'espace admin.
- [ ] Catalogue et pochettes : tu acceptes le risque lié aux conditions de Deezer (voir les sections 5 et 6) et tu sais les couper (`CATALOG_IMPORT=off`, `COVERS=off`).
- [ ] Rien n'est vendu contre de l'argent réel (boosters, royalties, cartes) : les CGU le disent, et c'est ce qui garde le jeu hors du champ des jeux d'argent.
- [ ] Les inscriptions exigent 15 ans ou plus (case de l'inscription) : n'ajoute pas de fonction qui viserait des enfants plus jeunes.

## Menace pour la vie ou la sécurité d'une personne (DSA, article 18)

Si un contenu signalé (critique, profil, message) fait craindre une infraction grave menaçant la vie ou la sécurité d'une personne (menace de mort, de suicide, d'attentat, mise en danger d'un enfant…) :

1. **Ne supprime pas tout de suite** : la file de modération garde une copie du contenu au moment du signalement ; note la date, l'heure, le pseudo, l'adresse de la page et le texte exact.
2. **Masque le contenu** depuis la file de modération (action « Masquer »), et suspends le compte si la menace continue.
3. **Préviens immédiatement les autorités** : en cas d'urgence, appelle le **17** ou le **112** ; sinon, signale le contenu sur **PHAROS** (<https://www.internet-signalement.gouv.fr>), la plateforme de la police et de la gendarmerie. Pour une personne en détresse suicidaire, le **3114** (numéro national de prévention du suicide) peut aussi conseiller.
4. **Garde une trace** de ton signalement (numéro, date) avec la décision de modération, et réponds aux demandes des enquêteurs (la base conserve l'adresse IP liée aux contenus publiés pendant un an).
5. N'informe l'auteur de la décision que si cela ne gêne pas l'enquête ; la notification envoyée par la modération peut attendre.

