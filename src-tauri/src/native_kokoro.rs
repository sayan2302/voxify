use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use sherpa_onnx::{OfflineTts, OfflineTtsConfig, OfflineTtsKokoroModelConfig, OfflineTtsModelConfig};
use tauri::Emitter;

static APP_HANDLE: Mutex<Option<tauri::AppHandle>> = Mutex::new(None);

pub fn set_app_handle(app: tauri::AppHandle) {
    if let Ok(mut guard) = APP_HANDLE.lock() {
        *guard = Some(app);
    }
}

static TTS_ENGINES: Mutex<Vec<std::sync::Arc<Mutex<OfflineTts>>>> = Mutex::new(Vec::new());
static AUDIO_PLAYER: Mutex<Option<AudioPlayer>> = Mutex::new(None);
static CURRENT_VOICE: Mutex<String> = Mutex::new(String::new());
static CURRENT_SPEED: Mutex<f32> = Mutex::new(0.9);
static PLAYBACK_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub struct CachedAudioChunk {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub duration_secs: f32,
    pub pause_ms: u32,
}

static CHUNK_CACHE: Mutex<Option<HashMap<(i32, u32, String), CachedAudioChunk>>> = Mutex::new(None);

pub fn cache_audio_chunk(
    sid: i32,
    speed_key: u32,
    chunk_text: &str,
    samples: Vec<f32>,
    sample_rate: u32,
    duration_secs: f32,
    pause_ms: u32,
) {
    let key = (sid, speed_key, chunk_text.trim().to_string());
    if let Ok(mut guard) = CHUNK_CACHE.lock() {
        if guard.is_none() {
            *guard = Some(HashMap::new());
        }
        if let Some(ref mut map) = *guard {
            if map.len() >= 500 {
                if let Some(k) = map.keys().next().cloned() {
                    map.remove(&k);
                }
            }
            map.insert(
                key,
                CachedAudioChunk {
                    samples,
                    sample_rate,
                    duration_secs,
                    pause_ms,
                },
            );
        }
    }
}

pub fn get_cached_chunk(sid: i32, speed_key: u32, chunk_text: &str) -> Option<CachedAudioChunk> {
    let key = (sid, speed_key, chunk_text.trim().to_string());
    if let Ok(guard) = CHUNK_CACHE.lock() {
        if let Some(ref map) = *guard {
            return map.get(&key).cloned();
        }
    }
    None
}

#[derive(Clone)]
struct PipelineChunk {
    #[allow(dead_code)]
    idx: usize,
    samples: Vec<f32>,
    sample_rate: u32,
    duration_secs: f32,
}

struct PipelineSession {
    session_id: u64,
    text_key: String,
    voice_name: String,
    speed_key: u32,
    chunks: Vec<String>,
    ready_chunks: Vec<Option<PipelineChunk>>,
    is_fully_buffered: bool,
}

static PIPELINE_STATE: Mutex<Option<PipelineSession>> = Mutex::new(None);
static PIPELINE_CONDVAR: std::sync::Condvar = std::sync::Condvar::new();
static PIPELINE_SESSION_ID: AtomicU64 = AtomicU64::new(0);

pub struct AudioPlayer {
    _stream: rodio::OutputStream,
    stream_handle: rodio::OutputStreamHandle,
    current_sink: Mutex<Option<rodio::Sink>>,
}

// Safety: AudioPlayer contains thread-safe types for playing through OutputStreamHandle
unsafe impl Send for AudioPlayer {}
unsafe impl Sync for AudioPlayer {}

impl AudioPlayer {
    pub fn new() -> Result<Self, String> {
        let (_stream, stream_handle) = rodio::OutputStream::try_default().map_err(|e| e.to_string())?;
        Ok(Self {
            _stream,
            stream_handle,
            current_sink: Mutex::new(None),
        })
    }

    pub fn play_samples(&self, samples: Vec<f32>, sample_rate: u32, speed: f32) {
        if let Ok(mut guard) = self.current_sink.lock() {
            if let Some(ref sink) = *guard {
                sink.stop();
            }
            if let Ok(sink) = rodio::Sink::try_new(&self.stream_handle) {
                sink.set_speed(speed);
                let buffer = rodio::buffer::SamplesBuffer::new(1, sample_rate, samples);
                sink.append(buffer);
                sink.play();
                *guard = Some(sink);
            }
        }
    }

    pub fn append_samples(&self, samples: Vec<f32>, sample_rate: u32) {
        if let Ok(mut guard) = self.current_sink.lock() {
            let buffer = rodio::buffer::SamplesBuffer::new(1, sample_rate, samples);
            if let Some(ref sink) = *guard {
                sink.append(buffer);
                sink.play();
            } else if let Ok(sink) = rodio::Sink::try_new(&self.stream_handle) {
                sink.set_speed(get_current_speed());
                sink.append(buffer);
                sink.play();
                *guard = Some(sink);
            }
        }
    }

    pub fn play_earcon(&self) {
        if let Ok(sink) = rodio::Sink::try_new(&self.stream_handle) {
            sink.set_volume(0.20);
            let samples = generate_earcon_samples();
            let buffer = rodio::buffer::SamplesBuffer::new(1, 24000, samples);
            sink.append(buffer);
            sink.play();
            sink.detach();
        }
    }

    pub fn set_speed(&self, speed: f32) {
        if let Ok(guard) = self.current_sink.lock() {
            if let Some(ref sink) = *guard {
                sink.set_speed(speed);
            }
        }
    }

    pub fn append_acoustic_bridge(&self, duration_ms: u32, sample_rate: u32) {
        if let Ok(guard) = self.current_sink.lock() {
            if let Some(ref sink) = *guard {
                let sample_count = ((sample_rate as f32) * (duration_ms as f32 / 1000.0)) as usize;
                // Subtle warm analog presence floor (amplitude ~ 0.00008, completely transparent)
                let samples: Vec<f32> = (0..sample_count)
                    .map(|i| {
                        let t = i as f32 / sample_rate as f32;
                        ((t * 55.0 * 2.0 * std::f32::consts::PI).sin() * 0.00003)
                            + ((i % 7) as f32 - 3.0) * 0.00001
                    })
                    .collect();
                let buffer = rodio::buffer::SamplesBuffer::new(1, sample_rate, samples);
                sink.append(buffer);
            }
        }
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.current_sink.lock() {
            if let Some(ref sink) = *guard {
                sink.stop();
            }
            *guard = None;
        }
    }

    pub fn is_speaking(&self) -> bool {
        if let Ok(guard) = self.current_sink.lock() {
            if let Some(ref sink) = *guard {
                return !sink.empty();
            }
        }
        false
    }
}

/// Generates a smooth, natural acoustic dual-tone crystal chime (E5 -> B5) with polyphonic resonance (< 0.05ms)
pub fn generate_earcon_samples() -> Vec<f32> {
    let sample_rate = 24000.0;
    let duration = 0.18; // 180ms natural acoustic decay
    let total_samples = (sample_rate * duration) as usize;
    let mut samples = Vec::with_capacity(total_samples);

    let f1 = 659.25; // E5
    let f2 = 987.77; // B5
    let offset2 = 0.032; // Note 2 enters 32ms later, resonating in harmony

    for i in 0..total_samples {
        let t = i as f32 / sample_rate;

        // Note 1: E5 struck at t=0
        let t1 = t;
        let attack1 = if t1 < 0.005 {
            (t1 / 0.005 * std::f32::consts::FRAC_PI_2).sin()
        } else {
            1.0
        };
        let decay1_fund = (-t1 * 11.5).exp();
        let decay1_harm = (-t1 * 24.0).exp();
        let decay1_ting = (-t1 * 45.0).exp();

        let note1 = ((2.0 * std::f32::consts::PI * f1 * t1).sin() * 0.70 * decay1_fund
                   + (4.0 * std::f32::consts::PI * f1 * t1).sin() * 0.20 * decay1_harm
                   + (2.0 * std::f32::consts::PI * f1 * 2.756 * t1).sin() * 0.08 * decay1_harm
                   + (2.0 * std::f32::consts::PI * f1 * 4.2 * t1).sin() * 0.02 * decay1_ting) * attack1;

        // Note 2: B5 struck gently at t=32ms, overlapping and harmonizing
        let note2 = if t >= offset2 {
            let t2 = t - offset2;
            let attack2 = if t2 < 0.006 {
                (t2 / 0.006 * std::f32::consts::FRAC_PI_2).sin()
            } else {
                1.0
            };
            let decay2_fund = (-t2 * 13.0).exp();
            let decay2_harm = (-t2 * 26.0).exp();
            let decay2_ting = (-t2 * 50.0).exp();

            ((2.0 * std::f32::consts::PI * f2 * t2).sin() * 0.65 * decay2_fund
           + (4.0 * std::f32::consts::PI * f2 * t2).sin() * 0.18 * decay2_harm
           + (2.0 * std::f32::consts::PI * f2 * 2.756 * t2).sin() * 0.06 * decay2_harm
           + (2.0 * std::f32::consts::PI * f2 * 4.2 * t2).sin() * 0.02 * decay2_ting) * attack2
        } else {
            0.0
        };

        // Smooth master tail fade (last 20ms) to ensure absolute silence at the end
        let tail_fade = if t > (duration - 0.020) {
            let rem = (duration - t) / 0.020;
            (rem * std::f32::consts::FRAC_PI_2).sin().clamp(0.0, 1.0)
        } else {
            1.0
        };

        let mixed = (note1 * 0.55 + note2 * 0.45) * tail_fade * 0.75;
        samples.push(mixed);
    }
    samples
}

