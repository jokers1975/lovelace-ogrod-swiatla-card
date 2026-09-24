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

const OSC_WERSJA = '2.2.0';

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

/* Przelicznik na kilometry na godzine - encje pogody podaja rozne jednostki. */
const OSC_WIATR_NA_KMH = {
  'km/h': 1, 'm/s': 3.6, 'mph': 1.609344, kn: 1.852, 'ft/s': 1.09728,
};

/* Zachmurzenie w procentach, gdy encja nie poda go wprost. */
const OSC_ZACHMURZENIE = {
  sunny: 5, 'clear-night': 5, partlycloudy: 40, cloudy: 90, fog: 85,
  rainy: 90, pouring: 100, snowy: 95, 'snowy-rainy': 95, hail: 95,
  lightning: 85, 'lightning-rainy': 95, windy: 25, 'windy-variant': 60,
  exceptional: 60,
};

/*
 * Sprowadza encje pogody do czterech liczb, ktorymi da sie sterowac rysunkiem.
 * Zachmurzenie bierzemy z atrybutu, jesli jest - jest dokladniejsze niz nazwa
 * stanu. Stany windy wymuszaja odczuwalny wiatr nawet przy niskiej predkosci.
 */
const oscPogoda = (st) => {
  if (!st) return null;
  const a = st.attributes || {};
  const stan = String(st.state || '');

  let wiatr = Number(a.wind_speed);
  wiatr = Number.isFinite(wiatr)
    ? wiatr * (OSC_WIATR_NA_KMH[a.wind_speed_unit] || 1) : 0;
  if (stan === 'windy' || stan === 'windy-variant') wiatr = Math.max(wiatr, 26);

  let chmury = Number(a.cloud_coverage);
  if (!Number.isFinite(chmury)) chmury = OSC_ZACHMURZENIE[stan];
  if (!Number.isFinite(chmury)) chmury = 0;

  const deszcz = stan === 'pouring' ? 2
    : (stan === 'rainy' || stan === 'lightning-rainy') ? 1
      : stan === 'snowy-rainy' ? 1 : 0;
  const snieg = (stan === 'snowy' || stan === 'hail') ? 2
    : stan === 'snowy-rainy' ? 1 : 0;

  return { stan, wiatr, chmury, deszcz, snieg };
};

/* Zima to grudzien, styczen i luty; na poludniu odwrotnie. */
const oscZima = (ts, lat) => {
  let m = new Date(ts).getMonth();
  if (Number.isFinite(lat) && lat < 0) m = (m + 6) % 12;
  return m === 11 || m <= 1;
};

/*
 * Ksztalty drzew i chmur. Korony to wygladzone obrysy wygenerowane
 * z sumy kilku harmonicznych - dzieki nieregularnosci nie wygladaja
 * jak nalozone kola. Galezie zimowe pochodza z rekurencyjnego
 * rozgalezienia, stad naturalne zwezanie ku koncom.
 */
