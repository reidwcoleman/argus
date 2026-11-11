# Argus

Every public signal on one live 3D globe: aircraft, ships, satellites, quakes, fires, weather, 24,000+ public cameras, radio and more. No account, no API keys, nothing paid.

**Hosted preview:** https://reidwcoleman.github.io/argus/

## Run it yourself (full version)

    npm install
    npm start        # http://localhost:4317

The small local server (`server.mjs`) serves the app and relays the public feeds that browsers cannot fetch directly. Run locally for second-by-second aircraft tracking, world AIS (with a free AISStream key), plate-reader locations and optional camera-network keys.

## How the hosted preview works

GitHub Pages has no server, so a scheduled workflow (`.github/workflows/snapshot.yml`) runs the same feed code every 20 minutes and publishes the result to the `data` branch. On the hosted page, aircraft, military flights, news, fires and the camera list come from that snapshot and are labelled as delayed; aircraft positions are projected forward from it. Everything else (satellites, weather, quakes, ships in the Baltic, camera frames and video) is fetched live by your browser.

## Credits

Inspired by the open-source God's Eye View project (MIT). Argus is an independent interface and codebase.
Aircraft models in `public/models` are CC BY 4.0 (see `ATTRIBUTION.md` there). Datacenter and dam points are (c) OpenStreetMap contributors, ODbL. Installations are from Wikidata (CC0). Each live feed is credited in the app under Settings.
