# gpx wetter

Eine kleine Web-App, die Wetterprognosen entlang einer Radroute visualisiert.

Upload einer GPX-Datei + geplante Startzeit + Ø-Geschwindigkeit → die App zeichnet
die Route auf einer Karte ein, färbt Segmente nach Niederschlagswahrscheinlichkeit,
zeigt Wind als Pfeil-Marker und plottet Temperatur, Niederschlag, Wind und
UV-Index entlang der Strecke.

## Stack

- Vanilla JS, HTML, CSS — kein Build-Step
- [Leaflet](https://leafletjs.com/) + [CyclOSM](https://www.cyclosm.org/) Tiles
- [Chart.js](https://www.chartjs.org/) für die Diagramme
- [Open-Meteo](https://open-meteo.com/) als Wetter-API (kostenlos, kein API-Key)

## Lokal entwickeln

```bash
python3 -m http.server 8765
```

Dann `http://localhost:8765` aufrufen.
