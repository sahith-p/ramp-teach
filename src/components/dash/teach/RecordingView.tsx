"use client";
/**
 * Recording page body: waveform with playback, the clicks and page changes on the same time axis, and the
 * transcript as words lined up with the steps each sentence is about. Low-confidence words are underlined.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { RecordingView as Rec } from "./server";
import { derivePeaks, fmtClock, resample, stepLabel, stepOffset, urlPath } from "./logic";
import { PlayIcon } from "./useClip";
import { Card, Empty, MUTED } from "../ui";

const BARS = 180;

export function RecordingBody({ v }: { v: Rec }) {
  const rec = v.recording;
  const dur = v.duration_s;
  const utts = rec.speech?.utterances ?? [];
  const peaks = useMemo(() => resample(v.peaks ?? derivePeaks(utts, dur, BARS * 2), BARS), [v.peaks, utts, dur]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);

  const marks = rec.steps
    .map((s, i) => ({ i, s, at: stepOffset(s, rec.started_at) }))
    .filter((m) => m.s.kind === "dom" && (m.s.detail.event === "click" || m.s.detail.event === "navigate") && m.at >= 0 && m.at <= dur);

  useEffect(() => {
    const m = /#t=([\d.]+)/.exec(window.location.hash);
    if (m) {
      const at = Number(m[1]);
      setT(at);
      if (audio.current) audio.current.currentTime = at;
      document.querySelector(`[data-utt-start="${utts.find((u) => u.start >= at - 0.05)?.start}"]`)?.scrollIntoView({ block: "center" });
    }
  }, [utts]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (audio.current) setT(audio.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = (at: number) => {
    setT(at);
    if (audio.current) audio.current.currentTime = at;
  };
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else a.pause();
  };
  const pct = (x: number) => `${Math.min(100, Math.max(0, (x / dur) * 100)).toFixed(2)}%`;

  return (
    <div className="space-y-6">
      <Card testId="waveform" pad={false}>
        <div className="flex items-center gap-4 px-5 pb-2 pt-5">
          {v.has_audio ? (
            <button data-testid="play" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(26,25,25)] text-white hover:bg-[rgb(71,69,67)]">
              <PlayIcon on={playing} size={12} />
            </button>
          ) : null}
          <div className="relative min-w-0 flex-1">
            <div
              className="relative h-16 cursor-pointer"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                seek(((e.clientX - r.left) / r.width) * dur);
              }}
            >
              <div className="absolute inset-0 flex items-center gap-[2px]">
                {peaks.map((p, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-full"
                    style={{ height: `${Math.round(Math.max(6, p * 100))}%`, backgroundColor: (i + 0.5) / BARS <= t / dur ? "rgb(26,25,25)" : "rgb(190,186,183)" }}
                  />
                ))}
              </div>
              <span className="absolute inset-y-[-4px] w-px bg-[rgb(26,25,25)]" style={{ left: pct(t) }} />
            </div>
            <div className="relative mt-1 h-5" aria-label="Clicks and page changes">
              {marks.map((m) => {
                const l = stepLabel(m.s);
                return (
                  <button
                    key={m.i}
                    title={`${l.kind} · ${l.text}`}
                    onClick={() => seek(m.at)}
                    className={`absolute top-1 h-3 w-3 -translate-x-1/2 ${l.kind === "Page" ? "rounded-full border border-[rgb(110,106,104)] bg-white" : "rotate-45 bg-[rgb(71,69,67)]"}`}
                    style={{ left: pct(m.at), width: l.kind === "Page" ? 10 : 8, height: l.kind === "Page" ? 10 : 8 }}
                  />
                );
              })}
            </div>
          </div>
        </div>
        <div className={`tabular flex items-center justify-between gap-4 border-t border-[rgb(234,231,228)] px-5 py-2.5 text-[12px] ${MUTED}`}>
          <span>
            {fmtClock(t)} / {fmtClock(dur)}
          </span>
          <span className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rotate-45 bg-[rgb(71,69,67)]" /> Click
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-[rgb(110,106,104)]" /> Page
            </span>
          </span>
        </div>
        {v.has_audio && (
          <audio ref={audio} src={`/api/teach/recordings/${encodeURIComponent(v.id)}/audio`} preload="metadata" onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="hidden" />
        )}
      </Card>

      <Card testId="transcript" title="Transcript" pad={false} aside={utts.length ? <span className="tabular">{v.words} words</span> : null}>
        {utts.length === 0 ? (
          <Empty>No transcript</Empty>
        ) : (
          <ol>
            {utts.map((u, i) => {
              const on = t >= u.start && t <= u.end + 0.2;
              const low = new Set(u.low_confidence);
              return (
                <li key={u.id} data-utterance={u.id} data-utt-start={u.start} className={`grid grid-cols-[56px_minmax(0,1fr)_minmax(0,320px)] gap-4 px-5 py-3.5 ${i > 0 ? "border-t border-[rgb(234,231,228)]" : ""} ${on ? "bg-[#fbfde6]" : ""}`}>
                  <button onClick={() => seek(u.start)} className={`tabular self-start pt-1 text-left text-[12px] ${MUTED} hover:text-[rgb(26,25,25)]`}>
                    {fmtClock(u.start)}
                  </button>
                  <p className="text-[15px] leading-6">
                    {u.words.map((w, j) => {
                      const isLow = low.has(w.text) || (w.confidence != null && w.confidence < 0.6);
                      const now = t >= w.start && t < w.end + 0.05;
                      return (
                        <span key={j}>
                          <span
                            onClick={() => seek(w.start)}
                            title={w.confidence != null ? `${Math.round(w.confidence * 100)}%` : undefined}
                            className={`cursor-pointer rounded-[2px] ${now ? "bg-[rgb(228,242,34)]" : ""} ${isLow ? "underline decoration-[#c47a00] decoration-dotted decoration-[1.5px] underline-offset-4" : ""}`}
                            data-low={isLow || undefined}
                          >
                            {w.text}
                          </span>{" "}
                        </span>
                      );
                    })}
                  </p>
                  <ul className="space-y-1 pt-0.5">
                    {u.step_refs.map((si) => {
                      const s = rec.steps[si];
                      if (!s) return null;
                      const l = stepLabel(s);
                      return (
                        <li key={si} className="flex min-w-0 items-baseline gap-2 text-[12.5px]">
                          <span className={`w-9 shrink-0 ${MUTED}`}>{l.kind}</span>
                          <span className="truncate text-[rgb(71,69,67)]" title={s.detail.selector ?? s.detail.url}>
                            {l.kind === "Page" ? urlPath(s.detail.url) : l.text}
                          </span>
                          <span className={`tabular ml-auto shrink-0 text-[11.5px] ${MUTED}`}>{fmtClock(stepOffset(s, rec.started_at))}</span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