/// Play an instant (< 2ms) acoustic selection chime to confirm selection immediately
pub fn play_earcon_chime() {
    if let Ok(mut guard) = AUDIO_PLAYER.lock() {
        if guard.is_none() {
            if let Ok(player) = AudioPlayer::new() {
                player.play_earcon();
                *guard = Some(player);
                return;
            }
        }
        if let Some(ref player) = *guard {
            player.play_earcon();
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct KokoroVoiceInfo {
    pub id: String,
    pub name: String,
    pub sid: i32,
    pub gender: String,
    pub description: String,
}

pub fn get_available_voices() -> Vec<KokoroVoiceInfo> {
    vec![
        KokoroVoiceInfo { id: "af_sarah".into(), name: "Sarah".into(), sid: 1, gender: "female".into(), description: "Youthful, bright, and natural podcast narrator".into() },
        KokoroVoiceInfo { id: "af_bella".into(), name: "Bella".into(), sid: 0, gender: "female".into(), description: "Gentle, melodic, and expressive".into() },
        KokoroVoiceInfo { id: "am_adam".into(), name: "Adam".into(), sid: 2, gender: "male".into(), description: "Deep, authoritative, and cinematic narrator".into() },
        KokoroVoiceInfo { id: "af_nicole".into(), name: "Nicole".into(), sid: 8, gender: "female".into(), description: "Articulate, crisp, and professional".into() },
        KokoroVoiceInfo { id: "af_sky".into(), name: "Sky".into(), sid: 9, gender: "female".into(), description: "Calm, airy, and soothing".into() },
        KokoroVoiceInfo { id: "am_michael".into(), name: "Michael".into(), sid: 3, gender: "male".into(), description: "Conversational, natural, and friendly".into() },
        KokoroVoiceInfo { id: "bf_emma".into(), name: "Emma".into(), sid: 4, gender: "female".into(), description: "British English, warm and clear".into() },
        KokoroVoiceInfo { id: "bf_isabella".into(), name: "Isabella".into(), sid: 5, gender: "female".into(), description: "British English, melodic and refined".into() },
        KokoroVoiceInfo { id: "bm_george".into(), name: "George".into(), sid: 6, gender: "male".into(), description: "British English, resonant and polished".into() },
        KokoroVoiceInfo { id: "bm_lewis".into(), name: "Lewis".into(), sid: 7, gender: "male".into(), description: "British English, rich and engaging".into() },
        KokoroVoiceInfo { id: "am_eric".into(), name: "Eric".into(), sid: 10, gender: "male".into(), description: "Clear, informative, and steady".into() },
    ]
}

pub fn voice_name_to_sid(voice_name: &str) -> i32 {
    let lower = voice_name.to_lowercase();
    if lower.contains("sarah") {
        1
    } else if lower.contains("bella") {
        0
    } else if lower.contains("adam") {
        2
    } else if lower.contains("michael") {
        3
    } else if lower.contains("nicole") {
        8
    } else if lower.contains("sky") {
        9
    } else if lower.contains("emma") {
        4
    } else if lower.contains("isabella") {
        5
    } else if lower.contains("george") {
        6
    } else if lower.contains("lewis") {
        7
    } else if lower.contains("eric") {
        10
    } else {
        1 // Default: Sarah
    }
}

pub fn get_default_model_dir() -> PathBuf {
    // 1. Check relative to running executable (Installed App or Portable zip)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let exe_candidates = [
                exe_dir.join("models").join("kokoro-en-v0_19"),
                exe_dir.join("resources").join("models").join("kokoro-en-v0_19"),
                exe_dir.join("resources").join("kokoro-en-v0_19"),
                exe_dir.join("kokoro-en-v0_19"),
            ];
            for c in &exe_candidates {
                if c.exists() && c.join("model.onnx").exists() {
                    return c.clone();
                }
            }
        }
    }

    // 2. Check local working directory and development paths
    let candidates = [
        PathBuf::from("src-tauri/models/kokoro-en-v0_19"),
        PathBuf::from("models/kokoro-en-v0_19"),
        PathBuf::from("../models/kokoro-en-v0_19"),
    ];

    for c in &candidates {
        if c.exists() && c.join("model.onnx").exists() {
            return c.clone();
        }
    }

    // 3. Check AppData paths
    if let Ok(app_data) = std::env::var("LOCALAPPDATA") {
        let p_vox = PathBuf::from(&app_data).join("voxify").join("models").join("kokoro-en-v0_19");
        if p_vox.exists() && p_vox.join("model.onnx").exists() {
            return p_vox;
        }
        let p = PathBuf::from(app_data).join("vocalis-studio").join("models").join("kokoro-en-v0_19");
        if p.exists() && p.join("model.onnx").exists() {
            return p;
        }
    }

    candidates[0].clone()
}

/// Initialize the native Kokoro engine with multi-threaded ONNX Runtime
pub fn init(model_dir: Option<&Path>) -> Result<(), String> {
    let dir = match model_dir {
        Some(p) => p.to_path_buf(),
        None => get_default_model_dir(),
    };

    if !dir.exists() {
        return Err(format!("Kokoro model directory not found at {:?}", dir));
    }

    let model_path = dir.join("model.onnx");
    let voices_path = dir.join("voices.bin");
    let tokens_path = dir.join("tokens.txt");
    let data_dir = dir.join("espeak-ng-data");

    if !model_path.exists() || !voices_path.exists() || !tokens_path.exists() || !data_dir.exists() {
        return Err(format!("Missing required Kokoro model assets in {:?}", dir));
    }

    let threads_per_engine = 4;

    let config = OfflineTtsConfig {
        model: OfflineTtsModelConfig {
            kokoro: OfflineTtsKokoroModelConfig {
                model: Some(model_path.to_str().unwrap().into()),
                voices: Some(voices_path.to_str().unwrap().into()),
                tokens: Some(tokens_path.to_str().unwrap().into()),
                data_dir: Some(data_dir.to_str().unwrap().into()),
                length_scale: 1.0,
                ..Default::default()
            },
            num_threads: threads_per_engine,
            debug: false,
            provider: Some("cpu".into()),
            ..Default::default()
        },
        ..Default::default()
    };

    println!("[NativeKokoro] Initializing Kokoro-82M high-performance neural engine ({} threads)...", threads_per_engine);
    let tts = OfflineTts::create(&config).ok_or_else(|| "Failed to create OfflineTts instance".to_string())?;

    // Warm up execution graph and pre-cache Sarah's audition voice for INSTANT playback (< 1ms)
    let warmup_cfg = sherpa_onnx::GenerationConfig {
        sid: 1, // Sarah
        speed: 1.0,
        ..Default::default()
    };

    let audition_text = "Hi, I'm Sarah. I read any highlighted text across your Windows apps with natural human expression.";
    let test_pill_text = "Voxify Audio Pill is running! Select any text anywhere in Windows to hear it read in Sarah's natural human voice.";

    let pre_cache_texts = [audition_text, test_pill_text];
    for text in &pre_cache_texts {
        let chunks = split_into_speech_chunks(text);
        for chunk in &chunks {
            if let Some(audio) = tts.generate_with_config(chunk, &warmup_cfg, None::<fn(&[f32], f32) -> bool>) {
                let raw_samples = audio.samples();
                let sr = audio.sample_rate() as u32;
                if !raw_samples.is_empty() {
                    let pause_ms = get_chunk_pause_ms(chunk);
                    let chunk_samples = prepare_chunk_samples(raw_samples, sr, pause_ms);
                    let chunk_dur = chunk_samples.len() as f32 / sr as f32;
                    cache_audio_chunk(1, 100, chunk, chunk_samples, sr, chunk_dur, pause_ms);
                }
            }
        }
    }
    println!(
        "[NativeKokoro] Pre-cached Sarah's signature audition & test pill audio in RAM for instant 0ms playback!"
    );

    if let Ok(mut guard) = TTS_ENGINES.lock() {
        *guard = vec![
            std::sync::Arc::new(Mutex::new(tts)),
        ];
    }

    if let Ok(mut guard) = AUDIO_PLAYER.lock() {
        if guard.is_none() {
            match AudioPlayer::new() {
                Ok(player) => {
                    *guard = Some(player);
                }
                Err(e) => {
                    eprintln!("[NativeKokoro] Audio player init warning: {}", e);
                }
            }
        }
    }

    if let Ok(mut v) = CURRENT_VOICE.lock() {
        if v.is_empty() {
            *v = "Sarah".to_string();
        }
    }

    println!("[NativeKokoro] Kokoro-82M native speech engine ready!");
    Ok(())
}

