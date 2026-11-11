"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** One shared audio element that plays a clip [start, end] of a recording's audio. */
export function useClip() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef<number | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    const a = new Audio();
    a.preload = "auto";
    audio.current = a;
    const onTime = () => {
      if (stopAt.current != null && a.currentTime >= stopAt.current) {
        a.pause();
        stopAt.current = null;
        setPlaying(null);
      }
    };
    const onEnd = () => setPlaying(null);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    a.addEventListener("pause", onEnd);
    return () => {
      a.pause();
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("pause", onEnd);
    };
  }, []);

  const play = useCallback((key: string, recordingId: string, start: number, end: number) => {
    const a = audio.current;
    if (!a) return;
    if (playing === key) {
      a.pause();
      return;
    }
    const src = `/api/teach/recordings/${encodeURIComponent(recordingId)}/audio`;
    const go = () => {
      a.currentTime = Math.max(0, start - 0.1);
      stopAt.current = end + 0.15;
      void a.play().then(() => setPlaying(key)).catch(() => setPlaying(null));
    };
    if (!a.src.endsWith(src)) {
      a.src = src;
      a.addEventListener("loadedmetadata", go, { once: true });
      a.load();
    } else go();
  }, [playing]);

  return { play, playing };
}

export function PlayIcon({ on, size = 10 }: { on: boolean; size?: number }) {
  return on ? (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden>
      <rect x="2" y="1.5" width="2" height="7" fill="currentColor" />
      <rect x="6" y="1.5" width="2" height="7" fill="currentColor" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden>
      <path d="M2.5 1.2v7.6L8.8 5z" fill="currentColor" />
    </svg>
  );
}
