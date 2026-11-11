/**
 * Caches Ramp's Lausanne webfonts locally for the video renderers (demo/video/assets/fonts/lausanne/, gitignored).
 * Lausanne is a commercially licensed typeface, so the files are not committed; this fetches the same files the
 * app already loads from assets.ramp.com. Optional: without the cache the renderers load them from that URL.
 *
 *   npx tsx demo/video/fetch-fonts.ts
 *
 * In a cloud session behind the HTTPS proxy, Node's fetch needs NODE_USE_ENV_PROXY=1 (Node >= 22.21).
 */
import fs from "node:fs";
import path from "node:path";
import { LAUSANNE_DIR, LAUSANNE_WEIGHTS, lausanneUrl } from "./fonts";

(async () => {
  fs.mkdirSync(LAUSANNE_DIR, { recursive: true });
  for (const w of LAUSANNE_WEIGHTS) {
    const dest = path.join(LAUSANNE_DIR, `TWKLausanne-${w}.woff2`);
    if (fs.existsSync(dest)) {
      console.log(`have ${path.basename(dest)}`);
      continue;
    }
    const res = await fetch(lausanneUrl(w));
    if (!res.ok) throw new Error(`Lausanne ${w}: HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`saved ${path.relative(process.cwd(), dest)} (${fs.statSync(dest).size} bytes)`);
  }
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
