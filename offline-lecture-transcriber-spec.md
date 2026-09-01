# Offline Lecture Transcriber & Summarizer — Technical Architecture Specification

---

## 0. Executive decision

**Optimization principle:** Maximize the probability that a student can trust the generated transcript, summary, and glossary as a faithful record of what was said — *entirely offline, on a phone NPU* — rather than maximizing feature count or summary "cleverness."

Non-negotiable design decisions:

1. Transcription runs 100% on-device — no network call anywhere in the pipeline, verifiable by a hard runtime assertion, not just "no calls made in practice."
2. The system must degrade gracefully on long audio (60–90 min lectures) without OOM-killing the app on a phone NPU.
3. ASR output is never silently "cleaned up" into the summary without the raw transcript being preserved and shown — summary is a derived, inspectable artifact, not a replacement for ground truth.
4. Glossary terms must be traceable back to the exact transcript span they came from — no term appears in the glossary without a citation into the transcript.
5. The system must explicitly flag low-confidence transcript segments rather than silently guessing words.
6. Audio capture and inference must be decoupled (streaming buffer) so a phone that runs out of battery/RAM mid-lecture does not lose already-processed content.
7. Model selection (Whisper-tiny vs Vosk, or a size variant) is a build-time config choice validated against the target NPU's memory/latency budget — not chosen for benchmark-only accuracy.
8. Summarization is extractive-grounded (constrained to reference transcript content) — the local LLM must not introduce facts absent from the transcript.
9. All intermediate artifacts (raw audio, transcript, summary, glossary) persist to local storage as the pipeline progresses, so a crash loses at most the current chunk, not the whole session.
10. UI must clearly separate three trust tiers: "verbatim transcript" (highest trust), "summary" (derived, may compress/omit), "glossary" (derived, may be wrong on ambiguous terms).
11. Everything must function with zero connectivity from cold boot — including model loading, so no first-run download step silently requires internet.
12. Build for one reference device (iQOO 15 / Snapdragon NPU) first; treat any other device support as a stretch goal, not a launch requirement.

---

## 1. Problem understanding

**Input:** A continuous audio stream (live mic capture) or a pre-recorded audio file (lecture length: typically 30–90 minutes, single or multiple speakers, classroom acoustics, variable mic distance).

**Output:**
- A time-aligned verbatim transcript.
- A structured summary (key points, likely organized by topic segment).
- A glossary of key terms with short definitions and back-references to transcript timestamps.

**Must NOT assume:**
- Do not assume clean, single-speaker, close-mic audio — classroom noise, cross-talk, and echo are the norm.
- Do not assume the lecture is in a single language or accent consistent with training data (esp. Indian-English classroom speech, code-switching with Hindi/regional terms is likely).
- Do not assume unlimited RAM/VRAM — this is a phone NPU with a hard memory ceiling shared with the OS and other apps.
- Do not assume the recording is uninterrupted — calls, app backgrounding, and battery-saver throttling can interrupt capture.
- Do not assume the local LLM used for summarization has the same context window as a cloud model — long lectures will exceed it and must be chunked.
- Do not assume the user will manually correct transcription errors before summarization runs — the pipeline must be usable in the fully automatic case.
- Do not assume network will *ever* become available — this is not "offline-first," it is "offline-only" for the target use case (Red Light phase).

---

## 2. Performance objective & priority tiers

**Scoring function (informal, since this is a build for real use / hackathon judging, not a fixed labeled test set):**

```
Score = 0.40 * TranscriptFaithfulness   (word error rate proxy, low WER = high score)
      + 0.25 * SummaryUsefulness        (coverage of key points, no hallucinated facts)
      + 0.15 * GlossaryPrecision        (terms are real, definitions are correct, traceable)
      + 0.10 * OnDeviceReliability      (no crash/OOM across a full 60-90 min session)
      + 0.10 * Latency/Efficiency       (processing completes in reasonable wall-clock time, doesn't drain battery unreasonably)
```

**Priority tiers:**

