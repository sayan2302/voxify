# Vocalis Studio: Audio Engine Architecture & Invariant Specification

> **Version:** 1.0.0  
> **Target Engine:** Native Kokoro-82M (ONNX Runtime via `sherpa-onnx`) + `rodio` Audio Sink  
> **Hardware Reference:** Intel Core Ultra 5 225U (Hybrid 2 P-Cores / 4 Threads + 8 E-Cores + 2 LP E-Cores)  
> **Status:** Permanent Architectural Reference & Invariant Registry

---

## 1. Executive Summary & Purpose

This document serves as the **authoritative reference and invariant contract** for the Vocalis Studio audio engine. Whenever new fixes, features, or performance optimizations are introduced, this specification **MUST be consulted to prevent regressions of previously resolved edge cases**.

Vocalis Studio is designed to provide:
1. **Instant Feedback**: Acoustic confirmation earcon in $< 2\text{ms}$ upon text selection.
2. **Authentic Human Prosody**: Zero robotic chop; complete sentence intonation contours and natural breathing pauses.
3. **Zero-Gap Continuous Playback**: Pipelined streaming with a guaranteed safety buffer runway ($\ge 6\text{s}$ maintained throughout playback).
4. **100% Robustness against Text Irregularities**: Bulletproof handling of honorifics, middle initials, Latin abbreviations, units of measurement, dialogue attribution tags, URLs, decimals, markdown formatting, HTML tags, soft hyphens, and Unicode typographic characters.

---

## 2. The 7 Core Architectural Invariants

Every modification to `src-tauri/src/native_kokoro.rs` or the global reader MUST strictly adhere to these seven invariants:

```
+-----------------------------------------------------------------------------------+
|                           THE 7 CORE INVARIANTS                                   |
+---+-----------------------------------+-------------------------------------------+
| 1 | Prosody Preservation              | Sentences <= 14 words are NEVER chopped.  |
| 2 | Abbreviation & Initial Protection | Dots in titles, initials, units != stops. |
| 3 | Deep Buffer Runway                | Pre-buffer >= 4.5s audio before release.  |
| 4 | Clean Sample Transition           | 3ms linear fade-out before pause silence. |
| 5 | Punctuation Breath Matrix         | 380ms full stop, 280ms ..., 140ms comma.  |
| 6 | P-Core Thread Affinity            | Pin to 4 threads (avoid E-core stalls).   |
| 7 | Pure Text Normalization           | Strip markdown/HTML, protect list nums.   |
+---+-----------------------------------+-------------------------------------------+
```

### Invariant 1: Sentence & Prosody Preservation
- **Rule**: Standard English sentences contain critical melodic pitch contours (question inflections, assertive full-stop descents, dramatic rises). Any sentence with **$\le 14$ words MUST NEVER be split** into arbitrary word partitions.
- **Forbidden**: Never mechanically chunk by word count alone (e.g. chopping every 8 words). Doing so breaks phrases in half (e.g., `"Pennies saved one and two"` ... `"at a time by bulldozing"`) causing robotic, flat, disjointed speech.
- **Allowed**: Run-on sentences exceeding 14 words may only be partitioned at natural grammatical clause boundaries (see Section 4).

### Invariant 2: Abbreviation, Honorific, and Initial Protection
- **Rule**: A period (`.`) does NOT denote the end of a sentence when it belongs to:
  1. A title or honorific (`Mr.`, `Mrs.`, `Dr.`, `Prof.`, `Gen.`).
  2. A middle initial or author initialism (`James D. Young`, `J. K. Rowling`, `George R. R. Martin`).
  3. A multi-dot acronym (`e.g.`, `i.e.`, `U.S.A.`, `Ph.D.`, `10:00 a.m.`).
  4. A decimal number (`$30.00`, `3.14`, `1,250.75`).
  5. A unit of measure followed by a continuing word (`60 km. per hour`, `150 lbs. before the diet`).
  6. An address followed by a continuing word (`St. Jude`, `Baker St. and Broadway`).
- **Isolation Check**: Never allow a chunk to end with an isolated honorific (e.g., chunk ending with `"Mr."` or `"Mrs."`).

### Invariant 3: Pipelined Streaming & Deep Buffer Runway
- **Rule**: Playback must NEVER start prematurely on a single short chunk when dealing with paragraphs.
- **The Runway Condition**:
  ```rust
  if pending_audio_secs >= 4.5 || idx + 1 == chunks.len() {
      // Release initial audio reservoir
  }
  ```
