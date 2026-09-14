// Barcelona – Látnivalók interaktív térkép logika.
// Függ: Leaflet (globális `L`) és sights.js (globális `SIGHTS`, `CATEGORIES`, `CATEGORY_BY_ID`).

(function () {
  "use strict";

  const BCN_CENTER = [41.39, 2.16];
  const START_ZOOM = 13;

  // Minden látnivalóhoz eltároljuk a marker + lista DOM elem hivatkozását.
  // A stabil azonosító a tömbbeli index.
  const registry = [];
  let activeIndex = null;

  // --- Térkép inicializálás ---
  const map = L.map("map", {
    center: BCN_CENTER,
    zoom: START_ZOOM,
    scrollWheelZoom: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> közreműködők',
  }).addTo(map);

  // Színes csepp-alakú marker készítése divIcon-nal.
  function makeIcon(color, active) {
    return L.divIcon({
      className: "",
      html:
        '<div class="marker-pin' +
        (active ? " is-active" : "") +
        '" style="background:' +
        color +
        '"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 22],
      popupAnchor: [0, -20],
    });
  }

  function popupHtml(sight, category) {
    return (
      '<span class="popup-cat" style="background:' +
      category.color +
      '">' +
      category.name +
      "</span>" +
      '<div class="popup-title">' +
      sight.name +
      "</div>" +
      '<p class="popup-desc">' +
      sight.desc +
      "</p>"
    );
  }

  // --- Markerek felvitele ---
  SIGHTS.forEach(function (sight, index) {
    const category = CATEGORY_BY_ID[sight.category];
    const marker = L.marker([sight.lat, sight.lng], {
      icon: makeIcon(category.color, false),
      title: sight.name,
    }).addTo(map);

    marker.bindPopup(popupHtml(sight, category));

    // Marker kattintás -> lista szinkron.
    marker.on("click", function () {
      setActive(index, false);
    });

    registry[index] = { sight: sight, category: category, marker: marker, item: null };
  });

  // --- Jelmagyarázat (legend) építése ---
  const legendEl = document.getElementById("legend");
  if (legendEl) {
    CATEGORIES.forEach(function (category) {
      const item = document.createElement("span");
      item.className = "legend-item";
      item.innerHTML =
        '<span class="legend-swatch" style="background:' +
        category.color +
        '"></span>' +
        category.name;
      legendEl.appendChild(item);
    });
  }

  // --- Oldalsáv lista építése kategóriánként ---
  const listEl = document.getElementById("sight-list");

  CATEGORIES.forEach(function (category) {
    const sightsInCat = [];
    SIGHTS.forEach(function (s, i) {
      if (s.category === category.id) sightsInCat.push(i);
    });
    if (sightsInCat.length === 0) return;

    const group = document.createElement("div");
    group.className = "category-group";
    group.dataset.category = category.id;

    const header = document.createElement("div");
    header.className = "category-header";
    header.innerHTML =
      '<span class="cat-dot" style="background:' +
      category.color +
      '"></span>' +
      category.name;
    group.appendChild(header);

    sightsInCat.forEach(function (index) {
      const sight = SIGHTS[index];
      const item = document.createElement("div");
      item.className = "sight-item";
      item.dataset.index = index;
      item.dataset.name = sight.name.toLowerCase();
      item.innerHTML =
        '<span class="pin" style="background:' +
        category.color +
        '"></span>' +
        '<span class="sight-text">' +
        '<span class="sight-name">' +
        sight.name +
        "</span>" +
        '<span class="sight-desc">' +
        sight.desc +
        "</span>" +
        "</span>";

      item.addEventListener("click", function () {
        setActive(index, true);
      });

      group.appendChild(item);
      registry[index].item = item;
    });

    listEl.appendChild(group);
  });

  // --- Aktív elem kezelése (térkép + lista szinkron) ---
  function setActive(index, fromList) {
    if (activeIndex !== null && registry[activeIndex]) {
      const prev = registry[activeIndex];
      if (prev.item) prev.item.classList.remove("active");
      prev.marker.setIcon(makeIcon(prev.category.color, false));
    }

    activeIndex = index;
    const entry = registry[index];
    if (!entry) return;

    if (entry.item) {
      entry.item.classList.add("active");
      // Görgessük láthatóvá a listában, ha a térképről jött a kattintás.
      if (!fromList) {
        entry.item.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
    entry.marker.setIcon(makeIcon(entry.category.color, true));

    // A jelenlegi nagyítást megtartjuk – csak a helyre panorámázunk.
    map.flyTo([entry.sight.lat, entry.sight.lng], map.getZoom(), {
      duration: 0.8,
    });

    // A repülés után nyissuk meg a popupot.
    map.once("moveend", function () {
      entry.marker.openPopup();
    });
    // Biztonsági megnyitás, ha nincs mozgás (már ott vagyunk).
    entry.marker.openPopup();
  }

  // --- Napi útvonalak (polyline overlay-ek, naponta más színnel) ---
  // Légvonalban kötik össze az adott nap megállóit; a rétegváltóval ki/be kapcsolhatók.
  if (window.DAY_ROUTES && Array.isArray(window.DAY_ROUTES)) {
    const overlays = {};

    window.DAY_ROUTES.forEach(function (route) {
      const latlngs = route.stops.map(function (s) {
        return [s.lat, s.lng];
      });

      const group = L.layerGroup();

      L.polyline(latlngs, {
        color: route.color,
        weight: 4,
        opacity: 0.85,
        dashArray: "8 8",
      }).addTo(group);

      route.stops.forEach(function (s, i) {
        const icon = L.divIcon({
          className: "",
          html:
            '<div class="route-stop-num" style="background:' +
            route.color +
            '">' +
            (i + 1) +
            "</div>",
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        L.marker([s.lat, s.lng], { icon: icon, title: s.name })
          .bindTooltip(i + 1 + ". " + s.name, { direction: "top" })
          .addTo(group);
      });

      overlays[route.label] = group;
    });

    const routesControl = L.control.layers(null, overlays, {
      collapsed: false,
      position: "topright",
    });
    routesControl.addTo(map);

    // Cím a vezérlő tetejére.
    const container = routesControl.getContainer();
    if (container) {
      container.classList.add("routes-control");
      const title = L.DomUtil.create("div", "routes-ctrl-title");
      title.textContent = "Napi útvonalak";
      container.insertBefore(title, container.firstChild);
    }
  }

  // --- Kereső / szűrő ---
  const searchInput = document.getElementById("search");
  const noResults = document.getElementById("no-results");

  searchInput.addEventListener("input", function () {
    const q = searchInput.value.trim().toLowerCase();
    let anyVisible = false;

    document.querySelectorAll(".category-group").forEach(function (group) {
      let groupHasVisible = false;
      group.querySelectorAll(".sight-item").forEach(function (item) {
        const match = item.dataset.name.indexOf(q) !== -1;
        item.style.display = match ? "" : "none";
        if (match) groupHasVisible = true;
      });
      // Kategória fejléc elrejtése, ha nincs benne találat.
      group.style.display = groupHasVisible ? "" : "none";
      if (groupHasVisible) anyVisible = true;
    });

    noResults.style.display = anyVisible ? "none" : "block";
  });

  // --- Mobil: oldalsáv lista összecsukása ---
  const toggleBtn = document.getElementById("mobile-toggle");
  const sidebar = document.getElementById("sidebar");
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener("click", function () {
      sidebar.classList.toggle("collapsed");
    });
  }

  // A térkép átméretezése biztosításához (pl. mobil elrendezés váltás).
  window.addEventListener("load", function () {
    setTimeout(function () {
      map.invalidateSize();
    }, 200);
  });
})();