const OSC_KSZTALTY = {
  koronaDuza: 'M 18.71 0.66 C 18.26 2.05 16.40 3.03 15.62 4.19 C 14.85 5.34 14.79 6.53 14.06 7.60 C 13.32 8.67 12.53 10.03 11.22 10.60 C 9.91 11.18 7.70 10.85 6.18 11.06 C 4.66 11.27 3.55 11.41 2.10 11.88 C 0.66 12.36 -0.82 13.60 -2.48 13.93 C -4.14 14.26 -6.21 14.26 -7.86 13.87 C -9.50 13.49 -11.24 12.62 -12.35 11.61 C -13.46 10.60 -14.23 9.11 -14.49 7.81 C -14.75 6.51 -13.84 4.99 -13.91 3.80 C -13.98 2.61 -14.44 1.91 -14.89 0.66 C -15.34 -0.58 -16.73 -2.33 -16.62 -3.69 C -16.50 -5.05 -15.18 -6.36 -14.21 -7.49 C -13.24 -8.62 -11.86 -9.28 -10.79 -10.45 C -9.71 -11.62 -9.13 -13.61 -7.77 -14.54 C -6.42 -15.46 -4.36 -16.14 -2.68 -15.98 C -1.00 -15.83 0.83 -14.39 2.30 -13.61 C 3.76 -12.82 4.88 -11.99 6.10 -11.26 C 7.33 -10.54 8.37 -9.95 9.65 -9.28 C 10.93 -8.61 12.33 -8.10 13.78 -7.24 C 15.22 -6.39 17.51 -5.46 18.33 -4.14 C 19.15 -2.82 19.16 -0.72 18.71 0.66 Z',
  koronaSrednia: 'M 10.71 0.40 C 10.35 1.34 8.60 1.97 7.87 2.68 C 7.14 3.38 6.78 3.81 6.34 4.63 C 5.90 5.46 6.01 7.02 5.25 7.64 C 4.49 8.26 2.93 8.23 1.76 8.36 C 0.59 8.49 -0.63 8.57 -1.77 8.41 C -2.92 8.26 -4.20 7.96 -5.09 7.42 C -5.98 6.87 -6.59 5.92 -7.11 5.15 C -7.63 4.38 -7.97 3.58 -8.24 2.78 C -8.51 1.99 -8.37 1.38 -8.73 0.40 C -9.09 -0.59 -10.43 -2.00 -10.40 -3.11 C -10.37 -4.22 -9.54 -5.64 -8.55 -6.25 C -7.56 -6.86 -5.63 -6.47 -4.47 -6.77 C -3.31 -7.08 -2.62 -7.86 -1.61 -8.07 C -0.60 -8.27 0.56 -8.18 1.60 -8.01 C 2.64 -7.84 3.60 -7.42 4.63 -7.03 C 5.66 -6.63 6.88 -6.32 7.78 -5.65 C 8.68 -4.97 9.54 -3.99 10.03 -2.98 C 10.52 -1.98 11.07 -0.55 10.71 0.40 Z',
  koronaMala: 'M 6.33 0.26 C 6.37 1.04 6.76 1.81 6.48 2.44 C 6.20 3.07 5.39 3.73 4.65 4.03 C 3.90 4.33 2.81 4.06 2.03 4.25 C 1.26 4.43 0.78 4.95 0.00 5.16 C -0.78 5.37 -1.83 5.62 -2.66 5.48 C -3.50 5.34 -4.54 4.89 -5.01 4.32 C -5.47 3.76 -5.23 2.78 -5.46 2.10 C -5.69 1.42 -6.42 0.91 -6.39 0.26 C -6.35 -0.39 -5.61 -1.11 -5.27 -1.80 C -4.93 -2.48 -4.75 -3.11 -4.35 -3.84 C -3.94 -4.57 -3.56 -5.83 -2.84 -6.19 C -2.11 -6.56 -0.84 -6.28 -0.00 -6.04 C 0.84 -5.80 1.54 -5.18 2.20 -4.75 C 2.87 -4.33 3.31 -3.93 3.99 -3.50 C 4.67 -3.07 5.90 -2.82 6.29 -2.19 C 6.68 -1.57 6.30 -0.51 6.33 0.26 Z',
  pienLisciasty: 'M -1.8 0 C -1.5 -8 -1.2 -14 -0.75 -21 L 0.75 -21 C 1.2 -14 1.5 -8 1.8 0 Z',
  pienZimowy: 'M -1.6 0 C -1.35 -7 -1.1 -13 -0.7 -20 L 0.7 -20 C 1.1 -13 1.35 -7 1.6 0 Z',
  konarL: 'M -0.4 -14 C -3 -17 -4.5 -19 -5.6 -22',
  konarP: 'M 0.4 -16 C 2.6 -19 4 -21 5.2 -24',
  galezie: [[0, -20, 0.24, -32.0, 2.3], [0.24, -32.0, -3.35, -39.3, 1.38], [-3.35, -39.3, -7.1, -43.21, 0.83], [-7.1, -43.21, -10.57, -44.47, 0.5], [-7.1, -43.21, -8.77, -46.44, 0.5], [-3.35, -39.3, -3.41, -45.09, 0.83], [-3.41, -45.09, -5.56, -48.12, 0.5], [-3.41, -45.09, -2.42, -49.1, 0.5], [0.24, -32.0, 3.66, -38.41, 1.38], [3.66, -38.41, 4.74, -43.65, 0.83], [4.74, -43.65, 4.0, -47.24, 0.5], [4.74, -43.65, 6.22, -46.5, 0.5], [3.66, -38.41, 7.12, -41.16, 0.83], [7.12, -41.16, 8.03, -43.82, 0.5], [7.12, -41.16, 9.78, -42.42, 0.5]],
};

/* Chmury: klebiaste bryly o plaskiej podstawie. Kazda to zestaw elips
   o wspolnym wypelnieniu, wiec zlaczenia sa niewidoczne. */
const OSC_CHMURY_KSZTALT = [
  [[-13, -3, 8], [-3, -8.5, 11], [7, -6, 9], [16, -2, 6.5]],
  [[-10, -2, 6.5], [-1, -6, 9], [8, -3, 7]],
  [[-16, -2, 7], [-6, -7, 10], [4, -9, 11], [15, -4, 8], [23, -1, 5.5]],
  [[-11, -2, 7], [-2, -7.5, 10], [8, -4, 7.5]],
];

const OSC_P0 = { x: 28, y: 118 };
const OSC_P1 = { x: 200, y: -26 };
const OSC_P2 = { x: 372, y: 118 };

/*
 * Astronomia pozycyjna w wersji niskiej dokladnosci - w zupelnosci wystarcza,
 * zeby umiescic dziewieciopikselowa tarcze na panelu. Slonce z dokladnoscia
 * ulamka stopnia, ksiezyc okolo jednej trzeciej stopnia.
 */
const OSC_ST = Math.PI / 180;

/* Doby od epoki J2000.0, ulamkowe. */
const oscDni = (ts) => (ts / 86400000) + 2440587.5 - 2451545.0;

/* Dlugosc ekliptyczna Slonca. */
const oscSlonceEkl = (n) => {
  const L = 280.460 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * OSC_ST;
  return { lam: L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g), bet: 0 };
};

