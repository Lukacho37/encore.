// Textes de la zone « shell » (P0-D) : coque du site : barres de navigation, paramètres, page introuvable. Fusionnés
// dans fr.js / en.js au chargement (i18n/index.jsx) ; une clé d'ici peut aussi préciser une clé existante. Chaque clé
// existe en FR et en EN (tutoiement, espace fine insécable avant ; : ! ? % et dans « »). Squelette posé par K0
// (scripts/scaffold.mjs), avec la page introuvable minimale et les codes d'erreur communs des squelettes.
export default {
  fr: {
    shell: {
      notFound: {
        title: 'Cette face n’existe pas',
        body: 'Ce lien ne mène nulle part : la page a peut-être changé d’adresse.',
        back: 'Retour aux boosters',
      },
    },
    errors: {
      not_ready: 'Cette fonction arrive bientôt.',
      invalid_input: 'Une des valeurs envoyées n’est pas valide.',
    },
  },
  en: {
    shell: {
      notFound: {
        title: 'This side doesn’t exist',
        body: 'This link leads nowhere: the page may have moved.',
        back: 'Back to packs',
      },
    },
    errors: {
      not_ready: 'This feature is coming soon.',
      invalid_input: 'One of the values you sent is not valid.',
    },
  },
};
