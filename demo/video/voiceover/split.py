"""Cut transcript.json into voice-over lines (source span, caption text, speaker, anchor). Usage: python3 split.py transcript.json silences.txt units.json
The list U below maps each line of the script to the words heard; edit lines.json for later tweaks."""
import json, re, sys
words = json.load(open(sys.argv[1]))["words"]
sil = [tuple(map(float, l.split())) for l in open(sys.argv[2]) if l.strip()]
R, S = "rohin", "sahith"
# speaker, first words of the unit (as transcribed), caption text (what was said, cleaned), anchor
U = [
  (R, "Suppose I'm", "Suppose I'm Rohin, an AP accountant. Every week I check invoices from our staffing agency, Halcyon, by hand.", {"sec": "intro", "t": 0.6}),
  (S, "Ramp Teach lets", "Ramp Teach lets Rohin show that check once, so every bill after already arrives checked, with the proof.", {"after": 0.5}),
  (R, "So let's say", "So let's say it's close week, so I'm recording myself reviewing this month's Halcyon invoice.", {"mark": "start", "dt": 0.3}),
  (R, "Every rate on", "Every rate on it has to match the rate card in our contract,", {"said": 1}),
  (R, "and nobody should", "and nobody should be billed twice for the same week.", {"said": 2}),
  (R, "Then I check", "Then I check each person's hours against their approved timecard.", {"said": 3}),
  (R, "Maya's approved for", "Maya's approved for 40 hours, so billed hours can't go over that.", {"said": 4}),
  (R, "Sam's is approved", "Sam's approved for 36.", {"said": 5}),
  (R, "If anything's off,", "If anything's off, I dispute it and ask the agency for a credit memo.", {"said": 6}),
  (R, "When I stop,", "When I stop, each thing I said shows up, linked to the step it was about.", {"mark": "record_stop", "dt": 0.5}),
  (S, "Rohin, while you", "Rohin, while you worked, the recorder saved each click with the exact element you hit, and every sentence you said with its timing, matched to the clicks around it.", {"sec": "record", "t": 0.4}),
  (S, "Your click shows", "Your click shows where the evidence is, and your sentences say the rules.", {"after": 0.4}),
  (R, "So now I'm", "So now I'm going to send it to Ramp.", {"mark": "record_end", "dt": 0.2}),
  (S, "Rohin's recording becomes", "Rohin's recording becomes a workflow, and when the next invoice comes in, an agent runs that workflow in its own browser, bringing back the same evidence.", {"sec": "overview", "t": 0.3}),
  (R, "Bill Pay is", "Bill Pay is learning my review, one stage at a time.", {"mark": "learn_start", "dt": 0.4}),
  (R, "Here's what it", "Here's what it learned.", {"mark": "learn_done", "dt": 1.8}),
  (R, "Each rule points", "Each rule points back to what I said and where I clicked,", {"mark": "rules", "dt": 1.1}),
  (R, "and my recording", "and my recording keeps my words lined up with my clicks.", {"mark": "recording", "dt": 0.3}),
  (S, "Claude reads your", "Claude reads your recording and writes the workflow: each rule with the words and click that it came from, and where the proof lives.", {"sec": "learning", "t": 0.4}),
  (S, "It learns what", "It learns what to check and where to find it, writing real deterministic math code to spot differences.", {"after": 0.4}),
  (R, "Here it passed", "Here it passed its evals, so this is now our active workflow.", {"mark": "eval_end", "dt": 0.3}),
  (R, "Just now, a", "Just now, a new invoice from Halcyon hit my approval queue,", {"mark": "deliver_1011", "dt": 0.2}),
  (R, "so we can", "so we can see Ramp picks the right workflow and starts its agent.", {"mark": "review", "dt": 0.0}),
  (R, "While it does", "While it does that, I can watch the agent's own browser right here in the bill,", {"mark": "agent_on", "dt": 0.4}),
  (R, "and it also", "and it also pulls each timecard the same way I did.", {"mark": "agent_on", "dt": 4.6}),
  (R, "The run lives", "The run lives under Workflows, with every model turn and tool call,", {"mark": "agent_leave", "dt": 1.4}),
  (R, "and each step", "and each step shows its tokens, cost and request ID.", {"mark": "result_1011", "dt": 0.9}),
  (R, "So every fact", "So every fact gets reread from its page by plain code.", {"mark": "evidence", "dt": 0.0}),
  (R, "It found three", "It found three problems and $3,500 to credit back,", {"mark": "evidence", "dt": 3.4}),
  (R, "and this is", "and this is where I can dispute it, as the agent never approves or pays anything itself.", {"mark": "dispute", "dt": -1.2}),
  (S, "The agent gets", "The agent gets its own browser, and each turn Claude sees the page as an outline, picks the action, and gets the result.", {"sec": "execution", "t": 0.4}),
  (S, "It only records", "It only records the facts with the page that they came from, and code turns them into pass or fail.", {"after": 0.4}),
  (S, "Claude writes to", "Claude writes the receipt, and then you make the call.", {"after": 0.3}),
  (R, "Next, this is", "Next, this is a clean invoice from the same agency,", {"mark": "deliver_1012", "dt": 0.2}),
  (R, "and since everything", "and since everything checks out, just one click from me moves it on to payment.", {"mark": "ready_1012", "dt": 0.3}),
  (S, "We test the", "We test the checks against past corrections, the learning against recordings with known answers, and the whole review end to end.", {"sec": "evaluation", "t": 0.4}),
  (S, "Every Claude call", "Every Claude call is logged with its tokens, its cost, and a request ID that we can look up for observability.", {"after": 0.4}),
  (S, "Today, this one", "Today, this one recording from Rohin can become a tested workflow, with evidence behind every single recommendation.", {"sec": "close", "t": 0.3}),
  (S, "In the future,", "In the future, we see integrations with Teams and Slack to attach evidence from there to receipts as well.", {"after": 0.4}),
  (S, "Thank you.", "Thank you.", {"sec": "outro", "t": 0.4, "caption": False}),
]
norm = lambda s: re.sub(r"[^a-z0-9']", "", s.lower())
idx, i = [], 0
for sp, first, text, anc in U:
    key = [norm(x) for x in first.split()]
    while i < len(words) and [norm(w["w"]) for w in words[i:i + len(key)]] != key: i += 1
    if i >= len(words): sys.exit(f"not found: {first}")
    idx.append(i); i += len(key)
