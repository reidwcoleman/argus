# Argus

Every public signal on one live 3D globe: aircraft, ships, satellites, quakes, fires, weather, public cameras, radio and more. No account, no API keys, nothing paid.

    npm install
    npm start        # http://localhost:4317

The small local server (`server.mjs`) serves the app and proxies the public feeds that do not send CORS headers.

Inspired by the open-source God's Eye View project (MIT). Argus is an independent interface and codebase.
Aircraft models in `public/models` are CC BY 4.0 (see `ATTRIBUTION.md` there). Datacenter and dam points are (c) OpenStreetMap contributors, ODbL.