- **P0 (must be correct):** Fully offline audio capture and STT pipeline that does not crash or silently drop audio on a 60–90 min session; transcript is persisted incrementally.
- **P1 (must be high quality):** Transcript WER is low enough to be usable for study; summary captures the actual topic structure of the lecture; glossary terms are real terms from the lecture, not invented.
- **P2 (must be robust):** Handles noisy audio, silence gaps, low-confidence segments, interruptions (call, backgrounding), multiple speakers, code-switched terms.
- **P3 (polish):** Nice transcript UI (speaker-tagged, scrollable, searchable), export formats (PDF/markdown), summary customization (bullet length, glossary term count).

---

## 3. Mandatory capability matrix

| Capability | Required? | Evidence/test source | Success criterion |
|---|---|---|---|
| Fully offline STT (no network call) | Yes (P0) | Airplane-mode test run | Zero network calls detected across full session |
| Streaming/chunked audio capture | Yes (P0) | 90-min continuous recording test | No data loss, memory stays bounded (< device RAM ceiling) |
| Incremental transcript persistence | Yes (P0) | Force-kill app mid-recording | Transcript up to last processed chunk recoverable on relaunch |
| On-device ASR accuracy | Yes (P1) | Compare against 10-min manually transcribed reference clips | WER below defined threshold (e.g., ≤ 20% on classroom-noise audio) |
| Local LLM summarization | Yes (P1) | Manual review of summary vs. transcript | Summary covers ≥ 80% of manually identified key points, 0 fabricated facts |
| Glossary generation with traceability | Yes (P1) | Spot-check 10 glossary terms | Every term maps to an actual transcript timestamp/span |
| Low-confidence segment flagging | Yes (P2) | Inject synthetic noisy segment | Segment is visibly marked as low-confidence, not silently guessed |
| Interruption recovery (call/backgrounding) | Yes (P2) | Simulate call during recording | Recording resumes or cleanly closes the session without corrupting existing data |
| Multi-speaker handling (non-diarized, best-effort) | Optional (P2) | Two-speaker test clip | Transcript remains coherent even without speaker labels |
| Export (PDF/markdown) | Optional (P3) | Manual export test | File opens correctly outside the app |

---

## 4. Research / prior-art grounding

- **Whisper (OpenAI), tiny/base variants exported to ONNX/TFLite/GGML:** Strongest open baseline for general-purpose robust ASR across accents and noisy conditions. Lesson borrowed: use log-mel spectrogram windowing with overlap between chunks to avoid word-boundary truncation errors — adapt by tuning chunk length to the NPU's memory budget rather than Whisper's default 30s window if that's too large.
- **Vosk (via Kaldi):** Lighter-weight, streaming-native, lower accuracy than Whisper but much better real-time/low-latency behavior on constrained hardware. Lesson borrowed: Vosk's streaming partial-hypothesis API is the right pattern for a "live captions while recording" UI even if the final transcript uses a heavier offline pass.
- **llama.cpp / MLC-LLM / on-device GGUF quantized small LLMs (Phi-3-mini, Gemma-2B, Qwen2.5-1.5B class):** Strongest existing pattern for local summarization. Lesson borrowed: quantize aggressively (Q4_K_M or similar) and keep context windows small by chunk-summarizing then hierarchically re-summarizing ("map-reduce summarization") rather than trying to fit a full lecture transcript in one pass.
- **Extractive-then-abstractive summarization pipelines (standard NLP pattern):** Lesson borrowed: constrain the LLM's abstractive step by first extracting candidate key sentences, so hallucination surface area is reduced — this generalizes the "never trust unvalidated input" discipline from the template to "never let the LLM freely invent from nothing."
- **NPU deployment patterns (Qualcomm SNPE / QNN SDK for Snapdragon):** Lesson borrowed: models must be exported and quantized specifically for the target NPU's supported ops; a model that runs fine on CPU may silently fall back to CPU (much slower, battery-draining) if an unsupported op breaks NPU delegation — must be explicitly checked, not assumed.

---

## 5. System architecture

