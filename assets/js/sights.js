// Barcelona látnivalók adatai.
// Kategóriánként csoportosítva; minden kategóriának saját színe (accent) van,
// amit a térkép markerek és az oldalsáv is használ.
// A böngésző globális `window.SIGHTS` és `window.CATEGORIES` néven éri el.

const CATEGORIES = [
  { id: "gaudi", name: "Gaudí és a modernizmus", color: "#e07a5f" },
  { id: "negyedek", name: "Negyedek és utcák", color: "#3d5a80" },
  { id: "vallasi", name: "Vallási épületek", color: "#8367c7" },
  { id: "muzeumok", name: "Múzeumok és kultúra", color: "#c9a227" },
  { id: "terek", name: "Terek, parkok, látványosságok", color: "#2a9d8f" },
  { id: "tengerpartok", name: "Tengerpartok", color: "#118ab2" },
];

const SIGHTS = [
  // --- Gaudí és a modernizmus ---
  {
    name: "Sagrada Família",
    category: "gaudi",
    lat: 41.4036,
    lng: 2.1744,
    desc: "Gaudí befejezetlen bazilikája; Születés- és Passió-homlokzat, Jézus Krisztus-torony.",
  },
  {
    name: "Casa Batlló (A Csontok Háza)",
    category: "gaudi",
    lat: 41.3917,
    lng: 2.165,
    desc: "Ikonikus modernista épület a Passeig de Gràcián.",
  },
  {
    name: "Casa Milà (La Pedrera)",
    category: "gaudi",
    lat: 41.3954,
    lng: 2.162,
    desc: "Gaudí híres hullámzó homlokzatú lakóépülete.",
  },
  {
    name: "Casa Amatller",
    category: "gaudi",
    lat: 41.3919,
    lng: 2.1649,
    desc: "Az 'Egyenetlenség Almája' épülettömb része.",
  },
  {
    name: "Casa Lleó Morera",
    category: "gaudi",
    lat: 41.3915,
    lng: 2.1651,
    desc: "Az 'Egyenetlenség Almája' épülettömb része.",
  },
  {
    name: "Park Güell",
    category: "gaudi",
    lat: 41.4145,
    lng: 2.1527,
    desc: "Dombtetői parképítészeti mestermű mozaikokkal és hullámzó teraszokkal.",
  },
  {
    name: "Casa Vicens",
    category: "gaudi",
    lat: 41.4036,
    lng: 2.15,
    desc: "Antoni Gaudí legelső lakóház-tervezése.",
  },
  {
    name: "Palau Güell",
    category: "gaudi",
    lat: 41.3789,
    lng: 2.1745,
    desc: "Gaudí korai, sötétebb hangulatú palotája a Rambla közelében.",
  },
  {
    name: "Palau de la Música Catalana",
    category: "gaudi",
    lat: 41.3875,
    lng: 2.1751,
    desc: "Domènech i Montaner lenyűgöző szecessziós koncertterme (UNESCO).",
  },
  {
    name: "Recinte Modernista de Sant Pau",
    category: "gaudi",
    lat: 41.4126,
    lng: 2.1745,
    desc: "Hatalmas, gyönyörűen díszített szecessziós egykori kórházkomplexum.",
  },

  // --- Negyedek és utcák ---
  {
    name: "Gótikus Negyed (Barri Gòtic)",
    category: "negyedek",
    lat: 41.3833,
    lng: 2.1767,
    desc: "Középkori, labirintusszerű történelmi központ.",
  },
  {
    name: "El Born",
    category: "negyedek",
    lat: 41.385,
    lng: 2.1817,
    desc: "Bohém, szűk utcás negyed kávézókkal és tapas bárokkal.",
  },
  {
    name: "Poblenou / Rambla del Poblenou",
    category: "negyedek",
    lat: 41.4045,
    lng: 2.1985,
    desc: "Egykori ipari zónából lett pezsgő negyed autentikus báréletel.",
  },
  {
    name: "Passeig de Gràcia",
    category: "negyedek",
    lat: 41.393,
    lng: 2.165,
    desc: "Barcelona legelegánsabb sugárútja luxusüzletekkel és modernista palotákkal.",
  },
  {
    name: "Plaça d'Espanya",
    category: "negyedek",
    lat: 41.3753,
    lng: 2.149,
    desc: "Kiemelt közlekedési és kulturális csomópont.",
  },
  {
    name: "Plaça de Sants",
    category: "negyedek",
    lat: 41.3755,
    lng: 2.133,
    desc: "Fontos közlekedési csomópont.",
  },
  {
    name: "La Rambla",
    category: "negyedek",
    lat: 41.3809,
    lng: 2.1734,
    desc: "Barcelona legforgalmasabb, több mint 1 km hosszú sétálóutcája.",
  },
  {
    name: "Plaça de Catalunya",
    category: "negyedek",
    lat: 41.387,
    lng: 2.17,
    desc: "A város legfőbb központja és közlekedési csomópontja.",
  },
  {
    name: "Plaça Reial",
    category: "negyedek",
    lat: 41.3799,
    lng: 2.1751,
    desc: "Pálmafás, elegáns tér Gaudí által tervezett lámpaoszlopokkal.",
  },
  {
    name: "El Raval",
    category: "negyedek",
    lat: 41.3796,
    lng: 2.168,
    desc: "A város multikulturálisabb, nyüzsgő negyede.",
  },

  // --- Vallási épületek ---
  {
    name: "Santa Maria del Mar",
    category: "vallasi",
    lat: 41.3839,
    lng: 2.1819,
    desc: "Impozáns gótikus templom a Born negyedben.",
  },
  {
    name: "Barcelonai katedrális (La Seu)",
    category: "vallasi",
    lat: 41.3839,
    lng: 2.1762,
    desc: "A Gótikus Negyed hatalmas központi katedrálisa.",
  },

  // --- Múzeumok és kultúra ---
  {
    name: "Picasso Múzeum",
    category: "muzeumok",
    lat: 41.3853,
    lng: 2.1809,
    desc: "A művész korai munkásságát bemutató tárlat El Bornban.",
  },
  {
    name: "Katalán Nemzeti Művészeti Múzeum (MNAC)",
    category: "muzeumok",
    lat: 41.3685,
    lng: 2.1533,
    desc: "Grandiózus palota a Montjuïc lábánál.",
  },
  {
    name: "Montjuïc-kastély (Castell de Montjuïc)",
    category: "muzeumok",
    lat: 41.3634,
    lng: 2.166,
    desc: "Erődítmény a Montjuïc hegy tetején.",
  },
  {
    name: "Mies van der Rohe Pavilon",
    category: "muzeumok",
    lat: 41.3706,
    lng: 2.15,
    desc: "A modern építészet egyik alapműve.",
  },
  {
    name: "Poble Espanyol",
    category: "muzeumok",
    lat: 41.3688,
    lng: 2.147,
    desc: "Spanyol régiók építészetét bemutató falumúzeum.",
  },
  {
    name: "Fundació Joan Miró",
    category: "muzeumok",
    lat: 41.3685,
    lng: 2.16,
    desc: "Joan Miró kortárs művészete a Montjuïc hegyen.",
  },
  {
    name: "MACBA",
    category: "muzeumok",
    lat: 41.3831,
    lng: 2.1668,
    desc: "Barcelona Kortárs Művészeti Múzeuma El Ravalban.",
  },
  {
    name: "Moco Museum",
    category: "muzeumok",
    lat: 41.3852,
    lng: 2.1815,
    desc: "Népszerű modern és kortárs street-art múzeum El Bornban.",
  },
  {
    name: "Banksy Museum",
    category: "muzeumok",
    lat: 41.3861,
    lng: 2.183,
    desc: "Street-art kiállítás Banksy műveiről.",
  },
  {
    name: "Gran Teatre del Liceu",
    category: "muzeumok",
    lat: 41.3801,
    lng: 2.1735,
    desc: "A város legendás operaháza a Ramblán.",
  },

  // --- Terek, parkok, látványosságok ---
  {
    name: "Montjuïc Varázsfókút (Font Màgica)",
    category: "terek",
    lat: 41.3711,
    lng: 2.1517,
    desc: "Zenés-fényes vízjáték a MNAC alatt.",
  },
  {
    name: "Velencei tornyok (Torres Venecianes)",
    category: "terek",
    lat: 41.3745,
    lng: 2.1487,
    desc: "Szimmetrikus tornyok a Plaça d'Espanyánál.",
  },
  {
    name: "Diadalív (Arc de Triomf)",
    category: "terek",
    lat: 41.391,
    lng: 2.1806,
    desc: "Az 1888-as világkiállításra épült vöröstéglás kapu.",
  },
  {
    name: "Parc de la Ciutadella",
    category: "terek",
    lat: 41.3884,
    lng: 2.187,
    desc: "Zöld oázis a belvárosban a monumentális Cascada kúttal.",
  },
  {
    name: "Parc de l'Espanya Industrial",
    category: "terek",
    lat: 41.3773,
    lng: 2.137,
    desc: "Sants modern, indusztriális múltat idéző parkja.",
  },
  {
    name: "Santa Caterina piac",
    category: "terek",
    lat: 41.3866,
    lng: 2.178,
    desc: "Színes, hullámzó tetőszerkezetű helyi piac.",
  },
  {
    name: "Bunkers del Carmel",
    category: "terek",
    lat: 41.4193,
    lng: 2.162,
    desc: "Panoráma-kilátó a város fölött (este lezárva).",
  },
  {
    name: "Montjuïc hegy",
    category: "terek",
    lat: 41.364,
    lng: 2.158,
    desc: "Hatalmas kulturális és rekreációs zóna, lanovkával is megközelíthető.",
  },
  {
    name: "Tibidabo (Sagrat Cor)",
    category: "terek",
    lat: 41.4225,
    lng: 2.1188,
    desc: "A város legmagasabb csúcsa romantikus vidámparkkal és a Sagrat Cor templommal.",
  },
  {
    name: "Mercat de la Boqueria",
    category: "terek",
    lat: 41.3817,
    lng: 2.1717,
    desc: "A város legikonikusabb, nyüzsgő fedett piaca a Rambláról nyílva.",
  },
  {
    name: "Camp Nou (FC Barcelona)",
    category: "terek",
    lat: 41.3809,
    lng: 2.1228,
    desc: "Az FC Barcelona stadionja és trófeamúzeuma.",
  },
  {
    name: "Kolumbusz-emlékmű (Mirador de Colom)",
    category: "terek",
    lat: 41.3757,
    lng: 2.1774,
    desc: "Kilátóoszlop a Rambla végén, a Port Vell régi kikötőjénél.",
  },
  {
    name: "La Monumental (egykori bikaaréna)",
    category: "terek",
    lat: 41.4002,
    lng: 2.1816,
    desc: "Látványos neomudéjar egykori bikaviadal-aréna a Gran Via-n, közel a szálláshoz.",
  },
  {
    name: "Festa Major de Sants – Plaça d'Osca",
    category: "terek",
    lat: 41.3742,
    lng: 2.1385,
    desc: "Az utcafesztivál egyik szíve: fesztiválbárok és a correfoc (tűzfutás) indulópontja.",
  },
  {
    name: "Sants – díszített utcák (Festa Major)",
    category: "terek",
    lat: 41.3757,
    lng: 2.1372,
    desc: "A Festa Major de Sants versenyben díszített utcái és terei (carrers guarnits).",
  },

  // --- Tengerpartok ---
  {
    name: "Nova Icària",
    category: "tengerpartok",
    lat: 41.3915,
    lng: 2.1985,
    desc: "Széles, homokos, kevésbé zsúfolt városi strand.",
  },
  {
    name: "Bogatell",
    category: "tengerpartok",
    lat: 41.396,
    lng: 2.205,
    desc: "Röplabdapályás, kellemes városi strand.",
  },
  {
    name: "Mar Bella",
    category: "tengerpartok",
    lat: 41.401,
    lng: 2.211,
    desc: "Fiatalos, sportosabb atmoszférájú strand.",
  },
  {
    name: "Barceloneta",
    category: "tengerpartok",
    lat: 41.3785,
    lng: 2.1925,
    desc: "A város legrégebbi és legzsúfoltabb tengerpartja.",
  },
  {
    name: "Ocata (Maresme)",
    category: "tengerpartok",
    lat: 41.489,
    lng: 2.317,
    desc: "Városon kívüli, csendes, hatalmas homokos partszakasz.",
  },
];

// Gyors kategória-kikeresés id alapján.
const CATEGORY_BY_ID = CATEGORIES.reduce((acc, c) => {
  acc[c.id] = c;
  return acc;
}, {});

window.CATEGORIES = CATEGORIES;
window.CATEGORY_BY_ID = CATEGORY_BY_ID;
window.SIGHTS = SIGHTS;
