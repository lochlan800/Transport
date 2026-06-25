# England Transport Finder 🚆

Pick a transport type (train, bus, tube, tram, coach, ferry, taxi, cycle hire, walk),
enter a place and a date, and get a clean visual board of departures.

- **`index.html`** — the whole app, one file, no build step. Double-click to open.
- **`proxy/`** — an optional, free server that turns on **real, live, nationwide data**.

The app has two modes:

| Mode | Data | Setup | Cost |
|------|------|-------|------|
| **Demo** (default) | Realistic but *made-up* timetables | None — just open the file | Free, works offline |
| **Live** | **Real** train, bus & tram departures across England | One-time: free key + deploy proxy | Free* |

\* Uses [TransportAPI](https://developer.transportapi.com/)'s free developer tier. No AI, no charges on the free tier.

---

## Make it accurate (turn on Live data)

You do this **once**. ~10 minutes.

### 1. Get a free API key
1. Sign up at **https://developer.transportapi.com/signup** (free).
2. Create an app — you'll get an **App ID** and **App Key**.

### 2. Deploy the proxy (recommended: Cloudflare Worker — free, nothing to run)
From the `proxy/` folder:

```bash
cd proxy
npm install
npx wrangler login                       # one-time, opens browser
npx wrangler secret put TRANSPORTAPI_APP_ID   # paste your App ID
npx wrangler secret put TRANSPORTAPI_APP_KEY  # paste your App Key
npx wrangler deploy
```

Wrangler prints a URL like `https://england-transport-proxy.<you>.workers.dev`.

### 3. Connect the app
1. Open `index.html`.
2. In the **🛰️ Live data server** box, paste that URL and click **Save**.
3. The badge top-right flips to **Live ✅**. Search — you now get real departures.

The URL is remembered in your browser. Click **Use demo** any time to switch back.

---

## Prefer to run it locally instead of Cloudflare?

```bash
cd proxy
npm install
TRANSPORTAPI_APP_ID=your_id TRANSPORTAPI_APP_KEY=your_key npm start
# serves http://localhost:8787
```

Then paste `http://localhost:8787` into the app's Live data server box.
(Note: the proxy only runs while that terminal is open.)

---

## What's live vs sample

| Mode | Live data? |
|------|-----------|
| 🚆 Train | ✅ real departures (National Rail via TransportAPI) |
| 🚌 Bus | ✅ real departures |
| 🚊 Tram | ✅ where covered |
| 🚇 Tube / 🚍 Coach / ⛴️ Ferry / 🚕 Taxi / 🚲 Bike / 🚶 Walk | sample data (no single free nationwide live feed) |

For real **London** tube/DLR/Overground you can later add a TfL endpoint — TfL's free API
can be called directly from the browser. Ask and it can be wired into the same proxy.

---

## How it fits together

```
index.html ──/api/places?q=York──►  proxy  ──► TransportAPI (holds secret key)
           ──/api/departures────►  (Worker / Node)
```

The proxy keeps your key secret and returns simple, normalised JSON the app renders.
To swap data sources, edit `proxy/worker.js` (or `proxy/server.js`) — the app doesn't change.
