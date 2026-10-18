# Datumsetikett

Ein Tipp – der NIIMBOT B1 druckt ein Etikett mit dem heutigen Datum. Gedacht für offene Lebensmittel:
Drucker an den Kühlschrank, Handy dran, „Heute drucken“.

**Seite:** https://vhenkel.github.io/niimbot-datum/

## Benutzung

1. Auf dem Android-Handy die Seite in **Chrome** öffnen (Web Bluetooth gibt es nur dort; am iPhone z. B. mit der App „Bluefy“).
2. Chrome-Menü → **Zum Startbildschirm hinzufügen**.
3. B1 kurz einschalten, **Heute drucken** tippen. Beim ersten Mal den Drucker in der Liste wählen;
   danach verbindet sich die Seite – wo Chrome es unterstützt – direkt mit dem gemerkten Drucker.

Unter *Einstellungen*: Text über dem Datum (Standard „Geöffnet“), Datumsformat, Etikettgröße
(50×30, 40×30, 30×15, 50×50 mm), Anzahl und Druckdichte. Die Einstellungen bleiben im Browser gespeichert.

## Technik

- `niimbot.js` – NIIMBOT-Protokoll über Web Bluetooth (Pakete `55 55 … AA AA` mit XOR-Prüfsumme,
  Ablauf wie der B1-Druckauftrag in [niimbluelib](https://github.com/MultiMote/niimbluelib)).
- `index.html` – Oberfläche, Etikett wird im Canvas gezeichnet und als 1-Bit-Bild gesendet.
- Schrift: [Atkinson Hyperlegible](https://fonts.google.com/specimen/Atkinson+Hyperlegible) (SIL OFL).
- Test: `node test.mjs`
