# Schulbegleitung • Personalmanager (Offline/PWA)

## Was ist das?
Eine offline-fähige Ein-Gerät-App (Progressive Web App), um Schulbegleiter zu verwalten und
bei Abwesenheit schnell Stunden-Vertretungen zuzuweisen.

- **Links:** Namensliste (1/5 Breite), Markierung „Verfügbar“ (grün) / „Abwesend“ (rot)
- **Rechts:** Abwesende Personen (aktueller Tag) + Zuweisungen per Popup
- **Standardraster:** zentral bearbeitbar (Stunden + Pausen in beliebiger Länge)
- **Pro Stunde:** kurzer Text (Notiz)
- **Log:** Änderungen/Zuweisungen pro Datum, Export als JSON/CSV
- **Offline:** Service Worker, Daten lokal im Browser (localStorage)

## Starten (PC/Mac)
1. Ordner entpacken
2. `index.html` öffnen

**Besser:** über einen lokalen Webserver (macht PWA-Install sauberer), z.B.:
- Python: `python -m http.server 5173`
- Dann öffnen: `http://localhost:5173`

## Installieren (Android)
- In Chrome öffnen → Menü → **„App installieren“** oder **„Zum Startbildschirm“**

## Installieren (iPhone/iPad)
- In Safari öffnen → Teilen → **„Zum Home-Bildschirm“**
- Danach aus dem Home Screen starten (Offline-PWA)

## Datenschutz
Es werden **nur Namen** gespeichert. Alle Daten bleiben auf **diesem Gerät**,
bis du sie exportierst oder löscht.

## Daten/Log Export
Im Tab **„Log“** oder in **„Optionen“**: Export als JSON/CSV.

---

Version: v1
