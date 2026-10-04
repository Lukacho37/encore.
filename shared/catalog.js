// Catalogue musical du jeu.
// On ne stocke que des métadonnées (titres, artistes, années, ordre des pistes).
// Les visuels des pochettes sont générés par le jeu (voir client/src/components/CoverArt.jsx) :
// aucune pochette officielle n'est reproduite.
//
// Codes de rareté par morceau : C commune · U peu commune · R rare · S super rare · X ultra rare · L légendaire
// Les singles hors album sont des PROMOS (rareté à part, voir PROMOS plus bas).

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

// Chaque piste : [titre, rareté, featuring?]
export const ALBUMS = [
  {
    id: 'discovery', artist: 'daft-punk', title: 'Discovery', year: 2001, genre: 'electro',
    art: { palette: ['#0b1030', '#4fc3ff', '#f1e9ff'], motif: 'bars' },
    tracks: [
      ['One More Time', 'L'],
      ['Aerodynamic', 'S'],
      ['Digital Love', 'S'],
      ['Harder, Better, Faster, Stronger', 'X'],
      ['Crescendolls', 'U'],
      ['Nightvision', 'C'],
      ['Superheroes', 'R'],
      ['High Life', 'U'],
      ['Something About Us', 'S'],
      ['Voyager', 'R'],
      ['Veridis Quo', 'R'],
      ['Short Circuit', 'U'],
      ['Face to Face', 'R'],
      ['Too Long', 'C'],
    ],
  },
  {
    id: 'random-access-memories', artist: 'daft-punk', title: 'Random Access Memories', year: 2013, genre: 'electro',
    art: { palette: ['#0c0b09', '#d8b26a', '#f6eedb'], motif: 'rings' },
    tracks: [
      ['Give Life Back to Music', 'R'],
      ['The Game of Love', 'U'],
      ['Giorgio by Moroder', 'S'],
      ['Within', 'U'],
      ['Instant Crush', 'S', 'Julian Casablancas'],
      ['Lose Yourself to Dance', 'R', 'Pharrell Williams'],
      ['Touch', 'R', 'Paul Williams'],
      ['Get Lucky', 'L', 'Pharrell Williams & Nile Rodgers'],
      ['Beyond', 'U'],
      ['Motherboard', 'C'],
      ['Fragments of Time', 'U', 'Todd Edwards'],
      ["Doin' It Right", 'R', 'Panda Bear'],
      ['Contact', 'C'],
    ],
  },
  {
    id: 'moon-safari', artist: 'air', title: 'Moon Safari', year: 1998, genre: 'electro',
    art: { palette: ['#f7d9e3', '#7fb7e6', '#2b3a67'], motif: 'sun' },
    tracks: [
      ["La Femme d'Argent", 'S'],
      ['Sexy Boy', 'X'],
      ['All I Need', 'R'],
      ['Kelly Watch the Stars', 'R'],
      ['Talisman', 'U'],
      ['Remember', 'U'],
      ['You Make It Easy', 'R'],
      ['Ce matin-là', 'C'],
      ['New Star in the Sky (Chanson pour Solal)', 'U'],
      ['Le Voyage de Pénélope', 'C'],
    ],
  },
  {
    id: 'the-college-dropout', artist: 'kanye-west', title: 'The College Dropout', year: 2004, genre: 'rap',
    art: { palette: ['#3a2315', '#d1934f', '#f3e3c3'], motif: 'grid' },
    tracks: [
      ['Intro', 'C'],
      ["We Don't Care", 'R'],
      ['Graduation Day', 'C'],
      ['All Falls Down', 'X', 'Syleena Johnson'],
      ["I'll Fly Away", 'C'],
      ['Spaceship', 'R', 'GLC & Consequence'],
      ['Jesus Walks', 'L'],
      ['Never Let Me Down', 'S', 'Jay-Z & J. Ivy'],
      ['Get Em High', 'U', 'Talib Kweli & Common'],
      ['Workout Plan', 'C'],
      ['The New Workout Plan', 'U'],
      ['Slow Jamz', 'S', 'Twista & Jamie Foxx'],
      ['Breathe In Breathe Out', 'U', 'Ludacris'],
      ['School Spirit (Skit 1)', 'C'],
      ['School Spirit', 'U'],
      ['School Spirit (Skit 2)', 'C'],
      ['Lil Jimmy (Skit)', 'C'],
      ['Two Words', 'R', 'Mos Def, Freeway & The Boys Choir of Harlem'],
      ['Through the Wire', 'X'],
      ['Family Business', 'R'],
      ['Last Call', 'U'],
    ],
  },
  {
    id: 'graduation', artist: 'kanye-west', title: 'Graduation', year: 2007, genre: 'rap',
    art: { palette: ['#2b0f3f', '#ff5ea3', '#ffd64f'], motif: 'shards' },
    tracks: [
      ['Good Morning', 'R'],
      ['Champion', 'U'],
      ['Stronger', 'L'],
      ['I Wonder', 'S'],
      ['Good Life', 'S', 'T-Pain'],
      ["Can't Tell Me Nothing", 'R'],
      ['Barry Bonds', 'U', 'Lil Wayne'],
      ['Drunk and Hot Girls', 'C', 'Mos Def'],
      ['Flashing Lights', 'X', 'Dwele'],
      ['Everything I Am', 'U'],
      ['The Glory', 'U'],
      ['Homecoming', 'R', 'Chris Martin'],
      ['Big Brother', 'C'],
    ],
  },
  {
    id: 'the-marshall-mathers-lp', artist: 'eminem', title: 'The Marshall Mathers LP', year: 2000, genre: 'rap',
    art: { palette: ['#101722', '#50648a', '#dde1e7'], motif: 'split' },
    tracks: [
      ['Public Service Announcement 2000', 'C'],
      ['Kill You', 'U'],
      ['Stan', 'L', 'Dido'],
      ['Paul (Skit)', 'C'],
      ['Who Knew', 'U'],
      ['Steve Berman', 'C'],
      ['The Way I Am', 'S'],
      ['The Real Slim Shady', 'X'],
      ['Remember Me?', 'U', 'RBX & Sticky Fingaz'],
      ["I'm Back", 'R'],
      ['Marshall Mathers', 'U'],
      ['Ken Kaniff (Skit)', 'C'],
      ['Drug Ballad', 'R'],
      ['Amityville', 'U', 'Bizarre'],
      ['B**** Please II', 'R', 'Dr. Dre, Snoop Dogg, Xzibit & Nate Dogg'],
      ['Kim', 'R'],
      ['Under the Influence', 'U', 'D12'],
      ['Criminal', 'R'],
    ],
  },
  {
    id: 'the-eminem-show', artist: 'eminem', title: 'The Eminem Show', year: 2002, genre: 'rap',
    art: { palette: ['#1b0b0d', '#b8222d', '#f2dba8'], motif: 'curtain' },
    tracks: [
      ['Curtains Up (Skit)', 'C'],
      ['White America', 'R'],
      ['Business', 'R'],
      ["Cleanin' Out My Closet", 'S'],
      ['Square Dance', 'U'],
      ['The Kiss (Skit)', 'C'],
      ['Soldier', 'U'],
      ['Say Goodbye Hollywood', 'U'],
      ['Drips', 'C', 'Obie Trice'],
      ['Without Me', 'L'],
      ['Paul Rosenberg (Skit)', 'C'],
      ['Sing for the Moment', 'S'],
      ['Superman', 'R', 'Dina Rae'],
      ["Hailie's Song", 'U'],
      ['Steve Berman (Skit)', 'C'],
      ['When the Music Stops', 'U', 'D12'],
      ['Say What You Say', 'U', 'Dr. Dre'],
      ["'Till I Collapse", 'X', 'Nate Dogg'],
      ["My Dad's Gone Crazy", 'U', 'Hailie Jade'],
      ['Curtains Close (Skit)', 'C'],
    ],
  },
  {
    id: 'good-kid-maad-city', artist: 'kendrick-lamar', title: 'good kid, m.A.A.d city', year: 2012, genre: 'rap',
    art: { palette: ['#201b15', '#c9b48a', '#6f9475'], motif: 'halftone' },
    tracks: [
      ["Sherane a.k.a Master Splinter's Daughter", 'U'],
      ["B****, Don't Kill My Vibe", 'S'],
      ['Backseat Freestyle', 'R'],
      ['The Art of Peer Pressure', 'U'],
      ['Money Trees', 'X', 'Jay Rock'],
      ['Poetic Justice', 'S', 'Drake'],
      ['good kid', 'C'],
      ['m.A.A.d city', 'R', 'MC Eiht'],
      ['Swimming Pools (Drank)', 'L'],
      ["Sing About Me, I'm Dying of Thirst", 'R'],
      ['Real', 'C', 'Anna Wise'],
      ['Compton', 'U', 'Dr. Dre'],
    ],
  },
  {
    id: 'thriller', artist: 'michael-jackson', title: 'Thriller', year: 1982, genre: 'pop',
    art: { palette: ['#f3eee8', '#6b2b8f', '#d8a33f'], motif: 'spotlight' },
    tracks: [
      ["Wanna Be Startin' Somethin'", 'S'],
      ['Baby Be Mine', 'C'],
      ['The Girl Is Mine', 'U', 'Paul McCartney'],
      ['Thriller', 'X'],
      ['Beat It', 'X'],
      ['Billie Jean', 'L'],
      ['Human Nature', 'S'],
      ['P.Y.T. (Pretty Young Thing)', 'R'],
      ['The Lady in My Life', 'U'],
    ],
  },
  {
    id: '21', artist: 'adele', title: '21', year: 2011, genre: 'pop',
    art: { palette: ['#2a2320', '#a98a6b', '#efe2cf'], motif: 'waves' },
    tracks: [
      ['Rolling in the Deep', 'L'],
      ['Rumour Has It', 'S'],
      ['Turning Tables', 'R'],
      ["Don't You Remember", 'U'],
      ['Set Fire to the Rain', 'S'],
      ["He Won't Go", 'U'],
      ['Take It All', 'C'],
      ["I'll Be Waiting", 'C'],
      ['One and Only', 'U'],
      ['Lovesong', 'R'],
      ['Someone Like You', 'X'],
    ],
  },
  {
    id: 'when-we-all-fall-asleep', artist: 'billie-eilish', title: 'When We All Fall Asleep, Where Do We Go?', year: 2019, genre: 'pop',
    art: { palette: ['#0b0b0c', '#a7e33a', '#e9e9e6'], motif: 'dots' },
    tracks: [
      ['!!!!!!!', 'C'],
      ['bad guy', 'L'],
      ['xanny', 'U'],
      ['you should see me in a crown', 'R'],
      ['all the good girls go to hell', 'R'],
      ['wish you were gay', 'S'],
      ["when the party's over", 'X'],
      ['8', 'U'],
      ['my strange addiction', 'U'],
      ['bury a friend', 'S'],
      ['ilomilo', 'R'],
      ['listen before i go', 'U'],
      ['i love you', 'R'],
      ['goodbye', 'C'],
    ],
  },
  {
    id: 'racine-carree', artist: 'stromae', title: 'Racine carrée', year: 2013, genre: 'pop',
    art: { palette: ['#111519', '#ebebeb', '#3f6cff'], motif: 'grid' },
    tracks: [
      ['Ta fête', 'R'],
      ['Papaoutai', 'L'],
      ['Bâtard', 'U'],
      ['Ave Cesaria', 'R'],
      ['Tous les mêmes', 'X'],
      ['Formidable', 'S'],
      ['Moules frites', 'C'],
      ['Carmen', 'R'],
      ["Humain à l'eau", 'U'],
      ["Quand c'est ?", 'R'],
      ['Sommeil', 'U'],
      ['Merci', 'C'],
      ['AVF', 'U', 'Maître Gims & Orelsan'],
    ],
  },
  {
    id: 'a-night-at-the-opera', artist: 'queen', title: 'A Night at the Opera', year: 1975, genre: 'rock',
    art: { palette: ['#f4efe4', '#b8942d', '#1e1b2b'], motif: 'diamond' },
    tracks: [
      ['Death on Two Legs (Dedicated to...)', 'U'],
      ['Lazing on a Sunday Afternoon', 'C'],
      ["I'm in Love with My Car", 'R'],
      ["You're My Best Friend", 'S'],
      ["'39", 'R'],
      ['Sweet Lady', 'C'],
      ['Seaside Rendezvous', 'C'],
      ["The Prophet's Song", 'U'],
      ['Love of My Life', 'X'],
      ['Good Company', 'U'],
      ['Bohemian Rhapsody', 'L'],
      ['God Save the Queen', 'C'],
    ],
  },
  {
    id: 'abbey-road', artist: 'the-beatles', title: 'Abbey Road', year: 1969, genre: 'rock',
    art: { palette: ['#1c2b3b', '#ececea', '#7da672'], motif: 'stripes' },
    tracks: [
      ['Come Together', 'X'],
      ['Something', 'S'],
      ["Maxwell's Silver Hammer", 'U'],
      ['Oh! Darling', 'R'],
      ["Octopus's Garden", 'R'],
      ["I Want You (She's So Heavy)", 'R'],
      ['Here Comes the Sun', 'L'],
      ['Because', 'U'],
      ['You Never Give Me Your Money', 'U'],
      ['Sun King', 'C'],
      ['Mean Mr. Mustard', 'C'],
      ['Polythene Pam', 'C'],
      ['She Came In Through the Bathroom Window', 'U'],
      ['Golden Slumbers', 'R'],
      ['Carry That Weight', 'U'],
      ['The End', 'R'],
      ['Her Majesty', 'C'],
    ],
  },
  {
    id: 'nevermind', artist: 'nirvana', title: 'Nevermind', year: 1991, genre: 'rock',
    art: { palette: ['#093b6c', '#3aa6e3', '#eaf6ff'], motif: 'waves' },
    tracks: [
      ['Smells Like Teen Spirit', 'L'],
      ['In Bloom', 'S'],
      ['Come as You Are', 'X'],
      ['Breed', 'R'],
      ['Lithium', 'S'],
      ['Polly', 'R'],
      ['Territorial Pissings', 'U'],
      ['Drain You', 'R'],
      ['Lounge Act', 'C'],
      ['Stay Away', 'U'],
      ['On a Plain', 'C'],
      ['Something in the Way', 'R'],
    ],
  },
  {
    id: 'the-dark-side-of-the-moon', artist: 'pink-floyd', title: 'The Dark Side of the Moon', year: 1973, genre: 'rock',
    art: { palette: ['#060607', '#ea4c3d', '#f7d23a'], motif: 'orbit' },
    tracks: [
      ['Speak to Me', 'C'],
      ['Breathe (In the Air)', 'R'],
      ['On the Run', 'U'],
      ['Time', 'X'],
      ['The Great Gig in the Sky', 'S'],
      ['Money', 'L'],
      ['Us and Them', 'S'],
      ['Any Colour You Like', 'U'],
      ['Brain Damage', 'R'],
      ['Eclipse', 'R'],
    ],
  },
  {
    id: 'back-to-black', artist: 'amy-winehouse', title: 'Back to Black', year: 2006, genre: 'soul',
    art: { palette: ['#1b0d13', '#e9c27b', '#f6e9df'], motif: 'spotlight' },
    tracks: [
      ['Rehab', 'L'],
      ["You Know I'm No Good", 'S'],
      ['Me & Mr Jones', 'R'],
      ['Just Friends', 'U'],
      ['Back to Black', 'X'],
      ['Love Is a Losing Game', 'S'],
      ['Tears Dry on Their Own', 'R'],
      ['Wake Up Alone', 'U'],
      ['Some Unholy War', 'U'],
      ['He Can Only Hold Her', 'C'],
      ['Addicted', 'C'],
    ],
  },
  {
    id: 'kind-of-blue', artist: 'miles-davis', title: 'Kind of Blue', year: 1959, genre: 'jazz',
    art: { palette: ['#0d1c3d', '#2f6fd0', '#e9eef8'], motif: 'arcs' },
    tracks: [
      ['So What', 'L'],
      ['Freddie Freeloader', 'R'],
      ['Blue in Green', 'X'],
      ['All Blues', 'S'],
      ['Flamenco Sketches', 'U'],
    ],
  },
  {
    id: 'exodus', artist: 'bob-marley', title: 'Exodus', year: 1977, genre: 'reggae',
    art: { palette: ['#1d1408', '#e2b23a', '#c8332b'], motif: 'burst' },
    tracks: [
      ['Natural Mystic', 'S'],
      ['So Much Things to Say', 'U'],
      ['Guiltiness', 'U'],
      ['The Heathen', 'C'],
      ['Exodus', 'X'],
      ['Jamming', 'S'],
      ['Waiting in Vain', 'R'],
      ['Turn Your Lights Down Low', 'R'],
      ['Three Little Birds', 'L'],
      ['One Love / People Get Ready', 'X'],
    ],
  },
  {
    id: 'histoire-de-melody-nelson', artist: 'serge-gainsbourg', title: 'Histoire de Melody Nelson', year: 1971, genre: 'chanson',
    art: { palette: ['#efe4d2', '#b5452b', '#2a1a14'], motif: 'checker' },
    tracks: [
      ['Melody', 'S'],
      ['Ballade de Melody Nelson', 'X'],
      ['Valse de Melody', 'R'],
      ['Ah ! Melody', 'R'],
      ["L'Hôtel particulier", 'S'],
      ['En Melody', 'U'],
      ['Cargo culte', 'R'],
    ],
  },
];

