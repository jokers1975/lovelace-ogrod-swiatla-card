![Karta w calosci: zdjecie posesji z punktami swietlnymi, godziny wlaczenia i wylaczenia oraz regulacja przesuniec wzgledem wschodu i zachodu](https://raw.githubusercontent.com/jokers1975/lovelace-ogrod-swiatla-card/main/docs/karta.webp)

# Oświetlenie ogrodu · Garden Lights Card

**Jedna karta, w której ustawiasz i obsługujesz automatyczne oświetlenie wokół
domu — włączane o zachodzie, gaszone o wschodzie słońca.** Lampy nanosisz
klikając na zdjęciu swojej posesji, ustalasz o ile minut przed zachodem mają
się zapalać i po wschodzie gasnąć, a karta pilnuje, żeby nie kłóciło się to
z automatyzacjami, które już masz.

*A single card to set up and run automatic outdoor lighting around your home —
on at sunset, off at sunrise. Mark the lamps by clicking on a photo of your
property, decide how many minutes before sunset they should come on and after
sunrise go off, and the card makes sure this does not clash with automations
you already have.*

![wersja](https://img.shields.io/badge/wersja%20%C2%B7%20version-3.0.0-2e7d32)
![hacs](https://img.shields.io/badge/HACS-Dashboard-41BDF5)
![licencja](https://img.shields.io/badge/licencja%20%C2%B7%20license-MIT-blue)

[![Postaw mi kawę · Buy me a coffee](https://img.shields.io/badge/Postaw%20mi%20kaw%C4%99%20%C2%B7%20Buy%20me%20a%20coffee-ea4aaa?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/jokers1975)

Karta jest darmowa i zostanie darmowa. Jeśli oszczędziła Ci wieczoru,
możesz postawić kawę — wystarczy kliknąć powyżej.
*The card is free and will stay free. If it saved you an evening, you can buy
me a coffee — just click above.*

**[Polski](#polski) · [English](#english)**

---

## Polski

### Po co to jest

Sterowanie oświetleniem zewnętrznym zwykle kończy się zlepkiem: kilka
automatyzacji, do tego harmonogram w osobnym dodatku, gdzieś jeszcze sztywne
godziny, które trzeba przestawiać cztery razy w roku. Ta karta zbiera to
w jedno miejsce.

**Wszystko ustawiasz z poziomu karty, bez pisania YAML-a.** Kreator prowadzi
przez cztery kroki i sam pokazuje, czego brakuje.

Karta jest **dwujęzyczna**: mówi po polsku, gdy Home Assistant jest ustawiony
na polski, a w każdym innym przypadku po angielsku. Nic nie trzeba włączać.

### Jak to działa

**1. Lampy na zdjęciu.** Wgrywasz zdjęcie posesji z góry i klikasz w miejsca,
gdzie stoją lampy. Do każdego punktu przypisujesz encję `light` albo `switch`.
Punkt na karcie pokazuje, czy lampa świeci, a kliknięcie ją przełącza —
bez wchodzenia w listy encji.

**2. Przesunięcia względem słońca.** Dwa regulatory: o ile minut przed lub po
**zachodzie** włączyć i przed lub po **wschodzie** wyłączyć. Karta zapisuje je
do encji `input_number`, więc czyta je zwykła automatyzacja Home Assistanta.
Godziny najbliższego włączenia i wyłączenia widać od razu na karcie.

Dzięki temu oświetlenie samo przesuwa się przez cały rok — w czerwcu zapala się
po dwudziestej drugiej, w grudniu przed szesnastą, bez Twojego udziału.

**3. Automatyzacja i konflikty.** Samo przełączanie wykonuje automatyzacja
(gotowy szablon niżej). Karta **sprawdza, czy tymi samymi lampami nie steruje
już coś innego** — inne automatyzacje znajduje przez wyszukiwarkę powiązań
Home Assistanta, a harmonogramy, na przykład dodatek Scheduler, po ich liście
encji. Gdy coś wykryje, pokazuje ostrzeżenie z nazwami i przyciskiem, który
wyłącza kolidujące wpisy i zostawia sterowanie wyłącznie Twojej automatyzacji.

To zwykle najbardziej dokuczliwy problem przy oświetleniu zewnętrznym: dwa
mechanizmy walczą o te same lampy i raz zapala jeden, raz drugi.

**4. Barwa zapalenia.** Lampy obsługujące kolor dostają przy sobie na liście
próbkę barwy — karta rozpoznaje je po `supported_color_modes`. Kliknięcie próbki
otwiera **paletę dwunastu podstawowych barw**; pełny próbnik systemowy kryje się
pod rozwijanym „Pełna paleta". Lampy z regulowaną bielą dostają pole temperatury
barwowej w kelwinach. Po ustawieniu barwy lampa zawsze wstaje w tym samym
kolorze, a nie w tym, co akurat pamiętała.

Żółć w palecie jest celowo przesunięta w stronę bursztynu. Czysta żółć
`#ffff00` na diodach RGB wychodzi zielonkawa, bo kanał zielony świeci mocniej
niż czerwony — dlatego wybierając żółty z pełnej palety łatwo trafić w limonkę.

### Oprawa wizualna

Górna część karty pokazuje niebo: pozycję Słońca i Księżyca, porę dnia
i pogodę. To **dodatek**, nie sedno działania — ale dzięki niemu jednym
spojrzeniem widać, ile zostało do zapalenia świateł.

Pozycje obu ciał liczone są z astronomii pozycyjnej dla współrzędnych z Twojej
konfiguracji Home Assistanta, więc Księżyc bywa widoczny także w dzień, tak jak
na prawdziwym niebie. Kreskowany łuk to rzeczywista droga po niebie w danym
dniu: latem wysoki, zimą płaski. Księżyc pokazuje aktualną fazę.

Po wskazaniu encji pogody dochodzą chmury, deszcz albo śnieg, a po bokach
drzewa — zielone od wiosny do jesieni, zimą bez liści — które bujają się przy
wietrze powyżej 10 km/h. Wieczorem zdjęcie posesji przygasa proporcjonalnie do
wysokości Słońca, przez co poświata zapalonych lamp staje się wyraźniejsza.

![Niebo o zachodzie: slonce tuz nad horyzontem, luk jego drogi, drzewa po bokach i pierwsze gwiazdy](https://raw.githubusercontent.com/jokers1975/lovelace-ogrod-swiatla-card/main/docs/baner.webp)

Animacje respektują systemowe ustawienie ograniczenia ruchu.

### Kreator konfiguracji

1. **Zdjęcie posesji** — przycisk *Wgraj zdjęcie* wysyła plik do magazynu
   obrazów Home Assistanta. Nie trzeba niczego kopiować do `/config/www`.
2. **Lampy** — rozmieszczasz je klikając w zdjęcie.
3. **Sterowanie słońcem** — przycisk *Utwórz helpery* zakłada oba
   `input_number` z właściwym zakresem i jednostką. Tu wskazujesz też encję pogody.
4. **Automatyzacja** — wskazujesz swoją automatyzację, dzięki czemu wykrywanie
   konfliktów wie, czego nie ruszać i co włączyć. Jeśli żadnej jeszcze nie masz,
   przycisk **Utwórz nową automatyzację** zakłada czystą, gotową automatyzację
   sterowaną wyłącznie tą kartą i od razu ją podpina. Zapala lampy względem
   zachodu, gasi względem wschodu, a przesunięcia czyta na bieżąco z helperów —
   zmiana suwaka na karcie działa natychmiast, bez edycji automatyzacji.

Rozmieszczanie lamp:

- **kliknięcie w wolne miejsce** obrazka dodaje punkt,
- **przytrzymanie i przeciągnięcie** punktu przesuwa go (działa też palcem),
- **kliknięcie w gotowy punkt** zaznacza go — wtedy przypisujesz encję
  albo go kasujesz.

Współrzędne zapisywane są w procentach wymiarów obrazka, więc punkty trzymają
się swoich miejsc niezależnie od rozmiaru ekranu.

### Jeden przekaźnik, kilka żarówek na planie

Najczęstszy przypadek w ogrodzie: jeden obwód zapala pięć lamp. Chcesz, żeby na
planie zaświeciło się pięć punktów, a nie jeden — i żeby kliknięcie w dowolny
z nich przełączyło cały obwód.

Rozstaw żarówki w zwykły sposób, a potem w kroku 2 naciśnij **Zaznacz kilka
żarówek**. Klikaj punkty na zdjęciu — podświetlą się — wskaż **jeden przekaźnik**
z listy encji i naciśnij **Przypisz zaznaczonym**. Wszystkie dostają tę samą
encję, więc:

- gdy przekaźnik się załączy, **zapalą się wszystkie te punkty naraz**,
- kliknięcie w którykolwiek z nich gasi albo zapala **cały obwód**.

Punkty dzielące jeden obwód dostają na planie wspólną literę (`A`, `B`, …), więc
od razu widać, które należą do siebie. Barwę poświaty ustawiasz nadal osobno dla
każdego punktu.

### Przełącznik „wszystkie światła"

W nagłówku karty jest przełącznik obejmujący wszystkie jej światła. Służy do
ręcznego przejęcia sterowania: w środku dnia zgasisz nim lampy, które z jakiegoś
powodu zostały zapalone, a wieczorem zapalisz je, nie czekając na próg zachodu.

Automatyzacja nie jest przy tym ruszana — przy najbliższym przejściu przez próg
i tak ustawi swoje. To doraźna poprawka, nie tryb ręczny.

### Grupy świateł

Grupa to kilka źródeł światła sterowanych razem — albo **jeden przekaźnik,
który zapala kilka żarówek**. Zakładasz ją w kroku 2, w rozwijanym panelu
*Grupy świateł*: nadajesz nazwę i zaznaczasz źródła (przytrzymaj Ctrl, by wybrać
kilka naraz). Potem przy punkcie wybierasz grupę zamiast pojedynczej encji —
grupy pojawiają się na początku tej samej listy.

Dwa typowe zastosowania:

- **kilka lamp, jedno kliknięcie** — jeden punkt na planie steruje całą grupą.
  Punkt świeci, gdy świeci cokolwiek w grupie; kliknięcie gasi wszystko naraz;
Do przypadku „jeden przekaźnik, pięć żarówek" grupa nie jest potrzebna —
wystarczy wspólna encja, opisana wyżej. Grupa przydaje się wtedy, gdy **jeden
punkt** ma sterować **kilkoma różnymi** źródłami światła.

Barwę ustawia się osobno dla każdego punktu, więc ten sam przekaźnik może mieć
różnie pokolorowane poświaty w różnych miejscach ogrodu. Automatyzacja tworzona
przyciskiem z kroku 4 obejmuje wszystkie źródła z grup, bez powtórzeń.

### Skąd wziąć zdjęcie posesji

Dowolne zdjęcie z góry. W Polsce
[Geoportal GUGiK](https://mapy.geoportal.gov.pl/imap/) udostępnia ortofotomapę
w rozdzielczości rzędu **5 cm na piksel** — kilkanaście razy dokładniej niż
popularne mapy internetowe — i obejmuje **cały kraj**. Link jest też w kroku 1
edytora. Poza Polską poszukaj krajowego odpowiednika albo użyj zdjęcia z drona.

**Wyłącz wszystkie warstwy.** Geoportal domyślnie nakłada granice działek,
numery ewidencyjne i nazwy ulic. Zdejmij je i zostaw samą ortofotomapę —
inaczej zostaną w tle karty na zawsze.

Kadr najlepiej obrócić tak, żeby ulica była na dole, a głąb ogrodu na górze.

#### Poprawa jakości

Zrzut bywa mało ostry. Można go podciągnąć darmowym narzędziem AI, na przykład
Gemini. Sprawdzony prompt:

> to jest zdjęcie lotnicze, popraw jakość tego zdjęcia zachowując jak najwięcej
> szczegółów, nie zmieniaj nic na tym zdjęciu

Ostatni człon jest najważniejszy: bez niego narzędzie chętnie „upiększa" ujęcie,
dostawiając drzewa albo zmieniając kształt dachu.

| zrzut prosto z Geoportalu | po poprawie narzędziem AI |
|---|---|
| ![zrzut z Geoportalu bez żadnych warstw](https://raw.githubusercontent.com/jokers1975/lovelace-ogrod-swiatla-card/main/docs/geoportal-surowe.webp) | ![to samo zdjęcie po poprawie jakości](https://raw.githubusercontent.com/jokers1975/lovelace-ogrod-swiatla-card/main/docs/geoportal-ai.webp) |

Takie narzędzia **dorysowują** detal, którego w oryginale nie było. Geometria
zwykle zostaje, ale drobne tekstury są zmyślone — do tła karty to bez znaczenia,
do celów pomiarowych już nie.

### Instalacja

HACS → menu ⋮ → **Custom repositories** → wklej adres tego repozytorium,
typ **Dashboard** → Add → następnie **Download**.

Instalacja ręczna: skopiuj `dist/ogrod-swiatla-card.js` do `/config/www/`
i dodaj zasób `/local/ogrod-swiatla-card.js` typu **JavaScript Module**
w Ustawienia → Dashboardy → ⋮ → Zasoby.

### Konfiguracja

```yaml
type: custom:ogrod-swiatla-card
title: Oświetlenie ogrodu
image: /local/ogrod.jpg
sun_entity: sun.sun
weather_entity: weather.home
offset_zachod_entity: input_number.ogrod_offset_zachod
offset_wschod_entity: input_number.ogrod_offset_wschod
automation_entity: automation.ogrod_swiatla
dim_max: 0.5
groups:
  - id: taras
    name: Taras
    entities:
      - light.ogrod_lampa_3
      - light.ogrod_lampa_4
points:
  - entity: light.ogrod_lampa_1
    x: 33
    y: 18
    color: "#ffd07a"
  - entity: switch.ogrod_lampa_2
    x: 70
    y: 27
  - group: taras
    x: 52
    y: 61
```

| pole | domyślnie | znaczenie |
|---|---|---|
| `title` | `Oswietlenie ogrodu` | nagłówek karty |
| `image` | — | tło karty; `x` i `y` punktów w procentach jego wymiarów |
| `offset_zachod_entity` | — | `input_number` z przesunięciem włączenia |
| `offset_wschod_entity` | — | `input_number` z przesunięciem wyłączenia |
| `automation_entity` | — | Twoja automatyzacja, włączana przy rozwiązywaniu konfliktu |
| `groups` | `[]` | grupy świateł: `id`, `name`, `entities` |
| `points` | `[]` | lista punktów świetlnych |
| `sun_entity` | `sun.sun` | encja słońca |
| `weather_entity` | — | encja pogody; bez niej niebo zostaje czyste |
| `dim_max` | `0.5` | maksymalne nocne przyciemnienie tła, `0`–`1` |

Punkt przyjmuje `x`, `y`, opcjonalnie `color` (`#rrggbb`) albo
`color_temp_kelvin`, oraz **`entity` albo `group`** — `group` wskazuje `id`
grupy z listy `groups`. Tę samą grupę można przypisać do dowolnej liczby
punktów.

### Helpery przesunięć

Najprościej utworzyć je przyciskiem w kroku 3 edytora. Odpowiednik w YAML-u:

```yaml
input_number:
  ogrod_offset_zachod:
    name: Ogród – włącz względem zachodu
    min: -120
    max: 120
    step: 5
    unit_of_measurement: min
    icon: mdi:weather-sunset-down
    mode: box
  ogrod_offset_wschod:
    name: Ogród – wyłącz względem wschodu
    min: -120
    max: 120
    step: 5
    unit_of_measurement: min
    icon: mdi:weather-sunset-up
    mode: box
```

Wartość **ujemna oznacza przed** zdarzeniem, **dodatnia po** zdarzeniu.
Przykładowo `-15` przy zachodzie to „włącz kwadrans przed zachodem".

### Automatyzacja

Karta pokazuje stan i pozwala ustawić przesunięcia, ale światła przełącza
automatyzacja. Wyzwalacze szablonowe zawierają `now()`, więc Home Assistant
przelicza je na początku każdej minuty, a reakcja następuje wyłącznie na zmianę
stanu okna — dzięki temu ręczne zgaszenie lampy w nocy nie jest cofane.

```yaml
alias: Ogród – oświetlenie wg wschodu i zachodu słońca
mode: single
triggers:
  - trigger: template
    id: wlacz
    value_template: >
      {% set a = state_attr('sun.sun','next_rising') %}
      {% set b = state_attr('sun.sun','next_setting') %}
      {% if a is none or b is none %}false{% else %}
      {% set nr = a | as_timestamp %}{% set ns = b | as_timestamp %}
      {% set t = now() | as_timestamp %}
      {% set ofz = states('input_number.ogrod_offset_zachod') | float(0) * 60 %}
      {% set ofw = states('input_number.ogrod_offset_wschod') | float(0) * 60 %}
      {% if ns < nr %}{{ t >= ns + ofz }}{% else %}{{ t < nr + ofw }}{% endif %}
      {% endif %}
  - trigger: template
    id: wylacz
    value_template: >
      {% set a = state_attr('sun.sun','next_rising') %}
      {% set b = state_attr('sun.sun','next_setting') %}
      {% if a is none or b is none %}false{% else %}
      {% set nr = a | as_timestamp %}{% set ns = b | as_timestamp %}
      {% set t = now() | as_timestamp %}
      {% set ofz = states('input_number.ogrod_offset_zachod') | float(0) * 60 %}
      {% set ofw = states('input_number.ogrod_offset_wschod') | float(0) * 60 %}
      {% if ns < nr %}{{ not (t >= ns + ofz) }}{% else %}{{ not (t < nr + ofw) }}{% endif %}
      {% endif %}
actions:
  - choose:
      - conditions:
          - condition: trigger
            id: wlacz
        sequence:
          - action: homeassistant.turn_on
            target:
              entity_id: &lampy
                - light.ogrod_lampa_1
                - switch.ogrod_lampa_2
      - conditions:
          - condition: trigger
            id: wylacz
        sequence:
          - action: homeassistant.turn_off
            target:
              entity_id: *lampy
```

### Wesprzyj

Karta powstała po godzinach i jest za darmo, razem z kodem. Jeśli oszczędziła
Ci wieczoru grzebania w YAML-u, możesz postawić kawę przez
[GitHub Sponsors](https://github.com/sponsors/jokers1975). Ten sam skutek ma
przycisk **Sponsor** w nagłówku repozytorium.

Wsparcie niczego nie odblokowuje — karta była i zostaje w całości darmowa.

---

## English

### What it is for

Outdoor lighting usually ends up as a patchwork: a couple of automations,
a schedule in a separate add-on, and somewhere a set of fixed hours that need
adjusting four times a year. This card pulls all of it into one place.

**Everything is configured from the card itself, with no YAML.** A four-step
wizard walks you through it and shows what is still missing.

The card is **bilingual**: it speaks Polish when Home Assistant is set to
Polish, and English in every other case. Nothing to switch on.

### How it works

**1. Lamps on a photo.** Upload a top-down photo of your property and click
where the lamps are. Assign a `light` or `switch` entity to each point. The
point shows whether the lamp is on, and clicking it toggles the lamp — no
digging through entity lists.

**2. Offsets from the sun.** Two controls: how many minutes before or after
**sunset** to switch on, and before or after **sunrise** to switch off. The card
stores them in `input_number` entities, so an ordinary Home Assistant
automation can read them. The next switch-on and switch-off times are shown
right on the card.

Your lighting then drifts with the seasons on its own — on after ten in June,
before four in December, with no input from you.

**3. Automation and conflicts.** The actual switching is done by an automation
(template below). The card **checks whether something else already drives the
same lamps** — other automations through Home Assistant's related-items search,
and schedulers such as the Scheduler add-on through their entity lists. When it
finds something, it shows a warning naming them, with a button that disables the
conflicting entries and leaves control to your automation alone.

This is usually the most annoying failure mode with outdoor lighting: two
mechanisms fighting over the same lamps, each undoing the other.

**4. Colour.** Lamps that support colour get a swatch beside them in the list —
detected from `supported_color_modes`. Clicking the swatch opens a **palette of
twelve basic colours**; the full system picker hides behind a "full palette"
disclosure. Tunable-white lamps get a colour temperature field instead. Once
set, a lamp always comes up in the same colour rather than whatever it happened
to remember.

The yellow in the palette is deliberately shifted towards amber. Pure yellow
`#ffff00` comes out greenish on RGB emitters because the green channel is
brighter than the red one — which is why picking "yellow" from a full colour
picker often lands on lime.

### Visual layer

The top of the card shows the sky: the position of the Sun and Moon, time of
day and the weather. This is **decoration**, not the point — but it does let you
see at a glance how long until the lights come on.

Both positions come from positional astronomy using the coordinates in your Home
Assistant configuration, so the Moon can appear during daylight, just as it does
in the real sky. The dashed arc is the real path across the sky on that day:
high in summer, flat in winter. The Moon shows its current phase.

Point the card at a weather entity and you also get clouds, rain or snow, plus
trees on both sides — green from spring through autumn, bare in winter — that
sway above 10 km/h of wind. In the evening the property photo dims in proportion
to the Sun's altitude, which makes the glow of lit lamps stand out.

![The sky at sunset: the sun just above the horizon, its arc, trees on both sides and the first stars](https://raw.githubusercontent.com/jokers1975/lovelace-ogrod-swiatla-card/main/docs/baner.webp)

Animations honour the system reduced-motion preference.

### Setup wizard

1. **Property photo** — the *Upload* button sends the file to the Home Assistant
   image store. Nothing needs copying into `/config/www`.
2. **Lamps** — place them by clicking on the photo.
3. **Sun control** — a button creates both `input_number` helpers with the right
   range and unit. The weather entity is chosen here too.
4. **Automation** — point the card at your automation so conflict detection
   knows what to leave alone and what to enable. If you have none yet, the
   **Create a new automation** button builds a clean one driven solely by this
   card and connects it straight away. It switches the lamps on relative to
   sunset and off relative to sunrise, reading the offsets live from the
   helpers — moving a slider on the card takes effect at once, with no need to
   edit the automation.

Placing lamps:

- **click an empty spot** on the image to add a point,
- **press and drag** a point to move it (works with a finger too),
- **click an existing point** to select it, then assign an entity or delete it.

Coordinates are stored as percentages of the image, so points stay put at any
screen size.

### One relay, several bulbs on the plan

The commonest garden case: one circuit powers five lamps. You want five points
to light up on the plan rather than one, and clicking any of them to switch the
whole circuit.

Place the bulbs as usual, then press **Select several bulbs** in step 2. Click
the points on the photo — they get highlighted — pick **one relay** from the
entity list and press **Assign to selected**. They all receive the same entity,
so:

- when the relay switches on, **all those points light up at once**,
- clicking any one of them switches **the whole circuit** on or off.

Points sharing a circuit get a common letter (`A`, `B`, …) on the plan, so you
can see at a glance which belong together. Glow colour is still set per point.

### The “all lights” switch

The card header carries a switch covering every light on the card. It is there
for taking over by hand: switch the lamps off in the middle of the day if they
were left on, or switch them on in the evening without waiting for the sunset
threshold.

The automation is left untouched — it will set its own state at the next
threshold crossing. This is a stopgap, not a manual mode.

### Light groups

A group is several light sources switched together — or **a single relay that
powers several bulbs**. You create one in step 2, in the collapsible *Light
groups* panel: give it a name and select the sources (hold Ctrl to pick
several). Then choose the group instead of a single entity for a point; groups
appear at the top of the same list.

Two typical uses:

- **several lamps, one click** — a single point on the plan drives the whole
  group. The point glows when anything in the group is on, and clicking it
  switches everything off at once;
The “one relay, five bulbs” case needs no group — a shared entity, described
above, is enough. Groups earn their keep when **a single point** should drive
**several different** light sources.

Colour is set per point, so the same relay can glow differently in different
corners of the garden. The automation created in step 4 covers every source
from every group, without duplicates.

### Where to get an aerial photo

Any top-down image will do. In Poland the national geoportal
([GUGiK](https://mapy.geoportal.gov.pl/imap/)) publishes orthophotos at roughly
**5 cm per pixel**, far sharper than common web maps, covering the whole
country; the editor links to it. Elsewhere, look for your national mapping
agency or use your own drone shot.

**Turn every overlay off.** Geoportal draws parcel boundaries, cadastral numbers
and street names on top of the imagery by default. Switch them all off and keep
only the orthophoto — otherwise those lines and labels end up baked into your
card background for good.

Rotate the frame so the street is at the bottom and the far end of the garden
at the top.

#### Sharpening the screenshot

Screenshots often look soft. A free AI tool such as Gemini can clean them up.
A prompt that works well:

> this is an aerial photograph, improve its quality while preserving as much
> detail as possible, do not change anything in this photograph

That last clause matters most: without it the tool happily "improves" the scene,
adding trees or reshaping roofs.

Such tools **invent** detail that was never in the original. Geometry usually
survives intact, but fine textures are fabricated — harmless for a card
background, unacceptable for anything measured.

### Installation

HACS → ⋮ menu → **Custom repositories** → paste this repository's URL,
category **Dashboard** → Add → then **Download**.

Manual: copy `dist/ogrod-swiatla-card.js` into `/config/www/` and register
`/local/ogrod-swiatla-card.js` as a **JavaScript Module** resource under
Settings → Dashboards → ⋮ → Resources.

### Options

See the Polish configuration table above; the option names are identical.
In short: `image`, `offset_zachod_entity` (switch-on offset),
`offset_wschod_entity` (switch-off offset), `automation_entity`, `points`,
and optionally `sun_entity`, `weather_entity`, `dim_max` and `groups`. Each
point takes `x`, `y`, optionally `color` (`#rrggbb`) or `color_temp_kelvin`,
and either `entity` or `group` — the latter referencing an `id` from `groups`.
The same group may be assigned to any number of points.

A negative offset means **before** the event, a positive one **after**.

### Support

This card was built after hours and is free, source and all. If it saved you an
evening of wrestling with YAML, you can buy me a coffee through
[GitHub Sponsors](https://github.com/sponsors/jokers1975). The **Sponsor**
button in the repository header does the same thing.

Sponsoring unlocks nothing — the card was and stays entirely free.

---

## Licencja · License

MIT.