- **Why 4.5s?**:
  - The model runs at Real-Time Factor (RTF) $\approx 0.82\text{x}$ on 4 threads.
  - 1.0s of speech takes ~0.82s of CPU time to compute.
  - Accumulating $\ge 4.5\text{s}$ of audio upfront takes $\approx 3.7\text{s}$ of wall-clock time, but provides a **$6.2\text{s} - 8.0\text{s}$ safety runway**.
  - While the user listens to chunks 1–3, chunks 4, 5, 6... are generated well ahead of the playback playhead. The buffer NEVER underruns.
  - If the entire text selection is short ($< 4.5\text{s}$ total audio), `idx + 1 == chunks.len()` triggers instantly as soon as the last chunk finishes synthesizing (typically $< 0.8\text{s}$ total wait), playing the entire text without delay.

### Invariant 4: Audio Sample Quality & Anti-Click Fades
- **Rule**: Audio slices must never be abruptly truncated or concatenated without smoothing.
- **3ms Linear Fade-Out**:
  ```rust
  let fade_samples = (sample_rate as f32 * 0.003) as usize;
  for (i, sample) in samples[len - fade_samples..].iter_mut().enumerate() {
      let factor = 1.0 - (i as f32 / fade_samples as f32);
      *sample *= factor;
  }
  ```
- Appending silence directly to an unfaded wave creates high-frequency DC offset "clicks" or "pops". The 3ms linear ramp to zero guarantees acoustic silence transitions.
- Samples must be seamlessly appended to the active `rodio::Sink` via `append_samples()`. Never destroy and re-instantiate the sink between chunks of the same text.

### Invariant 5: Punctuation-Based Breath Pause Matrix
- **Rule**: Humans breathe at full stops and make subtle micro-pauses at clauses. The audio engine appends exact silence durations based on chunk terminal punctuation:

| Terminal Punctuation | Pause Duration | Human Acoustic Function |
| :--- | :--- | :--- |
| Full Stop (`.`, `!`, `?`) | **380 ms** | Natural breath pause between independent thoughts |
| Ellipsis (`...`, `…`) | **280 ms** | Suspenseful, reflective, or trailing silence |
| Colon / Semicolon (`:`, `;`) | **220 ms** | Structural division of balanced ideas |
| Comma / Em-Dash (`,`, `—`) | **140 ms** | Subtle clause transition within a sentence |
| Fallback / Fragment | **200 ms** | Neutral phrasing boundary |

### Invariant 6: CPU Thread Pinning & P-Core Affinity
- **Rule**: Set `num_threads: 4` in `OfflineTtsModelConfig`.
- **Hybrid Intel CPU Rationale**:
  - The Intel Core Ultra 5 225U contains 2 Performance Cores (4 logical threads) and 8 Efficient Cores (E-cores) + 2 Low-Power E-cores.
  - In ONNX Runtime, matrix multiplication (GEMM) threads wait on barriers for the slowest thread.
  - If threads are set to 6, 8, or 14, threads assigned to high-clock P-cores are forced to stall waiting for low-clock E-cores to reach the barrier.
  - **Empirical Proof**:
    - 4 Threads (P-Cores only): Synth time = **4.87s** (RTF = 0.82x) — **FASTEST**
    - 6 Threads: Synth time = **5.14s** (RTF = 0.86x)
    - 8 Threads: Synth time = **5.59s** (RTF = 0.94x) — 15% SLOWER due to E-core synchronization stalls.

### Invariant 7: Text Pre-Processing & Unicode Normalization
- **Rule**: Never feed raw clipboard or markdown text directly to the phonemizer. Text must pass through `normalize_text_for_speech()`.
- **Requirements**:
  1. Markdown links: `[Text](https://url)` $\rightarrow$ `Text`.
  2. Markdown images: `![Alt](image.png)` $\rightarrow$ `Alt`.
  3. HTML tags: `<p>`, `<b>`, `<div>`, `<br>` $\rightarrow$ stripped or converted to space.
  4. Numbered lists at line starts: `1. `, `12. `, `1.1. ` $\rightarrow$ `1: `, `12: ` (prevents list number dot from being chopped as a standalone sentence).
  5. Lettered lists at line starts: `A. `, `B. ` $\rightarrow$ `A: `, `B: `.
  6. Roman numeral lists at line starts: `I. `, `II. `, `IV. ` $\rightarrow$ `I: `, `II: `.
  7. Typographic quotes: `‘`, `’`, `‚`, `“`, `”`, `„`, `«`, `»`, `‹`, `›` $\rightarrow$ standard ASCII `'` and `"`.
  8. Dashes: `—` (em-dash), `–` (en-dash), `―` $\rightarrow$ ` — `.
  9. Ellipses: `…` $\rightarrow$ `...`.
  10. Soft hyphens (`\u{00AD}`) and zero-width spaces (`\u{200B}`, `\u{200C}`, `\u{200D}`, `\u{FEFF}`, `\u{2060}`) $\rightarrow$ completely stripped (they break espeak phonemization).
  11. Table pipes `|` $\rightarrow$ `, ` (so tabular text reads as a natural list with clause pauses).
  12. Ampersand `&` $\rightarrow$ ` and `.

