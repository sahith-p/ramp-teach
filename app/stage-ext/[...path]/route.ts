/**
 * Film support (demo/video): serves the REAL extension files so the stage can show the actual Recorder side
 * panel and run the actual content script. sidepanel.html gets one extra script: /stage/chrome-shim.js,
 * which stands in for the chrome.* extension APIs (storage, runtime messages, downloads, speech).
 * Read-only, allowlisted files only.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "@/lib/paths";

const ALLOW: Record<string, string> = {
  "sidepanel.html": "text/html; charset=utf-8",
  "sidepanel.css": "text/css; charset=utf-8",
  "sidepanel.js": "text/javascript; charset=utf-8",
  "content.js": "text/javascript; charset=utf-8",
  "lib/recording.js": "text/javascript; charset=utf-8",
};

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const rel = (await ctx.params).path.join("/");
  const type = ALLOW[rel];
  if (!type) return new Response("not found", { status: 404 });
  let body = fs.readFileSync(path.join(ROOT, "extension", rel), "utf8");
  if (rel === "sidepanel.html") body = body.replace("</head>", '  <script src="/stage/chrome-shim.js"></script>\n  </head>');
  return new Response(body, { headers: { "content-type": type, "cache-control": "no-store" } });
}