// Cartes PROMO : morceaux qui ne figurent sur aucun album studio de l'artiste.
// kind : soundtrack (bande originale) · single (single hors album) · collab · charity (single caritatif)
export const PROMOS = [
  { id: 'lose-yourself', artist: 'eminem', title: 'Lose Yourself', year: 2002, genre: 'rap', kind: 'soundtrack', context: '8 Mile', art: { palette: ['#141414', '#e8e8e8', '#c9a227'], motif: 'spotlight' } },
  { id: 'not-like-us', artist: 'kendrick-lamar', title: 'Not Like Us', year: 2024, genre: 'rap', kind: 'single', art: { palette: ['#f2f2ee', '#1c1c1c', '#d23a2f'], motif: 'split' } },
  { id: 'ye-vs-the-people', artist: 'kanye-west', title: 'Ye vs. the People', feat: 'T.I.', year: 2018, genre: 'rap', kind: 'single', art: { palette: ['#e7e3d8', '#2d2a24', '#7a8b3a'], motif: 'stripes' } },
  { id: 'skyfall', artist: 'adele', title: 'Skyfall', year: 2012, genre: 'pop', kind: 'soundtrack', context: 'Skyfall', art: { palette: ['#0e0e12', '#c9b37e', '#6d7a8c'], motif: 'rings' } },
  { id: 'no-time-to-die', artist: 'billie-eilish', title: 'No Time to Die', year: 2020, genre: 'pop', kind: 'soundtrack', context: 'Mourir peut attendre', art: { palette: ['#070708', '#d6d0c4', '#9b2c2c'], motif: 'orbit' } },
  { id: 'we-are-the-world', artist: 'michael-jackson', title: 'We Are the World', year: 1985, genre: 'pop', kind: 'charity', context: 'USA for Africa', art: { palette: ['#f6efe0', '#2e5aa7', '#e0a43a'], motif: 'burst' } },
  { id: 'hey-jude', artist: 'the-beatles', title: 'Hey Jude', year: 1968, genre: 'rock', kind: 'single', art: { palette: ['#edf2e8', '#2f7d4f', '#e3a02b'], motif: 'dots' } },
  { id: 'thank-god-its-christmas', artist: 'queen', title: "Thank God It's Christmas", year: 1984, genre: 'rock', kind: 'single', art: { palette: ['#0f2a1d', '#d9443a', '#f3ead6'], motif: 'diamond' } },
  { id: 'sliver', artist: 'nirvana', title: 'Sliver', year: 1990, genre: 'rock', kind: 'single', art: { palette: ['#2a1f12', '#e46f2e', '#f1e3c8'], motif: 'halftone' } },
  { id: 'arnold-layne', artist: 'pink-floyd', title: 'Arnold Layne', year: 1967, genre: 'rock', kind: 'single', art: { palette: ['#2a1442', '#f08ac0', '#f7e96b'], motif: 'arcs' } },
  { id: 'valerie', artist: 'amy-winehouse', title: 'Valerie', year: 2007, genre: 'soul', kind: 'collab', context: 'Mark Ronson', art: { palette: ['#1e1a2e', '#ff8fa3', '#f5e6c8'], motif: 'waves' } },
  { id: 'derezzed', artist: 'daft-punk', title: 'Derezzed', year: 2010, genre: 'electro', kind: 'soundtrack', context: 'TRON : L’Héritage', art: { palette: ['#03070c', '#35e1ff', '#ff9a2e'], motif: 'grid' } },
  { id: 'playground-love', artist: 'air', title: 'Playground Love', year: 2000, genre: 'electro', kind: 'soundtrack', context: 'Virgin Suicides', art: { palette: ['#f3dfe6', '#c25a7c', '#3b2b4f'], motif: 'sun' } },
  { id: 'iron-lion-zion', artist: 'bob-marley', title: 'Iron Lion Zion', year: 1992, genre: 'reggae', kind: 'single', art: { palette: ['#13240f', '#e9c13b', '#cf3a2c'], motif: 'bars' } },
];