```
[Mic Input / Audio File]
        |
        v
[Audio Capture & Chunking Layer]  --(handles interruption, buffering, VAD)
        |
        v
[Validation Layer]  --(is chunk silence? is chunk corrupted? is device memory OK to proceed?)
        |
        v
[On-Device ASR Engine]  --(Whisper-tiny/Vosk, NPU-delegated)
        |
        v
[Transcript Assembler]  --(stitches chunks, timestamps, confidence scores, persists incrementally)
        |
        v
   -----------------------------
   |                           |
   v                           v
[Verification/Confidence      [Raw Transcript Store]
 Layer]                        (always available, source of truth)
   |
   v
[Local LLM Orchestrator]  --(map-reduce summarization + glossary extraction, grounded in transcript)
        |
        v
[Summary + Glossary Assembler]  --(attaches back-references to transcript spans)
        |
        v
[Output Contract]  --(transcript + summary + glossary + confidence + trace, all local files)
```

Data flows strictly downward and left-to-right; nothing downstream can silently overwrite the raw transcript store.

---

## 6. Data / interface contract

```json
{
  "session": {
    "session_id": "string (system-generated, immutable)",
    "created_at": "ISO8601 timestamp (system-resolved)",
    "device_model": "string (system-detected, e.g. 'iQOO 15')",
    "duration_seconds": "number (system-computed from audio, not user-entered)"
  },
  "transcript": {
    "segments": [
      {
        "segment_id": "string",
        "start_ms": "number",
        "end_ms": "number",
        "text": "string (system/ASR-generated)",
        "confidence": "number 0-1 (system-generated)",
        "low_confidence_flag": "boolean (system-derived from confidence threshold)"
      }
    ]
  },
  "summary": {
    "key_points": [
      {
        "point": "string (LLM-generated, must be grounded)",
        "source_segment_ids": ["segment_id", "..."]
      }
    ]
  },
  "glossary": [
    {
      "term": "string",
      "definition": "string (LLM-generated)",
      "source_segment_ids": ["segment_id", "..."]
    }
  ]
}
```

**Client controls:** recording start/stop, audio file selection, requested summary length/verbosity, glossary term count.

**Always system-resolved, never trusted from user input:** timestamps, confidence scores, session duration, device model, segment IDs, and any `source_segment_ids` back-references (the app must generate and validate these — a user or an LLM output cannot be allowed to fabricate a citation to a nonexistent segment).

---

## 7. Ingestion / validation pipeline

Resolution order for determining true properties of incoming audio:

1. **Sample rate / format:** Read from the audio stream's actual header/config — never assume 16kHz mono; resample explicitly if the mic delivers something else.
2. **Silence / voice-activity detection (VAD):** Run a lightweight VAD pass before ASR to skip silent chunks — do not guess "probably silence" from duration alone.
3. **Chunk integrity:** Verify each audio chunk is complete and non-corrupted (checksum or duration sanity check) before handing it to the ASR engine.
4. **Device resource check:** Query available RAM/battery state before starting or continuing a session; if resources are critically low, this is resolved by pausing capture, never by silently dropping audio without flagging it.

