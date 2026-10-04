// Catalogue musical du jeu.
// On ne stocke que des métadonnées (titres, artistes, années, ordre des pistes).
// Les visuels des pochettes sont générés par le jeu (voir client/src/components/CoverArt.jsx) :
// aucune pochette officielle n'est reproduite.
//
// Chaque piste porte un INDICE DE POPULARITÉ de 0 à 100 (estimé d'après les écoutes, les classements et la notoriété).
// La rareté en découle automatiquement (voir POP_TIERS) :
//   ⚪ commune ≤ 34 · 🟢 peu commune 35-54 · 🔵 rare 55-69 · 🟣 super rare 70-81 · 🟠 ultra rare 82-91 · ⭐ légendaire ≥ 92
// Les singles hors album sont des PROMOS 🟥 (rareté à part, voir PROMOS plus bas), quel que soit leur indice.

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
      ['One More Time', 95],
      ['Aerodynamic', 72],
      ['Digital Love', 79],
      ['Harder, Better, Faster, Stronger', 90],
      ['Crescendolls', 46],
      ['Nightvision', 28],
      ['Superheroes', 52],
      ['High Life', 40],
      ['Something About Us', 80],
      ['Voyager', 60],
      ['Veridis Quo', 63],
      ['Short Circuit', 33],
      ['Face to Face', 58],
      ['Too Long', 30],
    ],
  },
  {
    id: 'random-access-memories', artist: 'daft-punk', title: 'Random Access Memories', year: 2013, genre: 'electro',
    art: { palette: ['#0c0b09', '#d8b26a', '#f6eedb'], motif: 'rings' },
    tracks: [
      ['Give Life Back to Music', 58],
      ['The Game of Love', 50],
      ['Giorgio by Moroder', 66],
      ['Within', 42],
      ['Instant Crush', 87, 'Julian Casablancas'],
      ['Lose Yourself to Dance', 74, 'Pharrell Williams'],
      ['Touch', 48, 'Paul Williams'],
      ['Get Lucky', 96, 'Pharrell Williams & Nile Rodgers'],
      ['Beyond', 40],
      ['Motherboard', 34],
      ['Fragments of Time', 52, 'Todd Edwards'],
      ["Doin' It Right", 62, 'Panda Bear'],
      ['Contact', 44],
    ],
  },
  {
    id: 'moon-safari', artist: 'air', title: 'Moon Safari', year: 1998, genre: 'electro',
    art: { palette: ['#f7d9e3', '#7fb7e6', '#2b3a67'], motif: 'sun' },
    tracks: [
      ["La Femme d'Argent", 64],
      ['Sexy Boy', 80],
      ['All I Need', 66, 'Beth Hirsch'],
      ['Kelly Watch the Stars', 58],
      ['Talisman', 42],
      ['Remember', 44],
      ['You Make It Easy', 52, 'Beth Hirsch'],
      ['Ce matin-là', 34],
      ['New Star in the Sky (Chanson pour Solal)', 32],
      ['Le Voyage de Pénélope', 28],
    ],
  },
  {
    id: 'the-college-dropout', artist: 'kanye-west', title: 'The College Dropout', year: 2004, genre: 'rap',
    art: { palette: ['#3a2315', '#d1934f', '#f3e3c3'], motif: 'grid' },
    tracks: [
      ['Intro', 5],
      ["We Don't Care", 52],
      ['Graduation Day', 14],
      ['All Falls Down', 86, 'Syleena Johnson'],
      ["I'll Fly Away", 8],
      ['Spaceship', 56, 'GLC & Consequence'],
      ['Jesus Walks', 92],
      ['Never Let Me Down', 58, 'Jay-Z & J. Ivy'],
      ['Get Em High', 45, 'Talib Kweli & Common'],
      ['Workout Plan', 6],
      ['The New Workout Plan', 40],
      ['Slow Jamz', 76, 'Twista & Jamie Foxx'],
      ['Breathe In Breathe Out', 42, 'Ludacris'],
      ['School Spirit (Skit 1)', 4],
      ['School Spirit', 45],
      ['School Spirit (Skit 2)', 4],
      ['Lil Jimmy (Skit)', 5],
      ['Two Words', 52, 'Mos Def, Freeway & The Boys Choir of Harlem'],
      ['Through the Wire', 81],
      ['Family Business', 56],
      ['Last Call', 34],
    ],
  },
  {
    id: 'graduation', artist: 'kanye-west', title: 'Graduation', year: 2007, genre: 'rap',
    art: { palette: ['#2b0f3f', '#ff5ea3', '#ffd64f'], motif: 'shards' },
    tracks: [
      ['Good Morning', 66],
      ['Champion', 62],
      ['Stronger', 94],
      ['I Wonder', 80],
      ['Good Life', 84, 'T-Pain'],
      ["Can't Tell Me Nothing", 78],
      ['Barry Bonds', 45, 'Lil Wayne'],
      ['Drunk and Hot Girls', 30, 'Mos Def'],
      ['Flashing Lights', 90, 'Dwele'],
      ['Everything I Am', 52],
      ['The Glory', 46],
      ['Homecoming', 74, 'Chris Martin'],
      ['Big Brother', 38],
    ],
  },
  {
    id: 'the-marshall-mathers-lp', artist: 'eminem', title: 'The Marshall Mathers LP', year: 2000, genre: 'rap',
    art: { palette: ['#101722', '#50648a', '#dde1e7'], motif: 'split' },
    tracks: [
      ['Public Service Announcement 2000', 8],
      ['Kill You', 56],
      ['Stan', 94, 'Dido'],
      ['Paul (Skit)', 5],
      ['Who Knew', 42],
      ['Steve Berman', 8],
      ['The Way I Am', 80],
      ['The Real Slim Shady', 93],
      ['Remember Me?', 32, 'RBX & Sticky Fingaz'],
      ["I'm Back", 50],
      ['Marshall Mathers', 40],
      ['Ken Kaniff (Skit)', 5],
      ['Drug Ballad', 50],
      ['Amityville', 33, 'Bizarre'],
      ['B**** Please II', 46, 'Dr. Dre, Snoop Dogg, Xzibit & Nate Dogg'],
      ['Kim', 48],
      ['Under the Influence', 44, 'D12'],
      ['Criminal', 52],
    ],
  },
  {
    id: 'the-eminem-show', artist: 'eminem', title: 'The Eminem Show', year: 2002, genre: 'rap',
    art: { palette: ['#1b0b0d', '#b8222d', '#f2dba8'], motif: 'curtain' },
    tracks: [
      ['Curtains Up (Skit)', 6],
      ['White America', 62],
      ['Business', 58],
      ["Cleanin' Out My Closet", 84],
      ['Square Dance', 56],
      ['The Kiss (Skit)', 6],
      ['Soldier', 50],
      ['Say Goodbye Hollywood', 48],
      ['Drips', 30, 'Obie Trice'],
      ['Without Me', 95],
      ['Paul Rosenberg (Skit)', 5],
      ['Sing for the Moment', 74],
      ['Superman', 77, 'Dina Rae'],
      ["Hailie's Song", 40],
      ['Steve Berman (Skit)', 5],
      ['When the Music Stops', 33, 'D12'],
      ['Say What You Say', 44, 'Dr. Dre'],
      ["'Till I Collapse", 90, 'Nate Dogg'],
      ["My Dad's Gone Crazy", 38, 'Hailie Jade'],
      ['Curtains Close (Skit)', 5],
    ],
  },
  {
    id: 'good-kid-maad-city', artist: 'kendrick-lamar', title: 'good kid, m.A.A.d city', year: 2012, genre: 'rap',
    art: { palette: ['#201b15', '#c9b48a', '#6f9475'], motif: 'halftone' },
    tracks: [
      ["Sherane a.k.a Master Splinter's Daughter", 46],
      ["B****, Don't Kill My Vibe", 80],
      ['Backseat Freestyle', 72],
      ['The Art of Peer Pressure', 57],
      ['Money Trees', 91, 'Jay Rock'],
      ['Poetic Justice', 78, 'Drake'],
      ['good kid', 48],
      ['m.A.A.d city', 76, 'MC Eiht'],
      ['Swimming Pools (Drank)', 89],
      ["Sing About Me, I'm Dying of Thirst", 58],
      ['Real', 40, 'Anna Wise'],
      ['Compton', 45, 'Dr. Dre'],
    ],
  },
  {
    id: 'thriller', artist: 'michael-jackson', title: 'Thriller', year: 1982, genre: 'pop',
    art: { palette: ['#f3eee8', '#6b2b8f', '#d8a33f'], motif: 'spotlight' },
    tracks: [
      ["Wanna Be Startin' Somethin'", 80],
      ['Baby Be Mine', 38],
      ['The Girl Is Mine', 60, 'Paul McCartney'],
      ['Thriller', 95],
      ['Beat It', 96],
      ['Billie Jean', 99],
      ['Human Nature', 76],
      ['P.Y.T. (Pretty Young Thing)', 74],
      ['The Lady in My Life', 42],
    ],
  },
  {
    id: '21', artist: 'adele', title: '21', year: 2011, genre: 'pop',
    art: { palette: ['#2a2320', '#a98a6b', '#efe2cf'], motif: 'waves' },
    tracks: [
      ['Rolling in the Deep', 95],
      ['Rumour Has It', 74],
      ['Turning Tables', 62],
      ["Don't You Remember", 50],
      ['Set Fire to the Rain', 89],
      ["He Won't Go", 46],
      ['Take It All', 42],
      ["I'll Be Waiting", 40],
      ['One and Only', 52],
      ['Lovesong', 53],
      ['Someone Like You', 94],
    ],
  },
  {
    id: 'when-we-all-fall-asleep', artist: 'billie-eilish', title: 'When We All Fall Asleep, Where Do We Go?', year: 2019, genre: 'pop',
    art: { palette: ['#0b0b0c', '#a7e33a', '#e9e9e6'], motif: 'dots' },
    tracks: [
      ['!!!!!!!', 8],
      ['bad guy', 95],
      ['xanny', 55],
      ['you should see me in a crown', 70],
      ['all the good girls go to hell', 68],
      ['wish you were gay', 72],
      ["when the party's over", 84],
      ['8', 46],
      ['my strange addiction', 57],
      ['bury a friend', 75],
      ['ilomilo', 63],
      ['listen before i go', 60],
      ['i love you', 64],
      ['goodbye', 28],
    ],
  },
  {
    id: 'racine-carree', artist: 'stromae', title: 'Racine carrée', year: 2013, genre: 'pop',
    art: { palette: ['#111519', '#ebebeb', '#3f6cff'], motif: 'grid' },
    tracks: [
      ['Ta fête', 64],
      ['Papaoutai', 93],
      ['Bâtard', 46],
      ['Ave Cesaria', 56],
      ['Tous les mêmes', 86],
      ['Formidable', 88],
      ['Moules frites', 44],
      ['Carmen', 72],
      ["Humain à l'eau", 33],
      ["Quand c'est ?", 60],
      ['Sommeil', 48],
      ['Merci', 22],
      ['AVF', 50, 'Maître Gims & Orelsan'],
    ],
  },
  {
    id: 'a-night-at-the-opera', artist: 'queen', title: 'A Night at the Opera', year: 1975, genre: 'rock',
    art: { palette: ['#f4efe4', '#b8942d', '#1e1b2b'], motif: 'diamond' },
    tracks: [
      ['Death on Two Legs (Dedicated to...)', 50],
      ['Lazing on a Sunday Afternoon', 33],
      ["I'm in Love with My Car", 62],
      ["You're My Best Friend", 80],
      ["'39", 60],
      ['Sweet Lady', 33],
      ['Seaside Rendezvous', 32],
      ["The Prophet's Song", 42],
      ['Love of My Life', 84],
      ['Good Company', 32],
      ['Bohemian Rhapsody', 99],
      ['God Save the Queen', 28],
    ],
  },
  {
    id: 'abbey-road', artist: 'the-beatles', title: 'Abbey Road', year: 1969, genre: 'rock',
    art: { palette: ['#1c2b3b', '#ececea', '#7da672'], motif: 'stripes' },
    tracks: [
      ['Come Together', 95],
      ['Something', 88],
      ["Maxwell's Silver Hammer", 56],
      ['Oh! Darling', 70],
      ["Octopus's Garden", 76],
      ["I Want You (She's So Heavy)", 63],
      ['Here Comes the Sun', 97],
      ['Because', 56],
      ['You Never Give Me Your Money', 55],
      ['Sun King', 42],
      ['Mean Mr. Mustard', 33],
      ['Polythene Pam', 33],
      ['She Came In Through the Bathroom Window', 52],
      ['Golden Slumbers', 66],
      ['Carry That Weight', 48],
      ['The End', 60],
      ['Her Majesty', 30],
    ],
  },
  {
    id: 'nevermind', artist: 'nirvana', title: 'Nevermind', year: 1991, genre: 'rock',
    art: { palette: ['#093b6c', '#3aa6e3', '#eaf6ff'], motif: 'waves' },
    tracks: [
      ['Smells Like Teen Spirit', 98],
      ['In Bloom', 77],
      ['Come as You Are', 91],
      ['Breed', 60],
      ['Lithium', 82],
      ['Polly', 62],
      ['Territorial Pissings', 50],
      ['Drain You', 60],
      ['Lounge Act', 49],
      ['Stay Away', 46],
      ['On a Plain', 50],
      ['Something in the Way', 80],
    ],
  },
  {
    id: 'the-dark-side-of-the-moon', artist: 'pink-floyd', title: 'The Dark Side of the Moon', year: 1973, genre: 'rock',
    art: { palette: ['#060607', '#ea4c3d', '#f7d23a'], motif: 'orbit' },
    tracks: [
      ['Speak to Me', 28],
      ['Breathe (In the Air)', 78],
      ['On the Run', 42],
      ['Time', 89],
      ['The Great Gig in the Sky', 74],
      ['Money', 93],
      ['Us and Them', 72],
      ['Any Colour You Like', 44],
      ['Brain Damage', 68],
      ['Eclipse', 64],
    ],
  },
  {
    id: 'back-to-black', artist: 'amy-winehouse', title: 'Back to Black', year: 2006, genre: 'soul',
    art: { palette: ['#1b0d13', '#e9c27b', '#f6e9df'], motif: 'spotlight' },
    tracks: [
      ['Rehab', 93],
      ["You Know I'm No Good", 82],
      ['Me & Mr Jones', 62],
      ['Just Friends', 48],
      ['Back to Black', 91],
      ['Love Is a Losing Game', 70],
      ['Tears Dry on Their Own', 74],
      ['Wake Up Alone', 52],
      ['Some Unholy War', 45],
      ['He Can Only Hold Her', 42],
      ['Addicted', 30],
    ],
  },
  {
    id: 'kind-of-blue', artist: 'miles-davis', title: 'Kind of Blue', year: 1959, genre: 'jazz',
    art: { palette: ['#0d1c3d', '#2f6fd0', '#e9eef8'], motif: 'arcs' },
    tracks: [
      ['So What', 92],
      ['Freddie Freeloader', 52],
      ['Blue in Green', 76],
      ['All Blues', 68],
      ['Flamenco Sketches', 44],
    ],
  },
  {
    id: 'exodus', artist: 'bob-marley', title: 'Exodus', year: 1977, genre: 'reggae',
    art: { palette: ['#1d1408', '#e2b23a', '#c8332b'], motif: 'burst' },
    tracks: [
      ['Natural Mystic', 66],
      ['So Much Things to Say', 46],
      ['Guiltiness', 42],
      ['The Heathen', 34],
      ['Exodus', 80],
      ['Jamming', 86],
      ['Waiting in Vain', 79],
      ['Turn Your Lights Down Low', 63],
      ['Three Little Birds', 94],
      ['One Love / People Get Ready', 91],
    ],
  },
  {
    id: 'histoire-de-melody-nelson', artist: 'serge-gainsbourg', title: 'Histoire de Melody Nelson', year: 1971, genre: 'chanson',
    art: { palette: ['#efe4d2', '#b5452b', '#2a1a14'], motif: 'checker' },
    tracks: [
      ['Melody', 58],
      ['Ballade de Melody Nelson', 64],
      ['Valse de Melody', 44],
      ['Ah ! Melody', 32],
      ["L'Hôtel particulier", 54],
      ['En Melody', 28],
      ['Cargo culte', 50],
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
export const POP_TIERS = [
  { rarity: 'legendary', min: 92, max: 100 },
  { rarity: 'ultra', min: 82, max: 91 },
  { rarity: 'super', min: 70, max: 81 },
  { rarity: 'rare', min: 55, max: 69 },
  { rarity: 'uncommon', min: 35, max: 54 },
  { rarity: 'common', min: 0, max: 34 },
];

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
  return { ...album.art, seed: album.id };
}

/** Code catalogue façon maison de disques : AM-001, AM-P03… */
export function catalogCode(track) {
  if (track.kind === 'promo') return `AM-P${pad(track.n)}`;
  return `AM-${String(ALBUM_BY_ID[track.albumId].catalog).padStart(3, '0')}`;
}