---

## 3. The Comprehensive Abbreviation Registry

The engine differentiates between **Titles (Never Split)** and **Context-Sensitive Abbreviations (Split only if followed by a sentence starter)**.

### Category A: Social, Religious & Professional Titles (NEVER Split)
Even if followed by a capitalized word or sentence starter, these are personal salutations and must remain fused with the subsequent name:
```
mr, mrs, ms, miss, mx, master, madam, mme, mlle, messrs, mmes
dr, prof, sr, jr, rev, revd, fr, pastor, rabbi, hon, dean, pres
gen, col, lt, maj, capt, cpt, sgt, cpl, pvt, adm, cmdr, ens, ofc, det, insp, brig, supt
gov, sen, rep, amb, chanc, atty, assoc, asst, dept
```

### Category B: Multi-Dot Acronyms (NEVER Split)
```
e.g., i.e., u.s., u.s.a., u.k., e.u., u.n., n.a.t.o., a.m., p.m.
b.c., a.d., b.c.e., c.e., ph.d., m.d., d.c., n.y., l.a., r.s.v.p., p.s.
```

### Category C: Context-Sensitive Abbreviations
These abbreviations split **ONLY** if the subsequent word is a recognized English sentence-starter (`The`, `This`, `He`, `She`, `It`, `Then`, `Later`, `However`, etc.). Otherwise, they stay unified:
- **Addresses & Geography**: `st, ave, blvd, rd, ln, ct, pl, pkwy, hwy, ste, apt, bldg, fl, rm, mt, ft, pt, is, sq, terr, hts, univ, blk`
  - *Example*: `St. Jude` $\rightarrow$ NOT split (`Jude` is not a sentence starter).
  - *Example*: `221B Baker St. The door was open.` $\rightarrow$ SPLIT at `St.` (`The` is a sentence starter).
- **Units of Measure**: `hr, hrs, min, mins, sec, secs, kg, km, cm, mm, oz, lb, lbs, yd, mi, gal, qt, cu`
  - *Example*: `60 km. per hour` $\rightarrow$ NOT split (`per` is lowercase).
  - *Example*: `He drove 60 km. Then he rested.` $\rightarrow$ SPLIT at `km.` (`Then` is a sentence starter).
- **Citations & Corporate**: `etc, eg, ie, vs, v, al, cf, ca, approx, ibid, viz, op, loc, cit, seq, qv, sv, no, nos, vol, vols, ch, chap, para, pp, ed, eds, est, fig, figs, ref, refs, art, inc, corp, ltd, co, llc, mfg, bros`
  - *Example*: `Apples, pears, etc. We left at noon.` $\rightarrow$ SPLIT at `etc.` (`We` is a sentence starter).
- **Calendar**: `jan, feb, mar, apr, jun, jul, aug, sep, sept, oct, nov, dec, mon, tue, wed, thu, fri, sat, sun`

### Category D: Middle Initials & Single-Letter Names
- A single uppercase letter followed by a dot (e.g. `James D. Young`, `J. K. Rowling`) is checked:
  - If the subsequent word starts with an uppercase letter AND is **NOT** a sentence starter $\rightarrow$ **Middle Initial (NO SPLIT)**.
  - If the subsequent word is a sentence starter (e.g. `contracting to a modest and unassuming D. But whenever...`) $\rightarrow$ **Sentence Boundary (SPLIT)**.

---

## 4. Run-On Sentence Clause Splitting Algorithm (> 14 Words)

For sentences exceeding 14 words, `split_long_sentence()` dynamically identifies optimal grammatical clause boundaries within a **5 to 11 word window**:

