// Textes de la zone « legal » (P0-D) : les cinq pages légales (/legal/mentions, terms, privacy, rules, cookies,
// PLAN.md 7.1). Les coordonnées de l'éditeur et de l'hébergeur viennent de GET /api/legal/info (variables LEGAL_*).
// Une page = { title, short, intro, sections: [{ h, p: [...], ul?: [...] }] } (+ tableaux de la confidentialité et
// des cookies). Fusionnés dans fr.js / en.js au chargement (i18n/index.jsx). Chaque clé existe en FR et en EN
// (tutoiement, espace fine insécable avant ; : ! ? % et dans « »).
// Ces textes sont une base de travail, pas un avis juridique : à relire par un juriste avant une ouverture publique.
export default {
  fr: {
    legal: {
      eyebrow: 'Informations légales',
      updated: 'Version en vigueur du {date}',
      missing: 'non renseigné',
      missingVar: 'variable {v}',
      contactLine: 'Contact : {email}',
      contactNone: 'Contact : voir les mentions légales.',
      reportCta: 'Signaler un contenu',
      reportLine: 'Un contenu te semble illicite ? Signale-le, même sans compte.',
      pages: {
        mentions: {
          title: 'Mentions légales',
          short: 'Mentions',
          intro: 'Informations prévues par l’article 6 de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l’économie numérique (LCEN).',
          facts: {
            editor: 'Éditeur',
            editorAddress: 'Adresse',
            editorEmail: 'E-mail',
            director: 'Directeur de la publication',
            host: 'Hébergeur',
            hostAddress: 'Adresse de l’hébergeur',
            hostPhone: 'Téléphone de l’hébergeur',
            contact: 'Contact',
          },
          sections: [
            {
              h: 'Œuvres, pochettes et marques',
              p: [
                'Les titres, noms d’artistes, pochettes et liens d’écoute proviennent de Deezer et restent la propriété de leurs ayants droit. Ils sont affichés pour identifier les œuvres ; AlbumMania ne diffuse aucun fichier audio.',
                'Raretés, cartes, royalties, badges et classements sont des éléments de jeu AlbumMania ; les œuvres, pochettes, noms et marques appartiennent à leurs ayants droit. AlbumMania n’est affilié à aucun artiste, label ni plateforme.',
              ],
            },
            {
              h: 'Signaler un contenu',
              p: ['Pour signaler un contenu illicite, utilise le bouton « Signaler » présent sur chaque contenu, le formulaire de signalement (ouvert à tous, même sans compte) ou l’adresse de contact ci-dessus.'],
            },
            {
              h: 'Droit applicable',
              p: ['Le site et ces mentions sont soumis au droit français.'],
            },
          ],
        },
        terms: {
          title: 'Conditions générales d’utilisation',
          short: 'CGU',
          intro: 'Ces conditions encadrent l’utilisation d’AlbumMania. En créant un compte, tu les acceptes ; elles sont datées et la version en vigueur reste consultable ici.',
          sections: [
            {
              h: '1. Le service',
              p: [
                'AlbumMania est un jeu gratuit de collection de morceaux de musique : tu ouvres des boosters, tu complètes des albums, tu notes et critiques des albums et des morceaux, et tu partages ta collection avec tes amis.',
                'AlbumMania ne diffuse aucun fichier audio : l’écoute se fait sur les plateformes officielles (Deezer, Spotify, Apple Music, YouTube), par des liens ou par le lecteur Deezer intégré, chargé seulement à ta demande.',
              ],
            },
            {
              h: '2. Ton compte',
              ul: [
                'Il faut avoir 15 ans ou plus pour créer un compte.',
                'Un compte par personne, avec une adresse e-mail valide que tu confirmes.',
                'Tu gardes ton mot de passe pour toi : ce qui est fait depuis ton compte est sous ta responsabilité.',
                'Ton nom d’utilisateur est public ; il ne doit pas usurper l’identité d’une autre personne, d’un artiste, d’un label, d’une plateforme ou de l’équipe d’AlbumMania.',
              ],
            },
            {
              h: '3. Éléments de jeu et royalties',
              p: [
                'Boosters, cartes, raretés, royalties, niveaux, badges et classements sont des éléments de jeu. Ils n’ont aucune valeur monétaire : ils ne s’achètent pas, ne se vendent pas, ne s’échangent pas contre de l’argent et ne se transfèrent pas hors du jeu. Rien n’est vendu contre de l’argent réel.',
                'Les « royalties » sont une monnaie de jeu. Elles n’ont aucun lien avec les droits d’auteur ni avec la rémunération des artistes.',
                'Les probabilités de chaque tirage (raretés, cartes holographiques) sont publiées dans le guide des raretés, accessible depuis l’accueil.',
              ],
            },
            {
              h: '4. Ce que tu publies',
              p: [
                'Tes notes, critiques, nom d’utilisateur et autres contenus restent les tiens. Tu accordes à AlbumMania une licence gratuite, non exclusive et mondiale pour les afficher dans le service tant qu’ils sont publiés.',
                'Tu publies seulement ce que tu as le droit de publier : pas de paroles complètes de chansons (de courtes citations pour critiquer sont permises), pas de contenus d’autrui sans autorisation.',
              ],
            },
            {
              h: '5. Règles de la communauté et modération',
              p: [
                'Les règles de la communauté font partie de ces conditions. Chacun peut signaler un contenu. Une décision de modération (masquage, suppression, avertissement, suspension) est motivée et t’est notifiée ; tu peux la contester depuis la notification.',
                'Après trois manquements confirmés en 90 jours, un compte peut être suspendu. Un compte suspendu peut toujours se connecter, consulter, exporter ses données, contester et se supprimer, mais ne peut plus publier.',
              ],
            },
            {
              h: '6. Services tiers',
              p: ['Les liens d’écoute et le lecteur intégré mènent à des services tiers (Deezer, Spotify, Apple Music, YouTube), soumis à leurs propres conditions.'],
            },
            {
              h: '7. Disponibilité et évolution',
              p: [
                'Le service est fourni tel quel, sans garantie de disponibilité permanente. Il peut évoluer : de nouvelles fonctions apparaissent, d’autres changent.',
                'Quand ces conditions changent, un bandeau te présente la nouvelle version : tu peux continuer à jouer, mais il faut l’accepter pour publier.',
              ],
            },
            {
              h: '8. Fin de l’utilisation',
              p: ['Tu peux supprimer ton compte à tout moment depuis les Paramètres ; tes données sont alors effacées (voir la politique de confidentialité). En cas de manquement grave ou répété à ces conditions, AlbumMania peut suspendre ou fermer un compte.'],
            },
            {
              h: '9. Droit applicable',
              p: ['Ces conditions sont soumises au droit français. En cas de désaccord, écris-nous d’abord : nous chercherons une solution amiable avant toute autre démarche.'],
            },
          ],
        },
        privacy: {
          title: 'Politique de confidentialité',
          short: 'Confidentialité',
          intro: 'Ce que nous collectons, pourquoi, combien de temps, et comment exercer tes droits. Pas de publicité, pas de mesure d’audience, aucune donnée vendue.',
          retentionHead: ['Données', 'Durée de conservation'],
          retention: [
            ['Compte, collection, notes et critiques', 'Jusqu’à la suppression du compte'],
            ['Compte jamais confirmé', '7 jours'],
            ['Sessions de connexion', '30 jours'],
            ['Liens de confirmation et de mot de passe', '24 heures et 1 heure'],
            ['Historique des ouvertures de boosters', '400 jours'],
            ['Notifications', '90 jours une fois lues, 180 jours sinon'],
            ['Adresse IP liée aux contenus publiés et aux signalements', '1 an (décret n° 2021-1362)'],
            ['Décisions de modération', 'Le temps du suivi des recours et des récidives'],
          ],
          sections: [
            {
              h: 'Responsable du traitement',
              p: ['L’éditeur indiqué dans les mentions légales.'],
            },
            {
              h: 'Données collectées',
              ul: [
                'Compte : adresse e-mail, nom d’utilisateur, mot de passe (haché, jamais stocké en clair), langue, préférences.',
                'Jeu : cartes, boosters, royalties, succès, niveau, vitrine.',
                'Contenus : notes, critiques, signalements, demandes d’ami et amis.',
                'Technique : adresse IP (sécurité, limites d’usage, obligations légales) et cookies strictement nécessaires.',
              ],
            },
            {
              h: 'Finalités et bases légales',
              ul: [
                'Fournir le jeu et ton compte : exécution des conditions d’utilisation.',
                'Sécurité, lutte contre les abus et la triche : intérêt légitime.',
                'Modération et conservation des données de connexion : obligations légales (règlement européen sur les services numériques, LCEN).',
                'E-mails de service (confirmation, mot de passe, décisions de modération) : exécution des conditions d’utilisation.',
              ],
            },
            {
              h: 'Destinataires et sous-traitants',
              ul: [
                'L’hébergeur du site (voir les mentions légales) et le prestataire d’envoi des e-mails.',
                'Pochettes : les images sont chargées par ton navigateur depuis les serveurs de Deezer, qui reçoivent alors ton adresse IP.',
                'Lecteur intégré : le lecteur Deezer n’est chargé qu’à ta demande ; il peut alors déposer ses propres cookies.',
                'Polices de caractères : chargées depuis Google Fonts (ton adresse IP est transmise à Google) jusqu’à leur hébergement sur nos serveurs.',
              ],
            },
            {
              h: 'Tes droits',
              p: [
                'Tu peux accéder à tes données, les rectifier, les effacer, t’opposer à un traitement ou en demander la limitation. « Exporter mes données » (Paramètres) te donne une copie complète au format JSON ; « Supprimer mon compte » efface ton compte et tes contenus.',
                'Tu peux aussi adresser une réclamation à la CNIL (cnil.fr).',
              ],
            },
            {
              h: 'Sécurité',
              p: ['Mots de passe hachés (scrypt), cookies de session HttpOnly, connexions chiffrées (HTTPS) en production, accès d’administration réservé au propriétaire du jeu.'],
            },
          ],
        },
        rules: {
          title: 'Règles de la communauté',
          short: 'Règles',
          intro: 'AlbumMania est un endroit pour parler musique. Ces règles valent pour ton nom d’utilisateur, ta photo de profil, tes notes, tes critiques et tout ce que tu publies.',
          sections: [
            {
              h: 'Respecte les autres',
              p: ['Critique les œuvres, pas les personnes. Pas d’insultes, de harcèlement, de menaces, de propos haineux ou discriminatoires.'],
            },
            {
              h: 'Rien d’illicite',
              p: ['Pas d’incitation à la violence, pas d’apologie de crimes, pas de contenus sexuels impliquant des mineurs, pas d’informations personnelles sur autrui.'],
            },
            {
              h: 'Respecte les artistes',
              p: ['Pas de paroles complètes de chansons ni de liens vers des copies illégales. De courtes citations pour illustrer une critique sont les bienvenues.'],
            },
            {
              h: 'Pas de spam',
              p: ['Pas de publicité ni de messages répétés. Seuls les liens vers des sites musicaux reconnus sont gardés (Deezer, Spotify, Apple Music, YouTube, Bandcamp, MusicBrainz, Wikipédia) ; les comptes créés depuis moins de 24 heures ou sous le niveau 3 ne peuvent pas publier de liens.'],
            },
            {
              h: 'Joue franc-jeu',
              p: ['Un compte par personne. Pas d’usurpation d’identité (artiste, label, plateforme, équipe d’AlbumMania), pas d’automatisation, pas d’exploitation de bugs ni de comptes multiples pour obtenir des boosters ou des royalties.'],
            },
            {
              h: 'Signalements et sanctions',
              p: [
                'Chaque contenu porte un bouton « Signaler » ; le formulaire de signalement est aussi ouvert sans compte. Une décision (masquage, suppression, avertissement, suspension) est motivée, notifiée, et peut être contestée.',
                'Trois manquements confirmés en 90 jours peuvent entraîner une suspension. Une menace pour la vie ou la sécurité d’une personne est signalée aux autorités.',
              ],
            },
          ],
        },
        cookies: {
          title: 'Cookies',
          short: 'Cookies',
          intro: 'AlbumMania n’utilise que des cookies strictement nécessaires à son fonctionnement : aucun cookie publicitaire, aucune mesure d’audience. Il n’y a donc rien à accepter.',
          tableHead: ['Nom', 'Rôle', 'Durée'],
          table: [
            ['albummania_sid', 'Garder ta session ouverte (HttpOnly, inaccessible aux scripts)', '30 jours'],
            ['albummania_signup', 'Confirmer ton adresse depuis le navigateur de l’inscription sans retaper ton mot de passe', '24 heures'],
          ],
          sections: [
            {
              h: 'Stockage sur ton appareil',
              p: ['La langue, le son, l’échelle de notation affichée et le choix « Toujours charger » du lecteur Deezer sont gardés dans le stockage local de ton navigateur. Ils ne quittent pas ton appareil.'],
            },
            {
              h: 'Services tiers',
              p: [
                'Le lecteur Deezer n’est chargé que lorsque tu cliques sur « Charger le lecteur » (ou si tu as choisi « Toujours charger ») ; il peut alors déposer ses propres cookies, régis par la politique de Deezer. Tu peux revenir sur ce choix dans Paramètres, rubrique « Lecteurs intégrés ».',
                'Les pochettes et les polices sont chargées depuis les serveurs de Deezer et de Google, sans cookie déposé par AlbumMania.',
              ],
            },
          ],
        },
      },
    },
  },
  en: {
    legal: {
      eyebrow: 'Legal information',
      updated: 'Version in force since {date}',
      missing: 'not provided',
      missingVar: 'variable {v}',
      contactLine: 'Contact: {email}',
      contactNone: 'Contact: see the legal notice.',
      reportCta: 'Report content',
      reportLine: 'Does some content look illegal? Report it, even without an account.',
      pages: {
        mentions: {
          title: 'Legal notice',
          short: 'Legal notice',
          intro: 'Information required by article 6 of the French law no. 2004-575 of 21 June 2004 on confidence in the digital economy (LCEN).',
          facts: {
            editor: 'Publisher',
            editorAddress: 'Address',
            editorEmail: 'Email',
            director: 'Publication director',
            host: 'Host',
            hostAddress: 'Host address',
            hostPhone: 'Host phone',
            contact: 'Contact',
          },
          sections: [
            {
              h: 'Works, covers and trademarks',
              p: [
                'Titles, artist names, covers and listening links come from Deezer and remain the property of their rights holders. They are shown to identify the works; AlbumMania streams no audio file.',
                'Rarities, cards, royalties, badges and rankings are AlbumMania game items; the works, covers, names and trademarks belong to their rights holders. AlbumMania is not affiliated with any artist, label or platform.',
              ],
            },
            {
              h: 'Reporting content',
              p: ['To report illegal content, use the “Report” button on every piece of content, the report form (open to everyone, even without an account) or the contact address above.'],
            },
            {
              h: 'Governing law',
              p: ['This site and this notice are governed by French law.'],
            },
          ],
        },
        terms: {
          title: 'Terms of use',
          short: 'Terms',
          intro: 'These terms govern your use of AlbumMania. By creating an account, you accept them; they are dated and the version in force can always be read here.',
          sections: [
            {
              h: '1. The service',
              p: [
                'AlbumMania is a free music track collecting game: you open packs, complete albums, rate and review albums and tracks, and share your collection with your friends.',
                'AlbumMania streams no audio file: listening happens on the official platforms (Deezer, Spotify, Apple Music, YouTube), through links or through the embedded Deezer player, loaded only when you ask for it.',
              ],
            },
            {
              h: '2. Your account',
              ul: [
                'You must be 15 or older to create an account.',
                'One account per person, with a valid email address that you confirm.',
                'Keep your password to yourself: what is done from your account is your responsibility.',
                'Your username is public; it must not impersonate another person, an artist, a label, a platform or the AlbumMania team.',
              ],
            },
            {
              h: '3. Game items and royalties',
              p: [
                'Packs, cards, rarities, royalties, levels, badges and rankings are game items. They have no monetary value: they cannot be bought, sold, exchanged for money or transferred outside the game. Nothing is sold for real money.',
                '“Royalties” are a game currency. They have no link with copyright or with how artists are paid.',
                'The odds of every draw (rarities, holographic cards) are published in the rarity guide, available from the home page.',
              ],
            },
            {
              h: '4. What you post',
              p: [
                'Your ratings, reviews, username and other content remain yours. You grant AlbumMania a free, non-exclusive, worldwide licence to show them in the service for as long as they are published.',
                'Only post what you have the right to post: no full song lyrics (short quotes to support a review are fine), no one else’s content without permission.',
              ],
            },
            {
              h: '5. Community rules and moderation',
              p: [
                'The community rules are part of these terms. Anyone can report content. A moderation decision (hiding, removal, warning, suspension) comes with its reasons and is notified to you; you can appeal it from the notification.',
                'After three confirmed breaches within 90 days, an account may be suspended. A suspended account can still log in, browse, export its data, appeal and delete itself, but can no longer post.',
              ],
            },
            {
              h: '6. Third-party services',
              p: ['Listening links and the embedded player lead to third-party services (Deezer, Spotify, Apple Music, YouTube), subject to their own terms.'],
            },
            {
              h: '7. Availability and changes',
              p: [
                'The service is provided as is, without any guarantee of permanent availability. It evolves: new features appear, others change.',
                'When these terms change, a banner shows you the new version: you can keep playing, but you need to accept it to post.',
              ],
            },
            {
              h: '8. Ending your use',
              p: ['You can delete your account at any time from Settings; your data is then erased (see the privacy policy). In case of a serious or repeated breach of these terms, AlbumMania may suspend or close an account.'],
            },
            {
              h: '9. Governing law',
              p: ['These terms are governed by French law. If you disagree with something, write to us first: we will look for an amicable solution before anything else.'],
            },
          ],
        },
        privacy: {
          title: 'Privacy policy',
          short: 'Privacy',
          intro: 'What we collect, why, for how long, and how to exercise your rights. No advertising, no audience measurement, no data sold.',
          retentionHead: ['Data', 'Retention'],
          retention: [
            ['Account, collection, ratings and reviews', 'Until the account is deleted'],
            ['Account never confirmed', '7 days'],
            ['Login sessions', '30 days'],
            ['Confirmation and password links', '24 hours and 1 hour'],
            ['Pack opening history', '400 days'],
            ['Notifications', '90 days once read, 180 days otherwise'],
            ['IP address linked to posted content and reports', '1 year (French decree no. 2021-1362)'],
            ['Moderation decisions', 'As long as needed to follow appeals and repeat breaches'],
          ],
          sections: [
            {
              h: 'Data controller',
              p: ['The publisher named in the legal notice.'],
            },
            {
              h: 'Data we collect',
              ul: [
                'Account: email address, username, password (hashed, never stored in clear), language, preferences.',
                'Game: cards, packs, royalties, achievements, level, showcase.',
                'Content: ratings, reviews, reports, friend requests and friends.',
                'Technical: IP address (security, usage limits, legal obligations) and strictly necessary cookies.',
              ],
            },
            {
              h: 'Purposes and legal bases',
              ul: [
                'Providing the game and your account: performance of the terms of use.',
                'Security, fighting abuse and cheating: legitimate interest.',
                'Moderation and retention of connection data: legal obligations (EU Digital Services Act, French LCEN).',
                'Service emails (confirmation, password, moderation decisions): performance of the terms of use.',
              ],
            },
            {
              h: 'Recipients and processors',
              ul: [
                'The site host (see the legal notice) and the email delivery provider.',
                'Covers: images are loaded by your browser from Deezer’s servers, which then receive your IP address.',
                'Embedded player: the Deezer player only loads when you ask for it; it may then set its own cookies.',
                'Fonts: loaded from Google Fonts (your IP address is sent to Google) until we host them ourselves.',
              ],
            },
            {
              h: 'Your rights',
              p: [
                'You can access, correct and erase your data, object to a processing or ask for it to be restricted. “Export my data” (Settings) gives you a full copy as JSON; “Delete my account” erases your account and your content.',
                'You can also lodge a complaint with the French data protection authority, the CNIL (cnil.fr).',
              ],
            },
            {
              h: 'Security',
              p: ['Hashed passwords (scrypt), HttpOnly session cookies, encrypted connections (HTTPS) in production, administration access reserved for the owner of the game.'],
            },
          ],
        },
        rules: {
          title: 'Community rules',
          short: 'Rules',
          intro: 'AlbumMania is a place to talk about music. These rules apply to your username, profile picture, ratings, reviews and everything you post.',
          sections: [
            {
              h: 'Respect others',
              p: ['Criticise works, not people. No insults, harassment, threats, hateful or discriminatory speech.'],
            },
            {
              h: 'Nothing illegal',
              p: ['No incitement to violence, no glorification of crimes, no sexual content involving minors, no personal information about others.'],
            },
            {
              h: 'Respect the artists',
              p: ['No full song lyrics and no links to illegal copies. Short quotes to illustrate a review are welcome.'],
            },
            {
              h: 'No spam',
              p: ['No advertising and no repeated messages. Only links to well-known music sites are kept (Deezer, Spotify, Apple Music, YouTube, Bandcamp, MusicBrainz, Wikipedia); accounts created less than 24 hours ago or below level 3 cannot post links.'],
            },
            {
              h: 'Play fair',
              p: ['One account per person. No impersonation (artist, label, platform, AlbumMania team), no automation, no exploiting bugs or multiple accounts to get packs or royalties.'],
            },
            {
              h: 'Reports and sanctions',
              p: [
                'Every piece of content has a “Report” button; the report form is also open without an account. A decision (hiding, removal, warning, suspension) comes with its reasons, is notified, and can be appealed.',
                'Three confirmed breaches within 90 days may lead to a suspension. A threat to someone’s life or safety is reported to the authorities.',
              ],
            },
          ],
        },
        cookies: {
          title: 'Cookies',
          short: 'Cookies',
          intro: 'AlbumMania only uses cookies that are strictly necessary for it to work: no advertising cookie, no audience measurement. So there is nothing to accept.',
          tableHead: ['Name', 'Purpose', 'Duration'],
          table: [
            ['albummania_sid', 'Keep you logged in (HttpOnly, out of reach of scripts)', '30 days'],
            ['albummania_signup', 'Confirm your address from the browser you signed up with, without typing your password again', '24 hours'],
          ],
          sections: [
            {
              h: 'Storage on your device',
              p: ['Language, sound, the rating scale shown and the “Always load” choice for the Deezer player are kept in your browser’s local storage. They never leave your device.'],
            },
            {
              h: 'Third-party services',
              p: [
                'The Deezer player only loads when you click “Load the player” (or if you chose “Always load”); it may then set its own cookies, governed by Deezer’s policy. You can change this choice in Settings, under “Embedded players”.',
                'Covers and fonts are loaded from Deezer’s and Google’s servers, without any cookie set by AlbumMania.',
              ],
            },
          ],
        },
      },
    },
  },
};