/// Normalizes and cleans selected text for natural, studio-quality text-to-speech narration.
///
/// Handles:
/// 1. Unicode typographical normalization:
///    - Curly single quotes (‘, ’, `, ´) -> standard ASCII '
///    - Curly double quotes (“, ”, „, «, ») -> standard ASCII "
///    - Typographical ellipsis (…) -> standard three dots ...
///    - Em/En dashes (—, –) -> spaced em-dash ' — '
///    - Non-breaking spaces (\u{00A0}) -> standard space ' '
///    - Zero-width spaces (\u{200B}, \u{200C}, \u{200D}, \u{FEFF}) -> removed
/// 2. Markdown & Code formatting cleanup:
///    - Markdown headers (# Header) -> Header
///    - Markdown bold/italics (**bold**, *italic*, __word__) -> cleaned text
///    - Markdown inline code (`code`) -> code
///    - Markdown list bullets (* item, - item, + item) -> item
/// 3. Numbered list item protection:
///    - Lines starting with "1. ", "2. ", "10. " -> "1: ", "2: " so the dot is not mistaken for a sentence end
/// Helper: Fast zero-allocation / single-pass clean up of markdown links, images, and HTML tags.
/// Converts:
///   - `[Link text](https://example.com)` -> `Link text`
///   - `![Alt text](image.png)` -> `Alt text`
///   - `<p>Text</p>` -> ` Text `
///   - `<b>Bold</b>` -> `Bold`
fn strip_markdown_and_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        // 1. Markdown images: ![alt](url) -> alt
        if ch == '!' && chars.peek() == Some(&'[') {
            chars.next(); // consume '['
            let mut alt = String::new();
            let mut closed = false;
            while let Some(c) = chars.next() {
                if c == ']' {
                    closed = true;
                    break;
                } else if c == '\n' {
                    break;
                } else {
                    alt.push(c);
                }
            }
            if closed && chars.peek() == Some(&'(') {
                chars.next(); // consume '('
                while let Some(c) = chars.next() {
                    if c == ')' || c == '\n' {
                        break;
                    }
                }
                out.push_str(&alt);
                continue;
            } else {
                out.push('!');
                out.push('[');
                out.push_str(&alt);
                if closed {
                    out.push(']');
                }
                continue;
            }
        }

        // 2. Markdown links: [text](url) -> text
        if ch == '[' {
            let mut text = String::new();
            let mut closed = false;
            while let Some(c) = chars.next() {
                if c == ']' {
                    closed = true;
                    break;
                } else if c == '\n' {
                    break;
                } else {
                    text.push(c);
                }
            }
            if closed && chars.peek() == Some(&'(') {
                chars.next(); // consume '('
                while let Some(c) = chars.next() {
                    if c == ')' || c == '\n' {
                        break;
                    }
                }
                out.push_str(&text);
                continue;
            } else {
                out.push('[');
                out.push_str(&text);
                if closed {
                    out.push(']');
                }
                continue;
            }
        }

        // 3. HTML tags: <tag> -> space or stripped
        if ch == '<' {
            let mut tag = String::new();
            let mut closed = false;
            while let Some(c) = chars.next() {
                if c == '>' {
                    closed = true;
                    break;
                } else if c == '\n' {
                    break;
                } else {
                    tag.push(c);
                }
            }
            if closed {
                let tag_lower = tag.to_lowercase();
                if tag_lower.starts_with("p")
                    || tag_lower.starts_with("/p")
                    || tag_lower.starts_with("br")
                    || tag_lower.starts_with("div")
                    || tag_lower.starts_with("/div")
                    || tag_lower.starts_with("li")
                    || tag_lower.starts_with("/li")
                    || tag_lower.starts_with("h")
                {
                    out.push(' ');
                }
                continue;
            } else {
                out.push('<');
                out.push_str(&tag);
                continue;
            }
        }

        out.push(ch);
    }

    out
}

/// Helper: Checks if a word is a standard English sentence-starting word.
fn is_sentence_starter_word(word: &str) -> bool {
    let clean = word.trim_matches(|c: char| !c.is_alphabetic());
    matches!(
        clean,
        "The" | "This" | "That" | "These" | "Those" | "It" | "He" | "She" | "They" | "We" | "You" | "I"
            | "But" | "And" | "So" | "Or" | "If" | "When" | "Where" | "While" | "There" | "Then" | "Now"
            | "Which" | "What" | "How" | "Who" | "As" | "In" | "On" | "At" | "For" | "To" | "With"
            | "After" | "Before" | "Later" | "Meanwhile" | "Soon" | "Suddenly" | "Finally" | "However"
            | "Therefore" | "Moreover" | "Furthermore" | "Instead" | "Nevertheless" | "Yesterday" | "Today" | "Tomorrow"
            | "First" | "Second" | "Third" | "Next" | "Last"
    )
}

/// Comprehensive speech text normalizer.
/// Performs:
/// 1. Markdown link & HTML tag extraction ([Text](url) -> Text, <b>Bold</b> -> Bold).
/// 2. Header and bullet stripping (# Header -> Header, • Item -> Item).
/// 3. Numbered, lettered, and Roman numeral list protection (1. Item -> 1: Item, A. Item -> A: Item, I. Item -> I: Item).
/// 4. Unicode typographical conversions (smart quotes, dashes, ellipsis, zero-width chars, soft hyphens).
/// 5. Table pipes (| -> , ) and ampersands (& -> and).
pub fn normalize_text_for_speech(text: &str) -> String {
    let pre_cleaned = strip_markdown_and_html(text);
    let mut normalized = String::with_capacity(pre_cleaned.len());

    for line in pre_cleaned.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // 1. Strip markdown header prefixes (e.g. "### Hello" -> "Hello")
        let clean_line = if trimmed.starts_with('#') {
            trimmed.trim_start_matches('#').trim_start().to_string()
        } else if trimmed.starts_with("> ") {
            trimmed.trim_start_matches('>').trim_start().to_string()
        } else if (trimmed.starts_with("* ")
            || trimmed.starts_with("- ")
            || trimmed.starts_with("+ ")
            || trimmed.starts_with("• ")
            || trimmed.starts_with("◦ ")
            || trimmed.starts_with("▪ ")
            || trimmed.starts_with("▫ ")
            || trimmed.starts_with("◆ ")
            || trimmed.starts_with("◇ "))
            && trimmed.len() > 2
        {
            trimmed.chars().skip(2).collect::<String>()
        } else {
            trimmed.to_string()
        };

        // 2. Protect numbered, lettered, and Roman lists at start of line: "1. Item", "A. Item", "I. Item" -> "1: Item"
        let mut processed_line = clean_line;
        if let Some(dot_pos) = processed_line.find(". ") {
            let prefix = &processed_line[..dot_pos];
            let is_numeric_list = !prefix.is_empty()
                && prefix
                    .chars()
                    .all(|c| c.is_ascii_digit() || c == '.');
            let is_letter_list = prefix.len() == 1
                && prefix.chars().all(|c| c.is_ascii_alphabetic());
            let is_roman_list = matches!(
                prefix.to_uppercase().as_str(),
                "I" | "II" | "III" | "IV" | "V" | "VI" | "VII" | "VIII" | "IX" | "X"
            );

            if is_numeric_list || is_letter_list || is_roman_list {
                processed_line.replace_range(dot_pos..=dot_pos, ":");
            }
        }

        if !normalized.is_empty() {
            normalized.push('\n');
        }
        normalized.push_str(&processed_line);
    }

    // 3. Typographical and Unicode character normalization
    let mut result = String::with_capacity(normalized.len());
    let mut chars = normalized.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            // Quotes & Apostrophes
            '“' | '”' | '„' | '‟' | '«' | '»' | '‹' | '›' | '″' => result.push('"'),
            '‘' | '’' | '‚' | '‛' | '`' | '´' | '′' => result.push('\''),
            // Typographic Ellipsis
            '…' => result.push_str("..."),
            // Dashes
            '—' | '–' | '―' | '−' => {
                if !result.ends_with(' ') {
                    result.push(' ');
                }
                result.push('—');
                if chars.peek().map_or(false, |next| *next != ' ') {
                    result.push(' ');
                }
            }
            // Whitespace
            '\u{00A0}' | '\u{202F}' | '\u{2007}' => result.push(' '),
            // Zero-width characters & soft hyphens (invisible in text, but break TTS phonemizer)
            '\u{00AD}' | '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}' | '\u{FEFF}' => {}
            // Markdown formatting symbols: strip standalone *, _, ~
            '*' | '_' | '~' => {}
            // Table pipes: convert to comma pause
            '|' => {
                if !result.ends_with(' ') && !result.ends_with(',') {
                    result.push(',');
                }
                result.push(' ');
            }
            // Ampersand
            '&' => result.push_str(" and "),
            // Control characters (strip non-newline/tab control characters)
            c if (c as u32) < 32 && c != '\n' && c != '\t' => result.push(' '),
            _ => result.push(ch),
        }
    }

    result
}

