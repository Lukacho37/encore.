# Demande du propriétaire d'AlbumMania (texte d'origine, en français)

## Demande ponctuelle
Dans la barre de recherche (« Search for an album or track... » / « Album ou artiste… »), lorsqu'on commence à écrire le nom d'un album ou d'un morceau, afficher des résultats cliquables directement, avec une petite icône (pochette) de l'album à côté du titre de l'album ou du morceau.

## Amélioration en profondeur
Avant de modifier quoi que ce soit, analyser tout le projet existant : architecture, pages, base de données, authentification, design, fonctionnalités déjà présentes, navigation, responsive/mobile et logique du jeu.
IMPORTANT : ne pas supprimer les fonctionnalités existantes qui fonctionnent. Retravailler à fond l'UI, surtout les petits textes ; la police fait trop « AI made », pas originale : tout refaire. Le propriétaire a aimé l'amélioration du dynamisme mais sent qu'on peut largement mieux faire. Réutiliser au maximum l'architecture actuelle. Éviter les régressions. Le site doit rester rapide, moderne et simple à comprendre. Implémenter directement (pas seulement recommander). Améliorer l'existant plutôt que créer des doublons. Liberté de proposer et implémenter de meilleures idées si elles améliorent réellement AlbumMania.

### Vision
Mélange de : Letterboxd (notation / critiques / communauté), Pokémon ou Panini (collection), Spotify Wrapped (statistiques et partage), réseau social musical, jeu de découverte musicale. Le but n'est PAS de distribuer gratuitement de la musique. Transformer la passion pour la musique en jeu social de collection, découverte, notation et partage. Quatre piliers : COLLECTIONNER · NOTER · PARTAGER · DÉCOUVRIR.

### Collection de morceaux et d'albums
Renforcer énormément l'aspect collection. Chaque morceau = un objet / carte AlbumMania. Raretés : ⚪ Commune 🟢 Peu commune 🔵 Rare 🟣 Super Rare 🟠 Ultra Rare ⭐ Légendaire 🟥 PROMO (singles particuliers / contenus spéciaux hors album). Vraie sensation de progression. Album complet : marqué complété, animation de complétion, date de complétion, XP / récompense, badge éventuel, possibilité de le mettre en avant sur le profil, statistiques de complétion. Compléter un album doit donner une vraie satisfaction. Réfléchir à des mécaniques de collection supplémentaires intéressantes, sans frustration ni pay-to-win.

### Mon Studio (profil)
Partie très importante. Peut afficher : photo/avatar, albums favoris, albums complétés, derniers morceaux obtenus, artistes favoris, morceaux favoris, critiques récentes, posts récents, statistiques, badges, trophées, niveau / XP, nombre d'amis / abonnements, activité récente, albums actuellement recherchés, showcases personnalisés. Choisir plusieurs éléments à mettre en avant (« Mes 5 albums », « Les albums qui me représentent »). Donner envie d'être personnalisé et visité. Cosmétiques débloquables sans affecter l'équilibre du jeu si cela apporte quelque chose.

### Notation des albums et morceaux
Noter un album, un morceau ; 5 étoiles avec demi-étoiles possible ; critique/commentaire avec la note. Sur la page album ou morceau : note moyenne globale, nombre de notes, distribution, ma note, critiques, likes sur critiques, réponses, discussions. IMPORTANT : critiques et notes des amis AVANT celles des inconnus (« Vos amis » puis « Communauté AlbumMania »). Une critique peut recevoir des réponses et générer une discussion.

### Véritable réseau social
Amis ou follow, fil d'actualité, likes, commentaires, réponses aux commentaires, notifications, posts, partage de critiques, activité des amis. Posts libres : sans musique, ou mentionnant un album, un morceau, éventuellement un artiste → jolie carte interactive liée à sa page. Feed : privilégier intelligemment les contenus des amis et les interactions intéressantes, sans algorithme inutilement complexe.

### Taste Match
Comparer les goûts de deux utilisateurs (« Compatibilité musicale : 87 % ») : albums aimés en commun, artistes favoris en commun, morceaux aimés en commun, différences intéressantes, albums que l'un recommande implicitement à l'autre, genres communs. Page/modal agréable et très partageable. Algorithme pertinent et explicable.

### Album Battles
Discovery vs Random Access Memories, album A vs album B, éventuellement morceau A vs morceau B. L'utilisateur choisit son préféré. Avec assez de votes : classements communautaires (meilleur album d'un artiste, d'une décennie, d'un genre, meilleur album français, de 2026…). Architecture générique pour beaucoup de catégories.

### Music Passport / statistiques
Section très attractive : albums notés, morceaux collectionnés, albums complétés, artistes différents, genres, décennies, pays, artiste préféré, album le mieux noté, évolution des goûts, raretés obtenues, progression annuelle. Visuellement partageable. À terme un « AlbumMania Replay » annuel (esprit Spotify Wrapped, données AlbumMania), design original.

### Quêtes et défis
Quotidiennes, hebdomadaires, éventuellement événementielles : noter 3 albums, découvrir un nouvel artiste, obtenir 3 morceaux des années 2000, compléter un album, écrire une critique, découvrir plusieurs genres, participer à un Album Battle. Récompenses : XP, badges, cosmétiques, monnaie virtuelle, packs gratuits, objets de personnalisation. Pas agressif, pas casino, pas pay-to-win.

### Événements
Temporaires : French Touch Week, 80s Week, Rap US 90s, Rock Legends, Eurovision, Summer Albums, discographie d'un artiste. Pendant l'événement : quêtes, badges, collections, classements, battles, récompenses. Récompenses exclusives = créations AlbumMania (aucune revendication de droits sur la musique).