idx.append(len(words))

def cut_before(t, lo):
    """Cut point before a word starting at t: middle of the silence just before it, else t - 0.12."""
    c = [s for s in sil if s[1] >= t - 0.35 and s[1] <= t + 0.25 and s[1] > lo]
    if c: s = c[-1]; return max(s[0], s[1] - 0.2)
    return max(lo, t - 0.12)
def cut_after(t, hi):
    c = [s for s in sil if s[0] >= t - 0.25 and s[0] <= t + 0.35 and s[0] < hi]
    if c: s = c[0]; return min(s[1], s[0] + 0.25)
    return min(hi, t + 0.15)
out = []
for k, (sp, first, text, anc) in enumerate(U):
    ws = words[idx[k]:idx[k + 1]]
    prev_end = words[idx[k] - 1]["end"] if idx[k] > 0 else 0
    nxt = words[idx[k + 1]]["start"] if idx[k + 1] < len(words) else ws[-1]["end"] + 1
    a = cut_before(ws[0]["start"], prev_end)
    b = cut_after(ws[-1]["end"], nxt)
    u = {"speaker": sp, "a": round(a, 3), "b": round(b, 3), "text": text, "heard": " ".join(w["w"] for w in ws)}
    u.update({"at": {k2: v for k2, v in anc.items() if k2 != "caption"}})
    if anc.get("caption") is False: u["caption"] = False
    out.append(u)
json.dump(out, open(sys.argv[3], "w"), indent=1)
for u in out: print(f'{u["a"]:7.2f}-{u["b"]:7.2f} {u["speaker"][0]} {u["heard"][:70]}')