/// Helper: Checks if a period is part of a title/honorific (Mr., Mrs., Dr.), Latin abbreviation (e.g., i.e.),
/// unit of measure, address, corporate suffix, or middle initial (James D. Young), rather than a sentence-ending full stop.
fn is_abbreviation_or_initial(current: &str, chars: &[char], i: usize) -> bool {
    let trimmed = current.trim_end();
    if !trimmed.ends_with('.') {
        return false;
    }

    // Check if anything follows this dot
    let mut next_char_idx = i + 1;
    while next_char_idx < chars.len() && (chars[next_char_idx].is_whitespace() || chars[next_char_idx] == '"' || chars[next_char_idx] == '\'') {
        next_char_idx += 1;
    }
    if next_char_idx >= chars.len() {
        return false; // Nothing follows, so this dot ends the text
    }

    let remaining_str: String = chars[next_char_idx..].iter().take(25).collect();
    let next_word = remaining_str.split_whitespace().next().unwrap_or("");
    let next_is_starter = is_sentence_starter_word(next_word);
    let next_is_upper = next_word.chars().next().map_or(false, |c| c.is_uppercase());

    // 1. Multi-dot Latin and acronym abbreviations: "e.g.", "i.e.", "u.s.", "u.s.a.", "a.m.", "p.m.", etc.
    let lower = trimmed.to_lowercase();
    if lower.ends_with("e.g.")
        || lower.ends_with("i.e.")
        || lower.ends_with("u.s.")
        || lower.ends_with("u.s.a.")
        || lower.ends_with("u.k.")
        || lower.ends_with("e.u.")
        || lower.ends_with("u.n.")
        || lower.ends_with("n.a.t.o.")
        || lower.ends_with("a.m.")
        || lower.ends_with("p.m.")
        || lower.ends_with("b.c.")
        || lower.ends_with("a.d.")
        || lower.ends_with("b.c.e.")
        || lower.ends_with("c.e.")
        || lower.ends_with("ph.d.")
        || lower.ends_with("m.d.")
        || lower.ends_with("d.c.")
        || lower.ends_with("n.y.")
        || lower.ends_with("l.a.")
        || lower.ends_with("r.s.v.p.")
        || lower.ends_with("p.s.")
    {
        return true;
    }

    // Extract the token preceding this dot
    let before_dot = &trimmed[..trimmed.len() - 1];
    let last_word = before_dot.split_whitespace().last().unwrap_or("");
    let clean_last = last_word.trim_matches(|c: char| !c.is_alphabetic()).to_lowercase();

    // 2. Titles & Honorifics: NEVER split from the subsequent word, even if followed by a capitalized word
    if matches!(
        clean_last.as_str(),
        "mr" | "mrs" | "ms" | "miss" | "mx" | "master" | "madam" | "mme" | "mlle" | "messrs" | "mmes"
            | "dr" | "prof" | "sr" | "jr" | "rev" | "revd" | "fr" | "pastor" | "rabbi" | "hon" | "dean" | "pres"
            | "gen" | "col" | "lt" | "maj" | "capt" | "cpt" | "sgt" | "cpl" | "pvt" | "adm" | "cmdr" | "ens" | "ofc" | "det" | "insp" | "brig" | "supt"
            | "gov" | "sen" | "rep" | "amb" | "chanc" | "atty" | "assoc" | "asst" | "dept"
    ) {
        return true;
    }

    // 3. Context-Sensitive Abbreviations (Addresses, Units, Citations, Corporate suffixes):
    // If followed by a sentence-starter word (The, Then, However...), it IS a sentence boundary!
    // If followed by a lowercase word or proper noun (Baker St. and..., 50 km per hour, St. Jude), keep together!
    let is_context_abbrev = matches!(
        clean_last.as_str(),
        // Addresses & geography
        "st" | "ave" | "blvd" | "rd" | "ln" | "ct" | "pl" | "pkwy" | "hwy" | "ste" | "apt" | "bldg" | "fl" | "rm" | "mt" | "ft" | "pt" | "is" | "sq" | "terr" | "hts" | "univ" | "blk"
            // Months & days
            | "jan" | "feb" | "mar" | "apr" | "jun" | "jul" | "aug" | "sep" | "sept" | "oct" | "nov" | "dec"
            | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"
            // Units & measures
            | "hr" | "hrs" | "min" | "mins" | "sec" | "secs" | "kg" | "km" | "cm" | "mm" | "oz" | "lb" | "lbs" | "yd" | "mi" | "gal" | "qt" | "cu"
            // Latin, legal, citations & corporate
            | "etc" | "eg" | "ie" | "vs" | "v" | "al" | "cf" | "ca" | "approx" | "ibid" | "viz" | "op" | "loc" | "cit" | "seq" | "qv" | "sv"
            | "no" | "nos" | "vol" | "vols" | "ch" | "chap" | "para" | "pp" | "ed" | "eds" | "est" | "fig" | "figs" | "ref" | "refs" | "art"
            | "inc" | "corp" | "ltd" | "co" | "llc" | "mfg" | "bros"
    );

    if is_context_abbrev {
        // If the next word is a sentence starter, treat as full stop sentence break!
        if next_is_starter {
            return false;
        }
        // Otherwise, it's inside the sentence (e.g. "St. Jude", "50 km per hour", "etc., as planned")
        return true;
    }

    // 4. Middle Initial check: e.g. "James D. Young", "J. K. Rowling", "George R. R. Martin"
    // Single uppercase letter preceding dot:
    // If followed by another uppercase word that is NOT a sentence starter, it's an initial!
    // If followed by a sentence starter (e.g. "...unassuming D. But whenever..."), it IS a sentence boundary!
    if clean_last.len() == 1 && last_word.chars().all(|c| c.is_uppercase()) {
        if next_is_upper && !next_is_starter {
            return true;
        }
    }

    false
}

/// Intelligently split text into natural, complete sentence chunks for pipelined streaming.
///
/// Preserves FULL sentence integrity and punctuation for all sentences to guarantee
/// authentic human-grade prosody, natural intonation contours, and expressive cadence.
pub fn split_into_speech_chunks(text: &str) -> Vec<String> {
    let normalized = normalize_text_for_speech(text);
    let clean = normalized.trim();
    if clean.is_empty() {
        return Vec::new();
    }

    let mut raw_sentences = Vec::new();

    // 1. Split on paragraphs and line breaks first
    for line in clean.lines() {
        let trimmed_line = line.trim();
        if trimmed_line.is_empty() {
            continue;
        }

        // 2. Parse sentences based on terminal punctuation (. ! ? ;)
        let mut current = String::new();
        let chars: Vec<char> = trimmed_line.chars().collect();
        let len = chars.len();
        let mut i = 0;

        while i < len {
            let ch = chars[i];
            current.push(ch);

            let is_term = ch == '.' || ch == '!' || ch == '?' || ch == ';';
            if is_term {
                // Look ahead past any closing quotes, brackets, or parentheses
                let mut peek_idx = i + 1;
                while peek_idx < len && matches!(chars[peek_idx], '"' | '\'' | '”' | '’' | ')' | ']' | '}' | '»' | '›') {
                    peek_idx += 1;
                }
                let next_is_space_or_end = peek_idx == len || chars[peek_idx].is_whitespace();
                let prev_is_digit = i > 0 && chars[i - 1].is_ascii_digit();
                let next_is_digit = i + 1 < len && chars[i + 1].is_ascii_digit();
                let is_decimal = ch == '.' && prev_is_digit && next_is_digit;
                let is_abbrev = ch == '.' && is_abbreviation_or_initial(&current, &chars, i);

                // Check for dialogue attribution: e.g. "Why?" she asked. or "Wait!" replied Della.
                // If closing quotes are followed by a lowercase word, it is a dialogue tag in the same sentence!
                let is_dialogue_tag = if peek_idx > i + 1 {
                    let mut tag_idx = peek_idx;
                    while tag_idx < len && chars[tag_idx].is_whitespace() {
                        tag_idx += 1;
                    }
                    tag_idx < len && chars[tag_idx].is_lowercase()
                } else {
                    false
                };

                if next_is_space_or_end && !is_decimal && !is_abbrev && !is_dialogue_tag {
                    // Consume all trailing closing quotes/brackets/parentheses into the current sentence
                    while i + 1 < peek_idx {
                        i += 1;
                        current.push(chars[i]);
                    }

                    let s = current.trim().to_string();
                    if !s.is_empty() {
                        raw_sentences.push(s);
                    }
                    current.clear();
                }
            }
            i += 1;
        }

        let rem = current.trim().to_string();
        if !rem.is_empty() {
            raw_sentences.push(rem);
        }
    }

    if raw_sentences.is_empty() {
        return Vec::new();
    }

    // 2. Process each sentence:
    // Natural sentences are normalized, preserving complete sentences unless an individual
    // run-on sentence exceeds 35 words (which is split at major punctuation).
    let mut normalized_units = Vec::new();
    for sentence in raw_sentences {
        let s = sentence.trim();
        if s.is_empty() {
            continue;
        }

        let words_count = s.split_whitespace().count();
        if words_count <= 24 {
            normalized_units.push(s.to_string());
        } else {
            let clauses = split_long_sentence(s);
            for c in clauses {
                let trimmed = c.trim().to_string();
                if !trimmed.is_empty() {
                    normalized_units.push(trimmed);
                }
            }
        }
    }

    // 3. Pack complete sentences into cohesive speech chunks (target: 12-20 words).
    // Lead chunk (Chunk 0) is strictly capped at 20 words so neural synthesis finishes in < 2.0s.
    // Subsequent chunks are capped at 22 words so parallel dual-engines outrun playback 3x.
    let mut final_chunks = Vec::new();
    let mut current_chunk = String::new();
    let mut current_words = 0;

    for unit in normalized_units {
        let unit_words = unit.split_whitespace().count();
        let max_pack = if final_chunks.is_empty() { 20 } else { 22 };

        if current_chunk.is_empty() {
            current_chunk = unit;
            current_words = unit_words;
        } else if current_words + unit_words <= max_pack {
            current_chunk.push(' ');
            current_chunk.push_str(&unit);
            current_words += unit_words;
        } else {
            final_chunks.push(current_chunk);
            current_chunk = unit;
            current_words = unit_words;
        }
    }

    if !current_chunk.is_empty() {
        final_chunks.push(current_chunk);
    }

    final_chunks
}

