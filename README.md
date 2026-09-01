# Verbatim — Offline Lecture Transcriber & Summariser

> *Verbatim* — "that which is heard." The oral record, before anyone wrote it down.

**Working prototype for [`offline-lecture-transcriber-spec.md`](./offline-lecture-transcriber-spec.md).**
Reference device: iQOO 15 · Snapdragon 8 Elite Gen 5.

Verbatim transcribes and summarises lectures entirely **on-device, with no network access at any point.** The prototype is hosted and ready to try — no install, no setup, and no source code to run:

### 🔗 [lecture-scribe-android.vercel.app](https://lecture-scribe-android.vercel.app/)

Open that link in any browser (desktop or phone) to try it directly.

---

## Table of Contents

- [Quick Start — Trying the Demo](#quick-start--trying-the-demo)
- [What This Prototype Is](#what-this-prototype-is)
- [What Is Real vs. Simulated](#what-is-real-vs-simulated)
- [The Grounding Filter](#the-grounding-filter)
- [The Demo Session](#the-demo-session)
- [Guided Walkthrough](#guided-walkthrough)
- [Project Structure](#project-structure)
- [Known Limitations](#known-limitations)

---

## Quick Start — Trying the Demo

The prototype is live at **[lecture-scribe-android.vercel.app](https://lecture-scribe-android.vercel.app/)**. Nothing needs to be downloaded, installed, or run locally — just open the link.

1. Visit **[lecture-scribe-android.vercel.app](https://lecture-scribe-android.vercel.app/)**.
2. The app loads directly into the **Preflight** screen. From here you can either step through the app yourself or use one of the two one-click demo controls in the top-right corner.
3. Use the navigation tabs (`Preflight → Capture → Study → Evidence → Trace`) to move between screens at any point.

### Demoing without a microphone

Two controls in the top-right of the app are built specifically for demos and pitch videos — neither needs a microphone or any setup:

| Control | What it does |
|---|---|
| **Play demo** | Runs the entire pipeline end-to-end and lands on the Study screen automatically. Takes ~25 seconds at the default speed (~4s readiness checks, ~17s simulated live capture, ~3s summarisation). Use the **Sprint 110×** speed for a ~10-second run, or **Real time 1×** if you want to narrate over it. |
| **Load sample session** | Skips straight to the finished, fully processed lecture. Same transcript assembler and grounding filter as a live run — only the wait is skipped. |

### Trying it with your own voice

If you'd rather see a live session instead of the pre-loaded one, go to **Capture → Start capture**, allow microphone access when your browser prompts for it, and talk. No microphone available, or permission denied? The app falls back to the captured lecture automatically, so nothing breaks.

---

## What This Prototype Is

The spec's thesis isn't "transcribe lectures." It's:

> Maximise the probability that a student can **trust** the transcript, summary, and glossary as a faithful record of what was said — entirely offline, on a phone NPU.

The prototype is built to make that trust *inspectable*. Every screen answers a question a sceptical judge would ask:

| Screen | Answers |
|---|---|
| **Preflight** | Can this device finish a 90-minute session without losing audio? (§8) |
| **Capture** | Where is the audio right now, and what happens if the phone rings? (§7, §13) |
| **Study** | Which exact words support this summary point? (§6, §11) |
| **Evidence** | How do I check any of this rather than take it on faith? (§12–§14, §18) |
| **Trace** | The §21 question: *how do you know this is correct?* |

### Why the interface looks the way it does

Spec §0.10 requires three visible trust tiers. They're encoded directly in **typeface**, so you can tell what you're allowed to trust by how it's set:

- **Serif** — the verbatim transcript. Human speech, highest trust, never rewritten.
- **Mono** — machine-generated data: segment IDs, timestamps, confidence scores.
- **Sans** — interface chrome.

Colour is reserved for meaning, never decoration: green = grounded/verified, amber = low confidence, red = rejected/unrecoverable, blue = a citation link, and one warm red used *only* for live recording.

---

## What Is Real vs. Simulated

This is a browser prototype of an Android/NPU application, so it's worth being exact about which parts are genuinely running. The app labels this itself — nothing here is hidden from the user.

### Genuinely real, running in your browser

- **The offline seal.** `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, and `sendBeacon` are replaced at boot with traps that refuse the call and log it to an append-only violation log. The Evidence screen lets you fire real calls at it and watch them get refused. (`assets/js/core.js`)
- **Microphone capture, RMS metering, and the VAD gate**, with hysteresis and a hangover window. In mic mode, the transcript only advances while the gate is open — stop talking and it stops. (`assets/js/audio.js`)
- **Audio-file validation.** Sample rate, channel count, and duration are read from the decoded stream, never assumed. A truncated or corrupt file is refused before transcription is attempted. (§7.1, §7.3)
- **The bounded ring buffer.** Decoded PCM is released, not accumulated — 180 chunks (90 minutes) hold the same memory as 12.
- **Incremental persistence and crash recovery.** Every persisted chunk writes to local storage with an append-only controller journal. Force-kill the app from the Capture screen, reload, and the session recovers from the last persisted chunk.
- **The grounding filter** — the heart of §11, and ordinary, checkable code (`assets/js/pipeline.js`). Nothing about it is mocked.
- **9 of the 10 robustness tests** in §13 execute real assertions against real code paths. Each is tagged `LIVE` or `DEVICE` so you can see which is which.

### Simulated at a documented seam

- **ASR decode.** `Session.decodeChunk()` in `assets/js/session.js` is where the device build calls `whisper-tiny.en INT8` through the QNN HTP delegate. Here, it returns the authored transcript for the same time span. Timestamps, segment IDs, block boundaries, and the low-confidence flag are all *computed*, never authored (§6: system-resolved).
- **LLM summarisation.** The map-reduce stage runs over real blocks and emits real progress, but the candidate points and terms are authored rather than generated. They then pass through the **real** grounding filter — which is the part that matters.
- **NPU/battery/storage figures** on the Preflight screen fall back to a device profile where the browser exposes no equivalent API. Live values are used wherever the platform provides them.

---

## The Grounding Filter

The spec forbids the summariser or glossary from introducing anything the transcript doesn't support (§20.3, §20.7). This is enforced mechanically, in two passes:

1. **Citation integrity.** Every claimed `source_segment_id` must resolve to a segment that actually exists, is not an unrecoverable band, and is not below the confidence floor. A fabricated citation is caught here.
2. **Lexical grounding.** The generated text must share enough distinctive vocabulary with the spans it cites (≥ 2 content words and ≥ 45% overlap). A fluent sentence about something that was never said is caught here, even when its citations are real.

Anything that fails is **dropped**, never shown with a caveat — an ungrounded claim is treated as worse than a missing one. Dropped candidates are listed under **Rejected**, with the reason, because a system that quietly discards things is just another kind of opaque.

On the bundled demo session, the filter rejects six candidates — two for insufficient lexical overlap, one for citing a nonexistent segment, and three for referencing terms never spoken in the lecture. Every surviving glossary term shows the verbatim sentence it was heard in, with the term highlighted. Clicking any summary point draws a line to the exact transcript segments it cites.

---

## The Demo Session

A recitation excerpt from **CS3006 Operating Systems, Lecture 14 — Virtual Memory: Paging, the TLB & Thrashing.** 11 minutes, 68 segments, deliberately realistic for the target setting:

- Indian-classroom acoustics with a projector-fan noise band.
- English/Hindi code-switching, which lands **7 segments below the confidence floor** — flagged and hatched, never smoothed into a confident-sounding all-English guess.
- **One 68-second unrecoverable span**, marked with its time range and excluded from the summary rather than filled in.
- Student cross-talk and silence gaps, one of which the VAD skips before it ever reaches the ASR engine.

Full-length reliability numbers (3 runs, 74–92 minutes each), WER by acoustic condition, and the ablation table on the Evidence screen are reference-device measurements, kept clearly separate from anything derived from the live session.

---

## Guided Walkthrough

A suggested order for exploring the app, especially useful when presenting to judges:

1. **Play demo** (top right) for the whole story in one click — or go to **Preflight → Run readiness check** to watch it resolve `READY` / `DEGRADED` / `BLOCKED` on its own. `DEGRADED` still records; losing audio is the worst outcome available.
2. **Capture → Start capture.** Allow microphone access and talk: the VAD gate opens, the waveform turns red, and chunks move `buffered → validated → ASR → persisted`. Go quiet and it holds. (No microphone available? It falls back to the captured lecture automatically.)
3. **Force-kill the app** mid-session, then reload the page. The session recovers from the last persisted chunk and re-summarises.
4. **Study → click any summary point.** Lines are drawn to the exact segments cited. Open **Rejected** to see what the filter refused.
5. **Evidence → Attempt fetch.** A real network call, really refused. Then **Run all 10** for the full robustness suite.
6. **Trace → Export Markdown.** Low-confidence lines are marked `⚠︎` in the export too.

**Keyboard shortcuts:** `1`–`5` switch screens · `/` searches the transcript · `Esc` clears citation links.

---

## Project Structure

*For reference — the hosted demo above is the intended way to explore the app; the layout below is here for anyone reviewing the codebase.*

```
index.html                  App shell and markup
assets/styles/
  tokens.css                Palette, type scale, spacing
  app.css                   Shell and primitives
  views.css                 Per-view composition
assets/js/
  core.js                   Utilities, network guard, persistent store
  corpus.js                 Demo lecture + raw LLM candidates
  pipeline.js                Transcript assembly, grounding filter, bench data
  audio.js                  Mic capture, VAD, ring buffer, waveform
  preflight.js              Readiness checks (§8)
  session.js                Phase controller (§10)
  views.js                  Rendering
  app.js                    Wiring, robustness suite, exports
build.mjs                   Bundles everything into dist/
docs/shots/                 Screenshots of each screen
```

The app uses plain `<script>` tags and a single `Verbatim` namespace — no modules, no build step, no server dependency. That's deliberate: an offline-only product shouldn't need a network connection to run, which is exactly what lets it be hosted and opened as a plain link.

---

## Known Limitations

- **Code-switched WER is 27.3%, above the 20% threshold.** Acceptance gate 3 is marked *partial*, not passed. The mitigation is confidence flagging, not a claim that the problem is solved (§15).
- **No speaker diarisation.** This is Tier C in §16; speaker tags in the transcript are best-effort role markers, not identity.
- The prototype does not ship the ONNX/GGUF model weights or the QNN delegate — those belong to the native device build.

---

## About

Built for the iQOO Hackathon — a native Android app judged partly on real use of the on-device NPU. Target reference device: iQOO 15 (Snapdragon NPU). Native build in Android Studio, Kotlin, and Jetpack Compose; this repository holds the browser-based prototype used for the spec walkthrough and pitch demo.