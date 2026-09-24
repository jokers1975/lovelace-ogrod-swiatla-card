/*
 * ogrod-swiatla-card
 * -------------------------------------------------------------------------
 * Karta Lovelace: oswietlenie ogrodu sterowane wschodem/zachodem slonca.
 *
 *  - animowana pozycja slonca na horyzoncie (dane z sun.sun: azimuth,
 *    elevation, next_rising, next_setting),
 *  - zdjecie/plan ogrodu z lotu ptaka z punktami swietlnymi,
 *  - klikniecie punktu przelacza encje,
 *  - w edytorze: klikniecie w obrazek dodaje punkt, przeciaganie go przesuwa,
 *    do kazdego punktu przypisuje sie encje z listy,
 *  - dwa regulatory: ile minut przed/po zachodzie wlaczyc i przed/po wschodzie
 *    wylaczyc (zapisywane do input_number, zeby czytala je automatyzacja).
 *
 * Wartosc UJEMNA offsetu = PRZED zdarzeniem, DODATNIA = PO zdarzeniu.
 */

const OSC_WERSJA = '1.5.0';

const oscEsc = (s) =>
  String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

const oscTs = (v) => {
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

const oscGodzina = (ms) =>
  ms === null || ms === undefined
    ? '--:--'
    : new Date(ms).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

const oscZacisk = (v, a, b) => Math.max(a, Math.min(b, v));

/* Punkt na krzywej Beziera drugiego stopnia. */
const oscBezier = (t, p0, p1, p2) => {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
};

/* Tryby swiatla, w ktorych da sie ustawic barwe, oraz zamiana hex <-> rgb. */
const OSC_TRYBY_KOLORU = ['hs', 'rgb', 'rgbw', 'rgbww', 'rgbwww', 'xy'];

const oscTryby = (st) => (st && st.attributes && st.attributes.supported_color_modes) || [];
const oscObslugujeKolor = (st) => oscTryby(st).some((m) => OSC_TRYBY_KOLORU.includes(m));
const oscObslugujeTemp = (st) => oscTryby(st).includes('color_temp');

const oscHexNaRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const oscRgbNaHex = (rgb) => Array.isArray(rgb) && rgb.length >= 3
  ? '#' + rgb.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v)))
      .toString(16).padStart(2, '0')).join('')
  : null;

const OSC_P0 = { x: 28, y: 118 };
const OSC_P1 = { x: 200, y: -26 };
const OSC_P2 = { x: 372, y: 118 };

/* Pozycja ciala niebieskiego dla zadanego postepu doby (0..1).
   Za dnia po luku nad horyzontem, noca po plytkim luku pod nim. */
const oscPozycjaCiala = (dzien, t) => (dzien
  ? oscBezier(t, OSC_P0, OSC_P1, OSC_P2)
  : { x: 372 - t * 344, y: 118 + Math.sin(Math.PI * t) * 26 });

/* Faza ksiezyca liczona z miesiaca synodycznego, bez zadnej encji.
   Punkt odniesienia: now 6 stycznia 2000, 18:14 UTC. */
const OSC_NOW_ODN = Date.UTC(2000, 0, 6, 18, 14);
const OSC_MIESIAC = 29.530588853 * 86400000;
const oscFazaKsiezyca = (ts) => {
  const d = (((ts - OSC_NOW_ODN) % OSC_MIESIAC) + OSC_MIESIAC) % OSC_MIESIAC;
  return d / OSC_MIESIAC;              // 0 = now, 0.5 = pelnia
};

const OSC_NAZWY_FAZ = ['now', 'sierp przybywajacy', 'pierwsza kwadra',
  'wypukly przybywajacy', 'pelnia', 'wypukly ubywajacy', 'ostatnia kwadra',
  'sierp ubywajacy'];
const oscNazwaFazy = (f) => OSC_NAZWY_FAZ[Math.floor(((f + 1 / 16) % 1) * 8) % 8];

/*
 * Kontur oswietlonej czesci tarczy. Terminator to polowa elipsy o polosi
 * poziomej r*|cos(2*pi*f)|: przy nowiu rowna promieniowi (nic nie widac),
 * przy kwadrze zero (prosta), przy pelni znowu promieniowi, ale z drugiej
 * strony. Strona oswietlona zalezy od tego, czy ksiezyca przybywa.
 */
const oscSciezkaKsiezyca = (cx, cy, r, f) => {
  const rosnie = f < 0.5;
  const kos = Math.cos(2 * Math.PI * f);
  const rx = Math.abs(kos) * r;
  const zewn = rosnie ? 1 : 0;
  const term = rosnie ? (kos > 0 ? 0 : 1) : (kos > 0 ? 1 : 0);
  return 'M ' + cx + ' ' + (cy - r) +
         ' A ' + r + ' ' + r + ' 0 0 ' + zewn + ' ' + cx + ' ' + (cy + r) +
         ' A ' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + term + ' ' + cx + ' ' + (cy - r) + ' Z';
};

/*
 * Stan slonca na podstawie encji sun.sun. Zwraca doby sloneczna, do ktorej
 * nalezy biezaca chwila, postep 0..1 oraz wspolrzedne do rysowania.
 */
function oscStanSlonca(st) {
  const a = (st && st.attributes) || {};
  const nr = oscTs(a.next_rising);
  const ns = oscTs(a.next_setting);
  const teraz = Date.now();
  if (nr === null || ns === null) return null;

  const dzien = ns < nr;
  const wschod = dzien ? nr - 86400000 : nr;
  const zachod = dzien ? ns : ns - 86400000;

  const postep = dzien
    ? oscZacisk((teraz - wschod) / (zachod - wschod), 0, 1)
    : oscZacisk((teraz - zachod) / (nr - zachod), 0, 1);
  const poz = oscPozycjaCiala(dzien, postep);

  return {
    dzien,
    wschod,
    zachod,
    nastepny_wschod: nr,
    nastepny_zachod: ns,
    postep,
    x: poz.x,
    y: poz.y,
    elewacja: Number(a.elevation),
    azymut: Number(a.azimuth),
  };
}

/* ------------------------------------------------------------------ KARTA */

class OgrodSwiatlaCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement('ogrod-swiatla-card-editor');
  }

  static getStubConfig() {
    return {
      type: 'custom:ogrod-swiatla-card',
      title: 'Oswietlenie ogrodu',
      image: '',
      sun_entity: 'sun.sun',
      offset_zachod_entity: 'input_number.ogrod_offset_zachod',
      offset_wschod_entity: 'input_number.ogrod_offset_wschod',
      dim_max: 0.5,
      automation_entity: '',
      points: [],
    };
  }

  setConfig(config) {
    if (!config) throw new Error('Brak konfiguracji');
    this._config = {
      title: 'Oswietlenie ogrodu',
      sun_entity: 'sun.sun',
      offset_zachod_entity: 'input_number.ogrod_offset_zachod',
      offset_wschod_entity: 'input_number.ogrod_offset_wschod',
      dim_max: 0.5,
      automation_entity: '',
      points: [],
      ...config,
    };
    this._punktyJson = '';
    if (this._zbudowana) {
      this._rysujPunkty();
      this._odswiez();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._zbudowana) this._zbuduj();
    this._odswiez();
  }

  getCardSize() {
    return 10;
  }

  connectedCallback() {
    /* Przy kazdym wejsciu na karte ciało niebieskie wjezdza od wschodu. */
    this._wjechalo = false;
    if (!this._tyk) this._tyk = setInterval(() => this._odswiezSlonce(), 30000);
  }

  disconnectedCallback() {
    if (this._tyk) { clearInterval(this._tyk); this._tyk = null; }
    if (this._klatka) { cancelAnimationFrame(this._klatka); this._klatka = null; }
  }

  _zbuduj() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { overflow: hidden; }
        .naglowek {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 8px; padding: 14px 16px 6px 16px;
        }
        .tytul { font-size: 1.25rem; font-weight: 500; }
        .podtytul { font-size: .8rem; color: var(--secondary-text-color); }
        .konflikt {
          margin: 0 16px 8px; padding: 10px 12px; border-radius: 10px;
          background: rgba(255,152,0,.14); border: 1px solid rgba(255,152,0,.45);
          font-size: .82rem; line-height: 1.4; display: grid; gap: 8px;
        }
        .konflikt-akcje { display: flex; gap: 8px; flex-wrap: wrap; }
        .konflikt button {
          border: none; border-radius: 8px; padding: 7px 12px; cursor: pointer;
          font-size: .8rem;
        }
        .konflikt-rozwiaz { background: var(--primary-color); color: #fff; }
        .konflikt-ignoruj { background: var(--secondary-background-color);
                            color: var(--primary-text-color); }
        .niebo { padding: 0 8px; }
        svg { display: block; width: 100%; height: auto; }
        .info {
          display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px;
          padding: 10px 16px 4px 16px; font-size: .82rem;
        }
        .info div { display: flex; justify-content: space-between; gap: 8px; }
        .info span:last-child { color: var(--primary-text-color); font-weight: 500; }
        .info span:first-child { color: var(--secondary-text-color); }
        .offsety { padding: 8px 16px 14px 16px; display: grid; gap: 8px; }
        .offset {
          display: flex; align-items: center; gap: 10px;
          background: var(--secondary-background-color); border-radius: 12px;
          padding: 8px 10px;
        }
        .offset .opis { flex: 1; font-size: .85rem; line-height: 1.25; }
        .offset .opis b { display: block; font-weight: 500; }
        .offset .opis i { font-style: normal; color: var(--secondary-text-color); font-size: .78rem; }
        .offset button {
          width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer;
          background: var(--card-background-color); color: var(--primary-text-color);
          font-size: 1.1rem; line-height: 1; flex: none;
        }
        .offset button:active { background: var(--primary-color); color: #fff; }
        .offset .wart { min-width: 62px; text-align: center; font-weight: 500; font-size: .9rem; }
        .mapa { position: relative; line-height: 0; background: #0d1b12; }
        .mapa img { width: 100%; display: block; }
        /* Warstwa zmierzchu: lezy NAD zdjeciem, ale POD punktami swietlnymi,
           dzieki czemu poswiata zapalonych lamp pozostaje czytelna. */
        .zmierzch {
          position: absolute; inset: 0; pointer-events: none;
          background: radial-gradient(circle at 50% 32%, #0f1836 0%, #04060e 100%);
          opacity: 0; transition: opacity 3s ease;
        }
        .brak {
          padding: 28px 18px; text-align: center; color: var(--secondary-text-color);
          font-size: .85rem; line-height: 1.5;
        }
        .punkt {
          position: absolute; width: 26px; height: 26px; margin: -13px 0 0 -13px;
          border-radius: 50%; cursor: pointer; border: 2px solid rgba(255,255,255,.85);
          background: rgba(20,20,20,.55); transition: box-shadow .25s, background .25s;
          display: flex; align-items: center; justify-content: center;
        }
        .punkt .rdzen { width: 8px; height: 8px; border-radius: 50%; background: #ddd; }
        /* Najpierw wartosci awaryjne: starsze przegladarki nie znaja color-mix
           i pomijaja nastepne deklaracje, zamiast gubic poswiate. */
        .punkt.swieci {
          background: rgba(255,214,102,.35);
          box-shadow: 0 0 16px 6px rgba(255,208,80,.75);
          background: color-mix(in srgb, var(--osc-kolor, #ffd050) 35%, transparent);
          box-shadow: 0 0 16px 6px color-mix(in srgb, var(--osc-kolor, #ffd050) 75%, transparent);
        }
        .punkt.swieci .rdzen {
          background: #fff3c4;
          background: color-mix(in srgb, var(--osc-kolor, #ffd050) 45%, #fff);
        }
        .punkt.brak-encji { border-style: dashed; border-color: var(--error-color, #d33); }
        .punkt .etykieta {
          position: absolute; top: 28px; left: 50%; transform: translateX(-50%);
          white-space: nowrap; font-size: .68rem; line-height: 1.4; color: #fff;
          background: rgba(0,0,0,.6); padding: 1px 6px; border-radius: 6px;
          pointer-events: none; opacity: 0; transition: opacity .2s;
        }
        .punkt:hover .etykieta { opacity: 1; }
      </style>
      <ha-card>
        <div class="naglowek">
          <span class="tytul"></span>
          <span class="podtytul"></span>
        </div>
        <div class="konflikt" hidden>
          <span class="konflikt-tresc"></span>
          <span class="konflikt-akcje">
            <button class="konflikt-rozwiaz">Wylacz kolidujace</button>
            <button class="konflikt-ignoruj">Ignoruj</button>
          </span>
        </div>
        <div class="niebo">
          <svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="grad-niebo" x1="0" y1="0" x2="0" y2="1">
                <stop class="niebo-g1" offset="0%"/>
                <stop class="niebo-g2" offset="100%"/>
              </linearGradient>
              <radialGradient id="grad-slonce">
                <stop offset="0%" stop-color="#fff8d0"/>
                <stop offset="55%" stop-color="#ffd24a"/>
                <stop offset="100%" stop-color="#ffb300" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="grad-ksiezyc">
                <stop offset="0%" stop-color="#dfe7fb" stop-opacity=".55"/>
                <stop offset="100%" stop-color="#aab8e0" stop-opacity="0"/>
              </radialGradient>
            </defs>
            <rect x="0" y="0" width="400" height="118" fill="url(#grad-niebo)"/>
            <g class="gwiazdy" opacity="0"></g>
            <path d="M28 118 Q200 -26 372 118" fill="none"
                  stroke="rgba(255,255,255,.35)" stroke-width="1"
                  stroke-dasharray="3 5"/>
            <circle class="poswiata" r="26" fill="url(#grad-slonce)"/>
            <circle class="cialo" r="9"/>
            <g class="ksiezyc" opacity="0">
              <circle class="ks-poswiata" r="20" fill="url(#grad-ksiezyc)"/>
              <circle class="ks-tarcza" r="9" fill="#2a3250"/>
              <path class="ks-swiatlo" fill="#eef2fb"/>
            </g>
            <rect x="0" y="118" width="400" height="32" fill="#16351f"/>
            <path d="M0 118 L400 118" stroke="rgba(255,255,255,.35)" stroke-width="1"/>
            <text class="t-wschod" x="28" y="136" font-size="10"
                  text-anchor="middle" fill="rgba(255,255,255,.85)"></text>
            <text class="t-zachod" x="372" y="136" font-size="10"
                  text-anchor="middle" fill="rgba(255,255,255,.85)"></text>
            <text class="t-elew" x="200" y="136" font-size="10"
                  text-anchor="middle" fill="rgba(255,255,255,.7)"></text>
          </svg>
        </div>
        <div class="info">
          <div><span>Wschod</span><span class="i-wschod">--:--</span></div>
          <div><span>Zachod</span><span class="i-zachod">--:--</span></div>
          <div><span>Wlaczenie</span><span class="i-wl">--:--</span></div>
          <div><span>Wylaczenie</span><span class="i-wyl">--:--</span></div>
        </div>
        <div class="offsety"></div>
        <div class="mapa"></div>
      </ha-card>
    `;

    this._el = {
      tytul: this.shadowRoot.querySelector('.tytul'),
      podtytul: this.shadowRoot.querySelector('.podtytul'),
      g1: this.shadowRoot.querySelector('.niebo-g1'),
      g2: this.shadowRoot.querySelector('.niebo-g2'),
      gwiazdy: this.shadowRoot.querySelector('.gwiazdy'),
      poswiata: this.shadowRoot.querySelector('.poswiata'),
      cialo: this.shadowRoot.querySelector('.cialo'),
      ksiezyc: this.shadowRoot.querySelector('.ksiezyc'),
      ksPoswiata: this.shadowRoot.querySelector('.ks-poswiata'),
      ksTarcza: this.shadowRoot.querySelector('.ks-tarcza'),
      ksSwiatlo: this.shadowRoot.querySelector('.ks-swiatlo'),
      konflikt: this.shadowRoot.querySelector('.konflikt'),
      konfliktTresc: this.shadowRoot.querySelector('.konflikt-tresc'),
      tWschod: this.shadowRoot.querySelector('.t-wschod'),
      tZachod: this.shadowRoot.querySelector('.t-zachod'),
      tElew: this.shadowRoot.querySelector('.t-elew'),
      iWschod: this.shadowRoot.querySelector('.i-wschod'),
      iZachod: this.shadowRoot.querySelector('.i-zachod'),
      iWl: this.shadowRoot.querySelector('.i-wl'),
      iWyl: this.shadowRoot.querySelector('.i-wyl'),
      offsety: this.shadowRoot.querySelector('.offsety'),
      mapa: this.shadowRoot.querySelector('.mapa'),
    };

    /* Gwiazdy rysowane raz, pokazywane tylko noca. */
    const losowe = [
      [42, 22], [88, 47], [131, 18], [176, 62], [214, 30], [258, 54],
      [297, 20], [329, 58], [364, 34], [62, 74], [151, 88], [243, 82], [341, 92],
    ];
    this._el.gwiazdy.innerHTML = losowe
      .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 1.4 : 0.9}" fill="#fff" opacity="${0.5 + (i % 4) * 0.12}"/>`)
      .join('');

    this.shadowRoot.querySelector('.konflikt-ignoruj')
      .addEventListener('click', () => {
        this._konfliktUkryty = true;
        this._el.konflikt.hidden = true;
      });
    this.shadowRoot.querySelector('.konflikt-rozwiaz')
      .addEventListener('click', () => this._rozwiazKonflikt());

    this._zbudujOffsety();
    this._zbudowana = true;
    this._rysujPunkty();
  }

  _zbudujOffsety() {
    const wiersz = (klucz, tytul) => `
      <div class="offset" data-klucz="${klucz}">
        <button data-krok="-5" title="mniej">&minus;</button>
        <span class="wart">--</span>
        <button data-krok="5" title="wiecej">+</button>
        <span class="opis"><b>${tytul}</b><i class="wyjasnienie">&mdash;</i></span>
      </div>`;
    this._el.offsety.innerHTML =
      wiersz('zachod', 'Wlacz swiatla') +
      wiersz('wschod', 'Wylacz swiatla');

    this._el.offsety.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const klucz = b.closest('.offset').dataset.klucz;
        const encja = klucz === 'zachod'
          ? this._config.offset_zachod_entity
          : this._config.offset_wschod_entity;
        const st = this._hass && this._hass.states[encja];
        if (!st) return;
        const min = Number(st.attributes.min);
        const max = Number(st.attributes.max);
        const nowa = oscZacisk(Number(st.state) + Number(b.dataset.krok), min, max);
        this._hass.callService('input_number', 'set_value', {
          entity_id: encja, value: nowa,
        });
      });
    });
  }

  /* Przebudowa punktow tylko gdy zmienila sie ich lista, nie przy kazdym stanie. */
  _rysujPunkty() {
    if (!this._zbudowana) return;
    const punkty = Array.isArray(this._config.points) ? this._config.points : [];
    const json = JSON.stringify([this._config.image, punkty]);
    if (json === this._punktyJson) return;
    this._punktyJson = json;

    const mapa = this._el.mapa;
    mapa.innerHTML = '';

    if (!this._config.image) {
      mapa.innerHTML =
        '<div class="brak">Nie wskazano obrazka ogrodu.<br>' +
        'Wgraj zdjecie z lotu ptaka do <code>/config/www/</code> i podaj sciezke ' +
        '<code>/local/nazwa.jpg</code> w edytorze karty.</div>';
      this._el.zmierzch = null;
      return;
    }

    const img = document.createElement('img');
    img.src = this._config.image;
    img.alt = 'Plan ogrodu';
    mapa.appendChild(img);

    const zm = document.createElement('div');
    zm.className = 'zmierzch';
    mapa.appendChild(zm);
    this._el.zmierzch = zm;

    punkty.forEach((p, i) => {
      const d = document.createElement('div');
      d.className = 'punkt';
      d.dataset.idx = String(i);
      d.style.left = (Number(p.x) || 0) + '%';
      d.style.top = (Number(p.y) || 0) + '%';
      d.innerHTML = '<span class="rdzen"></span><span class="etykieta"></span>';
      d.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!p.entity || !this._hass) return;
        const st = this._hass.states[p.entity];
        const swieci = st && st.state === 'on';
        const barwa = oscHexNaRgb(p.color);
        /* Zapalenie lampy z zadana barwa; gaszenie i lampy bez barwy
           obsluguje zwykle przelaczenie. */
        if (!swieci && p.entity.startsWith('light.') && (barwa || p.color_temp_kelvin)) {
          const dane = { entity_id: p.entity };
          if (barwa) dane.rgb_color = barwa;
          else dane.color_temp_kelvin = Number(p.color_temp_kelvin);
          this._hass.callService('light', 'turn_on', dane);
          return;
        }
        this._hass.callService('homeassistant', 'toggle', { entity_id: p.entity });
      });
      mapa.appendChild(d);
    });
  }

  _odswiez() {
    if (!this._zbudowana || !this._hass) return;
    this._rysujPunkty();
    this._el.tytul.textContent = this._config.title || '';
    this._odswiezSlonce();
    this._odswiezOffsety();
    this._odswiezStanyPunktow();
    this._sprawdzKonflikty();
  }

  /*
   * Szuka innych automatyzacji i harmonogramow sterujacych tymi samymi lampami.
   * Automatyzacje znajdujemy przez wyszukiwarke powiazan Home Assistanta,
   * a harmonogramy (np. dodatek Scheduler) po atrybucie entities.
   * Wlasna automatyzacja karty jest z listy wykluczona.
   */
  async _sprawdzKonflikty() {
    if (this._konfliktUkryty || !this._hass) return;
    const encje = [...new Set((this._config.points || [])
      .map((p) => p.entity).filter(Boolean))];
    const klucz = JSON.stringify([encje, this._config.automation_entity]);
    if (klucz === this._konfliktKlucz && this._konfliktyTrwa !== true) {
      this._pokazKonflikt();
      return;
    }
    if (this._konfliktyTrwa) return;
    this._konfliktyTrwa = true;
    this._konfliktKlucz = klucz;

    const znalezione = new Set();
    try {
      if (typeof this._hass.callWS === 'function') {
        for (const enc of encje) {
          try {
            const r = await this._hass.callWS({
              type: 'search/related', item_type: 'entity', item_id: enc,
            });
            (r && r.automation ? r.automation : []).forEach((a) => znalezione.add(a));
          } catch (_) { /* brak uprawnien albo encja bez powiazan */ }
        }
      }
      Object.keys(this._hass.states).forEach((k) => {
        if (!k.startsWith('switch.')) return;
        const lista = this._hass.states[k].attributes.entities;
        if (Array.isArray(lista) && lista.some((x) => encje.includes(x))) znalezione.add(k);
      });
    } finally {
      this._konfliktyTrwa = false;
    }

    znalezione.delete(this._config.automation_entity);
    this._konflikty = [...znalezione].filter((k) => {
      const st = this._hass.states[k];
      return st && st.state === 'on';
    });
    this._pokazKonflikt();
  }

  _pokazKonflikt() {
    const lista = this._konflikty || [];
    if (this._konfliktUkryty || lista.length === 0) {
      this._el.konflikt.hidden = true;
      return;
    }
    const nazwy = lista.map((k) => {
      const st = this._hass.states[k];
      return (st && st.attributes.friendly_name) || k;
    });
    this._el.konfliktTresc.textContent =
      'Te same lampy sa juz sterowane przez: ' + nazwy.join(', ') + '. '
      + 'Beda sie nawzajem nadpisywac.'
      + (this._config.automation_entity
        ? ' Moge je wylaczyc i wlaczyc automatyzacje tej karty.'
        : ' Moge je wylaczyc; wlasna automatyzacje wskaz w edytorze karty.');
    this._el.konflikt.hidden = false;
  }

  async _rozwiazKonflikt() {
    const lista = this._konflikty || [];
    for (const k of lista) {
      const domena = k.split('.')[0];
      try {
        await this._hass.callService(domena, 'turn_off', { entity_id: k });
      } catch (_) { /* brak uprawnien - pomijamy */ }
    }
    if (this._config.automation_entity) {
      try {
        await this._hass.callService('automation', 'turn_on',
          { entity_id: this._config.automation_entity });
      } catch (_) { /* jw. */ }
    }
    this._konflikty = [];
    this._konfliktKlucz = null;
    this._el.konflikt.hidden = true;
  }

  _odswiezSlonce() {
    if (!this._zbudowana || !this._hass) return;
    const st = this._hass.states[this._config.sun_entity || 'sun.sun'];
    const s = oscStanSlonca(st);
    if (!s) return;
    this._slonce = s;

    const e = this._el;
    const elew = s.elewacja;

    let g1; let g2; let kolorCiala; let poswiataOpacity; let gwiazdyOpacity;
    if (elew > 12) {
      g1 = '#2f7fd4'; g2 = '#8fc4ee'; kolorCiala = '#ffd24a';
      poswiataOpacity = 1; gwiazdyOpacity = 0;
    } else if (elew > 0) {
      g1 = '#3a4f88'; g2 = '#f0a05a'; kolorCiala = '#ff9c33';
      poswiataOpacity = 1; gwiazdyOpacity = 0.15;
    } else if (elew > -8) {
      g1 = '#20264d'; g2 = '#8a5a54'; kolorCiala = '#d97a2b';
      poswiataOpacity = 0.6; gwiazdyOpacity = 0.5;
    } else {
      g1 = '#0b1026'; g2 = '#1d2a4a'; kolorCiala = '#e8ecf5';
      poswiataOpacity = 0; gwiazdyOpacity = 1;
    }

    e.g1.setAttribute('stop-color', g1);
    e.g2.setAttribute('stop-color', g2);
    e.gwiazdy.setAttribute('opacity', String(gwiazdyOpacity));
    e.cialo.setAttribute('fill', kolorCiala);
    this._slonceWidoczne = elew > -6;
    this._poswiataOpacity = this._slonceWidoczne ? poswiataOpacity : 0;

    /* Przyciemnienie podworka: pelne slonce -> brak, zmrok -> dim_max.
       Przejscie liniowe miedzy +8 a -8 stopnia wysokosci slonca. */
    if (e.zmierzch) {
      const GORA = 8, DOL = -8;
      const maks = Math.max(0, Math.min(1, Number(this._config.dim_max)));
      let f;
      if (!Number.isFinite(elew)) f = 0;
      else if (elew >= GORA) f = 0;
      else if (elew <= DOL) f = 1;
      else f = (GORA - elew) / (GORA - DOL);
      e.zmierzch.style.opacity = String(f * (Number.isFinite(maks) ? maks : 0.5));
    }

    /* Wjazd od wschodu do biezacej pozycji przy pierwszym pokazaniu karty. */
    if (!this._wjechalo && !this._klatka) {
      const CZAS = 2500;
      const start = performance.now();
      const klatka = (chwila) => {
        const u = Math.min(1, (chwila - start) / CZAS);
        this._rysujCialo(s, s.postep * (1 - Math.pow(1 - u, 3)));
        if (u < 1) {
          this._klatka = requestAnimationFrame(klatka);
        } else {
          this._klatka = null;
          this._wjechalo = true;
        }
      };
      this._klatka = requestAnimationFrame(klatka);
    } else if (!this._klatka) {
      this._rysujCialo(s, s.postep);
    }

    e.tWschod.textContent = oscGodzina(s.wschod);
    e.tZachod.textContent = oscGodzina(s.zachod);
    e.tElew.textContent = Number.isFinite(elew) ? elew.toFixed(1) + '°' : '';
    e.iWschod.textContent = oscGodzina(s.wschod);
    e.iZachod.textContent = oscGodzina(s.zachod);
    // Etykieta z wysokosci slonca, nie z kolejnosci wschodu/zachodu -
    // dzieki temu zawsze zgadza sie z przyciemnieniem podworka.
    if (Number.isFinite(elew) && elew > 0) {
      e.podtytul.textContent = 'dzien';
    } else {
      e.podtytul.textContent = 'noc \u00B7 ' + oscNazwaFazy(oscFazaKsiezyca(Date.now()));
    }

    const offZ = this._offset('zachod');
    const offW = this._offset('wschod');
    e.iWl.textContent = offZ === null ? '--:--' : oscGodzina(s.nastepny_zachod + offZ * 60000);
    e.iWyl.textContent = offW === null ? '--:--' : oscGodzina(s.nastepny_wschod + offW * 60000);
  }

  /*
   * Umieszcza slonce albo ksiezyc w pozycji odpowiadajacej postepowi t (0..1).
   * Wywolywane zarowno przez animacje wjazdu, jak i przy zwyklym odswiezeniu.
   */
  _rysujCialo(s, t) {
    const e = this._el;
    const poz = oscPozycjaCiala(s.dzien, t);
    const x = poz.x.toFixed(1);
    const y = poz.y.toFixed(1);

    if (this._slonceWidoczne) {
      e.cialo.setAttribute('cx', x);
      e.cialo.setAttribute('cy', y);
      e.cialo.setAttribute('opacity', '1');
      e.poswiata.setAttribute('cx', x);
      e.poswiata.setAttribute('cy', y);
      e.poswiata.setAttribute('opacity', String(this._poswiataOpacity));
      e.ksiezyc.setAttribute('opacity', '0');
      return;
    }

    /* Po zmierzchu slonce znika, a jego miejsce zajmuje ksiezyc z faza. */
    e.cialo.setAttribute('opacity', '0');
    e.poswiata.setAttribute('opacity', '0');
    e.ksiezyc.setAttribute('opacity', '1');
    e.ksPoswiata.setAttribute('cx', x);
    e.ksPoswiata.setAttribute('cy', y);
    e.ksTarcza.setAttribute('cx', x);
    e.ksTarcza.setAttribute('cy', y);
    e.ksSwiatlo.setAttribute('d',
      oscSciezkaKsiezyca(Number(x), Number(y), 9, oscFazaKsiezyca(Date.now())));
  }

  _offset(klucz) {
    const encja = klucz === 'zachod'
      ? this._config.offset_zachod_entity
      : this._config.offset_wschod_entity;
    const st = this._hass && this._hass.states[encja];
    if (!st) return null;
    const v = Number(st.state);
    return Number.isFinite(v) ? v : null;
  }

  _odswiezOffsety() {
    ['zachod', 'wschod'].forEach((klucz) => {
      const rzad = this._el.offsety.querySelector('.offset[data-klucz="' + klucz + '"]');
      if (!rzad) return;
      const v = this._offset(klucz);
      const wart = rzad.querySelector('.wart');
      const wyj = rzad.querySelector('.wyjasnienie');
      // 'przed' wymaga narzednika, 'po' i 'o' - miejscownika
      const narzednik = klucz === 'zachod' ? 'zachodem' : 'wschodem';
      const miejscownik = klucz === 'zachod' ? 'zachodzie' : 'wschodzie';
      if (v === null) {
        wart.textContent = '—';
        wyj.textContent = 'brak encji ' +
          (klucz === 'zachod' ? this._config.offset_zachod_entity : this._config.offset_wschod_entity);
        return;
      }
      wart.textContent = (v > 0 ? '+' : '') + v + ' min';
      if (v === 0) wyj.textContent = 'dokladnie o ' + miejscownik;
      else if (v < 0) wyj.textContent = Math.abs(v) + ' min przed ' + narzednik;
      else wyj.textContent = v + ' min po ' + miejscownik;
    });
  }

  _odswiezStanyPunktow() {
    const punkty = Array.isArray(this._config.points) ? this._config.points : [];
    this._el.mapa.querySelectorAll('.punkt').forEach((d) => {
      const p = punkty[Number(d.dataset.idx)];
      if (!p) return;
      const st = p.entity && this._hass.states[p.entity];
      d.classList.toggle('brak-encji', !st);
      d.classList.toggle('swieci', !!st && st.state === 'on');
      /* Poswiata przyjmuje barwe, ktora lampa faktycznie swieci,
         a gdy jej nie podaje - barwe z konfiguracji punktu. */
      const barwa = (st && st.attributes && oscRgbNaHex(st.attributes.rgb_color))
        || p.color || null;
      if (barwa) d.style.setProperty('--osc-kolor', barwa);
      else d.style.removeProperty('--osc-kolor');
      const nazwa = p.name
        || (st && st.attributes.friendly_name)
        || p.entity
        || 'nieprzypisany punkt';
      const stan = !st ? 'niedostepna' : (st.state === 'on' ? 'wlaczone' : 'wylaczone');
      d.querySelector('.etykieta').textContent = nazwa + ' · ' + stan;
    });
  }
}

/* ---------------------------------------------------------------- EDYTOR */

/* Definicje helperow offsetu tworzonych na zadanie z kreatora. */
const OSC_HELPERY = {
  offset_zachod_entity: {
    name: 'Ogrod - wlacz wzgledem zachodu',
    icon: 'mdi:weather-sunset-down',
  },
  offset_wschod_entity: {
    name: 'Ogrod - wylacz wzgledem wschodu',
    icon: 'mdi:weather-sunset-up',
  },
};

class OgrodSwiatlaCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { points: [], ...config };
    this._render();
  }

  set hass(hass) {
    const pierwszy = !this._hass;
    this._hass = hass;
    if (pierwszy) this._render();
  }

  _zmiana() {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }

  _ustaw(zmiany, przerysuj) {
    this._config = { ...this._config, ...zmiany };
    this._zmiana();
    if (przerysuj) this._render();
  }

  _listaEncji() {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter((e) => e.startsWith('light.') || e.startsWith('switch.'))
      .sort();
  }

  _istnieje(encja) {
    return !!(encja && this._hass && this._hass.states[encja]);
  }

  /*
   * Wysylka zdjecia przez wbudowane API obrazow Home Assistanta.
   * Plik ladzie w magazynie HA i dostaje trwaly adres
   * /api/image/serve/<id>/original - nic nie trzeba kopiowac do /config/www.
   */
  async _wgrajZdjecie(plik) {
    if (!plik) return;
    const stan = this.querySelector('.osc-stan-zdjecie');
    if (!this._hass || typeof this._hass.fetchWithAuth !== 'function') {
      if (stan) stan.textContent = 'Ta wersja Home Assistanta nie udostepnia wysylki obrazow. '
        + 'Skopiuj plik do /config/www i podaj sciezke /local/nazwa.jpg.';
      return;
    }
    if (stan) stan.textContent = 'Wysylanie...';
    try {
      const dane = new FormData();
      dane.append('file', plik);
      const odp = await this._hass.fetchWithAuth('/api/image/upload', { method: 'POST', body: dane });
      if (!odp.ok) throw new Error('HTTP ' + odp.status);
      const wynik = await odp.json();
      if (!wynik || !wynik.id) throw new Error('brak identyfikatora w odpowiedzi');
      this._ustaw({ image: '/api/image/serve/' + wynik.id + '/original' }, true);
    } catch (e) {
      if (stan) stan.textContent = 'Nie udalo sie wyslac: ' + e.message;
    }
  }

  /*
   * Tworzenie brakujacych input_number przez API Home Assistanta.
   * Encji nie da sie przewidziec z nazwy, wiec po utworzeniu szukamy jej
   * w stanach po nazwie przyjaznej.
   */
  async _utworzHelpery() {
    const stan = this.querySelector('.osc-stan-helpery');
    if (!this._hass || typeof this._hass.callWS !== 'function') {
      if (stan) stan.textContent = 'Brak dostepu do API - dodaj helpery recznie.';
      return;
    }
    if (stan) stan.textContent = 'Tworzenie...';
    const zmiany = {};
    try {
      for (const [klucz, def] of Object.entries(OSC_HELPERY)) {
        if (this._istnieje(this._config[klucz])) continue;
        await this._hass.callWS({
          type: 'input_number/create',
          name: def.name,
          icon: def.icon,
          min: -120,
          max: 120,
          step: 5,
          mode: 'box',
          unit_of_measurement: 'min',
        });
        let encja = null;
        for (let i = 0; i < 25 && !encja; i++) {
          await new Promise((r) => setTimeout(r, 150));
          encja = Object.keys(this._hass.states).find((e) =>
            e.startsWith('input_number.') &&
            this._hass.states[e].attributes.friendly_name === def.name);
        }
        if (!encja) throw new Error('utworzono, ale nie odnaleziono encji ' + def.name);
        zmiany[klucz] = encja;
      }
      if (stan) stan.textContent = 'Gotowe.';
      if (Object.keys(zmiany).length) this._ustaw(zmiany, true);
      else this._render();
    } catch (e) {
      if (stan) stan.textContent = 'Nie udalo sie utworzyc: ' + e.message;
    }
  }

  /*
   * Panel zaznaczonego punktu. Gdy encja jest zrodlem swiatla obslugujacym
   * barwe, dochodzi wybor koloru; gdy tylko biel regulowana - temperatura.
   */
  _panelPunktu(i, punkt, opcje) {
    const st = punkt.entity ? this._hass.states[punkt.entity] : null;
    const kolorowa = st && punkt.entity.startsWith('light.') && oscObslugujeKolor(st);
    const bialaReg = st && punkt.entity.startsWith('light.')
      && !kolorowa && oscObslugujeTemp(st);

    let barwa = '';
    if (kolorowa) {
      const domyslny = punkt.color
        || (st.attributes && oscRgbNaHex(st.attributes.rgb_color))
        || '#ffd07a';
      barwa = `
        <div class="osc-barwa">
          <label>Barwa zapalenia
            <input type="color" data-rola="kolor" value="${oscEsc(domyslny)}">
          </label>
          <button type="button" data-rola="kolor-czysc">Bez wymuszania</button>
          <span>${punkt.color
            ? 'Karta zapali te lampe w tej barwie.'
            : 'Ta lampa obsluguje kolor. Wybierz barwe, jesli chcesz, zeby'
              + ' karta zapalala ja zawsze tak samo.'}</span>
        </div>`;
    } else if (bialaReg) {
      barwa = `
        <div class="osc-barwa">
          <label>Temperatura barwowa (K)
            <input type="text" data-rola="kelwiny"
                   value="${oscEsc(punkt.color_temp_kelvin || '')}"
                   placeholder="np. 2700">
          </label>
          <button type="button" data-rola="kolor-czysc">Bez wymuszania</button>
          <span>Ta lampa pozwala regulowac biel.</span>
        </div>`;
    }

    return `
      <div class="osc-panel">
        <div class="osc-panel-rzad">
          <b>Punkt ${i + 1}</b>
          <select data-rola="encja-wybrany">${opcje(punkt.entity)}</select>
          <button type="button" class="usun" data-rola="usun-wybrany">Usun punkt</button>
        </div>
        ${barwa}
      </div>`;
  }

  _render() {
    if (!this._config || !this._hass) return;
    const cfg = this._config;
    const punkty = Array.isArray(cfg.points) ? cfg.points : [];
    if (this._wybrany !== undefined && this._wybrany >= punkty.length) this._wybrany = undefined;
    const encje = this._listaEncji();

    const opcje = (wybrana) =>
      '<option value="">-- wybierz encje --</option>' +
      encje.map((e) => {
        const st = this._hass.states[e];
        const n = (st && st.attributes.friendly_name) || e;
        return '<option value="' + oscEsc(e) + '"' + (e === wybrana ? ' selected' : '') +
          '>' + oscEsc(n) + ' (' + oscEsc(e) + ')</option>';
      }).join('');

    const w = this._wybrany;
    const wybranyPunkt = w === undefined ? null : punkty[w];

    const przypisane = punkty.filter((p) => p.entity).length;
    const helperyOk = this._istnieje(cfg.offset_zachod_entity)
      && this._istnieje(cfg.offset_wschod_entity);
    const znacznik = (ok) => ok
      ? '<span class="osc-ok">gotowe</span>'
      : '<span class="osc-todo">do zrobienia</span>';

    this.innerHTML = `
      <style>
        .osc-ed { display: grid; gap: 14px; padding: 4px 0; }
        .osc-ed label { display: grid; gap: 4px; font-size: .85rem; }
        .osc-ed input[type=text] {
          padding: 8px; border-radius: 8px; border: 1px solid var(--divider-color);
          background: var(--card-background-color); color: var(--primary-text-color);
        }
        .osc-krok { border: 1px solid var(--divider-color); border-radius: 12px; padding: 12px; }
        .osc-krok > h4 {
          margin: 0 0 10px; font-size: .95rem; display: flex; align-items: center; gap: 8px;
        }
        .osc-krok > h4 .nr {
          width: 22px; height: 22px; border-radius: 50%; flex: none;
          background: var(--primary-color); color: #fff; font-size: .78rem;
          display: flex; align-items: center; justify-content: center;
        }
        .osc-ok, .osc-todo {
          margin-left: auto; font-size: .7rem; font-weight: 600; letter-spacing: .02em;
          padding: 2px 8px; border-radius: 999px;
        }
        .osc-ok { background: rgba(46,125,50,.16); color: #2e7d32; }
        .osc-todo { background: rgba(211,51,51,.14); color: var(--error-color, #d33); }
        .osc-akcja {
          display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
          background: var(--secondary-background-color);
          border-radius: 10px; padding: 10px; margin-bottom: 10px;
        }
        .osc-akcja button {
          border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer;
          background: var(--primary-color); color: #fff; font-size: .85rem;
        }
        .osc-akcja span { font-size: .78rem; color: var(--secondary-text-color); flex: 1;
                          min-width: 150px; }
        .osc-plotno { position: relative; line-height: 0; border-radius: 10px; overflow: hidden;
                      border: 1px solid var(--divider-color); cursor: crosshair;
                      touch-action: none; user-select: none; }
        .osc-plotno img { width: 100%; display: block; -webkit-user-drag: none; }
        .osc-pkt { position: absolute; width: 24px; height: 24px; margin: -12px 0 0 -12px;
                   border-radius: 50%; background: rgba(255,193,7,.9);
                   border: 2px solid #fff; cursor: grab; color: #222; font-size: .72rem;
                   display: flex; align-items: center; justify-content: center;
                   font-weight: 700; touch-action: none; }
        .osc-pkt.wybrany { background: #03a9f4; color: #fff;
                           box-shadow: 0 0 0 4px rgba(3,169,244,.35); }
        .osc-pkt.pusty { border-style: dashed; }
        .osc-panel { display: grid; gap: 10px;
                     background: var(--secondary-background-color);
                     border-radius: 10px; padding: 10px; margin-top: 10px; }
        .osc-panel-rzad { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .osc-barwa { display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
                     border-top: 1px solid var(--divider-color); padding-top: 10px; }
        .osc-barwa label { flex: none; }
        .osc-barwa input[type=color] { width: 54px; height: 32px; padding: 2px;
                                       border: 1px solid var(--divider-color);
                                       border-radius: 8px; background: none; cursor: pointer; }
        .osc-barwa input[type=text] { width: 90px; }
        .osc-barwa button { border: none; border-radius: 8px; padding: 7px 10px;
                            cursor: pointer; font-size: .78rem;
                            background: var(--card-background-color);
                            color: var(--primary-text-color); }
        .osc-barwa span { flex: 1; min-width: 150px; font-size: .76rem;
                          color: var(--secondary-text-color); line-height: 1.35; }
        .osc-panel b { font-size: .85rem; }
        .osc-panel select { flex: 1; min-width: 150px; padding: 6px; border-radius: 8px;
                            border: 1px solid var(--divider-color);
                            background: var(--card-background-color);
                            color: var(--primary-text-color); }
        .osc-panel .usun { border: none; background: var(--error-color, #d33); color: #fff;
                           border-radius: 8px; padding: 7px 12px; cursor: pointer; }
        .osc-lista { display: grid; gap: 8px; margin-top: 10px; }
        .osc-wiersz { display: flex; gap: 6px; align-items: center; padding: 3px;
                      border-radius: 8px; }
        .osc-wiersz.wybrany { background: rgba(3,169,244,.16); }
        .osc-wiersz .nr { width: 22px; text-align: center; font-weight: 700; font-size: .8rem; }
        .osc-wiersz select { flex: 1; padding: 6px; border-radius: 8px; max-width: 100%;
                             border: 1px solid var(--divider-color);
                             background: var(--card-background-color);
                             color: var(--primary-text-color); }
        .osc-wiersz button { border: none; background: var(--error-color, #d33); color: #fff;
                             border-radius: 8px; padding: 6px 10px; cursor: pointer; }
        .osc-info { font-size: .8rem; color: var(--secondary-text-color); line-height: 1.5; }
        .osc-brak { padding: 22px; text-align: center; font-size: .82rem;
                    color: var(--secondary-text-color);
                    border: 1px dashed var(--divider-color); border-radius: 10px; }
        .osc-zaawansowane summary { font-size: .82rem; cursor: pointer;
                                    color: var(--secondary-text-color); }
        .osc-zaawansowane[open] summary { margin-bottom: 10px; }
        .osc-zaawansowane > div { display: grid; gap: 10px; }
        .osc-krok label select { padding: 7px; border-radius: 8px; max-width: 100%;
                                 border: 1px solid var(--divider-color);
                                 background: var(--card-background-color);
                                 color: var(--primary-text-color); }
      </style>
      <div class="osc-ed">

        <div class="osc-krok">
          <h4><span class="nr">1</span> Zdjecie ogrodu ${znacznik(!!cfg.image)}</h4>
          <div class="osc-akcja">
            <button type="button" class="osc-btn-wgraj">Wgraj zdjecie</button>
            <input type="file" accept="image/*" class="osc-plik" hidden>
            <span class="osc-stan-zdjecie">Wlasne zdjecie z lotu ptaka albo zrzut
              z portalu geodezyjnego. Plik trafia do magazynu Home Assistanta.</span>
          </div>
          <label>Adres zdjecia
            <input type="text" data-pole="image" value="${oscEsc(cfg.image || '')}">
          </label>
        </div>

        <div class="osc-krok">
          <h4><span class="nr">2</span> Lampy
            ${znacznik(punkty.length > 0 && przypisane === punkty.length)}</h4>
          <div class="osc-info">
            Klikniecie w wolne miejsce obrazka <b>dodaje punkt</b>.
            Przytrzymanie i przeciagniecie punktu <b>przesuwa</b> go.
            Klikniecie w gotowy punkt <b>zaznacza</b> go &mdash; wtedy mozna przypisac
            mu encje albo go skasowac.
            ${punkty.length
              ? '<br>Punktow: ' + punkty.length + ', z przypisana encja: ' + przypisane + '.'
              : ''}
          </div>
          ${cfg.image
            ? `<div class="osc-plotno" style="margin-top:10px">
                 <img src="${oscEsc(cfg.image)}" alt="">
                 ${punkty.map((p, i) =>
                   `<div class="osc-pkt${i === w ? ' wybrany' : ''}${p.entity ? '' : ' pusty'}"
                         data-idx="${i}"
                         style="left:${Number(p.x) || 0}%;top:${Number(p.y) || 0}%">${i + 1}</div>`
                 ).join('')}
               </div>`
            : '<div class="osc-brak" style="margin-top:10px">Najpierw dodaj zdjecie w kroku 1.</div>'}
          ${wybranyPunkt ? this._panelPunktu(w, wybranyPunkt, opcje) : ''}
          <div class="osc-lista">
            ${punkty.map((p, i) => `
                <div class="osc-wiersz${i === w ? ' wybrany' : ''}" data-idx="${i}">
                  <span class="nr">${i + 1}</span>
                  <select data-rola="encja">${opcje(p.entity)}</select>
                  <button type="button" data-rola="usun" title="usun punkt">&#10005;</button>
                </div>`).join('')}
          </div>
        </div>

        <div class="osc-krok">
          <h4><span class="nr">3</span> Sterowanie sloncem ${znacznik(helperyOk)}</h4>
          ${helperyOk
            ? '<div class="osc-info">Helpery offsetow sa podlaczone. Wartosci ustawisz'
              + ' juz na samej karcie.</div>'
            : `<div class="osc-akcja">
                 <button type="button" class="osc-btn-helpery">Utworz helpery</button>
                 <span class="osc-stan-helpery">Karta potrzebuje dwoch encji input_number
                   na przesuniecia wzgledem zachodu i wschodu. Moge je zalozyc automatycznie.</span>
               </div>`}
          <label>Maksymalne przyciemnienie nocne (0 = brak, 1 = czern)
            <input type="text" data-pole="dim_max" value="${oscEsc(cfg.dim_max === undefined ? 0.5 : cfg.dim_max)}">
          </label>
        </div>

        <div class="osc-krok">
          <h4><span class="nr">4</span> Automatyzacja
            ${znacznik(this._istnieje(cfg.automation_entity))}</h4>
          <div class="osc-info">
            Karta pokazuje stan i pozwala ustawic przesuniecia, ale swiatla
            przelacza automatyzacja. Wskaz ja tutaj, a karta wykryje inne
            automatyzacje i harmonogramy sterujace tymi samymi lampami
            i zaproponuje ich wylaczenie. Gotowy przyklad automatyzacji
            znajdziesz w README dodatku.
          </div>
          <label style="margin-top:10px">Automatyzacja tej karty
            <select data-rola="automatyzacja">
              <option value="">-- brak --</option>
              ${Object.keys(this._hass.states)
                .filter((e) => e.startsWith('automation.')).sort()
                .map((e) => {
                  const n = this._hass.states[e].attributes.friendly_name || e;
                  return '<option value="' + oscEsc(e) + '"' +
                    (e === cfg.automation_entity ? ' selected' : '') + '>' +
                    oscEsc(n) + '</option>';
                }).join('')}
            </select>
          </label>
        </div>

        <details class="osc-zaawansowane osc-krok">
          <summary>Ustawienia zaawansowane</summary>
          <div>
            <label>Tytul
              <input type="text" data-pole="title" value="${oscEsc(cfg.title || '')}">
            </label>
            <label>Encja slonca
              <input type="text" data-pole="sun_entity" value="${oscEsc(cfg.sun_entity || 'sun.sun')}">
            </label>
            <label>Encja offsetu zachodu (wlaczenie)
              <input type="text" data-pole="offset_zachod_entity" value="${oscEsc(cfg.offset_zachod_entity || '')}">
            </label>
            <label>Encja offsetu wschodu (wylaczenie)
              <input type="text" data-pole="offset_wschod_entity" value="${oscEsc(cfg.offset_wschod_entity || '')}">
            </label>
          </div>
        </details>
      </div>
    `;

    this.querySelectorAll('input[data-pole]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const pole = inp.dataset.pole;
        const wart = pole === 'dim_max'
          ? Math.max(0, Math.min(1, parseFloat(inp.value.replace(',', '.')) || 0))
          : inp.value.trim();
        this._ustaw({ [pole]: wart }, true);
      });
    });

    const plik = this.querySelector('.osc-plik');
    this.querySelector('.osc-btn-wgraj').addEventListener('click', () => plik.click());
    plik.addEventListener('change', () => this._wgrajZdjecie(plik.files && plik.files[0]));

    const selAuto = this.querySelector('select[data-rola="automatyzacja"]');
    if (selAuto) selAuto.addEventListener('change', () =>
      this._ustaw({ automation_entity: selAuto.value }, true));

    const btnHelpery = this.querySelector('.osc-btn-helpery');
    if (btnHelpery) btnHelpery.addEventListener('click', () => this._utworzHelpery());

    const zmienEncje = (i, wartosc) => {
      const nowe = this._config.points.slice();
      nowe[i] = { ...nowe[i], entity: wartosc };
      this._ustaw({ points: nowe }, true);
    };
    const usunPunkt = (i) => {
      const nowe = this._config.points.slice();
      nowe.splice(i, 1);
      if (this._wybrany === i) this._wybrany = undefined;
      else if (this._wybrany > i) this._wybrany -= 1;
      this._ustaw({ points: nowe }, true);
    };

    const zmienPunkt = (i, zmiany) => {
      const nowe = this._config.points.slice();
      nowe[i] = { ...nowe[i], ...zmiany };
      if (nowe[i].color === undefined) delete nowe[i].color;
      if (nowe[i].color_temp_kelvin === undefined) delete nowe[i].color_temp_kelvin;
      this._ustaw({ points: nowe }, true);
    };
    const inpKolor = this.querySelector('input[data-rola="kolor"]');
    if (inpKolor) inpKolor.addEventListener('change', () =>
      zmienPunkt(w, { color: inpKolor.value, color_temp_kelvin: undefined }));
    const inpKelwiny = this.querySelector('input[data-rola="kelwiny"]');
    if (inpKelwiny) inpKelwiny.addEventListener('change', () => {
      const k = parseInt(inpKelwiny.value, 10);
      zmienPunkt(w, {
        color_temp_kelvin: Number.isFinite(k) && k > 0 ? k : undefined,
        color: undefined,
      });
    });
    const btnCzysc = this.querySelector('button[data-rola="kolor-czysc"]');
    if (btnCzysc) btnCzysc.addEventListener('click', () =>
      zmienPunkt(w, { color: undefined, color_temp_kelvin: undefined }));

    const selWybrany = this.querySelector('select[data-rola="encja-wybrany"]');
    if (selWybrany) selWybrany.addEventListener('change', () => zmienEncje(w, selWybrany.value));
    const usunWybrany = this.querySelector('button[data-rola="usun-wybrany"]');
    if (usunWybrany) usunWybrany.addEventListener('click', () => usunPunkt(w));

    this.querySelectorAll('select[data-rola="encja"]').forEach((sel) => {
      sel.addEventListener('change', () =>
        zmienEncje(Number(sel.closest('.osc-wiersz').dataset.idx), sel.value));
    });
    this.querySelectorAll('button[data-rola="usun"]').forEach((b) => {
      b.addEventListener('click', () =>
        usunPunkt(Number(b.closest('.osc-wiersz').dataset.idx)));
    });

    const plotno = this.querySelector('.osc-plotno');
    if (plotno) this._podepnijPlotno(plotno);
  }

  _podepnijPlotno(plotno) {
    /* Zwraca null, gdy plotno nie ma jeszcze rozmiaru (obrazek sie doczytuje
       albo element zostal odlaczony po przerysowaniu). Bez tego dzielenie
       przez zero wrzucaloby punkt w naroznik. */
    const wzgledne = (ev) => {
      const r = plotno.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return {
        x: oscZacisk(((ev.clientX - r.left) / r.width) * 100, 0, 100),
        y: oscZacisk(((ev.clientY - r.top) / r.height) * 100, 0, 100),
      };
    };

    /* Dodanie punktu w wolnym miejscu. Po przeciagnieciu klik jest pomijany. */
    plotno.addEventListener('click', (ev) => {
      if (this._przeciagano) { this._przeciagano = false; return; }
      if (ev.target.closest('.osc-pkt')) return;
      const poz = wzgledne(ev);
      if (!poz) return;
      const { x, y } = poz;
      const nowe = [...(this._config.points || []), { entity: '', x: +x.toFixed(2), y: +y.toFixed(2) }];
      this._wybrany = nowe.length - 1;
      this._ustaw({ points: nowe }, true);
    });

    /* Pointer Events zamiast mysich - dziala tak samo pod palcem na tablecie. */
    plotno.querySelectorAll('.osc-pkt').forEach((d) => {
      d.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const i = Number(d.dataset.idx);
        const start = { x: ev.clientX, y: ev.clientY };
        let ruszono = false;
        d.setPointerCapture(ev.pointerId);

        const ruch = (e2) => {
          if (!ruszono &&
              Math.abs(e2.clientX - start.x) < 4 && Math.abs(e2.clientY - start.y) < 4) return;
          const poz = wzgledne(e2);
          if (!poz) return;
          ruszono = true;
          const { x, y } = poz;
          d.style.left = x + '%';
          d.style.top = y + '%';
          d.dataset.x = x.toFixed(2);
          d.dataset.y = y.toFixed(2);
        };
        const koniec = () => {
          d.removeEventListener('pointermove', ruch);
          d.removeEventListener('pointerup', koniec);
          d.removeEventListener('pointercancel', koniec);
          if (!ruszono) {
            this._wybrany = (this._wybrany === i) ? undefined : i;
            this._render();
            return;
          }
          this._przeciagano = true;
          const nowe = this._config.points.slice();
          nowe[i] = { ...nowe[i], x: Number(d.dataset.x), y: Number(d.dataset.y) };
          this._ustaw({ points: nowe }, false);
        };
        d.addEventListener('pointermove', ruch);
        d.addEventListener('pointerup', koniec);
        d.addEventListener('pointercancel', koniec);
      });
    });
  }
}

customElements.define('ogrod-swiatla-card', OgrodSwiatlaCard);
customElements.define('ogrod-swiatla-card-editor', OgrodSwiatlaCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'ogrod-swiatla-card',
  name: 'Oswietlenie ogrodu',
  description: 'Plan ogrodu z punktami swietlnymi i animacja pozycji slonca.',
  preview: false,
});

console.info('%c OGROD-SWIATLA-CARD %c ' + OSC_WERSJA + ' ',
  'color:#fff;background:#2e7d32;font-weight:700',
  'color:#2e7d32;background:#fff');
