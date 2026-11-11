/**
 * @font-face rules for the video renderers (diagrams, outro, caption PNGs), embedded as data URIs so a page loaded
 * with setContent (about:blank) can use them without a server.
 *
 * - Inter and JetBrains Mono are committed in demo/video/assets/fonts/ (open licenses; license files alongside).
 * - Lausanne (Ramp's typeface) is commercially licensed, so it is NOT committed. `npx tsx demo/video/fetch-fonts.ts`
 *   caches it in demo/video/assets/fonts/lausanne/ (gitignored); when the cache is missing the rules point at
 *   assets.ramp.com, which the cloud environment's network allowlist permits.
 */
import fs from "node:fs";
import path from "node:path";

const FONTS = path.join(process.cwd(), "demo", "video", "assets", "fonts");
export const LAUSANNE_DIR = path.join(FONTS, "lausanne");
export const LAUSANNE_WEIGHTS = [300, 400, 700] as const;
export const lausanneUrl = (w: number) => `https://assets.ramp.com/fonts/lausanne/lausanne-${w}/TWKLausanne-${w}.woff2`;

const MIME: Record<string, string> = { ".otf": "font/otf", ".ttf": "font/ttf", ".woff2": "font/woff2" };
const FORMAT: Record<string, string> = { ".otf": "opentype", ".ttf": "truetype", ".woff2": "woff2" };

function local(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(file);
  return `url("data:${MIME[ext]};base64,${fs.readFileSync(file).toString("base64")}") format("${FORMAT[ext]}")`;
}

function face(family: string, weight: number, style: "normal" | "italic", src: string | null): string {
  return src ? `@font-face { font-family: "${family}"; font-weight: ${weight}; font-style: ${style}; src: ${src}; }` : "";
}

let cached: string | null = null;

/** CSS with every font the renderers use. Lausanne weights default to 300 and 400. */
export function fontFaceCss(lausanneWeights: number[] = [300, 400]): string {
  if (cached && lausanneWeights.join() === "300,400") return cached;
  const css = [
    face("Inter", 400, "normal", local(path.join(FONTS, "inter", "Inter-Regular.otf"))),
    face("Inter", 500, "normal", local(path.join(FONTS, "inter", "Inter-Medium.otf"))),
    face("JetBrains Mono", 400, "normal", local(path.join(FONTS, "jetbrains-mono", "JetBrainsMono-Regular.ttf"))),
    face("JetBrains Mono", 500, "normal", local(path.join(FONTS, "jetbrains-mono", "JetBrainsMono-Medium.ttf"))),
    face("JetBrains Mono", 400, "italic", local(path.join(FONTS, "jetbrains-mono", "JetBrainsMono-Italic.ttf"))),
    ...lausanneWeights.map((w) =>
      face("Lausanne", w, "normal", local(path.join(LAUSANNE_DIR, `TWKLausanne-${w}.woff2`)) ?? `url("${lausanneUrl(w)}") format("woff2")`),
    ),
  ]
    .filter(Boolean)
    .join("\n");
  if (lausanneWeights.join() === "300,400") cached = css;
  return css;
}
