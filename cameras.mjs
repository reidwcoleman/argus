// Camera mesh aggregator: pulls every open, keyless official camera list the server can reach and
// normalises them to one compact table. Each source fails on its own; none needs an account.
const UA = 'Argus/1.0 (open-source globe viewer; public data only)';
async function text(url, timeout = 30000, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return (await res.text()).replace(/^﻿/, '');
}
const j = async (url, timeout) => JSON.parse(await text(url, timeout));
const DIR = { n: 0, north: 0, northbound: 0, nb: 0, ne: 45, northeast: 45, e: 90, east: 90, eastbound: 90, eb: 90, se: 135, southeast: 135, s: 180, south: 180, southbound: 180, sb: 180, sw: 225, southwest: 225, w: 270, west: 270, westbound: 270, wb: 270, nw: 315, northwest: 315 };
const dir = (s) => (s == null ? null : DIR[String(s).trim().toLowerCase()] ?? null);
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`)); return m ? m[1].trim() : ''; };
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Castle Rock "CARS" 511 platform, shared by several US states. */
const cars = (code, state, owner) => async (add) => {
  for (const c of await j(`https://${code}tg.carsprogram.org/cameras_v1/api/cameras`, 40000)) {
    const v = (c.views || [])[0], loc = c.location || {};
    if (!c.public || !v || !loc.latitude) continue;
    const live = v.type === 'WMP';
    add({ id: c.id, lat: loc.latitude, lon: loc.longitude, name: c.name, place: [(loc.cityReference || '').replace(/^in /, ''), state].filter(Boolean).join(', '), img: live ? v.videoPreviewUrl : v.url, hls: live ? v.url : '', src: owner });
  }
};

