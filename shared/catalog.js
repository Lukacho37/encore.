// Catalogue musical du jeu.
// On ne stocke que des métadonnées (titres, artistes, années, ordre des pistes).
// Les visuels des pochettes sont générés par le jeu (voir client/src/components/CoverArt.jsx) :
// aucune pochette officielle n'est reproduite.
//
// Chaque piste porte un INDICE DE POPULARITÉ de 0 à 100 (estimé d'après les écoutes, les classements et la notoriété).
// La rareté en découle automatiquement (voir POP_TIERS) :
//   ⚪ commune ≤ 34 · 🟢 peu commune 35-54 · 🔵 rare 55-69 · 🟣 super rare 70-81 · 🟠 ultra rare 82-91 · ⭐ légendaire ≥ 92
// Les singles hors album sont des PROMOS 🟥 (rareté à part, voir PROMOS plus bas), quel que soit leur indice.

import { POP_TIERS } from './rules.js';

export const GENRES = ['rap', 'pop', 'rock', 'electro', 'soul', 'jazz', 'reggae', 'chanson'];

export const ARTISTS = [
  { id: 'daft-punk', name: 'Daft Punk', country: 'FR', genre: 'electro' },
  { id: 'air', name: 'Air', country: 'FR', genre: 'electro' },
  { id: 'kanye-west', name: 'Kanye West', country: 'US', genre: 'rap' },
  { id: 'eminem', name: 'Eminem', country: 'US', genre: 'rap' },
  { id: 'kendrick-lamar', name: 'Kendrick Lamar', country: 'US', genre: 'rap' },
  { id: 'michael-jackson', name: 'Michael Jackson', country: 'US', genre: 'pop' },
  { id: 'adele', name: 'Adele', country: 'GB', genre: 'pop' },
  { id: 'billie-eilish', name: 'Billie Eilish', country: 'US', genre: 'pop' },
  { id: 'stromae', name: 'Stromae', country: 'BE', genre: 'pop' },
  { id: 'queen', name: 'Queen', country: 'GB', genre: 'rock' },
  { id: 'the-beatles', name: 'The Beatles', country: 'GB', genre: 'rock' },
  { id: 'nirvana', name: 'Nirvana', country: 'US', genre: 'rock' },
  { id: 'pink-floyd', name: 'Pink Floyd', country: 'GB', genre: 'rock' },
  { id: 'amy-winehouse', name: 'Amy Winehouse', country: 'GB', genre: 'soul' },
  { id: 'miles-davis', name: 'Miles Davis', country: 'US', genre: 'jazz' },
  { id: 'bob-marley', name: 'Bob Marley & The Wailers', country: 'JM', genre: 'reggae' },
  { id: 'serge-gainsbourg', name: 'Serge Gainsbourg', country: 'FR', genre: 'chanson' },
];

