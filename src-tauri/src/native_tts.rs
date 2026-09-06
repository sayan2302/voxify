use std::sync::Mutex;
use tts::Tts;

static TTS_INSTANCE: Mutex<Option<Tts>> = Mutex::new(None);
static CURRENT_VOICE_NAME: Mutex<Option<String>> = Mutex::new(None);
static CURRENT_RATE: Mutex<f32> = Mutex::new(1.0);

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct NativeVoiceInfo {
    pub id: String,
    pub name: String,
    pub language: String,
    pub gender: Option<String>,
}

/// Initialize the native Windows speech engine
pub fn init() -> Result<(), String> {
    let mut instance = TTS_INSTANCE.lock().map_err(|e| e.to_string())?;
    if instance.is_none() {
        match Tts::default() {
            Ok(tts) => {
                println!("[NativeTTS] Windows Native Speech engine initialized successfully.");
                *instance = Some(tts);
            }
            Err(e) => {
                eprintln!("[NativeTTS] Failed to initialize Windows TTS: {:?}", e);
                return Err(e.to_string());
            }
        }
    }
    Ok(())
}

/// Speak text immediately with native Windows TTS (< 15ms latency)
pub fn speak(text: &str, interrupt: bool) -> Result<(), String> {
    let mut instance = TTS_INSTANCE.lock().map_err(|e| e.to_string())?;
    if instance.is_none() {
        let tts = Tts::default().map_err(|e| e.to_string())?;
        *instance = Some(tts);
    }
    if let Some(ref mut tts) = *instance {
        let clean = text.trim();
        if clean.is_empty() {
            return Ok(());
        }
        tts.speak(clean, interrupt).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Stop native speech immediately (< 0.1ms)
pub fn stop() -> Result<(), String> {
    let mut instance = TTS_INSTANCE.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut tts) = *instance {
        tts.stop().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Check if native speech is currently speaking
pub fn is_speaking() -> bool {
    let mut instance = match TTS_INSTANCE.lock() {
        Ok(guard) => guard,
        Err(_) => return false,
    };
    if let Some(ref mut tts) = *instance {
        tts.is_speaking().unwrap_or(false)
    } else {
        false
    }
}

/// Set native speech rate multiplier (e.g. 0.8, 1.0, 1.25, 1.5, 2.0)
pub fn set_rate(rate_multiplier: f32) -> Result<(), String> {
    let mut instance = TTS_INSTANCE.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut tts) = *instance {
        let min = tts.min_rate();
        let max = tts.max_rate();
        let normal = tts.normal_rate();

        let target_rate = if rate_multiplier <= 1.0 {
            min + (normal - min) * rate_multiplier.clamp(0.1, 1.0)
        } else {
            normal + (max - normal) * ((rate_multiplier - 1.0) / 1.5).clamp(0.0, 1.0)
        };

        let _ = tts.set_rate(target_rate);
        if let Ok(mut r) = CURRENT_RATE.lock() {
            *r = rate_multiplier;
        }
    }
    Ok(())
}

/// Get all installed Windows voices (Desktop and OneCore)
pub fn get_voices() -> Result<Vec<NativeVoiceInfo>, String> {
    let mut instance = TTS_INSTANCE.lock().map_err(|e| e.to_string())?;
    if instance.is_none() {
        let tts = Tts::default().map_err(|e| e.to_string())?;
        *instance = Some(tts);
    }
    if let Some(ref mut tts) = *instance {
        let voices = tts.voices().map_err(|e| e.to_string())?;
        let mut list = Vec::new();
        for v in voices {
            list.push(NativeVoiceInfo {
                id: v.id().to_string(),
                name: v.name().to_string(),
                language: v.language().to_string(),
                gender: v.gender().map(|g| format!("{:?}", g)),
            });
        }
        Ok(list)
    } else {
        Ok(Vec::new())
    }
}

/// Set active native voice by name or ID
pub fn set_voice_by_name(name: &str) -> Result<(), String> {
    let mut instance = TTS_INSTANCE.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut tts) = *instance {
        let voices = tts.voices().map_err(|e| e.to_string())?;
        if let Some(target) = voices.into_iter().find(|v| v.name().eq_ignore_ascii_case(name) || v.id().contains(name)) {
            tts.set_voice(&target).map_err(|e| e.to_string())?;
            if let Ok(mut v_name) = CURRENT_VOICE_NAME.lock() {
                *v_name = Some(name.to_string());
            }
        }
    }
    Ok(())
}

pub fn get_current_voice_name() -> String {
    if let Ok(guard) = CURRENT_VOICE_NAME.lock() {
        if let Some(ref name) = *guard {
            return name.clone();
        }
    }
    "Microsoft David".to_string()
}