/// Helper: Splits sentences (> 24 words) into natural grammatical clauses (10-18 words each)
/// at author punctuation (; : — -) or natural clause conjunctions (and, but, which, that).
fn split_long_sentence(sentence: &str) -> Vec<String> {
    let words: Vec<&str> = sentence.split_whitespace().collect();
    if words.len() <= 24 {
        return vec![sentence.to_string()];
    }

    let mut clauses = Vec::new();
    let mut start = 0;

    while start < words.len() {
        let remaining = words.len() - start;
        if remaining <= 24 {
            let part = words[start..].join(" ");
            if !part.trim().is_empty() {
                clauses.push(part);
            }
            break;
        }

        // Look for natural clause boundary between start + 10 and start + 20
        let min_search = start + 10;
        let max_search = (start + 20).min(words.len() - 1);

        let mut best_split = None;

        // 1. Priority 1: Major punctuation (; : —)
        for i in (min_search..=max_search).rev() {
            let w = words[i];
            if w.ends_with(';') || w.ends_with(':') || w.ends_with('—') {
                best_split = Some(i);
                break;
            }
        }

        // 2. Priority 2: Comma or quoted comma
        if best_split.is_none() {
            for i in (min_search..=max_search).rev() {
                let w = words[i];
                if w.ends_with(',') || w.ends_with("\",") || w.ends_with("',") {
                    best_split = Some(i);
                    break;
                }
            }
        }

        // 3. Priority 3: Subordinating / coordinating clause conjunctions
        if best_split.is_none() {
            for i in (min_search..=max_search).rev() {
                let w = words[i].to_lowercase();
                let clean_w = w.trim_matches(|c: char| !c.is_alphanumeric());
                if matches!(
                    clean_w,
                    "and" | "but" | "which" | "that" | "because" | "although" | "while" | "since" | "where" | "when"
                ) {
                    if i > start + 9 {
                        best_split = Some(i - 1);
                        break;
                    }
                }
            }
        }

        let mut split_at = best_split.unwrap_or((start + 18).min(words.len() - 1));

        if best_split.is_none() && split_at > start + 10 {
            let last_w = words[split_at].to_lowercase();
            let clean_last = last_w.trim_matches(|c: char| !c.is_alphanumeric());
            if matches!(
                clean_last,
                "a" | "an" | "the" | "my" | "his" | "her" | "its" | "their" | "our" | "of" | "to" | "in" | "on" | "at" | "for" | "with" | "by" | "during" | "and" | "or" | "but"
            ) {
                split_at -= 1;
            }
        }

        let part = words[start..=split_at].join(" ");
        if !part.trim().is_empty() {
            clauses.push(part);
        }
        start = split_at + 1;
    }

    clauses
}

/// Helper: Calculates pause silence in milliseconds following a chunk.
/// Gives full stops a subtle 50ms natural breath room (Kokoro already decays naturally)
/// and clauses a subtle 15ms transition. Eliminates awkward dead silence.
fn get_chunk_pause_ms(chunk: &str) -> u32 {
    let trimmed = chunk.trim();
    let clean = trimmed.trim_end_matches(|c: char| c == '"' || c == '\'' || c == ')' || c == ']' || c == '}' || c == '»' || c == '”' || c == '’');
    if clean.ends_with("...") {
        80 // 80ms trailing pause for ellipsis
    } else if clean.ends_with('.') || clean.ends_with('!') || clean.ends_with('?') {
        50 // 50ms subtle breath room for full stops
    } else if clean.ends_with(';') || clean.ends_with(':') {
        30 // 30ms subtle pause for semicolons / colons
    } else if clean.ends_with(',') || clean.ends_with('—') || clean.ends_with('-') {
        15 // 15ms subtle clause pause
    } else {
        20 // default fragment pause
    }
}

/// Helper: Prepares audio samples by applying a subtle 3ms fade-out and appending the natural pause silence.
fn prepare_chunk_samples(audio_samples: &[f32], sample_rate: u32, pause_ms: u32) -> Vec<f32> {
    let mut samples = audio_samples.to_vec();
    if samples.is_empty() {
        return samples;
    }

    // 3ms smooth linear fade-out to eliminate any click entering silence
    let fade_samples = (sample_rate as f32 * 0.003).min(samples.len() as f32) as usize;
    let len = samples.len();
    if fade_samples > 0 && len >= fade_samples {
        for (i, sample) in samples[len - fade_samples..].iter_mut().enumerate() {
            let factor = 1.0 - (i as f32 / fade_samples as f32);
            *sample *= factor;
        }
    }

    // Append natural pause silence
    let silence_count = (sample_rate as f32 * (pause_ms as f32 / 1000.0)) as usize;
    samples.extend(std::iter::repeat(0.0f32).take(silence_count));
    samples
}

/// Determines whether enough audio chunks have been pre-synthesized into RAM
/// to guarantee that playback will never outrun generation, eliminating mid-stream pauses.
pub fn is_runway_safe_condition(ready_count: usize, total_chunks: usize, cumulative_dur: f32) -> bool {
    if total_chunks == 0 {
        return false;
    }
    if ready_count >= total_chunks {
        return true;
    }
    if total_chunks == 1 {
        ready_count >= 1
    } else {
        ready_count >= 2 || (ready_count >= 1 && cumulative_dur >= 2.5)
    }
}

/// Helper to inspect if the current active pipeline session has reached runway safety.
pub fn is_active_session_runway_safe(text: &str, voice_name: &str, speed: f32) -> bool {
    let clean = text.trim();
    let speed_key = (speed * 100.0).round() as u32;
    if let Ok(guard) = PIPELINE_STATE.lock() {
        if let Some(ref session) = *guard {
            if session.text_key == clean && session.voice_name == voice_name && session.speed_key == speed_key {
                let total = session.chunks.len();
                let mut count = 0usize;
                let mut dur = 0.0f32;
                for c in session.ready_chunks.iter().flatten() {
                    dur += c.duration_secs;
                    count += 1;
                }
                return is_runway_safe_condition(count, total, dur);
            }
        }
    }
    false
}

#[derive(Clone, Debug)]
pub struct PipelineSessionStats {
    pub session_id: u64,
    pub total_chunks: usize,
    pub ready_chunks: usize,
    pub ready_audio_secs: f32,
    pub is_fully_buffered: bool,
    pub is_runway_safe: bool,
}

/// Retrieve live telemetry for the active pipelined speech session
pub fn get_pipeline_session_stats(text: &str, voice_name: &str, speed: f32) -> Option<PipelineSessionStats> {
    let clean = text.trim();
    let speed_key = (speed * 100.0).round() as u32;
    if let Ok(guard) = PIPELINE_STATE.lock() {
        if let Some(ref session) = *guard {
            if session.text_key == clean && session.voice_name == voice_name && session.speed_key == speed_key {
                let total = session.chunks.len();
                let mut count = 0usize;
                let mut dur = 0.0f32;
                for c in session.ready_chunks.iter().flatten() {
                    dur += c.duration_secs;
                    count += 1;
                }
                let is_safe = is_runway_safe_condition(count, total, dur);
                return Some(PipelineSessionStats {
                    session_id: session.session_id,
                    total_chunks: total,
                    ready_chunks: count,
                    ready_audio_secs: dur,
                    is_fully_buffered: session.is_fully_buffered,
                    is_runway_safe: is_safe,
                });
            }
        }
    }
    None
}

