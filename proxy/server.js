/**
 * England Transport Finder — local Node proxy (alternative to the Cloudflare Worker)
 * Run:  npm install && TRANSPORTAPI_APP_ID=xxx TRANSPORTAPI_APP_KEY=yyy npm start
 * Then point the app's "Live server URL" at  http://localhost:8787
 *
 * Same two endpoints and same normalised output as worker.js.
 */
const http = require('http');

const API = 'https://transportapi.com/v3';
const PORT = process.env.PORT || 8787;
const APP_ID = process.env.TRANSPORTAPI_APP_ID;
const APP_KEY = process.env.TRANSPORTAPI_APP_KEY;

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

async function getJSON(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error('TransportAPI ' + r.status);
  return r.json();
}

function normalise(mode, d, origin) {
  const aimed = d.aimed_departure_time || d.aimed_pass_time || null;
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
    depTime: aimed, arrTime: null, durMins: null, stops: null, price: null,
    statusText, statusClass,
    platform: d.platform ? (mode === 'train' ? 'Platform ' + d.platform : 'Stand ' + d.platform) : '',
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!APP_ID || !APP_KEY) return send(res, 500, { error: 'Set TRANSPORTAPI_APP_ID and TRANSPORTAPI_APP_KEY env vars.' });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const auth = `app_id=${APP_ID}&app_key=${APP_KEY}`;

  try {
    if (url.pathname === '/api/places') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return send(res, 400, { error: 'Missing ?q=' });
      const data = await getJSON(`${API}/uk/places.json?query=${encodeURIComponent(q)}&type=train_station,bus_stop,tram_stop&${auth}`);
      const out = (data.member || []).map((m) => ({
        name: m.name, type: m.type,
        code: m.station_code || null, atcocode: m.atcocode || null,
        lat: m.latitude ?? null, lon: m.longitude ?? null,
      })).filter((m) => m.code || m.atcocode);
      return send(res, 200, out);
    }

    if (url.pathname === '/api/departures') {
      const mode = url.searchParams.get('mode') || 'train';
      const date = url.searchParams.get('date') || '';
      const time = url.searchParams.get('time') || '';
      let endpoint;
      if (mode === 'train') {
        const code = url.searchParams.get('code');
        if (!code) return send(res, 400, { error: 'train mode needs ?code=' });
        endpoint = (date && time)
          ? `${API}/uk/train/station/${encodeURIComponent(code)}/${date}/${time}/timetable.json?${auth}&train_status=passenger`
          : `${API}/uk/train/station/${encodeURIComponent(code)}/live.json?${auth}&train_status=passenger&darwin=true`;
      } else if (mode === 'bus' || mode === 'tram') {
        const atcocode = url.searchParams.get('atcocode');
        if (!atcocode) return send(res, 400, { error: `${mode} mode needs ?atcocode=` });
        endpoint = (date && time)
          ? `${API}/uk/bus/stop/${encodeURIComponent(atcocode)}/${date}/${time}/timetable.json?${auth}&group=no&nextbuses=no`
          : `${API}/uk/bus/stop/${encodeURIComponent(atcocode)}/live.json?${auth}&group=no&nextbuses=yes`;
      } else {
        return send(res, 400, { error: `Live data for mode "${mode}" is not supported by this source.` });
      }
      const data = await getJSON(endpoint);
      const origin = data.station_name || data.name || data.atcocode || '';
      const raw = (data.departures && data.departures.all) || [];
      return send(res, 200, raw.map((d) => normalise(mode, d, origin)).slice(0, 25));
    }

    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    return send(res, 502, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => console.log(`Transport proxy running on http://localhost:${PORT}`));
