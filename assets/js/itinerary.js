// Útiterv – kattintható programok (accordion) logika.
// Minden .slot-toggle fejléc lenyitja/becsukja a hozzá tartozó .slot-details panelt.

(function () {
  "use strict";

  const toggles = document.querySelectorAll(".slot-toggle");

  toggles.forEach(function (toggle) {
    const details = toggle.parentElement.querySelector(".slot-details");
    if (!details) return;

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", String(open));
      details.classList.toggle("open", open);
    }

    toggle.addEventListener("click", function () {
      const isOpen = toggle.getAttribute("aria-expanded") === "true";
      setOpen(!isOpen);
    });

    toggle.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        const isOpen = toggle.getAttribute("aria-expanded") === "true";
        setOpen(!isOpen);
      }
    });
  });
})();