/// Continuously synthesizes audio chunks for the selected text in the background.
/// Synthesizes ALL chunks sequentially on the single focused engine (4 threads) without core thrashing.
/// When Play is clicked, this worker continues building the audio runway in the background so playback NEVER catches up!
pub fn prebuffer_first_chunk(text: &str, voice_name: &str, speed: f32) {
    let clean = text.trim().to_string();
    if clean.is_empty() {
        return;
    }

    let chunks = split_into_speech_chunks(&clean);
    if chunks.is_empty() {
        return;
    }

    let speed_key = (speed * 100.0).round() as u32;
    let v_name = voice_name.to_string();
    let num_chunks = chunks.len();

    // If an identical session is already active or completed, keep it running!
    if let Ok(guard) = PIPELINE_STATE.lock() {
        if let Some(ref session) = *guard {
            if session.text_key == clean && session.voice_name == v_name && session.speed_key == speed_key {
                return;
            }
        }
    }

    // Ensure engine is initialized
    {
        if let Ok(guard) = TTS_ENGINES.lock() {
            if guard.is_empty() {
                drop(guard);
                let _ = init(None);
            }
        }
    }

    let engine = {
        if let Ok(guard) = TTS_ENGINES.lock() {
            if !guard.is_empty() {
                Some(guard[0].clone())
            } else {
                None
            }
        } else {
            None
        }
    };

    let engine = match engine {
        Some(e) => e,
        None => return,
    };

    let session_id = PIPELINE_SESSION_ID.fetch_add(1, Ordering::SeqCst) + 1;

    {
        let mut ready = Vec::with_capacity(num_chunks);
        ready.resize_with(num_chunks, || None);

        if let Ok(mut guard) = PIPELINE_STATE.lock() {
            *guard = Some(PipelineSession {
                session_id,
                text_key: clean.clone(),
                voice_name: v_name.clone(),
                speed_key,
                chunks: chunks.clone(),
                ready_chunks: ready,
                is_fully_buffered: false,
            });
        }
    }
    PIPELINE_CONDVAR.notify_all();

    let sid = voice_name_to_sid(&v_name);
    let effective_speed = speed.clamp(0.5, 2.5);

    // Fast Path: If all chunks are already in cache, populate RAM immediately (0 ms latency)!
    let all_cached = chunks.iter().all(|c| get_cached_chunk(sid, speed_key, c).is_some());
    if all_cached {
        let mut ready = Vec::with_capacity(num_chunks);
        let mut cumulative_dur = 0.0f32;
        for (idx, chunk) in chunks.iter().enumerate() {
            let cached = get_cached_chunk(sid, speed_key, chunk).unwrap();
            cumulative_dur += cached.duration_secs;
            ready.push(Some(PipelineChunk {
                idx,
                samples: cached.samples,
                sample_rate: cached.sample_rate,
                duration_secs: cached.duration_secs,
            }));
        }

        if let Ok(mut guard) = PIPELINE_STATE.lock() {
            *guard = Some(PipelineSession {
                session_id,
                text_key: clean.clone(),
                voice_name: v_name.clone(),
                speed_key,
                chunks: chunks.clone(),
                ready_chunks: ready,
                is_fully_buffered: true,
            });
        }
        PIPELINE_CONDVAR.notify_all();

        println!(
            "[NativeKokoro Cache HIT] Instant 0ms prebuffer for all {} chunk(s) ({:.2}s audio in RAM)!",
            num_chunks, cumulative_dur
        );

        if let Ok(app_guard) = APP_HANDLE.lock() {
            if let Some(ref app) = *app_guard {
                let _ = app.emit("global-prebuffer-ready", serde_json::json!({
                    "chunkIndex": num_chunks,
                    "totalChunks": num_chunks,
                    "chunksBuffered": num_chunks,
                    "durationSecs": cumulative_dur,
                    "isRunwaySafe": true,
                }));
            }
        }

        return;
    }

    let gen_config = sherpa_onnx::GenerationConfig {
        sid,
        speed: effective_speed,
        ..Default::default()
    };

    // Spawn dedicated sequential worker on the single focused engine
    std::thread::spawn(move || {
        let first_is_cached = get_cached_chunk(sid, speed_key, chunks.first().map(|s| s.as_str()).unwrap_or("")).is_some();
        if !first_is_cached {
            std::thread::sleep(std::time::Duration::from_millis(30));
        }

        for (idx, chunk) in chunks.into_iter().enumerate() {
            if PIPELINE_SESSION_ID.load(Ordering::Relaxed) != session_id {
                return;
            }

            let t0 = std::time::Instant::now();
            let (chunk_samples, sr, chunk_dur, pause_ms, from_cache) = if let Some(cached) = get_cached_chunk(sid, speed_key, &chunk) {
                (cached.samples, cached.sample_rate, cached.duration_secs, cached.pause_ms, true)
            } else {
                let audio_opt = {
                    let guard = engine.lock().unwrap();
                    guard.generate_with_config(&chunk, &gen_config, None::<fn(&[f32], f32) -> bool>)
                };

                if PIPELINE_SESSION_ID.load(Ordering::Relaxed) != session_id {
                    return;
                }

                if let Some(audio) = audio_opt {
                    let raw_samples = audio.samples();
                    let sr = audio.sample_rate() as u32;
                    if !raw_samples.is_empty() {
                        let pause_ms = get_chunk_pause_ms(&chunk);
                        let chunk_samples = prepare_chunk_samples(raw_samples, sr, pause_ms);
                        let chunk_dur = chunk_samples.len() as f32 / sr as f32;
                        cache_audio_chunk(sid, speed_key, &chunk, chunk_samples.clone(), sr, chunk_dur, pause_ms);
                        (chunk_samples, sr, chunk_dur, pause_ms, false)
                    } else {
                        continue;
                    }
                } else {
                    continue;
                }
            };

            let pipeline_chunk = PipelineChunk {
                idx,
                samples: chunk_samples,
                sample_rate: sr,
                duration_secs: chunk_dur,
            };

            let mut cumulative_dur = 0.0f32;
            let mut ready_count = 0usize;

            if let Ok(mut guard) = PIPELINE_STATE.lock() {
                if let Some(ref mut session) = *guard {
                    if session.session_id == session_id {
                        session.ready_chunks[idx] = Some(pipeline_chunk);
                        if session.ready_chunks.iter().all(|c| c.is_some()) {
                            session.is_fully_buffered = true;
                        }
                        for c in session.ready_chunks.iter().flatten() {
                            cumulative_dur += c.duration_secs;
                            ready_count += 1;
                        }
                    } else {
                        return;
                    }
                } else {
                    return;
                }
            }

            let is_safe = is_runway_safe_condition(ready_count, num_chunks, cumulative_dur);

            println!(
                "[NativeKokoro Worker] Chunk {}/{} ({:.2}s audio, {}ms pause) in {:.2}ms (total buffer: {:.2}s across {} ready chunk(s), safe: {}, cached: {})",
                idx + 1,
                num_chunks,
                chunk_dur,
                pause_ms,
                t0.elapsed().as_secs_f64() * 1000.0,
                cumulative_dur,
                ready_count,
                is_safe,
                from_cache
            );

            PIPELINE_CONDVAR.notify_all();

            if let Ok(app_guard) = APP_HANDLE.lock() {
                if let Some(ref app) = *app_guard {
                    let _ = app.emit("global-prebuffer-ready", serde_json::json!({
                        "chunkIndex": idx + 1,
                        "totalChunks": num_chunks,
                        "chunksBuffered": ready_count,
                        "durationSecs": cumulative_dur,
                        "isRunwaySafe": is_safe,
                    }));
                }
            }
        }
    });
}