const SOURCES = {
  tfl: ['Transport for London', async (add) => {
    for (const c of await j('https://api.tfl.gov.uk/Place/Type/JamCam', 45000)) {
      const g = (k) => c.additionalProperties.find((p) => p.key === k)?.value;
      if (g('available') !== 'false' && g('imageUrl')) add({ id: c.id, lat: c.lat, lon: c.lon, name: c.commonName, place: 'London', img: g('imageUrl'), video: g('videoUrl') });
    }
  }],
  ca: ['Caltrans', async (add) => {
    await Promise.allSettled([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(async (d) => {
      for (const r of (await j(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${String(d).padStart(2, '0')}.json`, 45000)).data) {
        const c = r.cctv, loc = c.location, img = c.imageData?.static?.currentImageURL;
        if (c.inService === 'true' && img && +loc.latitude) add({ id: `${d}_${c.index}`, lat: +loc.latitude, lon: +loc.longitude, name: loc.locationName, place: `${loc.nearbyPlace || loc.county}, California`, img, hls: c.imageData.streamingVideoURL || '', dir: dir(loc.direction) });
      }
    }));
  }],
  fi: ['Fintraffic', async (add) => {
    const d = JSON.parse(await text('https://tie.digitraffic.fi/api/weathercam/v1/stations', 45000, { 'Digitraffic-User': 'Argus/local' }));
    for (const f of d.features) {
      const p = f.properties, preset = (p.presets || []).find((x) => x.inCollection) || p.presets?.[0];
      if (preset && p.collectionStatus !== 'REMOVED_PERMANENTLY') add({ id: p.id, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: (p.name || '').replace(/_/g, ' '), place: 'Finland', img: `https://weathercam.digitraffic.fi/${preset.id}.jpg` });
    }
  }],
  nyc: ['NYC DOT', async (add) => {
    for (const c of await j('https://webcams.nyctmc.org/api/cameras')) if (c.isOnline === 'true') add({ id: c.id, lat: c.latitude, lon: c.longitude, name: c.name, place: `${c.area}, New York City`, img: c.imageUrl });
  }],
  wa: ['WSDOT', async (add) => {
    const kml = await text('https://www.wsdot.wa.gov/Traffic/api/HighwayCameras/kml.aspx', 40000);
    for (const pm of kml.split('<Placemark').slice(1)) {
      const img = (pm.match(/src="([^"]+)"/) || [])[1], co = tag(pm, 'coordinates').split(','), id = (pm.match(/^ id="ID (\d+)"/) || [])[1];
      if (img && co.length >= 2 && id) add({ id, lat: +co[1], lon: +co[0], name: unesc(tag(pm, 'name')), place: 'Washington', img });
    }
  }],
  sea: ['Seattle DOT', async (add) => {
    for (const f of (await j('https://web.seattle.gov/Travelers/api/Map/Data?zoomId=13&type=2')).Features) for (const c of f.Cameras || []) if (c.Type === 'sdot') add({ id: c.Id, lat: f.PointCoordinate[0], lon: f.PointCoordinate[1], name: c.Description, place: 'Seattle, Washington', img: `https://www.seattle.gov/trafficcams/images/${c.ImageUrl}` });
  }],
  or: ['Oregon DOT TripCheck', async (add) => {
    for (const f of (await j('https://tripcheck.com/Scripts/map/data/cctvinventory.js')).features) { const a = f.attributes; if (a.filename && a.latitude) add({ id: a.cameraId, lat: a.latitude, lon: a.longitude, name: a.title, place: `${(a.route || '').trim()}, Oregon`, img: `https://tripcheck.com/RoadCams/cams/${a.filename}` }); }
  }],
  mn: ['MnDOT', cars('mn', 'Minnesota', 'MnDOT')],
  ia: ['Iowa DOT', cars('ia', 'Iowa', 'Iowa DOT')],
  in: ['INDOT', cars('in', 'Indiana', 'INDOT')],
  ks: ['KDOT', cars('ks', 'Kansas', 'KDOT')],
  ne: ['Nebraska DOT', cars('ne', 'Nebraska', 'Nebraska DOT')],
  co: ['CDOT', cars('co', 'Colorado', 'CDOT')],
  md: ['Maryland CHART', async (add) => {
    for (const c of await j('https://chart.maryland.gov/DataFeeds/GetCamerasJson')) if (c.opStatus === 'OK' && c.commMode === 'ONLINE' && c.cctvIp && c.lat) add({ id: c.id, lat: c.lat, lon: c.lon, name: c.name || c.description, place: `${(c.cameraCategories || [])[0] || 'Maryland'}, Maryland`, hls: `https://${c.cctvIp}/rtplive/${c.id}/playlist.m3u8` });
  }],
  de: ['DelDOT', async (add) => {
    for (const c of (await j('https://tmc.deldot.gov/json/videocamera.json')).videoCameras) if (c.enabled && c.status === 'Active' && c.urls?.m3u8s) add({ id: c.id, lat: c.lat, lon: c.lon, name: c.title, place: `${c.county} County, Delaware`, hls: c.urls.m3u8s });
  }],
  mi: ['Michigan DOT', async (add) => {
    for (const c of await j('https://mdotjboss.state.mi.us/MiDrive/camera/list', 40000)) {
      const lat = (c.county.match(/lat=([-\d.]+)/) || [])[1], lon = (c.county.match(/lon=([-\d.]+)/) || [])[1], id = (c.county.match(/id=(\d+)/) || [])[1], img = (c.image.match(/src="([^"]+)"/) || [])[1];
      if (lat && lon && id && img) add({ id, lat: +lat, lon: +lon, name: `${c.route}${c.location}`.trim(), place: `${c.county.split('<')[0].trim()}, Michigan`, img: unesc(img), dir: dir((c.direction.match(/traveling (\w+)/) || [])[1]) });
    }
  }],
  il: ['Illinois DOT · Travel Midwest', async (add) => {
    for (let off = 0; off < 12000; off += 1000) {
      const d = await j(`https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID,CameraLocation,CameraDirection,SnapShot,TooOld&f=json&outSR=4326&resultRecordCount=1000&resultOffset=${off}`, 40000);
      for (const f of d.features || []) { const a = f.attributes; if (a.SnapShot && a.TooOld !== 'true' && f.geometry) add({ id: a.OBJECTID, lat: f.geometry.y, lon: f.geometry.x, name: a.CameraLocation, place: 'Illinois', img: a.SnapShot, dir: dir(a.CameraDirection) }); }
      if (!d.exceededTransferLimit) break;
    }
  }],
  nm: ['NMDOT', async (add) => {
    for (const c of (await j('https://servicev5.nmroads.com/RealMapWAR/GetCameraInfo')).cameraInfo) if (c.enabled && c.snapshotFile && c.lat) add({ id: c.name, lat: c.lat, lon: c.lon, name: c.title, place: `${c.grouping || 'New Mexico'}, New Mexico`, img: c.snapshotFile });
  }],
  atx: ['City of Austin', async (add) => {
    for (const c of await j('https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=5000&camera_status=TURNED_ON')) if (c.screenshot_address && c.location?.coordinates) add({ id: c.camera_id, lat: c.location.coordinates[1], lon: c.location.coordinates[0], name: c.location_name, place: 'Austin, Texas', img: c.screenshot_address });
  }],
  bc: ['DriveBC', async (add) => {
    for (const c of await j('https://www.drivebc.ca/api/webcams/', 45000)) if (c.is_on !== false && c.should_appear !== false && c.location?.coordinates) add({ id: c.id, lat: c.location.coordinates[1], lon: c.location.coordinates[0], name: c.name, place: `${c.region_name || 'British Columbia'}, British Columbia`, img: `https://www.drivebc.ca/images/${c.id}.jpg`, dir: dir(c.orientation) });
  }],
  tor: ['City of Toronto', async (add) => {
    const t = await text('https://opendata.toronto.ca/transportation/tmc/rescucameraimages/Data/tmcearthcameras.json');
    for (const c of JSON.parse(t.slice(t.indexOf('(') + 1, t.lastIndexOf(')'))).Data) add({ id: c.Number, lat: +c.Latitude, lon: +c.Longitude, name: c.Name, place: 'Toronto, Ontario', img: `https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/loc${c.Number}.jpg` });
  }],
  yyc: ['City of Calgary', async (add) => {
    for (const c of await j('https://data.calgary.ca/resource/k7p9-kppz.json?$limit=2000')) if (c.camera_url?.url && c.point?.coordinates) add({ id: c.camera_url.url.match(/loc(\d+)/)?.[1] || c.camera_location, lat: c.point.coordinates[1], lon: c.point.coordinates[0], name: c.camera_location, place: 'Calgary, Alberta', img: c.camera_url.url });
  }],
  is: ['Vegagerðin', async (add) => {
    for (const c of await j('https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1')) if (c.Slod && c.Breidd) add({ id: `${c.Maelist_nr}_${c.Slod.split('/').pop()}`, lat: c.Breidd, lon: c.Lengd, name: c.Skyring || c.Myndavel, place: `${c.Vegheiti || c.Myndavel}, Iceland`, img: c.Slod });
  }],
  hk: ['Hong Kong Transport Department', async (add) => {
    for (const x of (await text('https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml')).split('<image>').slice(1)) { const url = tag(x, 'url'); if (url) add({ id: tag(x, 'key'), lat: +tag(x, 'latitude'), lon: +tag(x, 'longitude'), name: unesc(tag(x, 'description')).replace(/\s*\[\w+\]$/, ''), place: `${tag(x, 'district')}, Hong Kong`, img: url }); }
  }],
  nsw: ['Transport for NSW', async (add) => {
    for (const f of (await j('https://data.livetraffic.com/cameras/traffic-cam.json')).features) { const p = f.properties; if (p.href) add({ id: f.id, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: p.title, place: 'New South Wales, Australia', img: p.href, dir: dir(p.direction) }); }
  }],
  nz: ['NZ Transport Agency', async (add) => {
    for (const x of (await text('https://trafficnz.info/service/traffic/rest/4/cameras/all', 40000)).split('<camera>').slice(1)) {
      const img = tag(x, 'imageUrl'), lat = +(x.match(/<latitude>([-\d.]+)<\/latitude>/) || [])[1], lon = +(x.match(/<longitude>([-\d.]+)<\/longitude>/) || [])[1];
      if (img && lat && tag(x, 'offline') !== 'true') add({ id: tag(x, 'id'), lat, lon, name: unesc((x.match(/<\/journeyLeg>[\s\S]*?<name>([^<]*)<\/name>/) || [])[1] || tag(x, 'description')).trim(), place: `${tag(x, 'highway')}, New Zealand`, img: `https://trafficnz.info${img}`, dir: dir(tag(x, 'direction')) });
    }
  }],
  usgs: ['USGS volcano cameras', async (add) => {
    const cut = Date.now() / 1000 - 3 * 86400;
    for (const c of (await j('https://volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams', 40000)).webcams) if (c.hasImages === 'Y' && c.lastImageTimestamp > cut && c.currentMediumImageUrl) add({ id: c.webcamCode, lat: c.latitude, lon: c.longitude, name: c.webcamName, place: c.vName ? `${c.vName} volcano` : 'Volcano observatory', img: c.currentMediumImageUrl, dir: Number.isFinite(c.bearingDeg) ? c.bearingDeg : null });
  }],
  buoy: ['NOAA buoy cameras', async (add) => {
    for (const b of await j('https://www.ndbc.noaa.gov/buoycams.php')) if (b.img && b.lat != null) add({ id: b.id, lat: b.lat, lon: b.lng, name: `Buoy ${b.id}`, place: b.name, img: `https://www.ndbc.noaa.gov/buoycam.php?station=${b.id}` });
  }],
};

/** Hosts that serve camera frames, so the image proxy can relay them for the in-world monitor. */
export const cameraHosts = new Set();
const publicHost = (h) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h) && !/^(localhost|.*\.local|.*\.internal)$/i.test(h);

export async function cameraMesh() {
  const sources = [], rows = [], failed = [];
  await Promise.allSettled(Object.entries(SOURCES).map(async ([code, [name, load]]) => {
    const mine = [], seen = new Set();
    const add = (c) => {
      const lat = +c.lat, lon = +c.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (!lat && !lon) || seen.has(c.id)) return;
      const img = /^https?:\/\//.test(c.img || '') ? c.img : '', hls = /^https:\/\//.test(c.hls || '') ? c.hls : '';
      if (!img && !hls) return;
      seen.add(c.id);
      mine.push({ k: `${code}_${c.id}`, lat: +lat.toFixed(5), lon: +lon.toFixed(5), name: String(c.name || 'Camera').replace(/\s+/g, ' ').trim().slice(0, 90), place: String(c.place || '').replace(/\s+/g, ' ').trim().slice(0, 70), img, hls, dir: c.dir ?? null, video: /^https:\/\//.test(c.video || '') ? c.video : '' });
    };
    try {
      await load(add);
      if (!mine.length) throw new Error('empty');
      const si = sources.push({ code, name, count: mine.length }) - 1;
      for (const c of mine) {
        rows.push(c.video ? [c.k, c.lat, c.lon, c.name, si, c.place, c.img, c.hls, c.dir, c.video] : [c.k, c.lat, c.lon, c.name, si, c.place, c.img, c.hls, c.dir]);
        for (const u of [c.img]) { if (!u) continue; try { const h = new URL(u).hostname; if (publicHost(h)) cameraHosts.add(h); } catch { /* skip */ } }
      }
    } catch (e) { failed.push({ code, name, why: String(e.message || e).slice(0, 80) }); }
  }));
  if (!rows.length) throw new Error('no camera network answered');
  return { status: 200, type: 'application/json; charset=utf-8', body: JSON.stringify({ sources, failed, rows }) };
}
