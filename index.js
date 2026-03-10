const WebSocket = require("ws");
const https = require("https");
const http = require("http");
const { URL } = require("url");

// ======= הגדר כאן את כתובת ה-GAS שלך =======
const GAS_URL = process.env.GAS_URL || "https://script.google.com/macros/s/AKfycbxRTPXJCEWSOUH6bpKh0bDZ2F5zR7MCHPy2IrRmnj0R7Y4b80JbKt10eOqSNi3Hnryr2g/exec";
// ============================================

const WSS_URL = "wss://ws.tzevaadom.co.il/socket?platform=WEB";
const RECONNECT_DELAY = 5000; // 5 שניות בין ניסיונות חיבור מחדש

function sendToGAS(data) {
  // fire & forget עם תמיכה ב-redirect (GAS מבצע 302)
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
        // עוקב אחרי redirect
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
          doRequest(res.headers.location);
          return;
        }
        // מרוקן את ה-response כדי לשחרר את החיבור
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
  });

  ws.on("message", (raw) => {
    // לוג גולמי לכל הודעה — לצורך דיבוג
    const preview = Buffer.isBuffer(raw)
      ? "[בינארי " + raw.length + " bytes]"
      : raw.toString().substring(0, 120);
    console.log("הודעה התקבלה:", preview);

    // בינארי — מנסה לפרסר כטקסט
    if (Buffer.isBuffer(raw)) {
      if (raw.length === 0) {
        console.log("פינג בינארי ריק —", new Date().toISOString());
        sendToGAS({ type: "PING", time: new Date().toISOString() });
        return;
      }
      // בינארי עם תוכן — ממיר לטקסט וממשיך לעיבוד
      raw = Buffer.from(raw).toString("utf8");
    }

    const text = raw.toString().trim();

    // מסנן ריק
    if (!text) return;

    // מנסה לפרסר JSON
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.log("לא JSON:", text.substring(0, 80));
      return;
    }

    // מסנן פינג / הודעות מערכת ריקות
    if (!parsed || typeof parsed !== "object") return;
    if (Object.keys(parsed).length === 0) {
      console.log("אובייקט ריק — מתעלם");
      return;
    }

    // שולח ל-GAS — fire & forget
    sendToGAS(parsed);
    console.log("נשלח:", JSON.stringify(parsed).substring(0, 80));
  });

  ws.on("ping", () => {
    console.log("WebSocket ping frame התקבל —", new Date().toISOString());
  });

  ws.on("ping", () => {
    console.log("פינג התקבל מהשרת —", new Date().toISOString());
    sendToGAS({ type: "PING_TEST", time: new Date().toISOString() });
  });

  ws.on("close", (code, reason) => {
    console.log(`חיבור נסגר (${code}). מתחבר מחדש בעוד ${RECONNECT_DELAY / 1000} שניות...`);
    setTimeout(connect, RECONNECT_DELAY);
  });

  ws.on("error", (err) => {
    console.log("שגיאת WebSocket:", err.message);
    // close יופעל אחרי error אוטומטית — reconnect יקרה שם
  });
}

// שרת HTTP קטן — נדרש ע"י Render כדי שיידע שהשירות חי
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
});
server.listen(process.env.PORT || 3000, () => {
  console.log("שרת HTTP חי על פורט", process.env.PORT || 3000);
  connect(); // מתחיל את חיבור ה-WSS
});