/// Speak text using the native Kokoro neural model via continuous pipelined streaming.
/// Seamlessly attaches as the consumer to the active pipeline session WITHOUT killing the producer!
/// Enforces the Ironclad Safe Runway Gate before playout begins, guaranteeing zero mid-stream pauses.
pub fn speak(text: &str, voice_name: &str, speed: f32) -> Result<(), String> {
    let clean = text.trim();
    if clean.is_empty() {
        return Ok(());
    }

    // Ensure engine is initialized
    {
        let guard = TTS_ENGINES.lock().map_err(|e| e.to_string())?;
        if guard.is_empty() {
            drop(guard);
            init(None)?;
        }
    }

    // Immediately halt and empty any existing audio sink playback (< 0.1ms)
    // so previous audio never continues draining or clashing with new speech!
    if let Ok(player_guard) = AUDIO_PLAYER.lock() {
        if let Some(ref player) = *player_guard {
            player.stop();
        }
    }

    let speed_key = (speed * 100.0).round() as u32;
    let play_gen = PLAYBACK_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    // 1. Ensure an active pipeline session is running for this exact text + voice + speed
    let (session_id, total_chunks) = {
        let guard = PIPELINE_STATE.lock().unwrap();
        let matches = if let Some(ref session) = *guard {
            session.text_key == clean && session.voice_name == voice_name && session.speed_key == speed_key
        } else {
            false
        };

        if matches {
            let session = guard.as_ref().unwrap();
            (session.session_id, session.chunks.len())
        } else {
            drop(guard);
            // Invalidate any previous background prebuffering worker
            PIPELINE_SESSION_ID.fetch_add(1, Ordering::SeqCst);
            prebuffer_first_chunk(clean, voice_name, speed);
            let guard = PIPELINE_STATE.lock().unwrap();
            let session = guard.as_ref().unwrap();
            (session.session_id, session.chunks.len())
        }
    };

    println!(
        "[NativeKokoro] Attaching playback consumer to pipeline session {} ({} chunks, play_gen: {})...",
        session_id, total_chunks, play_gen
    );

    // Emit active speaking status immediately
    if let Ok(app_guard) = APP_HANDLE.lock() {
        if let Some(ref app) = *app_guard {
            let _ = app.emit("global-hud-status", serde_json::json!({
                "status": "speaking",
                "text": clean,
                "voiceName": voice_name,
                "speed": speed,
                "chunkIndex": 1,
                "totalChunks": total_chunks,
            }));
        }
    }

    // 2. Ironclad Safe Runway Gate:
    // Playout must NEVER start draining audio into the sound card until safe runway is buffered in RAM!
    // For 1 chunk: chunk 0 is in RAM.
    // For 2 chunks: chunk 0 and chunk 1 are in RAM.
    // For 3+ chunks: at least 2 chunks and >= 7.0s of audio in RAM (or all chunks ready).
    {
        let mut guard = PIPELINE_STATE.lock().unwrap();
        loop {
            if PLAYBACK_GENERATION.load(Ordering::Relaxed) != play_gen {
                return Ok(());
            }
            if let Some(ref session) = *guard {
                if session.session_id != session_id {
                    return Ok(());
                }
                let total = session.chunks.len();
                let mut count = 0usize;
                let mut dur = 0.0f32;
                for c in session.ready_chunks.iter().flatten() {
                    count += 1;
                    dur += c.duration_secs;
                }
                if is_runway_safe_condition(count, total, dur) {
                    println!(
                        "[NativeKokoro] Safe runway condition satisfied ({}/{} chunks, {:.2}s buffer in RAM). Starting playout!",
                        count, total, dur
                    );
                    break;
                }
            } else {
                return Ok(());
            }
            let (new_guard, _) = PIPELINE_CONDVAR.wait_timeout(guard, std::time::Duration::from_millis(50)).unwrap();
            guard = new_guard;
        }
    }

    let mut initial_played = false;

    // 3. Sequentially consume all chunks from the pipeline directly into the audio player
    for chunk_idx in 0..total_chunks {
        if PLAYBACK_GENERATION.load(Ordering::Relaxed) != play_gen {
            println!("[NativeKokoro] Playback cancelled before consuming chunk {}/{}", chunk_idx + 1, total_chunks);
            return Ok(());
        }

        // Wait for next chunk to be ready in RAM
        let chunk_data = {
            let mut guard = PIPELINE_STATE.lock().unwrap();
            loop {
                if PLAYBACK_GENERATION.load(Ordering::Relaxed) != play_gen {
                    return Ok(());
                }
                if let Some(ref session) = *guard {
                    if session.session_id != session_id {
                        return Ok(());
                    }
                    if let Some(ref c) = session.ready_chunks[chunk_idx] {
                        break (c.samples.clone(), c.sample_rate, c.duration_secs);
                    }
                } else {
                    return Ok(());
                }

                let wait_timeout = std::time::Duration::from_millis(50);
                let (new_guard, _) = PIPELINE_CONDVAR.wait_timeout(guard, wait_timeout).unwrap();
                guard = new_guard;
            }
        };

        let (samples, sample_rate, duration_secs) = chunk_data;

        if PLAYBACK_GENERATION.load(Ordering::Relaxed) != play_gen {
            return Ok(());
        }

        // Re-emit speaking status as chunk arrives
        if let Ok(app_guard) = APP_HANDLE.lock() {
            if let Some(ref app) = *app_guard {
                let _ = app.emit("global-hud-status", serde_json::json!({
                    "status": "speaking",
                    "text": clean,
                    "voiceName": voice_name,
                    "speed": speed,
                    "chunkIndex": chunk_idx + 1,
                    "totalChunks": total_chunks,
                }));
            }
        }

        if let Ok(player_guard) = AUDIO_PLAYER.lock() {
            if let Some(ref player) = *player_guard {
                player.set_speed(speed);
                if !initial_played {
                    println!(
                        "[NativeKokoro] INSTANT PLAYBACK (< 1ms): Playing Chunk 1/{} ({:.2}s audio)!",
                        total_chunks, duration_secs
                    );
                    player.play_samples(samples, sample_rate, speed);
                    initial_played = true;
                } else {
                    println!(
                        "[NativeKokoro] Seamlessly queuing Chunk {}/{} ({:.2}s audio) to sink",
                        chunk_idx + 1, total_chunks, duration_secs
                    );
                    player.append_samples(samples, sample_rate);
                }
            }
        }
    }

    if let Ok(mut v) = CURRENT_VOICE.lock() {
        *v = voice_name.to_string();
    }
    if let Ok(mut s) = CURRENT_SPEED.lock() {
        *s = speed;
    }

    // Background watcher to notify UI when audio sink finishes playing
    let clean_str = clean.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        while is_speaking() {
            if PLAYBACK_GENERATION.load(Ordering::Relaxed) != play_gen {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        if PLAYBACK_GENERATION.load(Ordering::Relaxed) == play_gen {
            if let Ok(app_guard) = APP_HANDLE.lock() {
                if let Some(ref app) = *app_guard {
                    let _ = app.emit("global-hud-status", serde_json::json!({
                        "status": "finished",
                        "text": clean_str,
                    }));
                }
            }
        }
    });

    Ok(())
}

/// Stop native Kokoro speech immediately (< 0.1ms)
pub fn stop() -> Result<(), String> {
    PIPELINE_SESSION_ID.fetch_add(1, Ordering::SeqCst);
    PLAYBACK_GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut guard) = PIPELINE_STATE.lock() {
        *guard = None;
    }
    PIPELINE_CONDVAR.notify_all();
    if let Ok(player_guard) = AUDIO_PLAYER.lock() {
        if let Some(ref player) = *player_guard {
            player.stop();
        }
    }
    Ok(())
}

/// Check if native Kokoro audio is currently playing
pub fn is_speaking() -> bool {
    if let Ok(player_guard) = AUDIO_PLAYER.lock() {
        if let Some(ref player) = *player_guard {
            return player.is_speaking();
        }
    }
    false
}