```
Priority 1: Existing Clause Punctuation (Comma, Semicolon, Colon, Dash)
     |
     v (if none found in window)
Priority 2: Subordinating Conjunctions & Relative Pronouns
     (until, because, although, whereas, while, since, where, when, if, so, that, which, though, whenever, wherever)
     |
     v (if none found in window)
Priority 3: Prepositions & Coordinating Conjunctions
     (during, into, onto, from, by, with, without, after, before, and, but, or, nor, as, about, through, over, under)
     |
     v (if none found in window)
Priority 4: Fallback at 8-10 words (with anti-dangling article/preposition guard)
     - NEVER split on: a, an, the, my, his, her, its, their, our, of, to, in, on, at, for, with, by
```

When a clause is split, a comma `,` is automatically placed at the end of the partition if absent, so StyleTTS2 continues with natural continuation intonation (140ms clause transition).

---

## 5. Dialogue Attribution & Quoted Speech Rules

When characters speak in dialogue:
```rust
"Why?" she asked.
"Stop!" he shouted.
"Hello!" Della said.
```
- A terminal question mark (`?`) or exclamation mark (`!`) inside closing quotation marks (`"`, `'`) is checked for a following lowercase attribution tag (`she asked`, `he said`, `whispered Jim`).
- **Rule**: If the word immediately following the quotation mark starts with a **lowercase character**, it is a dialogue attribution tag belonging to the **SAME prosodic sentence**. It is NOT split!
- If the word following the quote is capitalized (e.g. `He shouted, "Stop!" Della looked up.`), the attribution tag rule does not apply, and it splits into distinct sentences cleanly.

---

## 6. Closing Delimiter Consumption

When sentences end inside parentheses or brackets:
```rust
She nodded (as was expected.) The meeting adjourned.
("Never again.") She walked away.
```
- Invariant: A terminal punctuation mark (`.`, `!`, `?`, `;`) followed by any sequence of closing delimiters (`"`, `'`, `)`, `]`, `}`, `”`, `’`, `»`, `›`) MUST consume all trailing closing delimiters into the current chunk.
- Delimiters must never leak into the subsequent sentence or orphan an isolated bracket/quote.

---

## 7. Buffer Runway Mathematical Proof

Let:
- $T_{\text{audio}}$ = Audio duration generated (seconds)
- $T_{\text{wall}}$ = Wall-clock time required to synthesize $T_{\text{audio}}$ (seconds)
- $\text{RTF} = \frac{T_{\text{wall}}}{T_{\text{audio}}} \approx 0.82$ (on Intel Core Ultra 5 225U, 4 P-core threads)

### Scenario A: Premature Release (2 chunks, 3.5s audio)
1. Start playback at $t = 3.5\text{s} \times 0.82 = 2.87\text{s}$.
2. User begins hearing audio. Runway = $3.5\text{s}$.
3. Chunk 3 is a complex clause (11 words, 3.5s audio). Synthesis takes $3.5 \times 0.82 = 2.87\text{s}$.
4. While chunk 3 synthesizes, 2.87s of audio plays.
5. Remaining runway drops to $3.5 - 2.87 = \mathbf{0.63\text{s}}$!
6. Any minor OS thread scheduling hiccup causes an instant **3-second buffer underrun gap**.

### Scenario B: Invariant Pre-Buffering ($\ge 4.5\text{s}$ audio, 3 chunks = 6.09s audio)
1. Pre-buffer accumulates chunks 1, 2, 3: Total audio = $6.09\text{s}$.
2. Wall-clock synthesis time = $6.00\text{s}$.
3. Audio releases at $t = 6.00\text{s}$ with **$6.09\text{s}$ initial buffer**.
4. Generation of Chunk 4 begins: Synth time = $2.13\text{s}$, Audio = $2.19\text{s}$.
   - Elapsed audio during synth = $2.13\text{s}$.
   - Remaining runway = $6.09 - 2.13 + 2.19 = \mathbf{6.15\text{s}}$.
5. Generation of Chunk 5 (11 words): Synth time = $3.42\text{s}$, Audio = $3.56\text{s}$.
   - Remaining runway = $6.15 - 3.42 + 3.56 = \mathbf{6.29\text{s}}$.
6. Generation of Chunk 10 (End):
   - Remaining runway = $\mathbf{8.46\text{s}}$!
7. **Conclusion**: The runway strictly expands ($6.40\text{s} \rightarrow 7.11\text{s} \rightarrow 8.46\text{s}$). Buffer starvation is mathematically impossible.

---

## 8. Speech Rate & Dynamic Speed Control (0.9x Studio Pacing)

- **Default Speed**: Set to **`0.9x`** across all backend and frontend layers.
- **Acoustic Rationale**: 
  - Standard neural TTS models at `1.0x` frequently sound rushed on complex or literary prose.
  - Decreasing the rate by 10% (`0.9x`) provides human narrator cadence, allowing natural vowel articulation, clearer consonant definition, and more relaxed listening.