// Chaque piste : [titre, indice de popularité, featuring?]
export const ALBUMS = [
  {
    id: 'discovery', artist: 'daft-punk', title: 'Discovery', year: 2001, genre: 'electro',
    art: { palette: ['#0b1030', '#4fc3ff', '#f1e9ff'], motif: 'bars' },
    tracks: [
      ['One More Time', 100],
      ['Aerodynamic', 94],
      ['Digital Love', 96],
      ['Harder, Better, Faster, Stronger', 98],
      ['Crescendolls', 79],
      ['Nightvision', 75],
      ['Superheroes', 81],
      ['High Life', 79],
      ['Something About Us', 96],
      ['Voyager', 84],
      ['Veridis Quo', 86],
      ['Short Circuit', 58],
      ['Face to Face', 88],
      ['Too Long', 56],
    ],
  },
  {
    id: 'random-access-memories', artist: 'daft-punk', title: 'Random Access Memories', year: 2013, genre: 'electro',
    art: { palette: ['#0c0b09', '#d8b26a', '#f6eedb'], motif: 'rings' },
    tracks: [
      ['Give Life Back to Music', 94],
      ['The Game of Love', 86],
      ['Giorgio by Moroder', 96],
      ['Within', 61],
      ['Instant Crush', 99, 'Julian Casablancas'],
      ['Lose Yourself to Dance', 98, 'Pharrell Williams'],
      ['Touch', 87, 'Paul Williams'],
      ['Get Lucky', 100, 'Pharrell Williams & Nile Rodgers'],
      ['Beyond', 60],
      ['Motherboard', 59],
      ['Fragments of Time', 87, 'Todd Edwards'],
      ["Doin' It Right", 95, 'Panda Bear'],
      ['Contact', 85],
    ],
  },
  {
    id: 'moon-safari', artist: 'air', title: 'Moon Safari', year: 1998, genre: 'electro',
    art: { palette: ['#f7d9e3', '#7fb7e6', '#2b3a67'], motif: 'sun' },
    tracks: [
      ["La Femme d'Argent", 63],
      ['Sexy Boy', 93],
      ['All I Need', 91, 'Beth Hirsch'],
      ['Kelly Watch the Stars', 84],
      ['Talisman', 58],
      ['Remember', 60],
      ['You Make It Easy', 61, 'Beth Hirsch'],
      ['Ce matin-là', 53],
      ['New Star in the Sky (Chanson pour Solal)', 40],
      ['Le Voyage de Pénélope', 36],
    ],
  },
  {
    id: 'the-college-dropout', artist: 'kanye-west', title: 'The College Dropout', year: 2004, genre: 'rap',
    art: { palette: ['#3a2315', '#d1934f', '#f3e3c3'], motif: 'grid' },
    tracks: [
      ['Intro', 59],
      ["We Don't Care", 64],
      ['Graduation Day', 62],
      ['All Falls Down', 99, 'Syleena Johnson'],
      ["I'll Fly Away", 61],
      ['Spaceship', 93, 'GLC & Consequence'],
      ['Jesus Walks', 99],
      ['Never Let Me Down', 91, 'Jay-Z & J. Ivy'],
      ['Get Em High', 63, 'Talib Kweli & Common'],
      ['Workout Plan', 60],
      ['The New Workout Plan', 89],
      ['Slow Jamz', 98, 'Twista & Jamie Foxx'],
      ['Breathe In Breathe Out', 63, 'Ludacris'],
      ['School Spirit (Skit 1)', 58],
      ['School Spirit', 63],
      ['School Spirit (Skit 2)', 58],
      ['Lil Jimmy (Skit)', 59],
      ['Two Words', 88, 'Mos Def, Freeway & The Boys Choir of Harlem'],
      ['Through the Wire', 99],
      ['Family Business', 64],
      ['Last Call', 62],
    ],
  },
  {
    id: 'graduation', artist: 'kanye-west', title: 'Graduation', year: 2007, genre: 'rap',
    art: { palette: ['#2b0f3f', '#ff5ea3', '#ffd64f'], motif: 'shards' },
    tracks: [
      ['Good Morning', 90],
      ['Champion', 88],
      ['Stronger', 100],
      ['I Wonder', 95],
      ['Good Life', 98, 'T-Pain'],
      ["Can't Tell Me Nothing", 95],
      ['Barry Bonds', 60, 'Lil Wayne'],
      ['Drunk and Hot Girls', 78, 'Mos Def'],
      ['Flashing Lights', 99, 'Dwele'],
      ['Everything I Am', 62],
      ['The Glory', 61],
      ['Homecoming', 94, 'Chris Martin'],
      ['Big Brother', 80],
    ],
  },
  {
    id: 'the-marshall-mathers-lp', artist: 'eminem', title: 'The Marshall Mathers LP', year: 2000, genre: 'rap',
    art: { palette: ['#101722', '#50648a', '#dde1e7'], motif: 'split' },
    tracks: [
      ['Public Service Announcement 2000', 60],
      ['Kill You', 97],
      ['Stan', 100, 'Dido'],
      ['Paul (Skit)', 58],
      ['Who Knew', 63],
      ['Steve Berman', 60],
      ['The Way I Am', 99],
      ['The Real Slim Shady', 100],
      ['Remember Me?', 61, 'RBX & Sticky Fingaz'],
      ["I'm Back", 64],
      ['Marshall Mathers', 62],
      ['Ken Kaniff (Skit)', 58],
      ['Drug Ballad', 64],
      ['Amityville', 62, 'Bizarre'],
      ['B**** Please II', 63, 'Dr. Dre, Snoop Dogg, Xzibit & Nate Dogg'],
      ['Kim', 94],
      ['Under the Influence', 87, 'D12'],
      ['Criminal', 64],
    ],
  },
  {
    id: 'the-eminem-show', artist: 'eminem', title: 'The Eminem Show', year: 2002, genre: 'rap',
    art: { palette: ['#1b0b0d', '#b8222d', '#f2dba8'], motif: 'curtain' },
    tracks: [
      ['Curtains Up (Skit)', 61],
      ['White America', 96],
      ['Business', 97],
      ["Cleanin' Out My Closet", 99],
      ['Square Dance', 64],
      ['The Kiss (Skit)', 61],
      ['Soldier', 64],
      ['Say Goodbye Hollywood', 63],
      ['Drips', 62, 'Obie Trice'],
      ['Without Me', 100],
      ['Paul Rosenberg (Skit)', 59],
      ['Sing for the Moment', 98],
      ['Superman', 99, 'Dina Rae'],
      ["Hailie's Song", 63],
      ['Steve Berman (Skit)', 59],
      ['When the Music Stops', 62, 'D12'],
      ['Say What You Say', 63, 'Dr. Dre'],
      ["'Till I Collapse", 99, 'Nate Dogg'],
      ["My Dad's Gone Crazy", 63, 'Hailie Jade'],
      ['Curtains Close (Skit)', 59],
    ],
  },
  {
    id: 'good-kid-maad-city', artist: 'kendrick-lamar', title: 'good kid, m.A.A.d city', year: 2012, genre: 'rap',
    art: { palette: ['#201b15', '#c9b48a', '#6f9475'], motif: 'halftone' },
    tracks: [
      ["Sherane a.k.a Master Splinter's Daughter", 83],
      ["B****, Don't Kill My Vibe", 65],
      ['Backseat Freestyle', 90],
      ['The Art of Peer Pressure', 62],
      ['Money Trees', 99, 'Jay Rock'],
      ['Poetic Justice', 95, 'Drake'],
      ['good kid', 84],
      ['m.A.A.d city', 93, 'MC Eiht'],
      ['Swimming Pools (Drank)', 98],
      ["Sing About Me, I'm Dying of Thirst", 88],
      ['Real', 58, 'Anna Wise'],
      ['Compton', 59, 'Dr. Dre'],
    ],
  },
  {
    id: 'thriller', artist: 'michael-jackson', title: 'Thriller', year: 1982, genre: 'pop',
    art: { palette: ['#f3eee8', '#6b2b8f', '#d8a33f'], motif: 'spotlight' },
    tracks: [
      ["Wanna Be Startin' Somethin'", 96],
      ['Baby Be Mine', 85],
      ['The Girl Is Mine', 89, 'Paul McCartney'],
      ['Thriller', 98],
      ['Beat It', 99],
      ['Billie Jean', 99],
      ['Human Nature', 94],
      ['P.Y.T. (Pretty Young Thing)', 92],
      ['The Lady in My Life', 87],
    ],
  },
  {
    id: '21', artist: 'adele', title: '21', year: 2011, genre: 'pop',
    art: { palette: ['#2a2320', '#a98a6b', '#efe2cf'], motif: 'waves' },
    tracks: [
      ['Rolling in the Deep', 100],
      ['Rumour Has It', 97],
      ['Turning Tables', 95],
      ["Don't You Remember", 82],
      ['Set Fire to the Rain', 98],
      ["He Won't Go", 60],
      ['Take It All', 59],
      ["I'll Be Waiting", 56],
      ['One and Only', 62],
      ['Lovesong', 92],
      ['Someone Like You', 99],
    ],
  },
  {
    id: 'when-we-all-fall-asleep', artist: 'billie-eilish', title: 'When We All Fall Asleep, Where Do We Go?', year: 2019, genre: 'pop',
    art: { palette: ['#0b0b0c', '#a7e33a', '#e9e9e6'], motif: 'dots' },
    tracks: [
      ['!!!!!!!', 59],
      ['bad guy', 100],
      ['xanny', 88],
      ['you should see me in a crown', 97],
      ['all the good girls go to hell', 96],
      ['wish you were gay', 98],
      ["when the party's over", 99],
      ['8', 86],
      ['my strange addiction', 89],
      ['bury a friend', 99],
      ['ilomilo', 93],
      ['listen before i go', 89],
      ['i love you', 94],
      ['goodbye', 84],
    ],
  },
  {
    id: 'racine-carree', artist: 'stromae', title: 'Racine carrée', year: 2013, genre: 'pop',
    art: { palette: ['#111519', '#ebebeb', '#3f6cff'], motif: 'grid' },
    tracks: [
      ['Ta fête', 84],
      ['Papaoutai', 94],
      ['Bâtard', 67],
      ['Ave Cesaria', 72],
      ['Tous les mêmes', 89],
      ['Formidable', 91],
      ['Moules frites', 66],
      ['Carmen', 87],
      ["Humain à l'eau", 67],
      ["Quand c'est ?", 83],
      ['Sommeil', 35],
      ['Merci', 32],
      ['AVF', 68, 'Maître Gims & Orelsan'],
    ],
  },
  {
    id: 'a-night-at-the-opera', artist: 'queen', title: 'A Night at the Opera', year: 1975, genre: 'rock',
    art: { palette: ['#f4efe4', '#b8942d', '#1e1b2b'], motif: 'diamond' },
    tracks: [
      ['Death on Two Legs (Dedicated to...)', 90],
      ['Lazing on a Sunday Afternoon', 84],
      ["I'm in Love with My Car", 93],
      ["You're My Best Friend", 95],
      ["'39", 91],
      ['Sweet Lady', 84],
      ['Seaside Rendezvous', 80],
      ["The Prophet's Song", 88],
      ['Love of My Life', 96],
      ['Good Company', 80],
      ['Bohemian Rhapsody', 98],
      ['God Save the Queen', 78],
    ],
  },
  {
    id: 'abbey-road', artist: 'the-beatles', title: 'Abbey Road', year: 1969, genre: 'rock',
    art: { palette: ['#1c2b3b', '#ececea', '#7da672'], motif: 'stripes' },
    tracks: [
      ['Come Together', 100],
      ['Something', 99],
      ["Maxwell's Silver Hammer", 94],
      ['Oh! Darling', 98],
      ["Octopus's Garden", 99],
      ["I Want You (She's So Heavy)", 96],
      ['Here Comes the Sun', 100],
      ['Because', 93],
      ['You Never Give Me Your Money', 91],
      ['Sun King', 88],
      ['Mean Mr. Mustard', 86],
      ['Polythene Pam', 86],
      ['She Came In Through the Bathroom Window', 90],
      ['Golden Slumbers', 97],
      ['Carry That Weight', 89],
      ['The End', 95],
      ['Her Majesty', 85],
    ],
  },
  {
    id: 'nevermind', artist: 'nirvana', title: 'Nevermind', year: 1991, genre: 'rock',
    art: { palette: ['#093b6c', '#3aa6e3', '#eaf6ff'], motif: 'waves' },
    tracks: [
      ['Smells Like Teen Spirit', 100],
      ['In Bloom', 96],
      ['Come as You Are', 100],
      ['Breed', 90],
      ['Lithium', 99],
      ['Polly', 95],
      ['Territorial Pissings', 86],
      ['Drain You', 90],
      ['Lounge Act', 84],
      ['Stay Away', 82],
      ['On a Plain', 87],
      ['Something in the Way', 97],
    ],
  },
  {
    id: 'the-dark-side-of-the-moon', artist: 'pink-floyd', title: 'The Dark Side of the Moon', year: 1973, genre: 'rock',
    art: { palette: ['#060607', '#ea4c3d', '#f7d23a'], motif: 'orbit' },
    tracks: [
      ['Speak to Me', 84],
      ['Breathe (In the Air)', 98],
      ['On the Run', 86],
      ['Time', 99],
      ['The Great Gig in the Sky', 97],
      ['Money', 100],
      ['Us and Them', 95],
      ['Any Colour You Like', 88],
      ['Brain Damage', 93],
      ['Eclipse', 90],
    ],
  },
  {
    id: 'back-to-black', artist: 'amy-winehouse', title: 'Back to Black', year: 2006, genre: 'soul',
    art: { palette: ['#1b0d13', '#e9c27b', '#f6e9df'], motif: 'spotlight' },
    tracks: [
      ['Rehab', 100],
      ["You Know I'm No Good", 97],
      ['Me & Mr Jones', 62],
      ['Just Friends', 83],
      ['Back to Black', 99],
      ['Love Is a Losing Game', 92],
      ['Tears Dry on Their Own', 95],
      ['Wake Up Alone', 61],
      ['Some Unholy War', 59],
      ['He Can Only Hold Her', 57],
      ['Addicted', 55],
    ],
  },
  {
    id: 'kind-of-blue', artist: 'miles-davis', title: 'Kind of Blue', year: 1959, genre: 'jazz',
    art: { palette: ['#0d1c3d', '#2f6fd0', '#e9eef8'], motif: 'arcs' },
    tracks: [
      ['So What', 91],
      ['Freddie Freeloader', 77],
      ['Blue in Green', 87],
      ['All Blues', 80],
      ['Flamenco Sketches', 73],
    ],
  },
  {
    id: 'exodus', artist: 'bob-marley', title: 'Exodus', year: 1977, genre: 'reggae',
    art: { palette: ['#1d1408', '#e2b23a', '#c8332b'], motif: 'burst' },
    tracks: [
      ['Natural Mystic', 59],
      ['So Much Things to Say', 43],
      ['Guiltiness', 34],
      ['The Heathen', 34],
      ['Exodus', 85],
      ['Jamming', 63],
      ['Waiting in Vain', 84],
      ['Turn Your Lights Down Low', 73],
      ['Three Little Birds', 96],
      ['One Love / People Get Ready', 64],
    ],
  },
  {
    id: 'histoire-de-melody-nelson', artist: 'serge-gainsbourg', title: 'Histoire de Melody Nelson', year: 1971, genre: 'chanson',
    art: { palette: ['#efe4d2', '#b5452b', '#2a1a14'], motif: 'checker' },
    tracks: [
      ['Melody', 60],
      ['Ballade de Melody Nelson', 61],
      ['Valse de Melody', 34],
      ['Ah ! Melody', 31],
      ["L'Hôtel particulier", 57],
      ['En Melody', 27],
      ['Cargo culte', 41],
    ],
  },
];