const RARITY_CODES = { C: 'common', U: 'uncommon', R: 'rare', S: 'super', X: 'ultra', L: 'legendary' };

export const ARTIST_BY_ID = Object.fromEntries(ARTISTS.map((a) => [a.id, a]));
export const ALBUM_BY_ID = Object.fromEntries(ALBUMS.map((a, i) => [a.id, { ...a, catalog: i + 1 }]));

const pad = (n) => String(n).padStart(2, '0');

/** Toutes les cartes du jeu, dans l'ordre du catalogue. */
export const TRACKS = [];
for (const album of ALBUMS) {
  album.tracks.forEach(([title, code, feat], i) => {
    TRACKS.push({
      id: `${album.id}:${pad(i + 1)}`,
      kind: 'album',
      title,
      feat: feat || null,
      rarity: RARITY_CODES[code],
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

export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]));

export const TRACKS_BY_ALBUM = {};
for (const t of TRACKS) if (t.albumId) (TRACKS_BY_ALBUM[t.albumId] ||= []).push(t);

export const PROMO_TRACKS = TRACKS.filter((t) => t.kind === 'promo');

export const ALBUMS_BY_ARTIST = {};
for (const a of ALBUMS) (ALBUMS_BY_ARTIST[a.artist] ||= []).push(a);

/** Cartes nécessaires pour maîtriser un artiste : tous ses albums + ses promos. */
export const TRACKS_BY_ARTIST = {};
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

/** Code catalogue façon maison de disques : ENC-001, ENC-P03… */
export function catalogCode(track) {
  if (track.kind === 'promo') return `ENC-P${pad(track.n)}`;
  return `ENC-${String(ALBUM_BY_ID[track.albumId].catalog).padStart(3, '0')}`;
}
