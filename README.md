# Oświetlenie ogrodu — karta Lovelace dla Home Assistanta

Karta pokazuje plan ogrodu z lotu ptaka, nanosi na niego lampy i steruje nimi
względem wschodu i zachodu słońca.

![wersja](https://img.shields.io/badge/wersja-1.5.0-2e7d32)
![hacs](https://img.shields.io/badge/HACS-Dashboard-41BDF5)

## Co robi

**Animowana pozycja słońca i księżyca.** Liczona z encji `sun.sun`
(`elevation`, `next_rising`, `next_setting`). Niebo zmienia barwę od dnia,
przez zmierzch, po noc z gwiazdami.

Po wejściu na kartę ciało niebieskie **wjeżdża od wschodu do swojej bieżącej
pozycji** w ciągu około dwóch i pół sekundy, z wyhamowaniem na końcu. Za dnia
robi to słońce, nocą — księżyc, który wędruje pod linią horyzontu.

Księżyc pokazuje **rzeczywistą fazę**. Liczona jest z miesiąca synodycznego,
bez żadnej dodatkowej encji, więc działa też bez integracji `moon`. Terminator
to półelipsa o poziomej półosi `r·|cos 2πf|`: przy nowiu równa promieniowi,
przy kwadrze zerowa, przy pełni znów równa promieniowi, ale z drugiej strony.
Sierp przybywający jest oświetlony po prawej, ubywający po lewej — zgodnie
z widokiem z półkuli północnej. Nazwa fazy trafia do podtytułu karty.

**Plan ogrodu z punktami świetlnymi.** Kliknięcie punktu przełącza przypisaną
encję, a świecąca lampa dostaje żółtą poświatę. Wieczorem zdjęcie przygasa
proporcjonalnie do wysokości słońca — płynnie między +8° a −8°, maksymalnie
o wartość `dim_max`. Warstwa przyciemnienia leży **pod** punktami, więc poświata
lamp pozostaje czytelna także po zmroku.

**Offsety wschodu i zachodu.** O ile minut przed lub po zachodzie włączyć
i przed lub po wschodzie wyłączyć oświetlenie. Karta zapisuje je do encji
`input_number`, dzięki czemu czyta je zwykła automatyzacja Home Assistanta.

## Konfiguracja bez YAML-a

Edytor karty prowadzi przez trzy kroki i sam pokazuje, czego jeszcze brakuje:

1. **Zdjęcie ogrodu** — przycisk *Wgraj zdjęcie* wysyła plik do magazynu obrazów
   Home Assistanta. Nie trzeba niczego kopiować do `/config/www`.
2. **Lampy** — rozmieszczasz je klikając w zdjęcie.
3. **Sterowanie słońcem** — przycisk *Utwórz helpery* zakłada oba `input_number`
   z właściwym zakresem i jednostką, po czym wpisuje je do konfiguracji karty.
4. **Automatyzacja** — wskazujesz automatyzację karty, dzięki czemu wykrywanie
   konfliktów wie, czego nie ruszać i co włączyć.

Sekcja *Ustawienia zaawansowane* pozwala podmienić encję słońca albo wskazać
własne helpery, jeśli już je masz.

## Instalacja przez HACS

HACS → menu ⋮ → **Custom repositories** → wklej adres tego repozytorium,
typ **Dashboard** → Add → następnie **Download**.

Instalacja ręczna: skopiuj `dist/ogrod-swiatla-card.js` do `/config/www/`
i dodaj zasób `/local/ogrod-swiatla-card.js` typu **JavaScript Module**
w Ustawienia → Dashboardy → ⋮ → Zasoby.

## Skąd wziąć zdjęcie ogrodu

Dowolne zdjęcie z góry. W edytorze karty jest przycisk **Wgraj zdjęcie** —
plik trafia do magazynu obrazów Home Assistanta i nie trzeba niczego kopiować
do `/config/www`.

Dobrym źródłem są darmowe ortofotomapy z krajowych serwisów geodezyjnych —
w Polsce Geoportal GUGiK udostępnia zdjęcia w rozdzielczości rzędu 5 cm na
piksel, czyli znacznie dokładniejsze niż popularne mapy internetowe.
Kadr najlepiej obrócić tak, żeby ulica była na dole, a głąb ogrodu na górze.

## Barwa zapalenia

Gdy przypiszesz do punktu źródło światła obsługujące kolor, edytor sam
zaproponuje **wybór barwy** — rozpoznaje to po `supported_color_modes`.
Lampy pozwalające regulować tylko biel dostają zamiast tego pole
**temperatury barwowej w kelwinach**. Zwykłe lampy i gniazdka nie dostają nic.

Po ustawieniu barwy kliknięcie punktu zapala lampę przez `light.turn_on`
z `rgb_color` albo `color_temp_kelvin`, więc światło zawsze wstaje w tym
samym kolorze, a nie w tym, co akurat pamiętało. Przycisk *Bez wymuszania*
wraca do zwykłego przełączania.

Poświata punktu przyjmuje **barwę, którą lampa faktycznie świeci**
(z atrybutu `rgb_color`), a gdy lampa jej nie podaje — barwę z konfiguracji.

## Rozmieszczanie lamp

W edytorze karty:

- **kliknięcie w wolne miejsce** obrazka dodaje punkt,
- **przytrzymanie i przeciągnięcie** punktu przesuwa go (działa też palcem),
- **kliknięcie w gotowy punkt** zaznacza go — wtedy można przypisać mu encję
  albo skasować.

Współrzędne zapisywane są w procentach szerokości i wysokości obrazka, więc
punkty trzymają się swoich miejsc niezależnie od rozmiaru ekranu.

## Konfiguracja

```yaml
type: custom:ogrod-swiatla-card
title: Oświetlenie ogrodu
image: /local/ogrod.jpg
sun_entity: sun.sun
offset_zachod_entity: input_number.ogrod_offset_zachod
offset_wschod_entity: input_number.ogrod_offset_wschod
dim_max: 0.5
points:
  - entity: light.ogrod_lampa_1
    x: 33
    y: 18
  - entity: switch.ogrod_lampa_2
    x: 70
    y: 27
```

| pole | domyślnie | znaczenie |
|---|---|---|
| `title` | `Oswietlenie ogrodu` | nagłówek karty |
| `image` | — | tło karty; `x` i `y` punktów liczone są w procentach jego wymiarów |
| `sun_entity` | `sun.sun` | encja słońca |
| `offset_zachod_entity` | — | `input_number` z przesunięciem włączenia |
| `offset_wschod_entity` | — | `input_number` z przesunięciem wyłączenia |
| `dim_max` | `0.5` | maksymalne nocne przyciemnienie tła, `0` = brak, `1` = czerń |
| `automation_entity` | — | automatyzacja karty; włączana przy rozwiązywaniu konfliktu |
| `points` | `[]` | lista punktów świetlnych z przypisanymi encjami |

Każdy punkt przyjmuje `entity`, `x`, `y` oraz opcjonalnie `color` (zapis `#rrggbb`)
albo `color_temp_kelvin`.

Punkt przyjmuje encje z domen `light` i `switch`; kliknięcie wywołuje
`homeassistant.toggle`.

## Helpery offsetów

Najprościej utworzyć je przyciskiem w kroku 3 edytora. Odpowiednik w YAML-u,
gdyby ktoś wolał ręcznie:

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

## Wykrywanie konfliktów

Karta sprawdza, czy tymi samymi lampami nie steruje już coś innego. Automatyzacje
znajduje przez wyszukiwarkę powiązań Home Assistanta (`search/related`),
a harmonogramy — na przykład dodatek Scheduler — po atrybucie `entities`.
Pod uwagę bierze tylko te aktywne, a własną automatyzację karty pomija.

Gdy coś znajdzie, pokazuje pasek ostrzeżenia z nazwami kolidujących wpisów
i przyciskiem, który **wyłącza je wszystkie i włącza automatyzację wskazaną
w konfiguracji karty**. Ostrzeżenie można też zignorować.

Własną automatyzację wskazuje się w kroku 4 edytora (`automation_entity`).

## Automatyzacja

Karta sama nie przełącza świateł o wyznaczonej porze — pokazuje stan i pozwala
ustawić offsety. Samo przełączanie robi automatyzacja. Wyzwalacze szablonowe
zawierają `now()`, więc Home Assistant przelicza je na początku każdej minuty,
a reakcja następuje wyłącznie na zmianę stanu okna — dzięki temu ręczne
zgaszenie lampy w środku nocy nie jest cofane.

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

Jeśli masz już inne harmonogramy na te same lampy (np. dodatek Scheduler),
wyłącz je — inaczej będą się nawzajem nadpisywać.

## Licencja

MIT.