// Cartes PROMO : morceaux qui ne figurent sur aucun album studio de l'artiste.
// kind : soundtrack (bande originale) · single (single hors album) · collab · charity (single caritatif)
export const PROMOS = [
  { id: 'lose-yourself', artist: 'eminem', title: 'Lose Yourself', pop: 98, year: 2002, genre: 'rap', kind: 'soundtrack', context: '8 Mile', art: { palette: ['#141414', '#e8e8e8', '#c9a227'], motif: 'spotlight' } },
  { id: 'not-like-us', artist: 'kendrick-lamar', title: 'Not Like Us', pop: 95, year: 2024, genre: 'rap', kind: 'single', art: { palette: ['#f2f2ee', '#1c1c1c', '#d23a2f'], motif: 'split' } },
  { id: 'ye-vs-the-people', artist: 'kanye-west', title: 'Ye vs. the People', pop: 28, feat: 'T.I.', year: 2018, genre: 'rap', kind: 'single', art: { palette: ['#e7e3d8', '#2d2a24', '#7a8b3a'], motif: 'stripes' } },
  { id: 'skyfall', artist: 'adele', title: 'Skyfall', pop: 88, year: 2012, genre: 'pop', kind: 'soundtrack', context: 'Skyfall', art: { palette: ['#0e0e12', '#c9b37e', '#6d7a8c'], motif: 'rings' } },
  { id: 'no-time-to-die', artist: 'billie-eilish', title: 'No Time to Die', pop: 76, year: 2020, genre: 'pop', kind: 'soundtrack', context: 'Mourir peut attendre', art: { palette: ['#070708', '#d6d0c4', '#9b2c2c'], motif: 'orbit' } },
  { id: 'we-are-the-world', artist: 'michael-jackson', title: 'We Are the World', pop: 90, year: 1985, genre: 'pop', kind: 'charity', context: 'USA for Africa', art: { palette: ['#f6efe0', '#2e5aa7', '#e0a43a'], motif: 'burst' } },
  { id: 'hey-jude', artist: 'the-beatles', title: 'Hey Jude', pop: 97, year: 1968, genre: 'rock', kind: 'single', art: { palette: ['#edf2e8', '#2f7d4f', '#e3a02b'], motif: 'dots' } },
  { id: 'thank-god-its-christmas', artist: 'queen', title: "Thank God It's Christmas", pop: 50, year: 1984, genre: 'rock', kind: 'single', art: { palette: ['#0f2a1d', '#d9443a', '#f3ead6'], motif: 'diamond' } },
  { id: 'sliver', artist: 'nirvana', title: 'Sliver', pop: 52, year: 1990, genre: 'rock', kind: 'single', art: { palette: ['#2a1f12', '#e46f2e', '#f1e3c8'], motif: 'halftone' } },
  { id: 'arnold-layne', artist: 'pink-floyd', title: 'Arnold Layne', pop: 45, year: 1967, genre: 'rock', kind: 'single', art: { palette: ['#2a1442', '#f08ac0', '#f7e96b'], motif: 'arcs' } },
  { id: 'valerie', artist: 'amy-winehouse', title: 'Valerie', pop: 87, year: 2007, genre: 'soul', kind: 'collab', context: 'Mark Ronson', art: { palette: ['#1e1a2e', '#ff8fa3', '#f5e6c8'], motif: 'waves' } },
  { id: 'derezzed', artist: 'daft-punk', title: 'Derezzed', pop: 72, year: 2010, genre: 'electro', kind: 'soundtrack', context: 'TRON : L’Héritage', art: { palette: ['#03070c', '#35e1ff', '#ff9a2e'], motif: 'grid' } },
  { id: 'playground-love', artist: 'air', title: 'Playground Love', feat: 'Gordon Tracks', pop: 78, year: 2000, genre: 'electro', kind: 'soundtrack', context: 'Virgin Suicides', art: { palette: ['#f3dfe6', '#c25a7c', '#3b2b4f'], motif: 'sun' } },
  { id: 'iron-lion-zion', artist: 'bob-marley', title: 'Iron Lion Zion', pop: 74, year: 1992, genre: 'reggae', kind: 'single', art: { palette: ['#13240f', '#e9c13b', '#cf3a2c'], motif: 'bars' } },
];

