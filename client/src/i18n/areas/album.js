// Textes de la zone « album » (P0-C) : catalogue à grande échelle, booster d'album, page artiste. Fusionnés dans
// fr.js / en.js au chargement ; une clé d'ici peut préciser une clé existante (album.rewardBody : l'avatar débloqué est
// le visuel AlbumMania de l'album, jamais sa vraie pochette, PLAN.md 7.1).
const NNBSP = '\u202f';

export default {
  fr: {
    album: {
      rewardBody: '+{r} royalties, +{x} XP, le vinyle dans ta vinylthèque et le visuel AlbumMania de l’album en photo de profil.',
      loading: 'Chargement de l’album…',
      notFound: 'Album introuvable',
      notFoundBody: 'Cet album n’existe pas ou n’est plus au catalogue.',
      loadError: 'Impossible de charger cet album',
      tracksError: 'Impossible de charger les cartes de cet album pour le moment.',
      retry: 'Réessayer',
      pressFreeShort: 'Gratuit',
      booster: {
        title: 'Booster d’album',
        body: '5 cartes de cet album, celles qui te manquent d’abord — {price} royalties.',
        bodyFree: '5 cartes de cet album, celles qui te manquent d’abord — gratuit et illimité pour l’admin.',
        open: 'Ouvrir le booster',
        missing: `Il te manque {n} royalties${NNBSP}: chaque nouvelle carte t’en rapporte, et recycler tes doublons aussi.`,
        complete: `Album complet${NNBSP}: tu as déjà toutes ses cartes.`,
        completeAdmin: `Album complet${NNBSP}: en admin, tu peux quand même en ouvrir pour tester.`,
      },
    },
    artist: {
      loading: 'Chargement de l’artiste…',
      notFound: 'Artiste introuvable',
      notFoundBody: 'Cet artiste n’existe pas ou n’est plus au catalogue.',
      loadError: 'Impossible de charger cet artiste',
      counts: '{albums} · {tracks}',
      albums: { one: '{n} album', other: '{n} albums' },
      cards: { one: '{n} carte', other: '{n} cartes' },
      more: { one: 'Voir plus ({n} restant)', other: 'Voir plus ({n} restants)' },
      noAlbums: 'Aucun album de cet artiste au catalogue pour l’instant.',
    },
    vinyl: {
      sidesError: 'Impossible de charger la liste des morceaux.',
    },
  },
  en: {
    album: {
      rewardBody: '+{r} royalties, +{x} XP, the vinyl on your shelf and the album’s AlbumMania artwork as your profile picture.',
      loading: 'Loading album…',
      notFound: 'Album not found',
      notFoundBody: 'This album doesn’t exist or is no longer in the catalog.',
      loadError: 'Couldn’t load this album',
      tracksError: 'Couldn’t load this album’s cards right now.',
      retry: 'Try again',
      pressFreeShort: 'Free',
      booster: {
        title: 'Album pack',
        body: '5 cards from this album, missing ones first — {price} royalties.',
        bodyFree: '5 cards from this album, missing ones first — free and unlimited for the admin.',
        open: 'Open the pack',
        missing: 'You need {n} more royalties: every new card earns some, and so does recycling your duplicates.',
        complete: 'Album complete: you already have all its cards.',
        completeAdmin: 'Album complete: as admin, you can still open some for testing.',
      },
    },
    artist: {
      loading: 'Loading artist…',
      notFound: 'Artist not found',
      notFoundBody: 'This artist doesn’t exist or is no longer in the catalog.',
      loadError: 'Couldn’t load this artist',
      counts: '{albums} · {tracks}',
      albums: { one: '{n} album', other: '{n} albums' },
      cards: { one: '{n} card', other: '{n} cards' },
      more: { one: 'Load more ({n} left)', other: 'Load more ({n} left)' },
      noAlbums: 'No album by this artist in the catalog yet.',
    },
    vinyl: {
      sidesError: 'Couldn’t load the track list.',
    },
  },
};