**Fail-closed vs fail-open policy:**
- If audio chunk is corrupted → **fail closed** on that chunk (mark segment as "unrecoverable," do not attempt to guess content) but **fail open** for the session (keep recording, don't abort the whole lecture over one bad chunk).
- If device memory is critically low → **fail closed** on starting new heavy work (e.g., delay LLM summarization) but **fail open** on the raw recording, since losing the raw audio is the worst-case outcome and must be avoided above all else.

---

## 8. Compatibility/Validation report (Session Readiness Check)

An executable pre-flight object run before allowing a recording session to start, and periodically during long sessions:

```json
{
  "checks": {
    "microphone_permission_granted": "bool",
    "storage_available_mb": "number",
    "storage_sufficient_for_estimated_duration": "bool",
    "npu_delegate_available": "bool",
    "asr_model_loaded_successfully": "bool",
    "llm_model_loaded_successfully": "bool",
    "battery_level_above_minimum_threshold": "bool",
    "network_interfaces_disabled_or_ignored": "bool (informational — confirms offline operation)"
  },
  "overall_status": "READY | DEGRADED | BLOCKED",
  "degraded_reasons": ["string", "..."]
}
```

Checks by category:
- **Permissions:** mic access granted.
- **Resources:** storage headroom for expected session length, battery above a safe threshold to avoid mid-session data loss.
- **Model integrity:** ASR and LLM models actually loaded and produced a successful test inference, not just "file exists on disk."
- **Hardware delegation:** NPU delegate confirmed active, not silently falling back to CPU (which would blow the latency/battery budget).

`BLOCKED` prevents recording start. `DEGRADED` allows recording with a visible warning (e.g., "summarization may be slow — battery low").

---

## 9. Core processing / logic design

**ASR engine:**
- Backbone: Whisper-tiny (or Vosk small model) exported to ONNX/TFLite, quantized (int8) for NPU execution.
- Chunking: overlapping windows (e.g., 30s window, 2–5s overlap) to avoid cutting words at boundaries; overlap region de-duplicated by the Transcript Assembler using timestamp alignment.
- Confidence: per-token or per-segment confidence scores (model-native if available, else derived from decoder logit entropy) feed the low-confidence flag.

**Local LLM (summarization + glossary):**
- Backbone: a small quantized instruction-tuned model (Phi-3-mini / Gemma-2B class, GGUF Q4).
- Strategy: map-reduce summarization — summarize each ~5-10 min transcript block independently ("map"), then summarize the block-summaries into a final structured summary ("reduce"). This keeps each LLM call within the small model's context window.
- Glossary extraction: run as a separate constrained pass over the same transcript blocks, prompted to extract only terms explicitly present in the transcript text (not inferred/invented), each paired with the block(s) it came from.

**Shared vs. task-specific:**
- Audio capture, VAD, chunking, and the raw transcript store are shared infrastructure used regardless of downstream task.
- The map-reduce summarizer and glossary extractor are separate LLM prompt "adapters" operating on the same shared transcript blocks — swappable independently (e.g., could add a "quiz question generator" adapter later without touching ASR).

---

## 10. Orchestration / control flow

A deterministic session controller (not a free-form agent) drives the pipeline:

**State object:**
```json
{
  "phase": "IDLE | CAPTURING | PROCESSING_ASR | SUMMARIZING | DONE | ERROR",
  "current_chunk_index": "number",
  "last_persisted_segment_id": "string",
  "error_log": ["string", "..."]
}
```

**Available actions:** `start_capture`, `stop_capture`, `pause_capture`, `process_pending_chunks`, `run_summarization`, `run_glossary_extraction`, `persist_state`, `recover_from_crash`.

**Execution loop:** interpret (what phase are we in / what triggered this cycle) → validate (run relevant checks from Section 7/8) → plan (which action is next given state) → execute (call the ASR/LLM engine) → verify (did the action produce valid output matching the Section 6 contract) → persist/respond (write to local store, update UI).

This loop is schema-constrained: the controller can only transition between the enumerated phases, and every transition is logged, making crash recovery a matter of replaying the state object rather than guessing where the session left off.

---

## 11. Confidence, calibration & abstention

**Signals feeding confidence:**
- ASR decoder confidence/entropy per segment.
- Audio quality signal (SNR estimate from VAD stage).
- LLM: whether a generated summary point or glossary term can be matched back to actual transcript text (a grounding check, not a model-reported confidence — small local LLMs are not well-calibrated to trust their own self-reported confidence).

**Thresholds/policy:**
- Transcript segment confidence below threshold → segment is visibly marked "low confidence" in the UI (e.g., greyed out or underlined), never silently smoothed over.
- If a generated glossary term/definition cannot be grounded to any transcript span → it is **dropped**, not shown with a caveat — an ungrounded term is worse than a missing one.
- If an entire audio block is too noisy to produce any segment above a minimum confidence floor → that block is marked in the summary as "[audio unclear from MM:SS to MM:SS — not summarized]" rather than the LLM guessing content to fill the gap.

**Example abstention text:** *"This section of the recording (12:03–13:40) was too unclear to transcribe reliably and was excluded from the summary. You can review the raw audio directly for this range."*

---

## 12. Evaluation framework

| Capability | Metric | Protocol |
|---|---|---|
| ASR accuracy | Word Error Rate (WER) | Manually transcribe 5–10 min reference clips across quiet/noisy/multi-speaker conditions; never tune model selection against these same clips used for final reporting — hold out a separate validation set during development. |
| Summarization quality | Key-point coverage %, hallucination count | Human reviewer checks each summary point against the transcript; count any point not traceable to the transcript as a hallucination (target: 0). |
| Glossary precision | % of terms that are real & correctly defined | Manual spot-check against transcript content. |
| Reliability | Crash/OOM rate | Run N full-length (60–90 min) sessions on the reference device; report failure rate. |
| Latency/efficiency | Wall-clock processing time, battery drain % per hour of audio | Timed runs on reference device (iQOO 15) with battery logging. |

**Data leakage policy:** Any audio clips used to tune chunk size, thresholds, or prompt wording during development are treated as a training/dev set and must not be reused as the final reported evaluation clips — final evaluation uses fresh recordings.

---

## 13. Robustness test suite

1. Silent/empty audio input → system should produce an empty transcript with a clear "no speech detected" message, not an error or fabricated content.
2. Heavy background noise (fans, chatter) → segments should show reduced confidence, not confidently wrong text.
3. Multiple overlapping speakers → transcript should remain readable even without diarization; should not silently merge/garble speech into nonsense without flagging low confidence.
4. Mid-session phone call interruption → recording pauses/stops cleanly; already-captured audio is not lost.
5. App backgrounded by OS (e.g., low memory) → session state is persisted such that recovery is possible on relaunch.
6. Very long session (90+ min) → memory usage stays bounded (chunk-and-discard raw audio buffers after processing, don't hold entire session in RAM).
7. Code-switched speech (English + Hindi/regional terms) → system should transcribe as best-effort and flag low confidence on ambiguous segments rather than fabricate an all-English guess.
8. Corrupted/truncated audio file input (for file-upload mode) → validation layer rejects gracefully with a clear error, not a crash.
9. Battery critically low mid-session → system prioritizes finishing/persisting the raw transcript over starting new LLM summarization work.
10. NPU delegate unavailable (fallback to CPU) → system detects this and warns the user of expected slower performance rather than silently running degraded without explanation.

---

## 14. Ablation study plan

- **With vs. without VAD-based silence skipping:** measure processing time and battery savings.
- **With vs. without chunk overlap in ASR:** measure WER impact at chunk boundaries.
- **With vs. without map-reduce summarization (vs. naive single-pass truncation):** measure key-point coverage on long lectures.
- **With vs. without grounding-check filtering on glossary terms:** measure hallucination rate before/after.
- **Whisper-tiny vs. Vosk-small:** measure WER and latency/battery tradeoff on the same reference clips to justify the final model choice.
- **NPU-delegated vs. CPU-only inference:** measure latency and battery drain difference to justify the NPU dependency.

---

## 15. Primary risk workstream

**Single biggest source of uncertainty:** ASR accuracy on real classroom audio (noisy, code-switched, variable mic distance) generalizing from whatever clean benchmark data the model was originally trained/tested on.

**Dedicated mitigation strategy:**
- Collect a small but *realistic* internal validation set recorded in actual classroom-like conditions (not just clean read speech) as early as possible in the build, even if small (e.g., 20–30 minutes across a few sessions).
- Explicitly test both candidate ASR backbones (Whisper-tiny, Vosk) against this realistic set before committing, rather than trusting published benchmark numbers.
- Build the low-confidence flagging system (Section 11) as a first-class feature specifically *because* this risk cannot be fully eliminated — the mitigation is not "make ASR perfect" but "make the system honest about where it's uncertain."
- **What can be guaranteed:** the system will never silently present a fabricated transcript as verbatim truth without a confidence signal.
- **What cannot be guaranteed:** perfect transcription accuracy on heavily degraded audio — this is stated explicitly to users, not hidden.

---

## 16. Resourcing & execution plan

**Tier A1 — never cut:**
- Offline audio capture with chunking and incremental persistence.
- On-device ASR producing a raw transcript.
- Session readiness validation (Section 8).

**Tier A2 — full feature/benchmark completeness:**
- Local LLM summarization (map-reduce).
- Glossary extraction with grounding checks.
- Low-confidence flagging in transcript UI.

**Tier B — valuable but optional:**
- Interruption recovery (call/backgrounding resilience).
- Multi-speaker best-effort handling.
- Export to PDF/markdown.

**Tier C — cut first:**
- Speaker diarization (true speaker labels).
- Summary customization controls (length/verbosity sliders).
- Polished transcript search/scroll UI.

**Execution plan (example, week-by-week for a hackathon-style build):**

- **Day 1–2 (Gate: capture works):** Build audio capture + chunking + local storage. Gate: record a 10-min test session, confirm zero data loss on force-kill.
- **Day 3–4 (Gate: ASR works offline):** Integrate Whisper-tiny/Vosk on-device, confirm NPU delegation active. Gate: WER measured on a small reference clip, airplane-mode test passes.
- **Day 5 (Gate: validation & confidence):** Build Section 8 readiness checks and Section 11 confidence flagging. Gate: injected noisy clip correctly flagged low-confidence.
- **Day 6–7 (Gate: summarization works):** Integrate local LLM, build map-reduce summarizer + glossary extractor with grounding checks. Gate: 0 hallucinated facts on a test transcript.
- **Day 8 (Gate: robustness):** Run the Section 13 test suite; fix crash/OOM issues on long sessions.
- **Day 9 (Gate: full end-to-end run):** Full 60–90 min real lecture recording end-to-end, review output quality.
- **Day 10:** Polish (Tier B/C items as time allows), final acceptance gate review.

---

## 17. If the schedule slips

Ordered sacrifice list:
1. Cut Tier C items first (diarization, UI polish, export formats).
2. Cut Tier B items next (interruption recovery can degrade to "session ends cleanly, no auto-resume"; multi-speaker handling can degrade to "best-effort, no special handling").
3. Reduce summarization scope (shorter/simpler summaries, smaller glossary term count) before cutting summarization entirely.
4. **Never cut:** offline-only operation, raw transcript capture/persistence, and confidence flagging — these are the trust foundation of the whole product; a version with a worse summary is still useful, a version that silently fabricates a transcript is not.

---

## 18. Final acceptance gates

1. A full 60–90 min lecture can be recorded and processed with zero network calls (verified in airplane mode).
2. No data loss occurs if the app is force-killed mid-session (transcript recoverable up to last persisted chunk).
3. Measured WER on the internal realistic validation set is at or below the defined threshold.
4. Zero hallucinated facts found in summaries across the test suite (Section 12/13).
5. Every glossary term is traceable to an actual transcript span; ungrounded terms are dropped, not shown.
6. Low-confidence segments are visibly flagged in at least one injected-noise test case.
7. The app runs end-to-end on the reference device (iQOO 15) without crash or OOM across at least 3 full-length test sessions.
8. NPU delegation is confirmed active (not silent CPU fallback) during a test run.

---

## 19. Final output contract

A successful session returns (as local files/objects, matching the schema in Section 6):

```json
{
  "transcript": "full timestamped, confidence-annotated transcript",
  "summary": "structured key points, each with source_segment_ids evidence",
  "glossary": "terms with definitions and source_segment_ids evidence",
  "confidence_report": "list of low-confidence segments/time ranges",
  "trace": {
    "session_metadata": "device, duration, model versions used",
    "validation_report": "the Section 8 readiness check result for this session"
  }
}
```

---

## 20. Things the system must never do

1. Never make a network call at any point in the capture/transcription/summarization pipeline.
2. Never present a low-confidence or unrecoverable transcript segment as if it were verified.
3. Never let the summarizer or glossary extractor introduce facts/terms not present in the transcript.
4. Never overwrite or discard the raw transcript in favor of a "cleaned up" version — raw transcript is always preserved and accessible.
5. Never silently fall back from NPU to CPU without informing the user of the performance implication.
6. Never lose already-captured audio/transcript data due to a crash, low battery, or interruption without an explicit recovery path.
7. Never fabricate a `source_segment_ids` citation that doesn't correspond to real transcript content.
8. Never tune the ASR model or thresholds against the same clips used for final reported evaluation numbers.
9. Never require a first-run internet connection to download models "just once" — models must ship with the app or be fully provisioned before the offline (Red Light) phase begins.

---

## 21. Final engineering principle

If a hostile expert asked, *"How do you know this transcript and summary are actually correct?"* — the system's answer must be a traceable chain: the raw audio is preserved and timestamped; every transcript segment carries a confidence score derived from the ASR model, not asserted; every summary point and glossary term is linked back to the specific transcript span it came from; any segment the system could not transcribe reliably is explicitly marked as such rather than filled in with a guess — and the whole chain was produced, start to finish, without a single byte leaving the device.