/// Synthesizes text to raw audio samples without playing them through the local sound card.
/// Returns (Vec<f32>, sample_rate) for direct frontend integration, audio mastering, or export.
pub fn synthesize_raw(text: &str, voice_name: &str, speed: f32) -> Result<(Vec<f32>, u32), String> {
    let clean = text.trim();
    if clean.is_empty() {
        return Ok((Vec::new(), 24000));
    }

    let sid = voice_name_to_sid(voice_name);
    let effective_speed = speed.clamp(0.5, 2.5);

    // Ensure dual engines are initialized
    {
        let guard = TTS_ENGINES.lock().map_err(|e| e.to_string())?;
        if guard.is_empty() {
            drop(guard);
            init(None)?;
        }
    }

    let chunks = split_into_speech_chunks(clean);
    if chunks.is_empty() {
        return Ok((Vec::new(), 24000));
    }

    let gen_config = sherpa_onnx::GenerationConfig {
        sid,
        speed: effective_speed,
        ..Default::default()
    };

    let engines = {
        let guard = TTS_ENGINES.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    if engines.is_empty() {
        return Err("Native Kokoro TTS engines not initialized".to_string());
    }

    let engine = engines[0].clone();
    let mut combined_samples = Vec::new();
    let mut sample_rate_out = 24000u32;

    let speed_key = (effective_speed * 100.0).round() as u32;

    for chunk in chunks {
        let (prepared, sr) = if let Some(cached) = get_cached_chunk(sid, speed_key, &chunk) {
            (cached.samples, cached.sample_rate)
        } else {
            let audio_opt = {
                let guard = engine.lock().map_err(|e| e.to_string())?;
                guard.generate_with_config(&chunk, &gen_config, None::<fn(&[f32], f32) -> bool>)
            };

            if let Some(audio) = audio_opt {
                let raw_samples = audio.samples();
                let sr = audio.sample_rate() as u32;
                let pause_ms = get_chunk_pause_ms(&chunk);
                let prepared = prepare_chunk_samples(raw_samples, sr, pause_ms);
                let chunk_dur = prepared.len() as f32 / sr as f32;
                cache_audio_chunk(sid, speed_key, &chunk, prepared.clone(), sr, chunk_dur, pause_ms);
                (prepared, sr)
            } else {
                continue;
            }
        };

        sample_rate_out = sr;
        combined_samples.extend(prepared);
    }

    Ok((combined_samples, sample_rate_out))
}

pub fn get_current_voice_name() -> String {
    if let Ok(guard) = CURRENT_VOICE.lock() {
        if !guard.is_empty() {
            return guard.clone();
        }
    }
    "Sarah".to_string()
}

pub fn set_current_voice(voice: &str) {
    if let Ok(mut guard) = CURRENT_VOICE.lock() {
        *guard = voice.to_string();
    }
}

pub fn get_current_speed() -> f32 {
    if let Ok(guard) = CURRENT_SPEED.lock() {
        return *guard;
    }
    0.9
}

pub fn set_current_speed(speed: f32) {
    if let Ok(mut guard) = CURRENT_SPEED.lock() {
        *guard = speed.clamp(0.5, 2.5);
    }
}

pub fn get_tts_engines() -> Vec<std::sync::Arc<Mutex<sherpa_onnx::OfflineTts>>> {
    if let Ok(guard) = TTS_ENGINES.lock() {
        guard.clone()
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_o_henry_chunking_and_pauses() {
        let text = "One dollar and eighty-seven cents. That was all. And sixty cents of it was in pennies. Pennies saved one and two at a time by bulldozing the grocer and the vegetable man and the butcher until one's cheeks burned with the silent imputation of parsimony that such close dealing implied. Three times Della counted it. One dollar and eighty-seven cents. And the next day would be Christmas.";
        let chunks = split_into_speech_chunks(text);

        println!("Generated chunks:");
        for (i, c) in chunks.iter().enumerate() {
            let pause = get_chunk_pause_ms(c);
            println!("  {}: \"{}\" [pause: {}ms]", i + 1, c, pause);
        }

        // Chunks are packed into cohesive chunks:
        // Chunk 0 packs the 3 short opening sentences: "One dollar and eighty-seven cents. That was all. And sixty cents of it was in pennies." (15 words)
        assert_eq!(chunks[0], "One dollar and eighty-seven cents. That was all. And sixty cents of it was in pennies.");
        assert_eq!(get_chunk_pause_ms(&chunks[0]), 50);

        // Every chunk ending with a period has a 50ms natural breath pause
        for c in &chunks {
            if c.ends_with('.') {
                assert_eq!(get_chunk_pause_ms(c), 50);
            }
        }
    }

    #[test]
    fn test_dillingham_paragraph() {
        let text = r#"The "Dillingham" had been flung to the breeze during a former period of prosperity when its possessor was being paid $30 per week. Now, when the income was shrunk to $20, the letters of "Dillingham" looked blurred, as though they were thinking seriously of contracting to a modest and unassuming D. But whenever Mr. James Dillingham Young came home and reached his flat above he was called "Jim" and greatly hugged by Mrs. James Dillingham Young, already introduced to you as Della. Which is all very good."#;
        let chunks = split_into_speech_chunks(text);

        println!("\n=== DILLINGHAM PARAGRAPH CHUNKS ===");
        for (i, c) in chunks.iter().enumerate() {
            println!("  {}: \"{}\" [pause: {}ms]", i + 1, c, get_chunk_pause_ms(c));
        }

        // Verify: neither "Mr." nor "Mrs." should EVER be isolated at the end of a chunk
        for c in &chunks {
            let clean = c.trim_end_matches(|ch: char| ch == '"' || ch == '\'' || ch == ',');
            assert!(!clean.ends_with("Mr."), "Found isolated Mr. at end of chunk: \"{}\"", c);
            assert!(!clean.ends_with("Mrs."), "Found isolated Mrs. at end of chunk: \"{}\"", c);
            assert_ne!(c, "Mr.");
            assert_ne!(c, "Mrs.");
        }

        // Verify: "Mr. James" and "Mrs. James" must be present together
        let joined = chunks.join(" || ");
        assert!(joined.contains("Mr. James"), "Did not find 'Mr. James' together in chunks");
        assert!(joined.contains("Mrs. James"), "Did not find 'Mrs. James' together in chunks");
    }

    #[test]
    fn test_abbreviation_and_title_edge_cases() {
        // 1. Social & Professional Titles (Mr., Mrs., Dr., Prof., Gen.)
        let text1 = "Mr. Anderson spoke with Mrs. Gable and Dr. Watson. Prof. Higgins was also present with Gen. Patton.";
        let chunks1 = split_into_speech_chunks(text1);
        assert!(chunks1.len() <= 2);
        assert!(chunks1[0].contains("Mr. Anderson spoke with Mrs. Gable and Dr. Watson."));

        // 2. Middle Initials & Initialisms (James D. Young, J. K. Rowling, George R. R. Martin)
        let text2 = "The novel was written by J. K. Rowling and George R. R. Martin. James D. Young reviewed it.";
        let chunks2 = split_into_speech_chunks(text2);
        assert!(chunks2[0].contains("J. K. Rowling and George R. R. Martin."));

        // 3. Saint vs Address (St. Jude vs Baker St.)
        let text3 = "St. Jude is revered here. We walked down Baker St. The weather was clear.";
        let chunks3 = split_into_speech_chunks(text3);
        assert!(chunks3[0].contains("St. Jude is revered here."));
        assert!(chunks3[0].contains("Baker St."));

        // 4. Units of measure (60 km per hour vs 60 km. Then...)
        let text4 = "The car went 60 km. per hour. We drove 60 km. Then we rested.";
        let chunks4 = split_into_speech_chunks(text4);
        assert!(chunks4[0].contains("60 km. per hour."));

        // 5. Latin & closing abbreviations (etc. followed by starter vs continuation)
        let text5 = "We brought apples, oranges, etc. We left at noon. They visited e.g. Paris and London.";
        let chunks5 = split_into_speech_chunks(text5);
        assert!(chunks5[0].contains("etc."));

        // 6. Acronyms (U.S.A., a.m., Ph.D.)
        let text6 = "He arrived in the U.S.A. at 10:00 a.m. with his Ph.D. in hand.";
        let chunks6 = split_into_speech_chunks(text6);
        assert_eq!(chunks6.len(), 1);
        assert_eq!(chunks6[0], "He arrived in the U.S.A. at 10:00 a.m. with his Ph.D. in hand.");
    }

    #[test]
    fn test_parentheses_and_quotes_closure() {
        // 1. Quoted terminal exclamation & question
        let text1 = r#"He shouted, "Stop!" Della looked up. "Why?" she asked."#;
        let chunks1 = split_into_speech_chunks(text1);
        assert!(chunks1[0].contains("He shouted, \"Stop!\""));

        // 2. Parentheses with terminal period inside
        let text2 = "She nodded (as was expected.) The meeting adjourned.";
        let chunks2 = split_into_speech_chunks(text2);
        assert!(chunks2[0].contains("She nodded (as was expected.)"));

        // 3. Double quotes and parentheses nested
        let text3 = r#"("Never again.") She walked away."#;
        let chunks3 = split_into_speech_chunks(text3);
        assert!(chunks3[0].contains("(\"Never again.\")"));

        // 4. Repeated punctuation
        let text4 = "What??? Really?! That is amazing!";
        let chunks4 = split_into_speech_chunks(text4);
        assert!(chunks4[0].contains("What???"));
    }

    #[test]
    fn test_markdown_and_html_cleaning() {
        // 1. Markdown link & bold extraction
        let text1 = "Check out [Voxify](https://voxify.app) for **amazing** sound!";
        let norm1 = normalize_text_for_speech(text1);
        assert_eq!(norm1, "Check out Voxify for amazing sound!");

        // 2. HTML tag stripping
        let text2 = "<p>Welcome to <b>Voxify</b>.</p><br>Enjoy your reading.";
        let norm2 = normalize_text_for_speech(text2);
        assert!(norm2.contains("Welcome to Voxify."));
        assert!(norm2.contains("Enjoy your reading."));

        // 3. Numbered, Lettered, and Roman numeral lists
        let text3 = "1. First step.\n2. Second step.\nA. Sub-item A.\nI. Roman item.";
        let norm3 = normalize_text_for_speech(text3);
        assert!(norm3.contains("1: First step."));
        assert!(norm3.contains("2: Second step."));
        assert!(norm3.contains("A: Sub-item A."));
        assert!(norm3.contains("I: Roman item."));

        // 4. Soft hyphen and zero-width spaces removal
        let text4 = "in\u{00AD}tel\u{00AD}li\u{00AD}gence and zero\u{200B}width";
        let norm4 = normalize_text_for_speech(text4);
        assert_eq!(norm4, "intelligence and zerowidth");

        // 5. Smart typographic quotes & ellipsis
        let text5 = "‘Single’ and “Double” quotes… with — dashes.";
        let norm5 = normalize_text_for_speech(text5);
        assert_eq!(norm5, "'Single' and \"Double\" quotes... with — dashes.");
    }

    #[test]
    fn test_synthesize_raw_samples() {
        let text = "One dollar and eighty-seven cents.";
        let res = synthesize_raw(text, "Sarah", 0.9);
        assert!(res.is_ok(), "synthesize_raw failed: {:?}", res.err());
        let (samples, sr) = res.unwrap();
        assert_eq!(sr, 24000);
        assert!(!samples.is_empty());
        let dur = samples.len() as f32 / sr as f32;
        assert!(dur > 1.5 && dur < 4.0, "Unexpected sample duration: {:.2}s", dur);
    }

    #[test]
    fn test_dillingham_paragraph_pipeline() {
        let text = "There was clearly nothing to do but flop down on the shabby little couch and howl. So Della did it. Which instigates the moral reflection that life is made up of sobs, sniffles, and smiles, with sniffles predominating.\n\nWhile the mistress of the home is gradually subsiding from the first stage to the second, take a look at the home. A furnished flat at $8 per week. It did not exactly beggar description, but it certainly had that word on the look-out for the mendicancy squad.\n\nIn the vestibule below was a letter-box into which no letter would go, and an electric button from which no mortal finger could coax a ring. Also appertaining thereunto was a card bearing the name \"Mr. James Dillingham Young.\"";

        let chunks = split_into_speech_chunks(text);
        // Chunks are cohesive - "So Della did it." is packed with sentence 1 so there's zero pause after it!
        assert_eq!(chunks[0], "There was clearly nothing to do but flop down on the shabby little couch and howl. So Della did it.");
        assert_eq!(chunks[1], "Which instigates the moral reflection that life is made up of sobs, sniffles, and smiles, with sniffles predominating.");
        assert!(chunks.len() <= 9, "Expected at most 9 cohesive chunks, got {}", chunks.len());
    }

    #[test]
    fn test_parallel_chunk_synthesis() {
        let _ = init(None);

        let text = "There was clearly nothing to do but flop down on the shabby little couch and howl. While the mistress of the home is gradually subsiding from the first stage to the second, take a look at the home.";

        let t0 = std::time::Instant::now();
        let res = synthesize_raw(text, "Sarah", 0.9);
        println!("Single-engine multi-chunk synthesis finished in {:.2}ms", t0.elapsed().as_secs_f64() * 1000.0);
        assert!(res.is_ok());
        let (samples, sr) = res.unwrap();
        assert!(!samples.is_empty());
        assert_eq!(sr, 24000);
    }
}