/** Seuils de popularité de chaque rareté (du plus rare au plus commun). */
// Seuils de popularité de chaque rareté : définis une fois dans shared/rules.js (publiés par le guide des raretés).
export { POP_TIERS };

export function rarityFromPop(pop) {
  return POP_TIERS.find((tier) => pop >= tier.min).rarity;
}

// Dictionnaires sans prototype : un identifiant comme « constructor » ou « __proto__ » n'y existe jamais.
const dict = (entries = []) => Object.assign(Object.create(null), Object.fromEntries(entries));

export const ARTIST_BY_ID = dict(ARTISTS.map((a) => [a.id, a]));
export const ALBUM_BY_ID = dict(ALBUMS.map((a, i) => [a.id, { ...a, catalog: i + 1 }]));

const pad = (n) => String(n).padStart(2, '0');

/** Toutes les cartes du jeu, dans l'ordre du catalogue. */
export const TRACKS = [];
for (const album of ALBUMS) {
  album.tracks.forEach(([title, pop, feat], i) => {
    TRACKS.push({
      id: `${album.id}:${pad(i + 1)}`,
      kind: 'album',
      title,
      feat: feat || null,
      pop,
      rarity: rarityFromPop(pop),
      albumId: album.id,
      artistId: album.artist,
      n: i + 1,
      total: album.tracks.length,
      year: album.year,
      genre: album.genre,
    });
  });
}
PROMOS.forEach((p, i) => {
  TRACKS.push({
    id: `promo:${p.id}`,
    kind: 'promo',
    title: p.title,
    feat: p.feat || null,
    rarity: 'promo',
    pop: p.pop,
    albumId: null,
    promoId: p.id,
    artistId: p.artist,
    n: i + 1,
    total: PROMOS.length,
    year: p.year,
    genre: p.genre,
    promoKind: p.kind,
    context: p.context || null,
    art: p.art,
  });
});

