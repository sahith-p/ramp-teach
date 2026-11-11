/**
 * Live view of the agent's browser (for the app's Review tab).
 *
 *   runs/<id>/live/frame.jpg     latest CDP screencast frame (~5 fps), replaced atomically
 *   runs/<id>/live/status.json   { running, url, step, updated_at }  (running=false at the end)
 *
 * Both are gitignored (/runs/** /live/). Frames come from the driver's screencast
 * (PlaywrightDriver.startScreencast → CDP Page.startScreencast); this file only throttles and writes.
 * Writes never throw into the run.
 */
import fs from "node:fs";
import path from "node:path";

export interface LiveStatus {
  running: boolean;
  url: string | null;
  step: number;
  updated_at: string;
}

/** A driver that can stream its active page (PlaywrightDriver does; fakes may not). */
export interface ScreencastCapable {
  startScreencast(onFrame: (jpeg: Buffer, url: string) => void, opts?: { maxWidth?: number; maxHeight?: number; quality?: number }): Promise<() => Promise<void>>;
}

export function canScreencast(d: unknown): d is ScreencastCapable {
  return typeof (d as Partial<ScreencastCapable> | null)?.startScreencast === "function";
}

function writeAtomic(file: string, data: string | Buffer): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export class LiveStatusWriter {
  readonly dir: string;
  readonly framePath: string;
  readonly statusPath: string;
  private status: LiveStatus;
  private lastFrameAt = 0;
  private readonly minFrameMs: number;
  private readonly now: () => number;
  frames = 0;

  constructor(dir: string, opts: { fps?: number; now?: () => number } = {}) {
    this.dir = dir;
    this.framePath = path.join(dir, "frame.jpg");
    this.statusPath = path.join(dir, "status.json");
    this.minFrameMs = 1000 / Math.max(1, Math.min(30, opts.fps ?? 5));
    this.now = opts.now ?? Date.now;
    this.status = { running: false, url: null, step: 0, updated_at: new Date(this.now()).toISOString() };
  }

  get current(): LiveStatus {
    return { ...this.status };
  }

  /** Mark the run as live (clears a previous run's frame). */
  begin(url: string | null = null): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.rmSync(this.framePath, { force: true });
    } catch {
      /* ignore */
    }
    this.lastFrameAt = 0;
    this.update({ running: true, url, step: 0 });
  }

  update(patch: Partial<Omit<LiveStatus, "updated_at">>): void {
    this.status = { ...this.status, ...patch, updated_at: new Date(this.now()).toISOString() };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      writeAtomic(this.statusPath, JSON.stringify(this.status, null, 2) + "\n");
    } catch {
      /* ignore */
    }
  }

  /** Keep the latest frame, at most `fps` writes per second. Returns true when the frame was written. */
  frame(jpeg: Buffer, url?: string): boolean {
    const t = this.now();
    if (this.lastFrameAt && t - this.lastFrameAt < this.minFrameMs) return false;
    this.lastFrameAt = t;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      writeAtomic(this.framePath, jpeg);
      this.frames++;
    } catch {
      return false;
    }
    if (url && url !== this.status.url) this.update({ url });
    return true;
  }

  step(n: number, url?: string | null): void {
    this.update(url ? { step: n, url } : { step: n });
  }

  finish(): void {
    this.update({ running: false });
  }
}

/** Start streaming a driver into a LiveStatusWriter. Returns a stop function (never throws). */
export async function startLiveView(driver: unknown, writer: LiveStatusWriter): Promise<() => Promise<void>> {
  writer.begin();
  if (!canScreencast(driver)) return async () => writer.finish();
  let stop: (() => Promise<void>) | null = null;
  try {
    stop = await driver.startScreencast((jpeg, url) => writer.frame(jpeg, url));
  } catch {
    stop = null;
  }
  return async () => {
    try {
      await stop?.();
    } catch {
      /* ignore */
    }
    writer.finish();
  };
}
