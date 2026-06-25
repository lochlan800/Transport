/**
 * England Transport Finder — Cloudflare Worker proxy
 * --------------------------------------------------
 * Keeps your TransportAPI credentials secret (they live in Worker secrets,
 * never in the browser) and exposes two clean, CORS-enabled endpoints that
 * the front-end (index.html) calls:
 *
 *   GET /api/places?q=York
 *       -> [{ name, type, code, atcocode, lat, lon }]
 *
 *   GET /api/departures?mode=train&code=YRK&date=2026-07-01&time=08:00
 *   GET /api/departures?mode=bus&atcocode=3290YYA00149&date=...&time=...
 *       -> [{ modeId, op, line, destination, origin,
 *              depTime, arrTime, durMins, stops, price,
 *              statusText, statusClass, platform }]
 *
 * Deploy:  npx wrangler deploy
 * Secrets: npx wrangler secret put TRANSPORTAPI_APP_ID
 *          npx wrangler secret put TRANSPORTAPI_APP_KEY
 */

const API = 'https://transportapi.com/v3';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const auth = `app_id=${env.TRANSPORTAPI_APP_ID}&app_key=${env.TRANSPORTAPI_APP_KEY}`;

    if (!env.TRANSPORTAPI_APP_ID || !env.TRANSPORTAPI_APP_KEY) {
      return json({ error: 'Server is missing TransportAPI credentials. Set them with `wrangler secret put`.' }, 500);
    }

    try {
      if (url.pathname === '/api/places') {
        return await places(url, auth);
      }
      if (url.pathname === '/api/departures') {
        return await departures(url, auth);
      }
      if (url.pathname === '/' || url.pathname === '/api') {
        return json({ ok: true, endpoints: ['/api/places?q=', '/api/departures?mode=&code=|atcocode='] });
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 502);
    }
  },
};

/* ----------------------------- /api/places ------------------------------ */
async function places(url, auth) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json({ error: 'Missing ?q=' }, 400);

  const types = 'train_station,bus_stop,tram_stop';
  const res = await fetch(`${API}/uk/places.json?query=${encodeURIComponent(q)}&type=${types}&${auth}`);
  if (!res.ok) return json({ error: `TransportAPI places ${res.status}` }, 502);
  const data = await res.json();

  const out = (data.member || []).map((m) => ({
    name: m.name,
    type: m.type,                                  // train_station | bus_stop | tram_stop
    code: m.station_code || null,                  // train station CRS code
    atcocode: m.atcocode || null,                  // bus / tram stop code
    lat: m.latitude ?? null,
    lon: m.longitude ?? null,
  })).filter((m) => m.code || m.atcocode);

  return json(out);
}

/* --------------------------- /api/departures ---------------------------- */
async function departures(url, auth) {
  const mode = url.searchParams.get('mode') || 'train';
  const date = url.searchParams.get('date') || '';   // YYYY-MM-DD
  const time = url.searchParams.get('time') || '';    // HH:MM

  let endpoint;
  if (mode === 'train') {
    const code = url.searchParams.get('code');
    if (!code) return json({ error: 'train mode needs ?code=' }, 400);
    endpoint = (date && time)
      ? `${API}/uk/train/station/${encodeURIComponent(code)}/${date}/${time}/timetable.json?${auth}&train_status=passenger`
      : `${API}/uk/train/station/${encodeURIComponent(code)}/live.json?${auth}&train_status=passenger&darwin=true`;
  } else if (mode === 'bus' || mode === 'tram') {
    const atcocode = url.searchParams.get('atcocode');
    if (!atcocode) return json({ error: `${mode} mode needs ?atcocode=` }, 400);
    endpoint = (date && time)
      ? `${API}/uk/bus/stop/${encodeURIComponent(atcocode)}/${date}/${time}/timetable.json?${auth}&group=no&nextbuses=no`
      : `${API}/uk/bus/stop/${encodeURIComponent(atcocode)}/live.json?${auth}&group=no&nextbuses=yes`;
  } else {
    return json({ error: `Live data for mode "${mode}" is not supported by this source.` }, 400);
  }

  const res = await fetch(endpoint);
  if (!res.ok) return json({ error: `TransportAPI departures ${res.status}` }, 502);
  const data = await res.json();

  const origin = data.station_name || data.name || data.atcocode || '';
  const raw = (data.departures && data.departures.all) || [];

  const routes = raw.map((d) => normalise(mode, d, origin)).slice(0, 25);
  return json(routes);
}

/* normalise a TransportAPI departure into the shape index.html renders */
function normalise(mode, d, origin) {
  const aimed = d.aimed_departure_time || d.aimed_pass_time || null;          // "08:13"
  const expected = d.expected_departure_time || d.best_departure_estimate || null;

  let statusText = 'On time', statusClass = 's-good';
  const status = (d.status || '').toUpperCase();
  if (status.includes('CANCEL')) { statusText = 'Cancelled'; statusClass = 's-bad'; }
  else if (expected && aimed && expected !== aimed && expected !== 'On time') {
    statusText = 'Expected ' + expected; statusClass = 's-warn';
  } else if (status && status !== 'ON TIME' && status !== 'EARLY' && status !== 'STARTS HERE') {
    statusText = d.status; statusClass = 's-warn';
  }

  return {
    modeId: mode,
    op: d.operator_name || d.operator || (mode === 'train' ? 'Train operator' : 'Bus operator'),
    line: d.line || d.line_name || (mode === 'train' ? '' : (d.service || '')),
    destination: d.destination_name || d.direction || '—',
    origin,
    depTime: aimed,
    arrTime: null,           // departure boards don't include arrival; journey planner would
    durMins: null,
    stops: null,
    price: null,
    statusText,
    statusClass,
    platform: d.platform ? (mode === 'train' ? 'Platform ' + d.platform : 'Stand ' + d.platform) : '',
  };
}