export const TRACK_BY_ID = dict(TRACKS.map((t) => [t.id, t]));

export const TRACKS_BY_ALBUM = dict();
for (const t of TRACKS) if (t.albumId) (TRACKS_BY_ALBUM[t.albumId] ||= []).push(t);

export const PROMO_TRACKS = TRACKS.filter((t) => t.kind === 'promo');

export const ALBUMS_BY_ARTIST = dict();
for (const a of ALBUMS) (ALBUMS_BY_ARTIST[a.artist] ||= []).push(a);

/** Cartes nécessaires pour maîtriser un artiste : tous ses albums + ses promos. */
export const TRACKS_BY_ARTIST = dict();
for (const t of TRACKS) (TRACKS_BY_ARTIST[t.artistId] ||= []).push(t);

export function decadeOf(year) {
  return Math.floor(year / 10) * 10;
}

export const DECADES = [...new Set(TRACKS.map((t) => decadeOf(t.year)))].sort((a, b) => a - b);
export const COUNTRIES = [...new Set(ARTISTS.map((a) => a.country))];

/** Visuel associé à une carte : pochette de l'album ou visuel propre à la promo. */
export function artFor(track) {
  if (track.kind === 'promo') return { ...track.art, seed: track.id };
  const album = ALBUM_BY_ID[track.albumId];
  // Album du grand catalogue de la démo : un seul objet partagé par ses morceaux (des centaines de milliers de cartes).
  return album.artView || { ...album.art, seed: album.id };
}

