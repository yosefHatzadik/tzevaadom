const WebSocket = require("ws");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const GAS_URL = process.env.GAS_URL;
const WSS_URL = "wss://ws.tzevaadom.co.il/socket?platform=WEB";
const RECONNECT_DELAY = 5000;

function sendToGAS(data) {
  const body = JSON.stringify(data);

  function doRequest(urlStr) {
    try {
      const url = new URL(urlStr);
      const lib = url.protocol === "https:" ? https : http;

      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      };

      const req = lib.request(options, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
          doRequest(res.headers.location);
          return;
        }
        res.resume();
      });

      req.on("error", () => {});
      req.write(body);
      req.end();
    } catch (e) {}
  }

  doRequest(GAS_URL);
}

function connect() {
  console.log("מתחבר ל-WSS...");

  let watchdog = null;

  function resetWatchdog() {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      console.log("Watchdog — לא התקבלה הודעה 10 דקות, מנתק ומתחבר מחדש...");
      ws.terminate();
    }, 4 * 60 * 1000);
  }

  const ws = new WebSocket(WSS_URL, {
    headers: {
      "Origin": "https://www.tzevaadom.co.il",
      "Host": "ws.tzevaadom.co.il",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    },
  });

  ws.on("open", () => {
    console.log("מחובר! ממתין להתראות...");
    resetWatchdog();
  });

  ws.on("message", (raw) => {
    resetWatchdog();

    if (Buffer.isBuffer(raw)) {
      if (raw.length === 0) {
        console.log("פינג בינארי ריק —", new Date().toISOString());
        sendToGAS({ type: "PING", time: new Date().toISOString() });
        return;
      }
      raw = Buffer.from(raw).toString("utf8");
    }

    const text = raw.toString().trim();
    if (!text) return;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.log("לא JSON:", text.substring(0, 80));
      return;
    }

    if (!parsed || typeof parsed !== "object") return;
    if (Object.keys(parsed).length === 0) {
      console.log("אובייקט ריק — מתעלם");
      return;
    }

    sendToGAS(parsed);
    console.log("נשלח:", JSON.stringify(parsed).substring(0, 80));
  });

  ws.on("ping", () => {
    resetWatchdog();
  });

  ws.on("close", (code) => {
    if (watchdog) clearTimeout(watchdog);
    console.log(`חיבור נסגר (${code}). מתחבר מחדש בעוד ${RECONNECT_DELAY / 1000} שניות...`);
    setTimeout(connect, RECONNECT_DELAY);
  });

  ws.on("error", (err) => {
    console.log("שגיאת WebSocket:", err.message);
  });
}

const SERVER_URL = process.env.RENDER_EXTERNAL_URL;

function selfPing() {
  if (!SERVER_URL) return;
  const lib = SERVER_URL.startsWith("https") ? https : http;
  lib.get(SERVER_URL, (res) => {
    res.resume();
    console.log("Self-ping נשלח —", new Date().toISOString());
  }).on("error", () => {});
}

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
});
server.listen(process.env.PORT || 3000, () => {
  console.log("שרת HTTP חי על פורט", process.env.PORT || 3000);
  connect();
  setInterval(selfPing, 14 * 60 * 1000); // כל 14 דקות
});
