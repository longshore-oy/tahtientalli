/* Suomen Tallit — hakusovellus */
(function () {
  "use strict";

  var DATA = (window.TALLIDATA || { tallit: [] });
  var ALL = DATA.tallit || [];
  // Aineistossa on kohteita jotka on tunnistettu muuksi kuin talliksi. Ne
  // sailytetaan tarkastettavina mutta ne eivat kuulu suodatinvalikoihin
  // eivatka oletusnakymaan.
  var TALLIT = ALL.filter(function (t) { return !t.piilotettu; });
  var PIILOSSA = ALL.length - TALLIT.length;
  var view = { list: [], sel: null };
  var map = null, layer = null, markers = {};

  // ---------------------------------------------------------------- apurit
  var $ = function (s) { return document.querySelector(s); };
  var el = function (t, c, txt) {
    var e = document.createElement(t);
    if (c) e.className = c;
    if (txt != null) e.textContent = txt;
    return e;
  };
  function norm(s) {
    return (s || "").toString().toLowerCase()
      .replace(/[äå]/g, "a").replace(/ö/g, "o").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function esc(s) {
    return (s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function euro(v) {
    if (v == null) return "";
    return (Math.round(v * 100) / 100).toLocaleString("fi-FI") + " €";
  }
  function valintaElementissa(e) {
    var s = window.getSelection && window.getSelection();
    if (!s || s.isCollapsed || !String(s).trim()) return false;
    return e.contains(s.anchorNode) || e.contains(s.focusNode);
  }

  function kopioi(teksti, nappi) {
    function palaute(ok) {
      if (!nappi) return;
      var vanha = nappi.dataset.teksti || nappi.textContent;
      nappi.dataset.teksti = vanha;
      nappi.textContent = ok ? "Kopioitu ✓" : "Kopiointi ei onnistunut";
      setTimeout(function () { nappi.textContent = vanha; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(teksti).then(function () { palaute(true); },
                                                 function () { varakopio(teksti, palaute); });
    } else {
      varakopio(teksti, palaute);
    }
  }

  function varakopio(teksti, palaute) {
    // Vanhempi tapa: nakymaton tekstialue + execCommand
    try {
      var ta = document.createElement("textarea");
      ta.value = teksti;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      palaute(ok);
    } catch (e) { palaute(false); }
  }

  function tallinTiedotTekstina(t) {
    var rivit = [t.nimi];
    var osoite = [t.osoite, [t.postinumero, t.postitoimipaikka].filter(Boolean).join(" ")]
      .filter(Boolean).join(", ");
    if (osoite) rivit.push(osoite);
    if (t.kunta) rivit.push(t.kunta + (t.maakunta ? ", " + t.maakunta : ""));
    (t.puhelin || []).forEach(function (p) { rivit.push("Puh. " + p); });
    (t.email || []).forEach(function (e) { rivit.push(e); });
    if (t.www) rivit.push(t.www);
    if (t.lat) rivit.push(t.lat.toFixed(5) + ", " + t.lon.toFixed(5));
    return rivit.join("\n");
  }

  function hakuindeksi(t) {
    if (t._idx) return t._idx;
    t._idx = norm([
      t.nimi, (t.aputoiminimet || []).join(" "), t.kunta, t.maakunta,
      t.osoite, t.postitoimipaikka,
      t.postinumero, (t.tyypit || []).join(" "), (t.palvelut || []).join(" "),
      (t.lajit || []).join(" "), (t.tilat || []).join(" "), (t.rodut || []).join(" "),
      (t.hevoset || []).join(" "), t.kuvaus, t.www, t.ytunnus, t.toimiala,
      (t.hinnat || []).map(function (h) { return h.nimike; }).join(" ")
    ].join(" "));
    return t._idx;
  }

  // ---------------------------------------------------------------- suodattimet
  var F = {
    q: "", maakunta: [], kunta: [], tyyppi: [], palvelu: [], laji: [], tila: [],
    hevmin: null, hevmax: null, hintamin: null, hintamax: null,
    srl: false, www: false, kuva: false, hinta: false, hevoset: false, kartta: false,
    muut: false,
    sort: "nimi"
  };

  function arvot(kentta) {
    var c = {};
    TALLIT.forEach(function (t) {
      (t[kentta] || []).forEach(function (v) { c[v] = (c[v] || 0) + 1; });
    });
    return Object.keys(c).sort(function (a, b) {
      return c[b] - c[a] || a.localeCompare(b, "fi");
    }).map(function (k) { return { arvo: k, n: c[k] }; });
  }
  function skalaarit(kentta) {
    var c = {};
    TALLIT.forEach(function (t) { if (t[kentta]) c[t[kentta]] = (c[t[kentta]] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return a.localeCompare(b, "fi"); })
      .map(function (k) { return { arvo: k, n: c[k] }; });
  }

  function rakennaSuodatin(hostId, lista, avain) {
    var host = $(hostId);
    host.innerHTML = "";
    lista.forEach(function (o) {
      var lab = el("label");
      var i = el("input"); i.type = "checkbox"; i.value = o.arvo;
      i.addEventListener("change", function () {
        var a = F[avain];
        if (i.checked) { if (a.indexOf(o.arvo) < 0) a.push(o.arvo); }
        else { F[avain] = a.filter(function (x) { return x !== o.arvo; }); }
        paivita();
      });
      lab.appendChild(i);
      lab.appendChild(el("span", null, o.arvo));
      lab.appendChild(el("span", "n", String(o.n)));
      host.appendChild(lab);
    });
  }

  function osuu(t) {
    if (t.piilotettu && !F.muut) return false;
    if (F.q) {
      var idx = hakuindeksi(t);
      var sanat = norm(F.q).split(" ").filter(Boolean);
      for (var i = 0; i < sanat.length; i++) if (idx.indexOf(sanat[i]) < 0) return false;
    }
    if (F.maakunta.length && F.maakunta.indexOf(t.maakunta) < 0) return false;
    if (F.kunta.length && F.kunta.indexOf(t.kunta) < 0) return false;
    function kaikki(valitut, lista) {
      for (var i = 0; i < valitut.length; i++)
        if ((lista || []).indexOf(valitut[i]) < 0) return false;
      return true;
    }
    if (!kaikki(F.tyyppi, t.tyypit)) return false;
    if (!kaikki(F.palvelu, t.palvelut)) return false;
    if (!kaikki(F.laji, t.lajit)) return false;
    if (!kaikki(F.tila, t.tilat)) return false;

    if (F.hevmin != null && !(t.hevosia >= F.hevmin)) return false;
    if (F.hevmax != null && !(t.hevosia != null && t.hevosia <= F.hevmax)) return false;
    if (F.hintamin != null && !(t.hinta_min != null && t.hinta_min >= F.hintamin)) return false;
    if (F.hintamax != null && !(t.hinta_min != null && t.hinta_min <= F.hintamax)) return false;

    if (F.srl && !t.srl_hyvaksytty) return false;
    if (F.www && !t.www) return false;
    if (F.kuva && !(t.kuvat && t.kuvat.length)) return false;
    if (F.hinta && !(t.hinnat && t.hinnat.length)) return false;
    if (F.hevoset && !(t.hevoset && t.hevoset.length)) return false;
    if (F.kartta && !(t.lat && t.lon)) return false;
    return true;
  }

  function kattavuus(t) {
    var p = 0;
    if (t.www) p += 1;
    if (t.lat) p += 1;
    if (t.kuvat && t.kuvat.length) p += 2;
    if (t.hinnat && t.hinnat.length) p += 2;
    if (t.hevoset && t.hevoset.length) p += 2;
    if (t.puhelin && t.puhelin.length) p += 1;
    if (t.email && t.email.length) p += 1;
    if (t.kuvaus) p += 1;
    if (t.palvelut && t.palvelut.length) p += 1;
    return p + (t.luottamus || 0) / 10;
  }

  function jarjesta(a) {
    var s = F.sort;
    return a.slice().sort(function (x, y) {
      if (s === "kunta") return (x.kunta || "").localeCompare(y.kunta || "", "fi")
        || x.nimi.localeCompare(y.nimi, "fi");
      if (s === "hinta") {
        var hx = x.hinta_min == null ? Infinity : x.hinta_min;
        var hy = y.hinta_min == null ? Infinity : y.hinta_min;
        return hx - hy || x.nimi.localeCompare(y.nimi, "fi");
      }
      if (s === "hevosia") {
        var ax = x.hevosia == null ? -1 : x.hevosia;
        var ay = y.hevosia == null ? -1 : y.hevosia;
        return ay - ax || x.nimi.localeCompare(y.nimi, "fi");
      }
      if (s === "tiedot") return kattavuus(y) - kattavuus(x) || x.nimi.localeCompare(y.nimi, "fi");
      return x.nimi.localeCompare(y.nimi, "fi");
    });
  }

  // ---------------------------------------------------------------- kortit
  function kortti(t) {
    var c = el("div", "card");
    c.dataset.id = t.id;
    c.tabIndex = 0;
    c.setAttribute("role", "button");
    c.setAttribute("aria-label", t.nimi + ", " + (t.kunta || "") + " — näytä tiedot");

    var th = el("div", "thumb");
    if (t.kuvat && t.kuvat.length) {
      var im = el("img");
      im.loading = "lazy"; im.alt = t.nimi; im.src = t.kuvat[0];
      im.addEventListener("error", function () {
        th.className = "thumb noimg"; th.innerHTML = "";
        var f = el("img"); f.src = "assets/brand/emblem-192.png"; f.alt = ""; th.appendChild(f);
      });
      th.appendChild(im);
    } else {
      th.className = "thumb noimg";
      var f = el("img"); f.src = "assets/brand/emblem-192.png"; f.alt = ""; th.appendChild(f);
    }
    if (t.srl_hyvaksytty) th.appendChild(el("span", "badge", "SRL"));
    c.appendChild(th);

    var b = el("div", "cbody");
    b.appendChild(el("h3", null, t.nimi));
    b.appendChild(el("div", "place", "📍 " + (t.kunta || "") + (t.osoite ? " · " + t.osoite : "")));

    var tags = el("div", "tags");
    (t.tyypit || []).slice(0, 3).forEach(function (x) { tags.appendChild(el("span", "tag", x)); });
    (t.tilat || []).slice(0, 2).forEach(function (x) { tags.appendChild(el("span", "tag g", x)); });
    b.appendChild(tags);

    var facts = el("div", "facts");
    if (t.hevosia != null) facts.appendChild(el("span", null, "🐴 " + t.hevosia + " hevosta"));
    if (t.hevoset && t.hevoset.length) facts.appendChild(el("span", null, "📋 " + t.hevoset.length + " nimeä"));
    if (t.hinta_min != null) {
      // Hintahaarukka on rehellisempi kuin "alkaen": halvin rivi voi olla
      // esim. lahjakorttilisä, ei varsinainen tuntihinta.
      var hteksti = (t.hinta_max != null && t.hinta_max !== t.hinta_min)
        ? euro(t.hinta_min) + "–" + euro(t.hinta_max)
        : euro(t.hinta_min);
      facts.appendChild(el("span", null, "💶 " + hteksti));
    }
    if (t.karsinoita != null) facts.appendChild(el("span", null, "🏠 " + t.karsinoita + " karsinaa"));
    b.appendChild(facts);

    c.appendChild(b);

    // Kortti on klikattava, mutta tekstin maalaaminen ei saa avata paneelia:
    // raahaus paattyy click-tapahtumaan, joka muuten veisi valinnan mennessaan.
    var alkuX = 0, alkuY = 0;
    c.addEventListener("mousedown", function (e) { alkuX = e.clientX; alkuY = e.clientY; });
    c.addEventListener("click", function (e) {
      var siirto = Math.abs(e.clientX - alkuX) + Math.abs(e.clientY - alkuY);
      if (siirto > 6 || valintaElementissa(c)) return;
      avaa(t.id);
    });
    c.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); avaa(t.id); }
    });
    return c;
  }

  // ------------------------------------------------- näkymä (lista / kartta)
  function naytaNakyma(v) {
    document.body.dataset.view = v;
    document.querySelectorAll(".viewtoggle button").forEach(function (b) {
      var on = b.dataset.view === v;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    try { localStorage.setItem("st-view", v); } catch (e) { }
    if (v === "map" && map) {
      setTimeout(function () {
        map.invalidateSize();
        sovitaKartta();
      }, 60);
    }
  }

  // ------------------------------------------------- suodatinpaneelin tila
  function naytaSuodattimet(nayta) {
    document.body.classList.toggle("filters-piilossa", !nayta);
    var b = $("#filterbtn");
    if (b) b.setAttribute("aria-expanded", nayta ? "true" : "false");
    try { localStorage.setItem("st-filters", nayta ? "auki" : "kiinni"); } catch (e) { }
    if (map) setTimeout(function () { map.invalidateSize(); }, 260);
  }

  // ---------------------------------------------------------------- kartta
  function initMap() {
    map = L.map("map", { zoomControl: true }).setView([60.35, 24.9], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    // Koko maan aineistossa on yli 1500 tallia, joten merkinnat ryhmitellaan.
    // Ilman ryhmittelya kartta on maan mittakaavassa yhta merkkiryppasta.
    layer = (typeof L.markerClusterGroup === "function")
      ? L.markerClusterGroup({
          maxClusterRadius: 45,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          disableClusteringAtZoom: 12,
          iconCreateFunction: function (cluster) {
            var n = cluster.getChildCount();
            var koko = n < 10 ? 34 : (n < 100 ? 40 : 48);
            return L.divIcon({
              html: '<div class="klusteri"><span>' + n + "</span></div>",
              className: "",
              iconSize: L.point(koko, koko)
            });
          }
        })
      : L.layerGroup();
    layer.addTo(map);
  }

  function piirraKartta(lista) {
    if (!map) return;
    layer.clearLayers();
    markers = {};
    var pisteet = [];
    var uudet = [];
    lista.forEach(function (t) {
      if (!t.lat || !t.lon) return;
      var icon = L.divIcon({
        className: "",
        html: '<div class="pin' + (t.srl_hyvaksytty ? " srl" : "") + '"></div>',
        iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -24]
      });
      var m = L.marker([t.lat, t.lon], { icon: icon, title: t.nimi });
      m.bindPopup(
        "<h4>" + esc(t.nimi) + "</h4>" +
        '<div class="pp">' + esc(t.kunta || "") + (t.osoite ? " · " + esc(t.osoite) : "") + "</div>" +
        (t.hinta_min != null ? '<div class="pp">Hinnat alkaen ' + euro(t.hinta_min) + "</div>" : "") +
        '<div style="margin-top:6px"><a href="#" data-open="' + esc(t.id) + '">Näytä kaikki tiedot →</a></div>'
      );
      m.on("popupopen", function (e) {
        var a = e.popup.getElement().querySelector("[data-open]");
        if (a) a.addEventListener("click", function (ev) {
          ev.preventDefault(); avaa(a.getAttribute("data-open"));
        });
      });
      uudet.push(m);
      markers[t.id] = m;
      pisteet.push([t.lat, t.lon]);
    });
    if (typeof layer.addLayers === "function") layer.addLayers(uudet);
    else uudet.forEach(function (m) { layer.addLayer(m); });
    view.pisteet = pisteet;
    if (document.body.dataset.view === "map") sovitaKartta();
  }

  function sovitaKartta() {
    if (!map || !view.pisteet || !view.pisteet.length) return;
    try { map.fitBounds(view.pisteet, { padding: [30, 30], maxZoom: 13 }); } catch (e) { }
  }

  // ---------------------------------------------------------------- drawer
  function rivi(dl, k, v) {
    if (!v) return;
    dl.appendChild(el("dt", null, k));
    var dd = el("dd");
    dd.innerHTML = v;
    dl.appendChild(dd);
  }

  function avaa(id) {
    var t = ALL.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    view.sel = id;
    document.querySelectorAll(".card").forEach(function (c) {
      c.classList.toggle("active", c.dataset.id === id);
    });

    var body = $("#drawerbody");
    body.innerHTML = "";

    var hero = el("div", "dhero");
    if (t.kuvat && t.kuvat.length) {
      var im = el("img"); im.src = t.kuvat[0]; im.alt = t.nimi;
      im.addEventListener("error", function () {
        hero.className = "dhero noimg"; hero.innerHTML = "";
        var f = el("img"); f.src = "assets/brand/emblem-512.png"; f.alt = ""; hero.appendChild(f);
      });
      hero.appendChild(im);
    } else {
      hero.className = "dhero noimg";
      var f0 = el("img"); f0.src = "assets/brand/emblem-512.png"; f0.alt = ""; hero.appendChild(f0);
    }
    body.appendChild(hero);

    var w = el("div", "dwrap");
    var otsikko = el("h2", null, t.nimi);
    var kopionappi = el("button", "kopioi", "⧉");
    kopionappi.title = "Kopioi tallin nimi";
    kopionappi.setAttribute("aria-label", "Kopioi tallin nimi");
    kopionappi.addEventListener("click", function () {
      kopioi(t.nimi, null);
      kopionappi.classList.add("ok");
      setTimeout(function () { kopionappi.classList.remove("ok"); }, 1400);
    });
    otsikko.appendChild(kopionappi);
    w.appendChild(otsikko);
    w.appendChild(el("div", "dsub",
      (t.tyypit || []).join(" · ") + " — " + (t.kunta || "") + ", " + t.maakunta));

    if (t.kuvaus) {
      var p = el("p"); p.textContent = t.kuvaus; p.style.marginTop = "0"; w.appendChild(p);
    }

    // toimintapainikkeet
    var br = el("div", "btnrow");
    if (t.www) {
      var a1 = el("a", "btn primary", "Kotisivu ↗");
      a1.href = t.www.match(/^https?:/) ? t.www : "https://" + t.www;
      a1.target = "_blank"; a1.rel = "noopener"; br.appendChild(a1);
    }
    if (t.lat && t.lon) {
      var a2 = el("a", "btn", "Reittiohjeet ↗");
      a2.href = "https://www.openstreetmap.org/directions?to=" + t.lat + "," + t.lon;
      a2.target = "_blank"; a2.rel = "noopener"; br.appendChild(a2);
      var a3 = el("button", "btn", "Näytä kartalla");
      a3.addEventListener("click", function () {
        sulje();
        naytaNakyma("map");
        setTimeout(function () {
          if (!map) return;
          map.invalidateSize();
          map.setView([t.lat, t.lon], 14);
          var m = markers[t.id];
          if (!m) return;
          // ryhmitellyn merkinnan on ensin avauduttava ryppaastaan
          if (typeof layer.zoomToShowLayer === "function") {
            layer.zoomToShowLayer(m, function () { m.openPopup(); });
          } else {
            m.openPopup();
          }
        }, 120);
      });
      br.appendChild(a3);
    }
    if (t.puhelin && t.puhelin.length) {
      var a4 = el("a", "btn", "Soita " + t.puhelin[0]);
      a4.href = "tel:" + t.puhelin[0].replace(/\s/g, ""); br.appendChild(a4);
    }
    if (t.email && t.email.length) {
      var a5 = el("a", "btn", "Sähköposti");
      a5.href = "mailto:" + t.email[0]; br.appendChild(a5);
    }
    var a6 = el("button", "btn", "Kopioi tiedot");
    a6.addEventListener("click", function () { kopioi(tallinTiedotTekstina(t), a6); });
    br.appendChild(a6);
    w.appendChild(br);

    // perustiedot
    var s1 = el("div", "dsec"); s1.appendChild(el("h4", null, "Perustiedot"));
    var dl = el("dl", "kv");
    rivi(dl, "Kunta", esc(t.kunta));
    rivi(dl, "Osoite", esc([t.osoite, [t.postinumero, t.postitoimipaikka].filter(Boolean).join(" ")]
      .filter(Boolean).join(", ")));
    rivi(dl, "Koordinaatit", t.lat ? t.lat.toFixed(5) + ", " + t.lon.toFixed(5) : "");
    rivi(dl, "Kotisivu", t.www ? '<a href="' + esc(t.www.match(/^https?:/) ? t.www : "https://" + t.www) +
      '" target="_blank" rel="noopener">' + esc(t.www) + "</a>" : "");
    rivi(dl, "Puhelin", (t.puhelin || []).map(esc).join("<br>"));
    rivi(dl, "Sähköposti", (t.email || []).map(function (e) {
      return '<a href="mailto:' + esc(e) + '">' + esc(e) + "</a>";
    }).join("<br>"));
    var some = Object.keys(t.some || {}).map(function (k) {
      return '<a href="' + esc(t.some[k]) + '" target="_blank" rel="noopener">' + esc(k) + "</a>";
    }).join(" · ");
    rivi(dl, "Some", some);
    rivi(dl, "Aukioloajat", esc(t.aukioloajat));
    rivi(dl, "SRL-jäsentalli", t.srl_hyvaksytty ? "Kyllä" : "");
    rivi(dl, "Y-tunnus", esc(t.ytunnus));
    rivi(dl, "Yhtiömuoto", esc(t.yhtiomuoto));
    rivi(dl, "Toimiala", esc(t.toimiala));
    rivi(dl, "Rekisteröity", esc(t.perustettu));
    s1.appendChild(dl); w.appendChild(s1);

    // hevoset
    if (t.hevosia != null || (t.hevoset && t.hevoset.length) || (t.rodut && t.rodut.length) || t.karsinoita != null) {
      var s2 = el("div", "dsec"); s2.appendChild(el("h4", null, "Hevoset"));
      var dl2 = el("dl", "kv");
      rivi(dl2, "Hevosia", t.hevosia != null ? t.hevosia + " kpl" : "");
      rivi(dl2, "Karsinoita", t.karsinoita != null ? t.karsinoita + " kpl" : "");
      rivi(dl2, "Rodut", (t.rodut || []).map(esc).join(", "));
      s2.appendChild(dl2);
      if (t.hevoset && t.hevoset.length) {
        s2.appendChild(el("p", null, "Tallin hevosia (" + t.hevoset.length + "):"));
        var hs = el("div", "horses");
        t.hevoset.forEach(function (h) { hs.appendChild(el("span", "horse", h)); });
        s2.appendChild(hs);
      }
      w.appendChild(s2);
    }

    // hinnat
    if (t.hinnat && t.hinnat.length) {
      var s3 = el("div", "dsec");
      s3.appendChild(el("h4", null, "Hinnat (" + t.hinnat.length + ")"));
      var wrap = el("div", "ptablewrap");
      var tb = el("table", "ptable");
      t.hinnat.forEach(function (h) {
        var tr = el("tr");
        var td = el("td", null, h.nimike);
        if (h.lahde) td.title = "Lähde: " + h.lahde;
        tr.appendChild(td);
        tr.appendChild(el("td", null, euro(h.hinta) + (h.yksikko ? " " + h.yksikko : "")));
        tb.appendChild(tr);
      });
      wrap.appendChild(tb);
      s3.appendChild(wrap);
      s3.appendChild(el("p", "hint", "Hinnat on poimittu automaattisesti tallin verkkosivuilta — tarkista aina ajantasainen hinta tallilta."));
      w.appendChild(s3);
    }

    // palvelut / lajit / tilat
    [["Palvelut", t.palvelut], ["Lajit", t.lajit], ["Tilat ja varusteet", t.tilat]].forEach(function (pair) {
      if (!(pair[1] && pair[1].length)) return;
      var s = el("div", "dsec"); s.appendChild(el("h4", null, pair[0]));
      var tg = el("div", "tags");
      pair[1].forEach(function (x) { tg.appendChild(el("span", "tag", x)); });
      s.appendChild(tg); w.appendChild(s);
    });

    // kuvat
    if (t.kuvat && t.kuvat.length > 1) {
      var s5 = el("div", "dsec"); s5.appendChild(el("h4", null, "Kuvia"));
      var g = el("div", "gal");
      t.kuvat.slice(0, 9).forEach(function (u) {
        var i = el("img"); i.src = u; i.loading = "lazy"; i.alt = t.nimi;
        i.addEventListener("error", function () { i.remove(); });
        g.appendChild(i);
      });
      s5.appendChild(g); w.appendChild(s5);
    }

    // lähteet
    var s6 = el("div", "dsec"); s6.appendChild(el("h4", null, "Lähteet ja tiedon laatu"));
    var ul = el("ul", "srclist");
    (t.lahteet || []).forEach(function (l) { ul.appendChild(el("li", null, l)); });
    (t.sivut_luettu || []).slice(0, 6).forEach(function (u) {
      var li = el("li");
      li.innerHTML = '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u) + "</a>";
      ul.appendChild(li);
    });
    if (t.osm_id) ul.appendChild(el("li", null, "OpenStreetMap: " + t.osm_id));
    s6.appendChild(ul);
    if (t.luottamus_perusteet && t.luottamus_perusteet.length) {
      s6.appendChild(el("p", "hint", "Tunnistettu talliksi: " + t.luottamus_perusteet.join(", ") + "."));
    }
    // Kerro avoimesti miksi kotisivun sisaltoa ei nayteta ja miksi kohde on
    // luokiteltu muuksi kuin talliksi — muuten puuttuva tieto nayttaa virheelta.
    if (t.verkkosivu_hylatty) {
      s6.appendChild(el("p", "hint",
        "Kotisivun sisältöä ei ole käytetty: " + t.verkkosivu_hylatty + "."));
    }
    if (t.piilotettu) {
      s6.appendChild(el("p", "hint",
        "Tätä kohdetta ei näytetä tallina: " + t.piilotus_syy + "."));
    }
    w.appendChild(s6);

    body.appendChild(w);
    $("#drawer").classList.add("open");
    $("#drawer").setAttribute("aria-hidden", "false");
    $("#scrim").classList.add("on");
  }

  function sulje() {
    $("#drawer").classList.remove("open");
    $("#drawer").setAttribute("aria-hidden", "true");
    $("#scrim").classList.remove("on");
  }

  // ---------------------------------------------------------------- päivitys
  function paivita() {
    var lista = jarjesta(ALL.filter(osuu));
    view.list = lista;

    var res = $("#tulokset");
    res.innerHTML = "";
    if (!lista.length) {
      var e = el("div", "empty");
      var i = el("img"); i.src = "assets/brand/emblem-256.png"; i.alt = "";
      e.appendChild(i);
      e.appendChild(el("p", null, "Ei hakuehtoja vastaavia talleja. Väljennä suodattimia."));
      res.appendChild(e);
    } else {
      var frag = document.createDocumentFragment();
      lista.forEach(function (t) { frag.appendChild(kortti(t)); });
      res.appendChild(frag);
    }

    var kartalla = lista.filter(function (t) { return t.lat && t.lon; }).length;
    var kaikki = F.muut ? ALL.length : TALLIT.length;
    $("#count").innerHTML = "<b>" + lista.length + "</b> tallia" +
      (lista.length !== kaikki ? " / " + kaikki : "") +
      ' <span style="color:var(--soft)">· ' + kartalla + " kartalla</span>";

    piirraKartta(lista);
  }

  // ---------------------------------------------------------------- käynnistys
  function init() {
    if (!ALL.length) {
      $("#count").textContent = "Aineistoa ei löytynyt (data/tallit.js puuttuu).";
      return;
    }
    rakennaSuodatin("#f-maakunta", skalaarit("maakunta"), "maakunta");
    rakennaSuodatin("#f-kunta", skalaarit("kunta"), "kunta");
    rakennaSuodatin("#f-tyyppi", arvot("tyypit"), "tyyppi");
    rakennaSuodatin("#f-palvelu", arvot("palvelut"), "palvelu");
    rakennaSuodatin("#f-laji", arvot("lajit"), "laji");
    rakennaSuodatin("#f-tila", arvot("tilat"), "tila");

    $("#footsources").textContent = "Lähteet: " + (DATA.lahteet || []).join(" · ") +
      " — aineisto päivitetty " + (DATA.paivitetty || "");

    var t = null;
    $("#q").addEventListener("input", function (e) {
      clearTimeout(t);
      t = setTimeout(function () { F.q = e.target.value; paivita(); }, 160);
    });
    $("#qclear").addEventListener("click", function () {
      $("#q").value = ""; F.q = ""; paivita(); $("#q").focus();
    });
    $("#sort").addEventListener("change", function (e) { F.sort = e.target.value; paivita(); });

    // kuntalistan rajaus: 300 kuntaa on liikaa selattavaksi
    $("#kuntahaku").addEventListener("input", function (e) {
      var s = norm(e.target.value);
      document.querySelectorAll("#f-kunta label").forEach(function (l) {
        var i = l.querySelector("input");
        l.hidden = !!s && norm(i.value).indexOf(s) < 0 && !i.checked;
      });
    });

    [["#f-hevmin", "hevmin"], ["#f-hevmax", "hevmax"],
     ["#f-hintamin", "hintamin"], ["#f-hintamax", "hintamax"]].forEach(function (p) {
      $(p[0]).addEventListener("input", function (e) {
        var v = e.target.value === "" ? null : Number(e.target.value);
        F[p[1]] = (v == null || isNaN(v)) ? null : v;
        paivita();
      });
    });
    [["#f-srl", "srl"], ["#f-www", "www"], ["#f-kuva", "kuva"], ["#f-hinta", "hinta"],
     ["#f-hevoset", "hevoset"], ["#f-kartta", "kartta"], ["#f-muut", "muut"]].forEach(function (p) {
      $(p[0]).addEventListener("change", function (e) { F[p[1]] = e.target.checked; paivita(); });
    });

    $("#reset").addEventListener("click", function () {
      F = { q: "", maakunta: [], kunta: [], tyyppi: [], palvelu: [], laji: [], tila: [],
            hevmin: null, hevmax: null, hintamin: null, hintamax: null,
            srl: false, www: false, kuva: false, hinta: false, hevoset: false,
            kartta: false, muut: false, sort: F.sort };
      document.querySelectorAll(".filters input").forEach(function (i) {
        if (i.type === "checkbox") i.checked = false; else i.value = "";
      });
      document.querySelectorAll("#f-kunta label").forEach(function (l) { l.hidden = false; });
      $("#q").value = "";
      paivita();
    });

    document.querySelectorAll(".viewtoggle button").forEach(function (b) {
      b.addEventListener("click", function () { naytaNakyma(b.dataset.view); });
    });

    $("#themebtn").addEventListener("click", function () {
      var d = document.documentElement.getAttribute("data-theme") === "dark";
      document.documentElement.setAttribute("data-theme", d ? "light" : "dark");
      try { localStorage.setItem("st-theme", d ? "light" : "dark"); } catch (e) { }
    });
    try {
      var saved = localStorage.getItem("st-theme");
      if (saved) document.documentElement.setAttribute("data-theme", saved);
      else if (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches)
        document.documentElement.setAttribute("data-theme", "dark");
    } catch (e) { }

    $("#filterbtn").addEventListener("click", function () {
      naytaSuodattimet(document.body.classList.contains("filters-piilossa"));
    });
    $("#filterhide").addEventListener("click", function () { naytaSuodattimet(false); });
    $("#filtershow").addEventListener("click", function () {
      naytaSuodattimet(true);
      var f = $("#filters .chk input");
      if (f) f.focus();
    });

    $("#drawerclose").addEventListener("click", sulje);
    $("#scrim").addEventListener("click", sulje);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") sulje();
      if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); }
    });

    initMap();

    // alkutila: kapealla näytöllä suodattimet piilossa, muuten muistettu tila
    var kapea = window.innerWidth <= 860;
    var tallennettu = null;
    try { tallennettu = localStorage.getItem("st-filters"); } catch (e) { }
    naytaSuodattimet(tallennettu ? tallennettu === "auki" : !kapea);

    var nakyma = null;
    try { nakyma = localStorage.getItem("st-view"); } catch (e) { }
    naytaNakyma(nakyma === "map" ? "map" : "list");

    paivita();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
