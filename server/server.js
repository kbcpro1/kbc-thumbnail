// server/server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "../web")));

const YT_RSS = (ch) => `https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`;
const YT_CH  = (ch) => `https://www.youtube.com/channel/${ch}`;

// bardzo prosty cache na avatary (restart = czyszczenie)
const avatarCache = new Map();

async function fetchChannelAvatar(channelId) {
  if (avatarCache.has(channelId)) return avatarCache.get(channelId);
  try {
    const r = await fetch(YT_CH(channelId), {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    if (!r.ok) return "";
    const html = await r.text();
    const m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    const url = m ? m[1] : "";
    avatarCache.set(channelId, url);
    return url;
  } catch {
    return "";
  }
}

function parseSeconds(xmlChunk) {
  const m = xmlChunk.match(/yt:duration[^>]*seconds="(\d+)"/);
  return m ? parseInt(m[1], 10) : 0;
}
const thumbs = (id) => ({
  max: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
  hq:  `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
});

async function getFromChannel(channelId, max, minSeconds) {
  const r = await fetch(YT_RSS(channelId));
  if (!r.ok) return [];
  const xml = await r.text();

  const author = (xml.match(/<name>([\s\S]*?)<\/name>/) || [,""])[1] || "";
  const avatar = await fetchChannelAvatar(channelId);

  const entries = [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)];
  const out = [];
  for (const m of entries) {
    const block = m[0];
    const id   = (block.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
    if (!id) continue;

    const dur = parseSeconds(block);
    if (minSeconds > 0 && dur < minSeconds) continue; // filtr „shortów”

    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    const published = (block.match(/<published>(.*?)<\/published>/) || [])[1] || "";
    const t = thumbs(id);

    out.push({
      channelId,
      channelTitle: author,
      videoId: id,
      title,
      publishedAt: published,
      duration: dur,
      thumb: t.max,
      thumbHQ: t.hq,
      avatar
    });
    if (out.length >= max) break;
  }
  return out;
}

/** GET /api/latest?channels=ID,ID&max=8&min=0&sort=newest|popular */
app.get("/api/latest", async (req, res) => {
  try {
    const channels = String(req.query.channels || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    const per  = Math.min(parseInt(req.query.max || "8", 10), 50);
    const min  = Math.max(parseInt(req.query.min || "0", 10), 0);
    const sort = String(req.query.sort || "newest");

    const all = [];
    for (const ch of channels) {
      const list = await getFromChannel(ch, per, min);
      list.sort((a,b) => sort === "popular"
        ? b.duration - a.duration
        : new Date(b.publishedAt) - new Date(a.publishedAt)
      );
      all.push(...list);
    }
    res.json({ items: all });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "../web/index.html"));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`API działa na porcie ${PORT}`));