/* Dlugosc i szerokosc ekliptyczna Ksiezyca. */
const oscKsiezycEkl = (n) => {
  const L = 218.316 + 13.176396 * n;
  const M = (134.963 + 13.064993 * n) * OSC_ST;
  const F = (93.272 + 13.229350 * n) * OSC_ST;
  return { lam: L + 6.289 * Math.sin(M), bet: 5.128 * Math.sin(F) };
};

/* Wspolrzedne ekliptyczne -> wysokosc i azymut dla obserwatora. */
const oscHoryzontalne = (ekl, n, lat, lon) => {
  const eps = (23.439 - 0.0000004 * n) * OSC_ST;
  const lam = ekl.lam * OSC_ST;
  const bet = ekl.bet * OSC_ST;
  const dec = Math.asin(Math.sin(bet) * Math.cos(eps)
    + Math.cos(bet) * Math.sin(eps) * Math.sin(lam));
  const ra = Math.atan2(
    Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps),
    Math.cos(lam));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (((gmst * 15 + lon) % 360) + 360) % 360;
  const H = lst * OSC_ST - ra;
  const fi = lat * OSC_ST;
  const alt = Math.asin(Math.sin(fi) * Math.sin(dec)
    + Math.cos(fi) * Math.cos(dec) * Math.cos(H));
  let az = Math.atan2(-Math.cos(dec) * Math.sin(H),
    Math.sin(dec) * Math.cos(fi) - Math.cos(dec) * Math.sin(fi) * Math.cos(H));
  az = (((az / OSC_ST) % 360) + 360) % 360;
  return { alt: alt / OSC_ST, az };
};

/* Pelny stan nieba: obie tarcze naraz plus faza z elongacji. */
const oscNiebo = (ts, lat, lon) => {
  const n = oscDni(ts);
  const sl = oscSlonceEkl(n);
  const ks = oscKsiezycEkl(n);
  return {
    slonce: oscHoryzontalne(sl, n, lat, lon),
    ksiezyc: oscHoryzontalne(ks, n, lat, lon),
    faza: ((((ks.lam - sl.lam) % 360) + 360) % 360) / 360,
  };
};

/* Wysokosc i azymut -> punkt na panelu. Poludnie posrodku, wschod po lewej. */
const oscNaPanel = (alt, az) => ({
  x: oscZacisk(28 + ((az - 45) / 270) * 344, 16, 384),
  y: oscZacisk(118 - alt * 1.7, 10, 146),
});

const OSC_NAZWY_FAZ = ['now', 'sierp przybywajacy', 'pierwsza kwadra',
  'wypukly przybywajacy', 'pelnia', 'wypukly ubywajacy', 'ostatnia kwadra',
  'sierp ubywajacy'];
