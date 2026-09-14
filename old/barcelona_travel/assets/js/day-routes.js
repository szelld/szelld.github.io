// Napi útvonalak a térképhez.
// Minden naphoz egy szín és a látogatás sorrendjében rendezett megállók.
// A koordináták a sights.js-ben szereplő helyeket használják, kiegészítve
// a szállással, éttermekkel és fesztiválhelyszínekkel.
// Megjegyzés: a vonalak LÉGVONALBAN kötik össze a megállókat (nem tömegközlekedési
// útvonal), mert statikus oldalon nincs valós útvonaltervező.
// Böngészőben: window.DAY_ROUTES.

const DAY_ROUTES = [
  {
    day: 1,
    label: "1. nap – aug. 26. (Érkezés)",
    color: "#e6194b",
    stops: [
      { name: "Szállás (Sancho de Ávila 32)", lat: 41.4053, lng: 2.1889 },
      { name: "Vacsora – Poblenou (Els Tres Porquets)", lat: 41.403, lng: 2.1966 },
    ],
  },
  {
    day: 2,
    label: "2. nap – aug. 27. (Gaudí & El Born)",
    color: "#3cb44b",
    stops: [
      { name: "Mercat de la Boqueria", lat: 41.3817, lng: 2.1717 },
      { name: "Casa Batlló", lat: 41.3917, lng: 2.165 },
      { name: "Casa Milà (La Pedrera)", lat: 41.3954, lng: 2.162 },
      { name: "Ebéd – Cervecería Catalana", lat: 41.3936, lng: 2.1615 },
      { name: "Sagrada Família", lat: 41.4036, lng: 2.1744 },
      { name: "La Monumental", lat: 41.4002, lng: 2.1816 },
      { name: "Vacsora – El Born (Bormuth)", lat: 41.386, lng: 2.182 },
      { name: "Szállás", lat: 41.4053, lng: 2.1889 },
    ],
  },
  {
    day: 3,
    label: "3. nap – aug. 28. (Montjuïc & Sants)",
    color: "#4363d8",
    stops: [
      { name: "Plaça d'Espanya", lat: 41.3753, lng: 2.149 },
      { name: "MNAC", lat: 41.3685, lng: 2.1533 },
      { name: "Castell de Montjuïc", lat: 41.3634, lng: 2.166 },
      { name: "Ebéd – Carrer Blai (Poble Sec)", lat: 41.3723, lng: 2.1615 },
      { name: "Szállás (szieszta)", lat: 41.4053, lng: 2.1889 },
      { name: "Bogatell (opcionális fürdés)", lat: 41.396, lng: 2.205 },
      { name: "Font Màgica", lat: 41.3711, lng: 2.1517 },
      { name: "Festa de Sants – Plaça d'Osca", lat: 41.3742, lng: 2.1385 },
    ],
  },
  {
    day: 4,
    label: "4. nap – aug. 29. (Park Güell & Festa-csúcs)",
    color: "#f58231",
    stops: [
      { name: "Park Güell", lat: 41.4145, lng: 2.1527 },
      { name: "Gràcia – Plaça del Sol", lat: 41.4008, lng: 2.1556 },
      { name: "Gótikus Negyed – Katedrális", lat: 41.3839, lng: 2.1762 },
      { name: "Plaça Reial", lat: 41.3799, lng: 2.1751 },
      { name: "Castellers – Pl. de Bonet i Muixí", lat: 41.3746, lng: 2.136 },
      { name: "Correfoc – Plaça d'Osca", lat: 41.3742, lng: 2.1385 },
      { name: "Szállás", lat: 41.4053, lng: 2.1889 },
    ],
  },
  {
    day: 5,
    label: "5. nap – aug. 30. (Strand & Festa-zárás)",
    color: "#911eb4",
    stops: [
      { name: "Parc de la Ciutadella", lat: 41.3884, lng: 2.187 },
      { name: "Arc de Triomf", lat: 41.391, lng: 2.1806 },
      { name: "Nova Icària / Bogatell strand", lat: 41.3915, lng: 2.1985 },
      { name: "Ebéd – Xiringuito Escribà", lat: 41.3928, lng: 2.2025 },
      { name: "Szállás (pakolás)", lat: 41.4053, lng: 2.1889 },
      { name: "Piromusical – Parc de l'Espanya Industrial", lat: 41.3767, lng: 2.1385 },
    ],
  },
  {
    day: 6,
    label: "6. nap – aug. 31. (Hazautazás)",
    color: "#f032e6",
    stops: [
      { name: "Szállás", lat: 41.4053, lng: 2.1889 },
      { name: "BCN repülőtér (T1)", lat: 41.287, lng: 2.0787 },
    ],
  },
];

window.DAY_ROUTES = DAY_ROUTES;
