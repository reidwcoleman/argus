// Bundled gazetteer for keyless search and voice: [name, lat, lon, country or note, kind, aliases?]
// kind: c = city, a = airport, l = landmark, p = port
export const PLACES = [
  ['Tokyo', 35.6762, 139.6503, 'Japan', 'c'], ['Delhi', 28.6139, 77.209, 'India', 'c'], ['Shanghai', 31.2304, 121.4737, 'China', 'c'], ['São Paulo', -23.5505, -46.6333, 'Brazil', 'c', 'sao paulo'],
  ['Mexico City', 19.4326, -99.1332, 'Mexico', 'c'], ['Cairo', 30.0444, 31.2357, 'Egypt', 'c'], ['Mumbai', 19.076, 72.8777, 'India', 'c'], ['Beijing', 39.9042, 116.4074, 'China', 'c'],
  ['Dhaka', 23.8103, 90.4125, 'Bangladesh', 'c'], ['Osaka', 34.6937, 135.5023, 'Japan', 'c'], ['New York', 40.7128, -74.006, 'United States', 'c', 'nyc|new york city|manhattan'], ['Karachi', 24.8607, 67.0011, 'Pakistan', 'c'],
  ['Buenos Aires', -34.6037, -58.3816, 'Argentina', 'c'], ['Istanbul', 41.0082, 28.9784, 'Türkiye', 'c'], ['Kolkata', 22.5726, 88.3639, 'India', 'c'], ['Manila', 14.5995, 120.9842, 'Philippines', 'c'],
  ['Lagos', 6.5244, 3.3792, 'Nigeria', 'c'], ['Rio de Janeiro', -22.9068, -43.1729, 'Brazil', 'c', 'rio'], ['Kinshasa', -4.4419, 15.2663, 'DR Congo', 'c'], ['Los Angeles', 34.0522, -118.2437, 'United States', 'c', 'la'],
  ['Moscow', 55.7558, 37.6173, 'Russia', 'c'], ['Paris', 48.8566, 2.3522, 'France', 'c'], ['Bogotá', 4.711, -74.0721, 'Colombia', 'c', 'bogota'], ['Jakarta', -6.2088, 106.8456, 'Indonesia', 'c'],
  ['Lima', -12.0464, -77.0428, 'Peru', 'c'], ['Bangkok', 13.7563, 100.5018, 'Thailand', 'c'], ['Seoul', 37.5665, 126.978, 'South Korea', 'c'], ['London', 51.5074, -0.1278, 'United Kingdom', 'c'],
  ['Tehran', 35.6892, 51.389, 'Iran', 'c'], ['Chicago', 41.8781, -87.6298, 'United States', 'c'], ['Hong Kong', 22.3193, 114.1694, 'China', 'c'], ['Baghdad', 33.3152, 44.3661, 'Iraq', 'c'],
  ['Singapore', 1.3521, 103.8198, 'Singapore', 'c'], ['Toronto', 43.6532, -79.3832, 'Canada', 'c'], ['Madrid', 40.4168, -3.7038, 'Spain', 'c'], ['Houston', 29.7604, -95.3698, 'United States', 'c'],
  ['Dallas', 32.7767, -96.797, 'United States', 'c'], ['Miami', 25.7617, -80.1918, 'United States', 'c'], ['Atlanta', 33.749, -84.388, 'United States', 'c'], ['Washington', 38.9072, -77.0369, 'United States', 'c', 'washington dc|dc'],
  ['Boston', 42.3601, -71.0589, 'United States', 'c'], ['Philadelphia', 39.9526, -75.1652, 'United States', 'c'], ['Phoenix', 33.4484, -112.074, 'United States', 'c'], ['San Francisco', 37.7749, -122.4194, 'United States', 'c', 'sf'],
  ['Seattle', 47.6062, -122.3321, 'United States', 'c'], ['Denver', 39.7392, -104.9903, 'United States', 'c'], ['Austin', 30.2672, -97.7431, 'United States', 'c'], ['San Diego', 32.7157, -117.1611, 'United States', 'c'],
  ['Las Vegas', 36.1699, -115.1398, 'United States', 'c', 'vegas'], ['Honolulu', 21.3069, -157.8583, 'United States', 'c'], ['Anchorage', 61.2181, -149.9003, 'United States', 'c'], ['Minneapolis', 44.9778, -93.265, 'United States', 'c'],
  ['Detroit', 42.3314, -83.0458, 'United States', 'c'], ['New Orleans', 29.9511, -90.0715, 'United States', 'c'], ['Nashville', 36.1627, -86.7816, 'United States', 'c'], ['Charlotte', 35.2271, -80.8431, 'United States', 'c'],
  ['Raleigh', 35.7796, -78.6382, 'United States', 'c'], ['Orlando', 28.5383, -81.3792, 'United States', 'c'], ['Portland', 45.5152, -122.6784, 'United States', 'c'], ['Salt Lake City', 40.7608, -111.891, 'United States', 'c'],
  ['Vancouver', 49.2827, -123.1207, 'Canada', 'c'], ['Montreal', 45.5019, -73.5674, 'Canada', 'c'], ['Calgary', 51.0447, -114.0719, 'Canada', 'c'], ['Havana', 23.1136, -82.3666, 'Cuba', 'c'],
  ['Santiago', -33.4489, -70.6693, 'Chile', 'c'], ['Caracas', 10.4806, -66.9036, 'Venezuela', 'c'], ['Quito', -0.1807, -78.4678, 'Ecuador', 'c'], ['Panama City', 8.9824, -79.5199, 'Panama', 'c'],
  ['Berlin', 52.52, 13.405, 'Germany', 'c'], ['Rome', 41.9028, 12.4964, 'Italy', 'c'], ['Amsterdam', 52.3676, 4.9041, 'Netherlands', 'c'], ['Brussels', 50.8503, 4.3517, 'Belgium', 'c'],
  ['Vienna', 48.2082, 16.3738, 'Austria', 'c'], ['Zurich', 47.3769, 8.5417, 'Switzerland', 'c'], ['Geneva', 46.2044, 6.1432, 'Switzerland', 'c'], ['Munich', 48.1351, 11.582, 'Germany', 'c'],
  ['Frankfurt', 50.1109, 8.6821, 'Germany', 'c'], ['Hamburg', 53.5511, 9.9937, 'Germany', 'c'], ['Barcelona', 41.3851, 2.1734, 'Spain', 'c'], ['Lisbon', 38.7223, -9.1393, 'Portugal', 'c'],
  ['Dublin', 53.3498, -6.2603, 'Ireland', 'c'], ['Edinburgh', 55.9533, -3.1883, 'United Kingdom', 'c'], ['Manchester', 53.4808, -2.2426, 'United Kingdom', 'c'], ['Copenhagen', 55.6761, 12.5683, 'Denmark', 'c'],
  ['Stockholm', 59.3293, 18.0686, 'Sweden', 'c'], ['Oslo', 59.9139, 10.7522, 'Norway', 'c'], ['Helsinki', 60.1699, 24.9384, 'Finland', 'c'], ['Reykjavik', 64.1466, -21.9426, 'Iceland', 'c'],
  ['Warsaw', 52.2297, 21.0122, 'Poland', 'c'], ['Prague', 50.0755, 14.4378, 'Czechia', 'c'], ['Budapest', 47.4979, 19.0402, 'Hungary', 'c'], ['Athens', 37.9838, 23.7275, 'Greece', 'c'],
  ['Kyiv', 50.4501, 30.5234, 'Ukraine', 'c', 'kiev'], ['Bucharest', 44.4268, 26.1025, 'Romania', 'c'], ['Milan', 45.4642, 9.19, 'Italy', 'c'], ['Venice', 45.4408, 12.3155, 'Italy', 'c'],
  ['Saint Petersburg', 59.9311, 30.3609, 'Russia', 'c', 'st petersburg'], ['Dubai', 25.2048, 55.2708, 'UAE', 'c'], ['Abu Dhabi', 24.4539, 54.3773, 'UAE', 'c'], ['Riyadh', 24.7136, 46.6753, 'Saudi Arabia', 'c'],
  ['Doha', 25.2854, 51.531, 'Qatar', 'c'], ['Tel Aviv', 32.0853, 34.7818, 'Israel', 'c'], ['Jerusalem', 31.7683, 35.2137, 'Israel', 'c'], ['Beirut', 33.8938, 35.5018, 'Lebanon', 'c'],
  ['Amman', 31.9454, 35.9284, 'Jordan', 'c'], ['Kabul', 34.5553, 69.2075, 'Afghanistan', 'c'], ['Islamabad', 33.6844, 73.0479, 'Pakistan', 'c'], ['Bengaluru', 12.9716, 77.5946, 'India', 'c', 'bangalore'],
  ['Chennai', 13.0827, 80.2707, 'India', 'c'], ['Hyderabad', 17.385, 78.4867, 'India', 'c'], ['Kathmandu', 27.7172, 85.324, 'Nepal', 'c'], ['Colombo', 6.9271, 79.8612, 'Sri Lanka', 'c'],
  ['Hanoi', 21.0278, 105.8342, 'Vietnam', 'c'], ['Ho Chi Minh City', 10.8231, 106.6297, 'Vietnam', 'c', 'saigon'], ['Kuala Lumpur', 3.139, 101.6869, 'Malaysia', 'c'], ['Taipei', 25.033, 121.5654, 'Taiwan', 'c'],
  ['Shenzhen', 22.5431, 114.0579, 'China', 'c'], ['Guangzhou', 23.1291, 113.2644, 'China', 'c'], ['Chengdu', 30.5728, 104.0668, 'China', 'c'], ['Wuhan', 30.5928, 114.3055, 'China', 'c'],
  ['Pyongyang', 39.0392, 125.7625, 'North Korea', 'c'], ['Ulaanbaatar', 47.8864, 106.9057, 'Mongolia', 'c'], ['Sydney', -33.8688, 151.2093, 'Australia', 'c'], ['Melbourne', -37.8136, 144.9631, 'Australia', 'c'],
  ['Brisbane', -27.4698, 153.0251, 'Australia', 'c'], ['Perth', -31.9505, 115.8605, 'Australia', 'c'], ['Auckland', -36.8485, 174.7633, 'New Zealand', 'c'], ['Wellington', -41.2866, 174.7756, 'New Zealand', 'c'],
  ['Johannesburg', -26.2041, 28.0473, 'South Africa', 'c'], ['Cape Town', -33.9249, 18.4241, 'South Africa', 'c'], ['Nairobi', -1.2921, 36.8219, 'Kenya', 'c'], ['Addis Ababa', 9.0054, 38.7636, 'Ethiopia', 'c'],
  ['Accra', 5.6037, -0.187, 'Ghana', 'c'], ['Casablanca', 33.5731, -7.5898, 'Morocco', 'c'], ['Algiers', 36.7538, 3.0588, 'Algeria', 'c'], ['Tunis', 36.8065, 10.1815, 'Tunisia', 'c'],
  ['Dakar', 14.7167, -17.4677, 'Senegal', 'c'], ['Khartoum', 15.5007, 32.5599, 'Sudan', 'c'], ['Dar es Salaam', -6.7924, 39.2083, 'Tanzania', 'c'], ['Luanda', -8.839, 13.2894, 'Angola', 'c'],
  ['LAX Los Angeles Intl', 33.9416, -118.4085, 'Airport', 'a', 'lax'], ['JFK New York', 40.6413, -73.7781, 'Airport', 'a', 'jfk|kennedy'], ['LHR London Heathrow', 51.47, -0.4543, 'Airport', 'a', 'lhr|heathrow'],
  ['DFW Dallas Fort Worth', 32.8998, -97.0403, 'Airport', 'a', 'dfw'], ['ATL Atlanta Hartsfield-Jackson', 33.6407, -84.4277, 'Airport', 'a', 'atl'], ['ORD Chicago O\'Hare', 41.9742, -87.9073, 'Airport', 'a', 'ord|ohare|o\'hare'],
  ['DEN Denver Intl', 39.8561, -104.6737, 'Airport', 'a', 'den'], ['SFO San Francisco Intl', 37.6213, -122.379, 'Airport', 'a', 'sfo'], ['SEA Seattle-Tacoma', 47.4502, -122.3088, 'Airport', 'a', 'sea|seatac'],
  ['MIA Miami Intl', 25.7959, -80.287, 'Airport', 'a', 'mia'], ['EWR Newark Liberty', 40.6895, -74.1745, 'Airport', 'a', 'ewr|newark'], ['IAH Houston Intercontinental', 29.9902, -95.3368, 'Airport', 'a', 'iah'],
  ['AUS Austin-Bergstrom', 30.1975, -97.6664, 'Airport', 'a', 'aus'], ['BOS Boston Logan', 42.3656, -71.0096, 'Airport', 'a', 'bos|logan'], ['LAS Las Vegas Harry Reid', 36.084, -115.1537, 'Airport', 'a', 'las'],
  ['PHX Phoenix Sky Harbor', 33.4352, -112.0101, 'Airport', 'a', 'phx'], ['CDG Paris Charles de Gaulle', 49.0097, 2.5479, 'Airport', 'a', 'cdg'], ['AMS Amsterdam Schiphol', 52.3105, 4.7683, 'Airport', 'a', 'ams|schiphol'],
  ['FRA Frankfurt', 50.0379, 8.5622, 'Airport', 'a', 'fra'], ['IST Istanbul Airport', 41.2753, 28.7519, 'Airport', 'a', 'ist'], ['DXB Dubai Intl', 25.2532, 55.3657, 'Airport', 'a', 'dxb'],
  ['HND Tokyo Haneda', 35.5494, 139.7798, 'Airport', 'a', 'hnd|haneda'], ['NRT Tokyo Narita', 35.772, 140.3929, 'Airport', 'a', 'nrt|narita'], ['SIN Singapore Changi', 1.3644, 103.9915, 'Airport', 'a', 'sin|changi'],
  ['HKG Hong Kong Intl', 22.308, 113.9185, 'Airport', 'a', 'hkg'], ['PEK Beijing Capital', 40.0799, 116.6031, 'Airport', 'a', 'pek'], ['ICN Seoul Incheon', 37.4602, 126.4407, 'Airport', 'a', 'icn|incheon'],
  ['SYD Sydney Kingsford Smith', -33.9399, 151.1753, 'Airport', 'a', 'syd'], ['DEL Delhi Indira Gandhi', 28.5562, 77.1, 'Airport', 'a', 'del'], ['GRU São Paulo Guarulhos', -23.4356, -46.4731, 'Airport', 'a', 'gru'],
  ['MEX Mexico City Intl', 19.4361, -99.0719, 'Airport', 'a', 'mex'], ['YYZ Toronto Pearson', 43.6777, -79.6248, 'Airport', 'a', 'yyz|pearson'], ['MAD Madrid Barajas', 40.4983, -3.5676, 'Airport', 'a', 'mad'],
  ['DOH Doha Hamad', 25.2731, 51.6081, 'Airport', 'a', 'doh'], ['JNB Johannesburg O.R. Tambo', -26.1367, 28.2411, 'Airport', 'a', 'jnb'], ['MEM Memphis (FedEx hub)', 35.0424, -89.9767, 'Airport', 'a', 'mem'],
  ['Eiffel Tower', 48.8584, 2.2945, 'Paris', 'l'], ['Louvre', 48.8606, 2.3376, 'Paris', 'l', 'the louvre'], ['Statue of Liberty', 40.6892, -74.0445, 'New York', 'l'], ['Golden Gate Bridge', 37.8199, -122.4783, 'San Francisco', 'l'],
  ['Grand Canyon', 36.1069, -112.1129, 'Arizona', 'l'], ['Mount Everest', 27.9881, 86.925, 'Nepal / China', 'l', 'everest'], ['Pyramids of Giza', 29.9792, 31.1342, 'Egypt', 'l', 'giza|pyramids'], ['Taj Mahal', 27.1751, 78.0421, 'India', 'l'],
  ['Colosseum', 41.8902, 12.4922, 'Rome', 'l'], ['Big Ben', 51.5007, -0.1246, 'London', 'l'], ['Sydney Opera House', -33.8568, 151.2153, 'Sydney', 'l'], ['Burj Khalifa', 25.1972, 55.2744, 'Dubai', 'l'],
  ['Mount Fuji', 35.3606, 138.7274, 'Japan', 'l', 'fuji'], ['Machu Picchu', -13.1631, -72.545, 'Peru', 'l'], ['Christ the Redeemer', -22.9519, -43.2105, 'Rio de Janeiro', 'l'], ['Niagara Falls', 43.0962, -79.0377, 'Canada / US', 'l'],
  ['Three Gorges Dam', 30.8231, 111.0037, 'China', 'l', 'three gorges'], ['Hoover Dam', 36.0161, -114.7377, 'Nevada', 'l'], ['Area 51', 37.2431, -115.793, 'Nevada', 'l', 'groom lake'], ['Pentagon', 38.8719, -77.0563, 'Virginia', 'l', 'the pentagon'],
  ['Texas State Capitol', 30.2747, -97.7404, 'Austin', 'l', 'the capitol'], ['Zilker Park', 30.267, -97.7729, 'Austin', 'l'], ['Kennedy Space Center', 28.5729, -80.649, 'Florida', 'l', 'cape canaveral|ksc'], ['Starbase', 25.9971, -97.1554, 'Texas', 'l', 'boca chica'],
  ['Vandenberg Space Force Base', 34.742, -120.5724, 'California', 'l', 'vandenberg'], ['Baikonur Cosmodrome', 45.965, 63.305, 'Kazakhstan', 'l', 'baikonur'], ['The Boneyard (AMARG)', 32.1512, -110.8262, 'Tucson, Arizona', 'l', 'boneyard|amarg|davis-monthan'],
  ['Times Square', 40.758, -73.9855, 'New York', 'l'], ['Shibuya Crossing', 35.6595, 139.7005, 'Tokyo', 'l', 'shibuya'], ['Panama Canal', 9.08, -79.68, 'Panama', 'l'], ['Suez Canal', 30.5852, 32.2654, 'Egypt', 'l'],
  ['Strait of Hormuz', 26.5667, 56.25, 'Persian Gulf', 'l', 'hormuz'], ['Strait of Gibraltar', 35.97, -5.5, 'Spain / Morocco', 'l', 'gibraltar'], ['Chernobyl', 51.3896, 30.0991, 'Ukraine', 'l'], ['Mount St. Helens', 46.1914, -122.1956, 'Washington', 'l'],
  ['Yellowstone', 44.428, -110.5885, 'Wyoming', 'l'], ['Kilauea', 19.4069, -155.2834, 'Hawaii', 'l'], ['Mount Etna', 37.751, 14.9934, 'Sicily', 'l', 'etna'], ['Great Barrier Reef', -18.2871, 147.6992, 'Australia', 'l'],
  ['Port of Long Beach', 33.7542, -118.2165, 'California', 'p', 'long beach'], ['Port of Oakland', 37.7955, -122.2791, 'California', 'p', 'oakland'], ['Port of Rotterdam', 51.9496, 4.1453, 'Netherlands', 'p', 'rotterdam'],
  ['Port of Singapore', 1.2644, 103.84, 'Singapore', 'p'], ['Port of Shanghai (Yangshan)', 30.6267, 122.0647, 'China', 'p', 'yangshan'], ['Port of Helsinki', 60.1525, 24.9247, 'Finland', 'p'], ['Port of Gothenburg', 57.69, 11.87, 'Sweden', 'p', 'gothenburg'],
];
const KIND = { c: 'City', a: 'Airport', l: 'Landmark', p: 'Port' };
const RANGE = { c: 60000, a: 14000, l: 6000, p: 16000 };
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const index = PLACES.map((p) => ({ name: p[0], lat: p[1], lon: p[2], where: p[3], kind: KIND[p[4]], range: RANGE[p[4]], keys: [norm(p[0]), ...(p[5] ? p[5].split('|').map(norm) : [])] }));
export const CITIES = index.filter((p) => p.kind === 'City');
/** Ranked bundled matches for free text. */
export function searchPlaces(q, max = 6) {
  const n = norm(q);
  if (!n) return [];
  const out = [];
  for (const p of index) {
    let score = 0;
    for (const k of p.keys) {
      if (k === n) score = Math.max(score, 100);
      else if (k.startsWith(n)) score = Math.max(score, 70 - (k.length - n.length) * 0.3);
      else if (n.length > 2 && k.includes(n)) score = Math.max(score, 40);
    }
    if (score) out.push({ ...p, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}
export function exactPlace(q) { const r = searchPlaces(q, 1)[0]; return r && r.score >= 100 ? r : null; }
/** Parses "lat, lon", "geo:lat,lon", and signed or hemisphere pairs. */
export function parseCoords(q) {
  const s = q.trim();
  const geo = s.match(/^geo:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
  if (geo) return { lat: +geo[1], lon: +geo[2] };
  const m = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?[\s,]+(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = +m[1], lon = +m[3];
  if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