/* Osiem nazw, kazda obejmuje osma czesc cyklu wysrodkowana na swojej fazie. */
const oscNazwaFazy = (f) => OSC_NAZWY_FAZ[Math.floor(((f + 1 / 16) % 1) * 8) % 8];

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


  return {
    dzien,
    wschod,
    zachod,
    nastepny_wschod: nr,
    nastepny_zachod: ns,
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
      weather_entity: '',
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
      weather_entity: '',
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
        .konflikt-tytul { font-size: .88rem; }
        .konflikt {
          margin: 0 16px 8px; padding: 10px 12px; border-radius: 10px;
          background: rgba(255,152,0,.14); border: 1px solid rgba(255,152,0,.45);
          font-size: .82rem; line-height: 1.4; display: grid; gap: 8px;
        }
        /* Bez tego display:grid z reguly wyzej bije [hidden] z arkusza
           przegladarki i pasek widac zawsze. */
        .konflikt[hidden] { display: none; }
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
        /* Godzina tuz przy swoim opisie. Stala szerokosc etykiety ustawia
           wartosci w rowna kolumne, bez rozpychania ich na krance karty. */
        .info div { display: flex; gap: 10px; align-items: baseline; }
        .info span:first-child { color: var(--secondary-text-color);
                                 min-width: 5.6em; flex: none; }
        .info span:last-child { color: var(--primary-text-color); font-weight: 500; }
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
          box-shadow: 0 0 26px 11px rgba(255,208,80,.72);
          background: color-mix(in srgb, var(--osc-kolor, #ffd050) 35%, transparent);
          box-shadow: 0 0 26px 11px color-mix(in srgb, var(--osc-kolor, #ffd050) 72%, transparent);
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

        /* --- pogoda --- */
        .chmury, .opady, .drzewa { pointer-events: none; }
        @keyframes osc-chmura {
          from { transform: translateX(-110px); }
          to   { transform: translateX(510px); }
        }
        .chmura { animation-name: osc-chmura; animation-timing-function: linear;
                  animation-iteration-count: infinite; }
        @keyframes osc-deszcz {
          0%   { transform: translateY(-26px); opacity: 0; }
          12%  { opacity: .85; }
          100% { transform: translateY(126px); opacity: .85; }
        }
        .kropla { animation-name: osc-deszcz; animation-timing-function: linear;
                  animation-iteration-count: infinite; }
        @keyframes osc-snieg {
          0%   { transform: translate(0, -22px); opacity: 0; }
          15%  { opacity: .95; }
          50%  { transform: translate(7px, 52px); }
          100% { transform: translate(-3px, 124px); opacity: .95; }
        }
        .platek { animation-name: osc-snieg; animation-timing-function: linear;
                  animation-iteration-count: infinite; }
        /* Obrot wokol podstawy pnia, a nie srodka rysunku. */
        .drzewo { transform-box: fill-box; transform-origin: 50% 100%; }
        @keyframes osc-wiatr {
          0%, 100% { transform: rotate(calc(-1 * var(--osc-kat, 0deg))); }
          50%      { transform: rotate(var(--osc-kat, 0deg)); }
        }
        .drzewo.buja { animation-name: osc-wiatr;
                       animation-timing-function: ease-in-out;
                       animation-iteration-count: infinite;
                       animation-duration: var(--osc-czas, 3s); }
        @media (prefers-reduced-motion: reduce) {
          .chmura, .kropla, .platek, .drzewo.buja { animation: none; }
        }
      </style>
      <ha-card>
        <div class="naglowek">
          <span class="tytul"></span>
          <span class="podtytul"></span>
        </div>
        <div class="konflikt" hidden>
          <b class="konflikt-tytul"></b>
          <span class="konflikt-tresc"></span>
          <span class="konflikt-akcje">
            <button class="konflikt-rozwiaz"></button>
            <button class="konflikt-ignoruj">Zostaw jak jest</button>
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
            <path class="tor-ksiezyca" fill="none"
                  stroke="rgba(255,255,255,.16)" stroke-width="1"
                  stroke-dasharray="2 4"/>
            <path class="tor-slonca" fill="none"
                  stroke="rgba(255,255,255,.35)" stroke-width="1"
                  stroke-dasharray="3 5"/>
            <circle class="poswiata" r="26" fill="url(#grad-slonce)"/>
            <circle class="cialo" r="9"/>
            <g class="ksiezyc" opacity="0">
              <circle class="ks-poswiata" r="20" fill="url(#grad-ksiezyc)"/>
              <circle class="ks-tarcza" r="9" fill="#2a3250"/>
              <path class="ks-swiatlo" fill="#eef2fb"/>
            </g>
            <g class="chmury"></g>
            <g class="opady"></g>
            <rect x="0" y="118" width="400" height="32" fill="#16351f"/>
            <path d="M0 118 L400 118" stroke="rgba(255,255,255,.35)" stroke-width="1"/>
            <g class="drzewa"></g>
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
      torSlonca: this.shadowRoot.querySelector('.tor-slonca'),
      torKsiezyca: this.shadowRoot.querySelector('.tor-ksiezyca'),
      ksiezyc: this.shadowRoot.querySelector('.ksiezyc'),
      ksPoswiata: this.shadowRoot.querySelector('.ks-poswiata'),
      ksTarcza: this.shadowRoot.querySelector('.ks-tarcza'),
      ksSwiatlo: this.shadowRoot.querySelector('.ks-swiatlo'),
      konflikt: this.shadowRoot.querySelector('.konflikt'),
      chmury: this.shadowRoot.querySelector('.chmury'),
      opady: this.shadowRoot.querySelector('.opady'),
      drzewa: this.shadowRoot.querySelector('.drzewa'),
      konfliktTytul: this.shadowRoot.querySelector('.konflikt-tytul'),
      konfliktTresc: this.shadowRoot.querySelector('.konflikt-tresc'),
      konfliktRozwiaz: this.shadowRoot.querySelector('.konflikt-rozwiaz'),
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

    this._zbudujPogode();
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
    this._odswiezPogode();
    this._sprawdzKonflikty();
  }

  /* Elementy pogody powstaja raz; pozniej tylko je pokazujemy i chowamy. */
  _zbudujPogode() {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (nazwa, atr) => {
      const e = document.createElementNS(NS, nazwa);
      Object.keys(atr).forEach((k) => e.setAttribute(k, atr[k]));
      return e;
    };

    /* Chmury: cien pod spodem, biala bryla, podswietlenie od gory. */
    this._chmury = [[52, 30, 0.85, 64], [158, 48, 0.62, 86], [262, 26, 0.95, 52],
      [340, 54, 0.7, 73]].map(([x, y, skala, czas], i) => {
      const g = el('g', { class: 'chmura',
        transform: 'translate(' + x + ',' + y + ') scale(' + skala + ')' });
      g.style.animationDuration = czas + 's';
      g.style.animationDelay = (-i * czas / 4).toFixed(1) + 's';

      const bryly = OSC_CHMURY_KSZTALT[i % OSC_CHMURY_KSZTALT.length];
      const lewa = Math.min.apply(null, bryly.map(([bx, , r]) => bx - r));
      const prawa = Math.max.apply(null, bryly.map(([bx, , r]) => bx + r));
      const cien = el('g', { fill: '#c6d4e6' });
      const bryla = el('g', { fill: '#ffffff' });
      const swiatlo = el('g', { fill: '#ffffff', 'fill-opacity': '.8' });

      bryly.forEach(([cx, cy, r]) => {
        cien.appendChild(el('ellipse', { cx, cy: cy + 1.6, rx: r, ry: (r * 0.82).toFixed(2) }));
        bryla.appendChild(el('ellipse', { cx, cy, rx: r, ry: (r * 0.82).toFixed(2) }));
      });
      cien.appendChild(el('rect', { x: lewa, y: -3.4, width: prawa - lewa, height: 7, rx: 3.5 }));
      bryla.appendChild(el('rect', { x: lewa, y: -4.6, width: prawa - lewa, height: 7, rx: 3.5 }));
      bryly.slice(0, 2).forEach(([cx, cy, r]) =>
        swiatlo.appendChild(el('ellipse', { cx: (cx - r * 0.2).toFixed(2),
          cy: (cy - r * 0.26).toFixed(2), rx: (r * 0.6).toFixed(2), ry: (r * 0.45).toFixed(2) })));

      g.appendChild(cien);
      g.appendChild(bryla);
      g.appendChild(swiatlo);
      this._el.chmury.appendChild(g);
      return g;
    });

    this._krople = [];
    for (let i = 0; i < 18; i++) {
      const x = 14 + ((i * 121) % 374);
      const l = el('line', { class: 'kropla', x1: x, y1: 0, x2: x - 2, y2: 9,
        stroke: '#bcd8f5', 'stroke-width': 1.4, 'stroke-linecap': 'round' });
      l.style.animationDuration = (0.55 + (i % 5) * 0.11).toFixed(2) + 's';
      l.style.animationDelay = (-(i % 7) * 0.13).toFixed(2) + 's';
      this._el.opady.appendChild(l);
      this._krople.push(l);
    }

    this._platki = [];
    for (let i = 0; i < 16; i++) {
      const x = 18 + ((i * 97) % 366);
      const c = el('circle', { class: 'platek', cx: x, cy: 0,
        r: (1.3 + (i % 3) * 0.5).toFixed(1), fill: '#fff' });
      c.style.animationDuration = (2.4 + (i % 4) * 0.55).toFixed(2) + 's';
      c.style.animationDelay = (-(i % 6) * 0.42).toFixed(2) + 's';
      this._el.opady.appendChild(c);
      this._platki.push(c);
    }

    const K = OSC_KSZTALTY;
    this._drzewa = [[32, 1, 0], [368, -1, 1]].map(([x, zwrot, i]) => {
      const kotwica = el('g', { transform: 'translate(' + x + ',120) scale(' + zwrot + ',1)' });
      const d = el('g', { class: 'drzewo' });

      /* Konary wychodza spod korony, wiec rysujemy je pod nia. */
      d.appendChild(el('path', { d: K.konarL, stroke: '#4a3a29', 'stroke-width': 1.5,
        fill: 'none', 'stroke-linecap': 'round' }));
      d.appendChild(el('path', { d: K.konarP, stroke: '#4a3a29', 'stroke-width': 1.3,
        fill: 'none', 'stroke-linecap': 'round' }));

      const lisc = el('g', { class: 'lisc' });
      lisc.appendChild(el('path', { d: K.pienLisciasty, fill: '#4a3a29' }));
      const kor = el('g', { transform: 'translate(0,-31)' });
      kor.appendChild(el('path', { d: K.koronaDuza, fill: '#27582c' }));
      kor.appendChild(el('path', { d: K.koronaSrednia, fill: '#357440', transform: 'translate(-4,1)' }));
      kor.appendChild(el('path', { d: K.koronaSrednia, fill: '#2d6535', transform: 'translate(5,3) scale(.9)' }));
      kor.appendChild(el('path', { d: K.koronaMala, fill: '#468f4c', transform: 'translate(-3,-6)' }));
      kor.appendChild(el('path', { d: K.koronaMala, fill: '#4f9c55', transform: 'translate(4,-7) scale(.75)' }));
      lisc.appendChild(kor);
      d.appendChild(lisc);

      const golo = el('g', { class: 'golo' });
      K.galezie.forEach(([x1, y1, x2, y2, w]) =>
        golo.appendChild(el('line', { x1, y1, x2, y2, stroke: '#5b4733',
          'stroke-width': w, 'stroke-linecap': 'round' })));
      golo.appendChild(el('path', { d: K.pienZimowy, fill: '#4a3a29' }));
      d.appendChild(golo);

      d.style.animationDelay = (i * -0.7) + 's';
      kotwica.appendChild(d);
      this._el.drzewa.appendChild(kotwica);
      return { d, lisc, golo };
    });
  }

  /* Przelozenie stanu encji pogody na to, co widac na niebie. */
  _odswiezPogode() {
    const e = this._el;
    const st = this._config.weather_entity
      ? this._hass.states[this._config.weather_entity] : null;
    const p = oscPogoda(st);

    if (!p) {
      e.chmury.style.display = 'none';
      e.opady.style.display = 'none';
      e.drzewa.style.display = 'none';
      return;
    }
    e.drzewa.style.display = '';

    const ileChmur = p.chmury < 12 ? 0
      : p.chmury < 35 ? 1 : p.chmury < 65 ? 2 : p.chmury < 90 ? 3 : 4;
    e.chmury.style.display = ileChmur ? '' : 'none';
    this._chmury.forEach((c, i) => {
      c.style.display = i < ileChmur ? '' : 'none';
      c.setAttribute('opacity', p.chmury > 85 ? '0.82' : '0.6');
    });

    const kropli = p.deszcz === 2 ? 18 : p.deszcz === 1 ? 10 : 0;
    const platkow = p.snieg === 2 ? 16 : p.snieg === 1 ? 8 : 0;
    e.opady.style.display = (kropli || platkow) ? '' : 'none';
    this._krople.forEach((k, i) => { k.style.display = i < kropli ? '' : 'none'; });
    this._platki.forEach((k, i) => { k.style.display = i < platkow ? '' : 'none'; });

    const zima = oscZima(Date.now(),
      this._hass.config ? this._hass.config.latitude : undefined);
    const sredni = p.wiatr >= 10;
    const silny = p.wiatr >= 30;
    this._drzewa.forEach((t) => {
      t.lisc.style.display = zima ? 'none' : '';
      t.golo.style.display = zima ? '' : 'none';
      t.d.classList.toggle('buja', sredni);
      t.d.style.setProperty('--osc-kat', (silny ? 5.5 : 2.2) + 'deg');
      t.d.style.setProperty('--osc-czas', (silny ? 1.5 : 2.9) + 's');
    });
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
    const wlasna = this._config.automation_entity
      ? this._hass.states[this._config.automation_entity]
      : null;
    const nazwaWlasnej = wlasna
      ? (wlasna.attributes.friendly_name || this._config.automation_entity)
      : null;

    this._el.konfliktTytul.textContent =
      'Twoje obecne automatyzacje koliduja z ustawieniami tej karty';
    this._el.konfliktTresc.textContent =
      'Tymi samymi lampami steruje juz ' + nazwy.length + ' '
      + (nazwy.length === 1 ? 'inne ustawienie' : 'inne ustawienia')
      + ': ' + nazwy.join(', ') + '. '
      + 'Beda walczyc o te same swiatla - raz zapali jedno, raz drugie. '
      + (nazwaWlasnej
        ? 'Moge je wylaczyc i zostawic sterowanie wylacznie automatyzacji tej karty '
          + '(' + nazwaWlasnej + ').'
        : 'Moge je wylaczyc. Automatyzacje tej karty wskaz potem w jej edytorze, '
          + 'w kroku 4.');
    this._el.konfliktRozwiaz.textContent = nazwaWlasnej
      ? 'Wylacz tamte i wlacz moja'
      : 'Wylacz tamte';
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
    this._poswiataOpacity = poswiataOpacity;

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

    /* Wjazd od wschodu do biezacej pozycji przy kazdym pokazaniu karty.
       Animujemy czas, wiec obie tarcze jada swoimi prawdziwymi torami. */
    const teraz = Date.now();
    this._rysujTory(teraz);
    if (!this._wjechalo && !this._klatka) {
      const t0 = this._ostatniWschod(teraz);
      const CZAS = 2500;
      const start = performance.now();
      const klatka = (chwila) => {
        const u = Math.min(1, (chwila - start) / CZAS);
        const w = 1 - Math.pow(1 - u, 3);
        this._rysujNiebo(t0 + (teraz - t0) * w);
        if (u < 1) {
          this._klatka = requestAnimationFrame(klatka);
        } else {
          this._klatka = null;
          this._wjechalo = true;
        }
      };
      this._klatka = requestAnimationFrame(klatka);
    } else if (!this._klatka) {
      this._rysujNiebo(teraz);
    }

    e.tWschod.textContent = oscGodzina(s.wschod);
    e.tZachod.textContent = oscGodzina(s.zachod);
    e.tElew.textContent = Number.isFinite(elew) ? elew.toFixed(1) + '°' : '';
    e.iWschod.textContent = oscGodzina(s.wschod);
    e.iZachod.textContent = oscGodzina(s.zachod);
    // Etykieta z wysokosci slonca, nie z kolejnosci wschodu/zachodu -
    // dzieki temu zawsze zgadza sie z przyciemnieniem podworka.
    const nb = this._niebo(Date.now());
    let opis = (Number.isFinite(elew) && elew > 0) ? 'dzien' : 'noc';
    if (nb && nb.ksiezyc.alt > -1) opis += ' \u00B7 ' + oscNazwaFazy(nb.faza);
    e.podtytul.textContent = opis;

    const offZ = this._offset('zachod');
    const offW = this._offset('wschod');
    e.iWl.textContent = offZ === null ? '--:--' : oscGodzina(s.nastepny_zachod + offZ * 60000);
    e.iWyl.textContent = offW === null ? '--:--' : oscGodzina(s.nastepny_wschod + offW * 60000);
  }

  /* Polozenie obserwatora z konfiguracji Home Assistanta. */
  _niebo(ts) {
    const k = this._hass && this._hass.config;
    if (!k || !Number.isFinite(k.latitude) || !Number.isFinite(k.longitude)) return null;
    return oscNiebo(ts, k.latitude, k.longitude);
  }

  /*
   * Chwila, w ktorej nad horyzont wyszlo to cialo, ktore wlasnie widac.
   * Od niej zaczyna sie animacja wjazdu. Szukanie wstecz co kwadrans,
   * potem uscislenie polowieniem przedzialu.
   */
  _ostatniWschod(ts) {
    const nb = this._niebo(ts);
    if (!nb) return ts - 6 * 3600000;
    const ktore = nb.slonce.alt > 0 ? 'slonce' : 'ksiezyc';
    const wys = (t) => {
      const n = this._niebo(t);
      return n ? n[ktore].alt : 1;
    };
    /* Prog -0,833 stopnia to standardowa poprawka na refrakcje atmosferyczna
       i promien tarczy - dzieki niej wschod zgadza sie z tym, co pokazuje
       Home Assistant, a nie wypada siedem minut pozniej. */
    const PROG = -0.833;
    if (wys(ts) <= PROG) return ts - 6 * 3600000;
    const KROK = 15 * 60000;
    for (let i = 1; i <= 96; i++) {
      const t = ts - i * KROK;
      if (wys(t) <= PROG) {
        let a = t;
        let b = t + KROK;
        for (let j = 0; j < 12; j++) {
          const m = (a + b) / 2;
          if (wys(m) <= PROG) a = m; else b = m;
        }
        return b;
      }
    }
    return ts - 6 * 3600000;
  }

  /*
   * Tor ciala nad horyzontem: od jego wschodu do zachodu, probkowany
   * co rowny odstep czasu. Dzieki temu kreskowana linia jest faktyczna
   * droga po niebie, a tarcza zawsze na niej lezy.
   */
  _tor(ktore, ts) {
    const wys = (t) => {
      const n = this._niebo(t);
      return n ? n[ktore].alt : -90;
    };
    if (wys(ts) <= -0.9) return '';
    const KROK = 10 * 60000;
    let start = ts;
    let koniec = ts;
    for (let i = 0; i < 144 && wys(start - KROK) > -0.9; i++) start -= KROK;
    for (let i = 0; i < 144 && wys(koniec + KROK) > -0.9; i++) koniec += KROK;
    const N = 56;
    const kawalki = [];
    for (let i = 0; i <= N; i++) {
      const n = this._niebo(start + ((koniec - start) * i) / N);
      if (!n) return '';
      const p = oscNaPanel(n[ktore].alt, n[ktore].az);
      kawalki.push((i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1));
    }
    return kawalki.join(' ');
  }

  _rysujTory(ts) {
    this._el.torSlonca.setAttribute('d', this._tor('slonce', ts));
    this._el.torKsiezyca.setAttribute('d', this._tor('ksiezyc', ts));
  }

  /*
   * Rysuje niebo w zadanej chwili. Slonce i ksiezyc sa niezalezne, wiec
   * moga byc widoczne jednoczesnie - za dnia ksiezyc jest po prostu bledszy.
   */
  _rysujNiebo(ts) {
    const e = this._el;
    const nb = this._niebo(ts);
    if (!nb) { e.cialo.setAttribute('opacity', '0'); e.ksiezyc.setAttribute('opacity', '0'); return; }

    const sl = oscNaPanel(nb.slonce.alt, nb.slonce.az);
    const widacSlonce = nb.slonce.alt > -6;
    e.cialo.setAttribute('cx', sl.x.toFixed(1));
    e.cialo.setAttribute('cy', sl.y.toFixed(1));
    e.cialo.setAttribute('opacity', widacSlonce ? '1' : '0');
    e.poswiata.setAttribute('cx', sl.x.toFixed(1));
    e.poswiata.setAttribute('cy', sl.y.toFixed(1));
    e.poswiata.setAttribute('opacity',
      widacSlonce ? String(this._poswiataOpacity === undefined ? 1 : this._poswiataOpacity) : '0');

    const ks = oscNaPanel(nb.ksiezyc.alt, nb.ksiezyc.az);
    const widacKsiezyc = nb.ksiezyc.alt > -1;
    /* Za dnia ksiezyc jest na niebie, ale slabo widoczny - oddajemy to krycie. */
    e.ksiezyc.setAttribute('opacity',
      !widacKsiezyc ? '0' : (nb.slonce.alt > 3 ? '0.45' : '1'));
    if (widacKsiezyc) {
      e.ksPoswiata.setAttribute('cx', ks.x.toFixed(1));
      e.ksPoswiata.setAttribute('cy', ks.y.toFixed(1));
      e.ksTarcza.setAttribute('cx', ks.x.toFixed(1));
      e.ksTarcza.setAttribute('cy', ks.y.toFixed(1));
      e.ksSwiatlo.setAttribute('d',
        oscSciezkaKsiezyca(Number(ks.x.toFixed(1)), Number(ks.y.toFixed(1)), 9, nb.faza));
    }
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

  /* Male sterowanie barwa w wierszu listy - zeby nie trzeba bylo najpierw
     klikac punktu na zdjeciu, zeby w ogole zobaczyc, ze barwe da sie ustawic. */
  _barwaWiersza(punkt) {
    const st = punkt.entity ? this._hass.states[punkt.entity] : null;
    if (!st || !punkt.entity.startsWith('light.')) return '';
    if (oscObslugujeKolor(st)) {
      const v = punkt.color
        || (st.attributes && oscRgbNaHex(st.attributes.rgb_color))
        || '#ffd07a';
      return '<input type="color" data-rola="kolor-wiersz" value="' + oscEsc(v) + '"'
        + ' title="Barwa, w ktorej karta zapali te lampe">'
        + (punkt.color
          ? '<button type="button" data-rola="kolor-wiersz-czysc" class="drobny"'
            + ' title="Nie wymuszaj barwy">bez</button>'
          : '');
    }
    if (oscObslugujeTemp(st)) {
      return '<input type="text" data-rola="kelwiny-wiersz" class="kelw"'
        + ' value="' + oscEsc(punkt.color_temp_kelvin || '') + '" placeholder="K"'
        + ' title="Temperatura barwowa w kelwinach">';
    }
    return '';
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
        .osc-wiersz input[type=color] { width: 38px; height: 30px; flex: none; padding: 2px;
                                        border: 1px solid var(--divider-color);
                                        border-radius: 8px; background: none; cursor: pointer; }
        .osc-wiersz input.kelw { width: 56px; flex: none; padding: 6px; border-radius: 8px;
                                 border: 1px solid var(--divider-color);
                                 background: var(--card-background-color);
                                 color: var(--primary-text-color); }
        .osc-wiersz button.drobny { background: var(--card-background-color);
                                    color: var(--secondary-text-color);
                                    padding: 6px 8px; font-size: .72rem; }
        .osc-info { font-size: .8rem; color: var(--secondary-text-color); line-height: 1.5; }
        .osc-info a { color: var(--primary-color); }
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
              z portalu mapowego. Plik trafia do magazynu Home Assistanta.</span>
          </div>
          <label>Adres zdjecia
            <input type="text" data-pole="image" value="${oscEsc(cfg.image || '')}">
          </label>
          <div class="osc-info" style="margin-top:8px">
            W Polsce najdokladniejsze zdjecia z gory daje darmowa ortofotomapa
            Glownego Urzedu Geodezji i Kartografii &mdash; rozdzielczosc rzedu
            5 cm na piksel, czyli kilkanascie razy lepiej niz zwykle mapy
            internetowe. Obejmuje caly kraj.
            <a href="https://mapy.geoportal.gov.pl/imap/" target="_blank"
               rel="noopener noreferrer">Otworz Geoportal</a>.
            Znajdz swoj adres, wlacz warstwe ortofotomapy, zrob zrzut ekranu
            i wgraj go powyzej. Poza Polska poszukaj krajowego odpowiednika
            albo uzyj wlasnego zdjecia z drona.
          </div>
        </div>

        <div class="osc-krok">
          <h4><span class="nr">2</span> Lampy
            ${znacznik(punkty.length > 0 && przypisane === punkty.length)}</h4>
          <div class="osc-info">
            Klikniecie w wolne miejsce obrazka <b>dodaje punkt</b>.
            Przytrzymanie i przeciagniecie punktu <b>przesuwa</b> go.
            Klikniecie w gotowy punkt <b>zaznacza</b> go &mdash; wtedy mozna przypisac
            mu encje albo go skasowac.
            Lampy, ktore obsluguja kolor, maja na liscie ponizej <b>probnik barwy</b>:
            karta bedzie je zapalac wlasnie w niej.
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
                  ${this._barwaWiersza(p)}
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
          <label style="margin-top:10px">Encja pogody (opcjonalnie)
            <select data-rola="pogoda">
              <option value="">-- bez pogody --</option>
              ${Object.keys(this._hass.states)
                .filter((x) => x.startsWith('weather.')).sort()
                .map((x) => {
                  const n = this._hass.states[x].attributes.friendly_name || x;
                  return '<option value="' + oscEsc(x) + '"' +
                    (x === cfg.weather_entity ? ' selected' : '') + '>' +
                    oscEsc(n) + '</option>';
                }).join('')}
            </select>
          </label>
          <div class="osc-info" style="margin-top:6px">
            Po wskazaniu pogody na niebie pojawiaja sie chmury, deszcz albo snieg,
            a po bokach drzewa &mdash; zielone od wiosny do jesieni, zima bez lisci.
            Przy wietrze powyzej 10 km/h drzewa zaczynaja sie bujac, powyzej
            30 km/h mocniej.
          </div>
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

    const selPogoda = this.querySelector('select[data-rola="pogoda"]');
    if (selPogoda) selPogoda.addEventListener('change', () =>
      this._ustaw({ weather_entity: selPogoda.value }, true));

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
    this.querySelectorAll('input[data-rola="kolor-wiersz"]').forEach((inp) => {
      inp.addEventListener('change', () =>
        zmienPunkt(Number(inp.closest('.osc-wiersz').dataset.idx),
          { color: inp.value, color_temp_kelvin: undefined }));
    });
    this.querySelectorAll('button[data-rola="kolor-wiersz-czysc"]').forEach((b) => {
      b.addEventListener('click', () =>
        zmienPunkt(Number(b.closest('.osc-wiersz').dataset.idx),
          { color: undefined, color_temp_kelvin: undefined }));
    });
    this.querySelectorAll('input[data-rola="kelwiny-wiersz"]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const k = parseInt(inp.value, 10);
        zmienPunkt(Number(inp.closest('.osc-wiersz').dataset.idx),
          { color_temp_kelvin: Number.isFinite(k) && k > 0 ? k : undefined,
            color: undefined });
      });
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