### Page album (une des meilleures pages du site)
Ordre possible : pochette + informations → progression de collection → tracklist → ma note → notes de mes amis → note communauté → critiques de mes amis → critiques communauté → posts mentionnant cet album → statistiques → albums similaires → classements / battles liés. CTA intelligents sans surcharger.

### Page morceau (vraie page)
Titre, artiste, album, numéro de piste, année, rareté AlbumMania, collection, note personnelle, note communauté, amis, critiques, discussions, posts associés, autres morceaux de l'album.

### Découverte
Excellente page Découvrir, pas une simple liste d'albums populaires : goûts de l'utilisateur, collections, notes, amis, genres, décennies, nouveautés, tendances AlbumMania, albums jamais notés, similarités. Ex. « Parce que tu as aimé… », « Très apprécié par tes amis », « Album culte que tu n'as jamais noté », « Découvre les années 90 », « Albums à compléter ».

### Listes (façon Letterboxd)
« Mes 10 albums préférés », « Albums à écouter », « Meilleurs albums français », « Albums pour conduire la nuit ». Publiques ou privées ; likes, commentaires, partages.
IMPORTANT : créer exactement la même chose que https://my9games.com/edit (sélectionner des éléments pour en choisir 9 et générer une image de la grille) — ici avec des albums (« Mes 9 albums ») ; l'image générée porte en bas le lien du site ; pas encore de lien : mettre simplement « AlbumMania ».

### Badges et succès
Système intelligent : premier album complété, 100 albums notés, critique populaire, explorateur des années 70, fan de jazz, collectionneur légendaire… Pas 500 badges sans intérêt ; vraie valeur symbolique.

### Onboarding
Excellent onboarding au premier lancement : quelques artistes préférés, albums préférés, genres appréciés, quelques notes rapides. Puis générer immédiatement : recommandations, profil musical, premières suggestions d'amis, premières collections intéressantes. Un nouveau compte ne doit pas paraître vide.

### Viralité
Éléments partageables : Taste Match, AlbumMania Replay, Top 5 albums, album complété, badge obtenu, classement personnel, battle, statistiques musicales. Belles cards adaptées au partage externe.

### Recherche
Excellente recherche globale : artistes, albums, morceaux, utilisateurs, listes. Tolérer les petites fautes de frappe. Catégories claires.

### UX/UI
Élégant, musical, premium, moderne, dynamique, facile à comprendre, mobile-first, cohérent. Éviter : trop de couleurs, trop d'informations simultanées, design enfantin, interfaces type dashboard d'entreprise. Ludique sans être enfantin. Véritable design system cohérent : typographie, espacements, cards, boutons, modals, menus, badges, raretés, animations, états hover, skeleton loading, empty states, erreurs. Petites animations quand elles améliorent l'expérience, sans nuire aux performances.

### Mobile
Tout doit parfaitement fonctionner sur smartphone : navigation, profil, collection, feed, commentaires, recherche, pages album, ouverture de packs, cards, modals.

### Légalité / copyright (priorité absolue)
Ne PAS : héberger des MP3 protégés, permettre le téléchargement illégal, scraper de la musique protégée, copier des paroles complètes sans licence, télécharger arbitrairement des pochettes depuis Google Images, prétendre posséder les droits sur les albums/artistes. Respecter API, licences, attribution, conditions des services tiers. Éléments AlbumMania (raretés, cadres, badges, XP, design, statistiques, classements communautaires) clairement séparés des droits des artistes, labels, plateformes. Écoute : liens officiels, embeds autorisés, API officielles. Si une fonctionnalité demandée présente un risque juridique ou enfreint les conditions d'un fournisseur : ne pas l'implémenter aveuglément, trouver une alternative légale.

### Données musicales
Architecture pour plusieurs dizaines de milliers d'albums et beaucoup plus. Pas de données dupliquées inutilement. Identifiants propres + identifiants de sources (MusicBrainz, Spotify, Apple Music, autres services légitimes). Ne pas lier toute l'architecture à un seul fournisseur.

### Sécurité et réseau social
Signalement, blocage, suppression, modération, anti-spam, permissions correctes, validation backend, rate limiting. Vérifier : authentification, autorisations, routes admin, accès base, secrets/API keys, validation des entrées. Accès administrateur réellement protégé (seule l'adresse ADMIN_EMAILS du propriétaire).

### Performance
Rapide avec 20 000+ albums, beaucoup de morceaux, utilisateurs, commentaires, likes, amitiés, collections : requêtes, index, pagination, lazy loading, cache, images, N+1, chargement du feed.

### Nouvelles idées
Analyser comme product designer senior, fondateur de startup musicale, UX designer, game designer, ingénieur senior. Ajouter les excellentes idées cohérentes et légales ; éviter les gadgets.

### Priorisation
P0 = indispensable / fondations · P1 = très forte valeur · P2 = amélioration importante · P3 = expérimental / futur. Commencer par les fondations. Concevoir le schéma de base de données globalement avant les migrations.

### Avant de terminer
Seconde passe complète : bugs, boutons non fonctionnels, liens morts, incohérences UI, pages incomplètes, mauvais responsive, erreurs console, problèmes de permissions, requêtes inefficaces, doublons, fonctionnalités inaccessibles depuis l'interface. Résultat = un produit cohérent, pas une accumulation. Objectif : « Je veux créer mon compte, noter mes albums et commencer ma collection. »
