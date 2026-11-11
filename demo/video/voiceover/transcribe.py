"""Transcribe a voice-over with local faster-whisper. Usage: transcribe.py <audio> <out.json>"""
import json, subprocess, sys, time
import numpy as np
from faster_whisper import WhisperModel

src, out = sys.argv[1], sys.argv[2]
raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                     check=True, capture_output=True).stdout
audio = np.frombuffer(raw, np.float32)
t = time.time()
model = WhisperModel("small.en", device="cpu", compute_type="int8")
prompt = "Rohin, Sahith, Ramp, Ramp Teach, Halcyon, Bill Pay, Claude, timecard, rate card, credit memo, evals, Maya, Sam, Teams, Slack"
segs, info = model.transcribe(audio, word_timestamps=True, vad_filter=False, initial_prompt=prompt, beam_size=5)
words = [{"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3), "p": round(w.probability, 2)} for s in segs for w in s.words]
json.dump({"duration": round(len(audio) / 16000, 3), "words": words}, open(out, "w"), indent=1)
print(f"{len(words)} words, {len(audio)/16000:.1f}s audio, {time.time()-t:.1f}s")