/** Code catalogue façon maison de disques : AM-001, AM-P03… */
export function catalogCode(track) {
  if (track.kind === 'promo') return `AM-P${pad(track.n)}`;
  return `AM-${String(ALBUM_BY_ID[track.albumId].catalog).padStart(3, '0')}`;
}

// ---------- grand catalogue de la démo ----------

/** Version du catalogue : change quand extendCatalog ajoute des albums (caches de shared/staticCatalog.js). */
export let CATALOG_VERSION = 0;

/**
 * Ajoute le grand catalogue (albums importés, scripts/demo-catalog.mjs) aux tables ci-dessus, dans le navigateur de la
 * démo seulement (client/src/demo/bigCatalog.js). Les albums importés gardent leur visuel généré ; leur rareté découle
 * de l'indice (POP_TIERS). Renvoie le nombre d'albums ajoutés.
 */
export function extendCatalog(data, { artOf } = {}) {
  if (!data || data.v !== 1 || !Array.isArray(data.albums)) return 0;
  const artists = (data.artists || []).map(([id, name, genre, country]) => ({ id, name, genre, country: country || null }));
  for (const a of artists) {
    if (ARTIST_BY_ID[a.id]) continue;
    ARTISTS.push(a);
    ARTIST_BY_ID[a.id] = a;
  }
  let catalog = ALBUMS.length;
  let added = 0;
  // Vraies pochettes en planches (scripts/demo-sprites.mjs) : case de l'album dans la planche, découpée à l'affichage.
  const sheet = data.sprites && Number(data.sprites.cols) > 0 ? data.sprites : null;
  const spriteOf = (cell) => {
    if (!sheet || !Number.isInteger(cell) || cell < 0) return null;
    const per = sheet.cols * sheet.cols;
    const k = cell % per;
    return { src: `${sheet.prefix}${Math.floor(cell / per)}.jpg`, x: k % sheet.cols, y: Math.floor(k / sheet.cols), cols: sheet.cols };
  };
  for (const [id, artistIdx, title, year, genre, titles, pops, cell] of data.albums) {
    const artist = artists[artistIdx];
    if (!artist || ALBUM_BY_ID[id]) continue;
    const names = String(titles).split('\u001f');
    const sprite = spriteOf(cell);
    const art = { ...(artOf ? artOf(id) : { palette: ['#1b1623', '#ef3b3b', '#ffd35a'], motif: 'bars' }), ...(sprite && { sprite }) };
    const album = { id, artist: artist.id, title, year: year || null, genre, art, artView: { ...art, seed: id }, imported: true };
    catalog += 1;
    added += 1;
    ALBUMS.push(album);
    ALBUM_BY_ID[id] = { ...album, catalog };
    const list = (TRACKS_BY_ALBUM[id] = []);
    names.forEach((name, i) => {
      const pop = Number(pops[i]) || 0;
      const t = {
        id: `${id}:${pad(i + 1)}`, kind: 'album', title: name, feat: null, pop, rarity: rarityFromPop(pop),
        albumId: id, artistId: artist.id, n: i + 1, total: names.length, year: year || null, genre,
      };
      TRACKS.push(t);
      TRACK_BY_ID[t.id] = t;
      list.push(t);
      (TRACKS_BY_ARTIST[artist.id] ||= []).push(t);
    });
    (ALBUMS_BY_ARTIST[artist.id] ||= []).push(album);
  }
  (data.promos || []).forEach(([id, artistIdx, title, pop, year, genre], i) => {
    const artist = artists[artistIdx];
    if (!artist || TRACK_BY_ID[id]) return;
    const art = artOf ? artOf(id) : { palette: ['#1b1623', '#ef3b3b', '#ffd35a'], motif: 'bars' };
    const t = {
      id, kind: 'promo', title, feat: null, rarity: 'promo', pop: Number(pop) || 0, albumId: null, promoId: id, artistId: artist.id,
      n: PROMOS.length + i + 1, total: PROMOS.length + data.promos.length, year: year || null, genre, promoKind: 'single', context: null, art,
    };
    TRACKS.push(t);
    TRACK_BY_ID[id] = t;
    PROMO_TRACKS.push(t);
    (TRACKS_BY_ARTIST[artist.id] ||= []).push(t);
  });
  for (const d of new Set(TRACKS.filter((t) => t.year).map((t) => decadeOf(t.year)))) if (!DECADES.includes(d)) DECADES.push(d);
  DECADES.sort((a, b) => a - b);
  CATALOG_VERSION += 1;
  return added;
}
