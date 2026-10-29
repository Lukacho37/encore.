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
      ['One More Time', 62],
      ['Aerodynamic', 46],
      ['Digital Love', 52],
      ['Harder, Better, Faster, Stronger', 58],
      ['Crescendolls', 33],
      ['Nightvision', 28],
      ['Superheroes', 38],
      ['High Life', 33],
      ['Something About Us', 55],
      ['Voyager', 42],
      ['Veridis Quo', 45],
      ['Short Circuit', 32],
      ['Face to Face', 42],
      ['Too Long', 30],
    ],
  },
  {
    id: 'random-access-memories', artist: 'daft-punk', title: 'Random Access Memories', year: 2013, genre: 'electro',
    art: { palette: ['#0c0b09', '#d8b26a', '#f6eedb'], motif: 'rings' },
    tracks: [
      ['Give Life Back to Music', 77],
      ['The Game of Love', 66],
      ['Giorgio by Moroder', 88],
      ['Within', 52],
      ['Instant Crush', 95, 'Julian Casablancas'],
      ['Lose Yourself to Dance', 92, 'Pharrell Williams'],
      ['Touch', 62, 'Paul Williams'],
      ['Get Lucky', 96, 'Pharrell Williams & Nile Rodgers'],
      ['Beyond', 50],
      ['Motherboard', 46],
      ['Fragments of Time', 72, 'Todd Edwards'],
      ["Doin' It Right", 80, 'Panda Bear'],
      ['Contact', 58],
    ],
  },
  {
    id: 'moon-safari', artist: 'air', title: 'Moon Safari', year: 1998, genre: 'electro',
    art: { palette: ['#f7d9e3', '#7fb7e6', '#2b3a67'], motif: 'sun' },
    tracks: [
      ["La Femme d'Argent", 42],
      ['Sexy Boy', 48],
      ['All I Need', 44, 'Beth Hirsch'],
      ['Kelly Watch the Stars', 38],
      ['Talisman', 30],
      ['Remember', 32],
      ['You Make It Easy', 33, 'Beth Hirsch'],
      ['Ce matin-là', 22],
      ['New Star in the Sky (Chanson pour Solal)', 8],
      ['Le Voyage de Pénélope', 6],
    ],
  },
  {
    id: 'the-college-dropout', artist: 'kanye-west', title: 'The College Dropout', year: 2004, genre: 'rap',
    art: { palette: ['#3a2315', '#d1934f', '#f3e3c3'], motif: 'grid' },
    tracks: [
      ['Intro', 42],
      ["We Don't Care", 62],
      ['Graduation Day', 48],
      ['All Falls Down', 82, 'Syleena Johnson'],
      ["I'll Fly Away", 46],
      ['Spaceship', 68, 'GLC & Consequence'],
      ['Jesus Walks', 87],
      ['Never Let Me Down', 76, 'Jay-Z & J. Ivy'],
      ['Get Em High', 58, 'Talib Kweli & Common'],
      ['Workout Plan', 44],
      ['The New Workout Plan', 52],
      ['Slow Jamz', 77, 'Twista & Jamie Foxx'],
      ['Breathe In Breathe Out', 56, 'Ludacris'],
      ['School Spirit (Skit 1)', 40],
      ['School Spirit', 57],
      ['School Spirit (Skit 2)', 38],
      ['Lil Jimmy (Skit)', 42],
      ['Two Words', 62, 'Mos Def, Freeway & The Boys Choir of Harlem'],
      ['Through the Wire', 80],
      ['Family Business', 68],
      ['Last Call', 50],
    ],
  },
  {
    id: 'graduation', artist: 'kanye-west', title: 'Graduation', year: 2007, genre: 'rap',
    art: { palette: ['#2b0f3f', '#ff5ea3', '#ffd64f'], motif: 'shards' },
    tracks: [
      ['Good Morning', 60],
      ['Champion', 56],
      ['Stronger', 90],
      ['I Wonder', 75],
      ['Good Life', 79, 'T-Pain'],
      ["Can't Tell Me Nothing", 72],
      ['Barry Bonds', 45, 'Lil Wayne'],
      ['Drunk and Hot Girls', 40, 'Mos Def'],
      ['Flashing Lights', 84, 'Dwele'],
      ['Everything I Am', 52],
      ['The Glory', 48],
      ['Homecoming', 64, 'Chris Martin'],
      ['Big Brother', 42],
    ],
  },
  {
    id: 'the-marshall-mathers-lp', artist: 'eminem', title: 'The Marshall Mathers LP', year: 2000, genre: 'rap',
    art: { palette: ['#101722', '#50648a', '#dde1e7'], motif: 'split' },
    tracks: [
      ['Public Service Announcement 2000', 46],
      ['Kill You', 82],
      ['Stan', 93, 'Dido'],
      ['Paul (Skit)', 42],
      ['Who Knew', 60],
      ['Steve Berman', 46],
      ['The Way I Am', 88],
      ['The Real Slim Shady', 91],
      ['Remember Me?', 50, 'RBX & Sticky Fingaz'],
      ["I'm Back", 74],
      ['Marshall Mathers', 56],
      ['Ken Kaniff (Skit)', 42],
      ['Drug Ballad', 74],
      ['Amityville', 52, 'Bizarre'],
      ['B**** Please II', 64, 'Dr. Dre, Snoop Dogg, Xzibit & Nate Dogg'],
      ['Kim', 70],
      ['Under the Influence', 62, 'D12'],
      ['Criminal', 80],
    ],
  },
  {
    id: 'the-eminem-show', artist: 'eminem', title: 'The Eminem Show', year: 2002, genre: 'rap',
    art: { palette: ['#1b0b0d', '#b8222d', '#f2dba8'], motif: 'curtain' },
    tracks: [
      ['Curtains Up (Skit)', 50],
      ['White America', 80],
      ['Business', 78],
      ["Cleanin' Out My Closet", 91],
      ['Square Dance', 76],
      ['The Kiss (Skit)', 50],
      ['Soldier', 74],
      ['Say Goodbye Hollywood', 70],
      ['Drips', 55, 'Obie Trice'],
      ['Without Me', 95],
      ['Paul Rosenberg (Skit)', 44],
      ['Sing for the Moment', 84],
      ['Superman', 89, 'Dina Rae'],
      ["Hailie's Song", 63],
      ['Steve Berman (Skit)', 44],
      ['When the Music Stops', 57, 'D12'],
      ['Say What You Say', 64, 'Dr. Dre'],
      ["'Till I Collapse", 94, 'Nate Dogg'],
      ["My Dad's Gone Crazy", 60, 'Hailie Jade'],
      ['Curtains Close (Skit)', 44],
    ],
  },
  {
    id: 'good-kid-maad-city', artist: 'kendrick-lamar', title: 'good kid, m.A.A.d city', year: 2012, genre: 'rap',
    art: { palette: ['#201b15', '#c9b48a', '#6f9475'], motif: 'halftone' },
    tracks: [
      ["Sherane a.k.a Master Splinter's Daughter", 45],
      ["B****, Don't Kill My Vibe", 78],
      ['Backseat Freestyle', 60],
      ['The Art of Peer Pressure', 52],
      ['Money Trees', 90, 'Jay Rock'],
      ['Poetic Justice', 74, 'Drake'],
      ['good kid', 48],
      ['m.A.A.d city', 66, 'MC Eiht'],
      ['Swimming Pools (Drank)', 84],
      ["Sing About Me, I'm Dying of Thirst", 56],
      ['Real', 40, 'Anna Wise'],
      ['Compton', 42, 'Dr. Dre'],
    ],
  },
  {
    id: 'thriller', artist: 'michael-jackson', title: 'Thriller', year: 1982, genre: 'pop',
    art: { palette: ['#f3eee8', '#6b2b8f', '#d8a33f'], motif: 'spotlight' },
    tracks: [
      ["Wanna Be Startin' Somethin'", 90],
      ['Baby Be Mine', 52],
      ['The Girl Is Mine', 66, 'Paul McCartney'],
      ['Thriller', 94],
      ['Beat It', 99],
      ['Billie Jean', 99],
      ['Human Nature', 80],
      ['P.Y.T. (Pretty Young Thing)', 74],
      ['The Lady in My Life', 60],
    ],
  },
  {
    id: '21', artist: 'adele', title: '21', year: 2011, genre: 'pop',
    art: { palette: ['#2a2320', '#a98a6b', '#efe2cf'], motif: 'waves' },
    tracks: [
      ['Rolling in the Deep', 80],
      ['Rumour Has It', 62],
      ['Turning Tables', 58],
      ["Don't You Remember", 44],
      ['Set Fire to the Rain', 68],
      ["He Won't Go", 42],
      ['Take It All', 40],
      ["I'll Be Waiting", 33],
      ['One and Only', 48],
      ['Lovesong', 52],
      ['Someone Like You', 76],
    ],
  },
  {
    id: 'when-we-all-fall-asleep', artist: 'billie-eilish', title: 'When We All Fall Asleep, Where Do We Go?', year: 2019, genre: 'pop',
    art: { palette: ['#0b0b0c', '#a7e33a', '#e9e9e6'], motif: 'dots' },
    tracks: [
      ['!!!!!!!', 46],
      ['bad guy', 98],
      ['xanny', 58],
      ['you should see me in a crown', 86],
      ['all the good girls go to hell', 80],
      ['wish you were gay', 91],
      ["when the party's over", 95],
      ['8', 54],
      ['my strange addiction', 62],
      ['bury a friend', 93],
      ['ilomilo', 72],
      ['listen before i go', 66],
      ['i love you', 76],
      ['goodbye', 50],
    ],
  },
  {
    id: 'racine-carree', artist: 'stromae', title: 'Racine carrée', year: 2013, genre: 'pop',
    art: { palette: ['#111519', '#ebebeb', '#3f6cff'], motif: 'grid' },
    tracks: [
      ['Ta fête', 28],
      ['Papaoutai', 34],
      ['Bâtard', 5],
      ['Ave Cesaria', 8],
      ['Tous les mêmes', 32],
      ['Formidable', 33],
      ['Moules frites', 5],
      ['Carmen', 30],
      ["Humain à l'eau", 5],
      ["Quand c'est ?", 28],
      ['Sommeil', 5],
      ['Merci', 4],
      ['AVF', 6, 'Maître Gims & Orelsan'],
    ],
  },
  {
    id: 'a-night-at-the-opera', artist: 'queen', title: 'A Night at the Opera', year: 1975, genre: 'rock',
    art: { palette: ['#f4efe4', '#b8942d', '#1e1b2b'], motif: 'diamond' },
    tracks: [
      ['Death on Two Legs (Dedicated to...)', 72],
      ['Lazing on a Sunday Afternoon', 56],
      ["I'm in Love with My Car", 81],
      ["You're My Best Friend", 89],
      ["'39", 78],
      ['Sweet Lady', 56],
      ['Seaside Rendezvous', 48],
      ["The Prophet's Song", 66],
      ['Love of My Life', 93],
      ['Good Company', 48],
      ['Bohemian Rhapsody', 95],
      ['God Save the Queen', 45],
    ],
  },
  {
    id: 'abbey-road', artist: 'the-beatles', title: 'Abbey Road', year: 1969, genre: 'rock',
    art: { palette: ['#1c2b3b', '#ececea', '#7da672'], motif: 'stripes' },
    tracks: [
      ['Come Together', 95],
      ['Something', 94],
      ["Maxwell's Silver Hammer", 72],
      ['Oh! Darling', 89],
      ["Octopus's Garden", 92],
      ["I Want You (She's So Heavy)", 80],
      ['Here Comes the Sun', 97],
      ['Because', 70],
      ['You Never Give Me Your Money', 64],
      ['Sun King', 56],
      ['Mean Mr. Mustard', 50],
      ['Polythene Pam', 50],
      ['She Came In Through the Bathroom Window', 60],
      ['Golden Slumbers', 84],
      ['Carry That Weight', 58],
      ['The End', 76],
      ['Her Majesty', 46],
    ],
  },
  {
    id: 'nevermind', artist: 'nirvana', title: 'Nevermind', year: 1991, genre: 'rock',
    art: { palette: ['#093b6c', '#3aa6e3', '#eaf6ff'], motif: 'waves' },
    tracks: [
      ['Smells Like Teen Spirit', 96],
      ['In Bloom', 80],
      ['Come as You Are', 94],
      ['Breed', 63],
      ['Lithium', 91],
      ['Polly', 74],
      ['Territorial Pissings', 53],
      ['Drain You', 63],
      ['Lounge Act', 50],
      ['Stay Away', 46],
      ['On a Plain', 52],
      ['Something in the Way', 86],
    ],
  },
  {
    id: 'the-dark-side-of-the-moon', artist: 'pink-floyd', title: 'The Dark Side of the Moon', year: 1973, genre: 'rock',
    art: { palette: ['#060607', '#ea4c3d', '#f7d23a'], motif: 'orbit' },
    tracks: [
      ['Speak to Me', 44],
      ['Breathe (In the Air)', 86],
      ['On the Run', 49],
      ['Time', 93],
      ['The Great Gig in the Sky', 79],
      ['Money', 95],
      ['Us and Them', 74],
      ['Any Colour You Like', 52],
      ['Brain Damage', 64],
      ['Eclipse', 60],
    ],
  },
  {
    id: 'back-to-black', artist: 'amy-winehouse', title: 'Back to Black', year: 2006, genre: 'soul',
    art: { palette: ['#1b0d13', '#e9c27b', '#f6e9df'], motif: 'spotlight' },
    tracks: [
      ['Rehab', 63],
      ["You Know I'm No Good", 52],
      ['Me & Mr Jones', 42],
      ['Just Friends', 34],
      ['Back to Black', 60],
      ['Love Is a Losing Game', 45],
      ['Tears Dry on Their Own', 50],
      ['Wake Up Alone', 40],
      ['Some Unholy War', 33],
      ['He Can Only Hold Her', 32],
      ['Addicted', 30],
    ],
  },
  {
    id: 'kind-of-blue', artist: 'miles-davis', title: 'Kind of Blue', year: 1959, genre: 'jazz',
    art: { palette: ['#0d1c3d', '#2f6fd0', '#e9eef8'], motif: 'arcs' },
    tracks: [
      ['So What', 58],
      ['Freddie Freeloader', 33],
      ['Blue in Green', 46],
      ['All Blues', 40],
      ['Flamenco Sketches', 28],
    ],
  },
  {
    id: 'exodus', artist: 'bob-marley', title: 'Exodus', year: 1977, genre: 'reggae',
    art: { palette: ['#1d1408', '#e2b23a', '#c8332b'], motif: 'burst' },
    tracks: [
      ['Natural Mystic', 28],
      ['So Much Things to Say', 8],
      ['Guiltiness', 5],
      ['The Heathen', 5],
      ['Exodus', 33],
      ['Jamming', 34],
      ['Waiting in Vain', 30],
      ['Turn Your Lights Down Low', 14],
      ['Three Little Birds', 44],
      ['One Love / People Get Ready', 40],
    ],
  },
  {
    id: 'histoire-de-melody-nelson', artist: 'serge-gainsbourg', title: 'Histoire de Melody Nelson', year: 1971, genre: 'chanson',
    art: { palette: ['#efe4d2', '#b5452b', '#2a1a14'], motif: 'checker' },
    tracks: [
      ['Melody', 32],
      ['Ballade de Melody Nelson', 34],
      ['Valse de Melody', 6],
      ['Ah ! Melody', 5],
      ["L'Hôtel particulier", 28],
      ['En Melody', 4],
      ['Cargo culte', 8],
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
  for (const [id, artistIdx, title, year, genre, titles, pops] of data.albums) {
    const artist = artists[artistIdx];
    if (!artist || ALBUM_BY_ID[id]) continue;
    const names = String(titles).split('\u001f');
    const art = artOf ? artOf(id) : { palette: ['#1b1623', '#ef3b3b', '#ffd35a'], motif: 'bars' };
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