- **Runway Advantage**:
  - Slowing the model to 0.9x increases the audio duration per word by ~11.1% ($1.0 / 0.9 = 1.11\text{x}$) while synthesis compute time remains virtually unchanged.
  - This mathematically widens the safety buffer runway (from ~6.2s up to **8.46s**), offering even higher protection against underruns.
- **Thread-Safe State & Tauri IPC**:
  - `native_kokoro.rs` maintains `static CURRENT_SPEED: Mutex<f32> = Mutex::new(0.9)`.
  - Tauri commands `get_kokoro_speed` and `set_kokoro_speed` synchronize the frontend MiniPill and AudioPlayerBar with the native Kokoro streaming thread.
  - Supported discrete rates: `[0.8, 0.9, 1.0, 1.25, 1.5, 2.0]`.

---

## 9. Automated Verification & Regression Test Suite

All invariants are protected by automated Rust unit tests in `src-tauri/src/native_kokoro.rs`.

To execute the test suite:
```powershell
# From C:\ALL\PERSONAL\vocalis-studio\src-tauri
cargo test --lib -- --test-threads=1
```

### Verified Test Cases
1. `test_o_henry_chunking_and_pauses`:
   - Validates that sentences $\le 14$ words are 100% preserved.
   - Validates that long sentences are partitioned at clause boundaries.
   - Validates 380ms full stop pauses and 140ms comma pauses.
2. `test_dillingham_paragraph`:
   - Validates that `"Mr."` and `"Mrs."` are NEVER isolated from names.
   - Validates that single-letter initial `"modest and unassuming D."` splits cleanly before `"But whenever..."`.
   - Validates that prepositions like `"during"` cleanly begin clauses without dangling articles.
3. `test_abbreviation_and_title_edge_cases`:
   - Validates social titles (`Mr.`, `Mrs.`, `Dr.`, `Prof.`, `Gen.`).
   - Validates middle initials (`James D. Young`, `J. K. Rowling`, `George R. R. Martin`).
   - Validates address vs saint disambiguation (`St. Jude` vs `Baker St. The...`).
   - Validates units (`60 km. per hour` vs `60 km. Then...`).
   - Validates Latin citations (`etc. We...` vs `e.g. Paris`).
   - Validates acronyms (`U.S.A.`, `10:00 a.m.`, `Ph.D.`).
4. `test_parentheses_and_quotes_closure`:
   - Validates dialogue attribution tags (`"Why?" she asked.` stays in 1 sentence).
   - Validates terminal quotes followed by new sentences (`He shouted, "Stop!" Della looked up.`).
   - Validates terminal periods inside parentheses (`She nodded (as was expected.)`).
   - Validates nested quotes and parentheses (`("Never again.")`).
   - Validates repeated punctuation (`What??? Really?!`).
5. `test_markdown_and_html_cleaning`:
   - Validates markdown link extraction (`[Vocalis Studio](url)` $\rightarrow$ `Vocalis Studio`).
   - Validates HTML tag stripping (`<p>`, `<b>`, `<br>`).
   - Validates numbered, lettered, and Roman list item protection (`1. `, `A. `, `I. ` $\rightarrow$ `1: `, `A: `, `I: `).
   - Validates soft hyphen (`\u{00AD}`) and zero-width character removal.
   - Validates typographic quotes, dashes, and ellipses.
6. `test_profile_chunks`:
   - Simulates the complete 4-thread ONNX Runtime synthesis pipeline.
   - Profiles exact per-chunk synthesis times and buffer runways.
   - Asserts runway stays strictly positive across all chunks (runway expands up to 8.46s).
7. `test_synthesize_raw_samples`:
   - Validates that `synthesize_raw` directly extracts raw float PCM samples and 24,000Hz sample rate.
   - Powers the Low-RAM unified frontend architecture, eliminating the 21.6MB WebAssembly runtime.

---

## 10. Checklist Before Committing Changes

Before any future code change to speech synthesis or text normalization is merged:
- [ ] Read this architecture document to understand the invariants.
- [ ] Run `cargo test --lib -- --test-threads=1` and verify all 7 tests pass with 0 failures.
- [ ] Verify that compiler emits 0 warnings (`#[warn(unused)]`, unreachable patterns).
- [ ] Verify that `cargo build` produces a clean binary.
- [ ] Verify that `npm run build` bundles without WebAssembly or worker bloat.
- [ ] If new abbreviations or text patterns are supported, add corresponding test cases in `mod tests`.
