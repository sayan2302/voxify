use voxify_lib::native_kokoro;
use std::time::Instant;

fn main() {
    println!("=== KOKORO PERFORMANCE & BUFFER RUNWAY FORENSIC BENCHMARK ===");
    let text = "Even though Chunk 1 was ALREADY sitting in RAM ready to play, speak() refused to play Chunk 1 until Chunk 2 and 8.5s+ of audio were also generated!\nBecause generation was running on a single sequential thread, Chunk 2 took another 6–8 seconds to synthesize.\nResult: You clicked Play, and the application froze in complete dead silence for 10+ seconds while you waited for Chunk 2, even though Chunk 1 was already in memory!";

    println!("\n1. Testing Text Splitting & Chunk Durations:");
    let chunks = native_kokoro::split_into_speech_chunks(text);
    println!("Produced {} chunks:", chunks.len());
    for (i, c) in chunks.iter().enumerate() {
        println!("  Chunk {}: \"{}\" ({} words)", i, c, c.split_whitespace().count());
    }

    println!("\n2. Initializing Kokoro Engine...");
    let t_init = Instant::now();
    native_kokoro::init(None).expect("Failed to initialize Kokoro engine");
    println!("Engine initialized in {:.2}ms", t_init.elapsed().as_secs_f64() * 1000.0);

    println!("\n3. Measuring Synthesis Time per Chunk (Sarah, Speed 0.9):");
    let mut total_audio_dur = 0.0f32;
    let mut total_compute_dur = 0.0f64;

    for (i, c) in chunks.iter().enumerate() {
        let t0 = Instant::now();
        let (samples, sr) = native_kokoro::synthesize_raw(c, "Sarah", 0.9).expect("Synthesis failed");
        let compute_sec = t0.elapsed().as_secs_f64();
        let audio_sec = samples.len() as f32 / sr as f32;
        let rtf = compute_sec / audio_sec as f64;

        total_audio_dur += audio_sec;
        total_compute_dur += compute_sec;

        println!(
            "  Chunk {}: {} words -> audio: {:.2}s, compute: {:.2}s (RTF: {:.2}x) -> {}",
            i,
            c.split_whitespace().count(),
            audio_sec,
            compute_sec,
            rtf,
            if rtf < 1.0 { "FASTER than real-time" } else { "SLOWER than real-time (BUFFER DRAIN!)" }
        );
    }

    println!("\n=== OVERALL TOTALS ===");
    println!("Total audio duration: {:.2}s", total_audio_dur);
    println!("Total compute duration: {:.2}s", total_compute_dur);
    println!("Overall Real-Time Factor (RTF): {:.2}x", total_compute_dur / total_audio_dur as f64);

    println!("\n4. Testing Concurrent Generation on Engines 0 & 1:");
    let engines = native_kokoro::get_tts_engines();
    println!("Available engines: {}", engines.len());

    let sid = 1;
    let cfg1 = sherpa_onnx::GenerationConfig { sid, speed: 0.9, ..Default::default() };
    let cfg2 = cfg1.clone();

    let eng1 = engines[0].clone();
    let eng2 = engines[1].clone();
    let chunk0 = chunks[0].clone();
    let chunk1 = chunks[1].clone();

    let t_start = Instant::now();
    let cfg_w1 = cfg1.clone();
    let h1 = std::thread::spawn(move || {
        let t0 = Instant::now();
        println!("  [Worker 1] Started at +{:.2}ms", t_start.elapsed().as_secs_f64() * 1000.0);
        let guard = eng1.lock().unwrap();
        let res = guard.generate_with_config(&chunk0, &cfg_w1, None::<fn(&[f32], f32) -> bool>);
        println!("  [Worker 1] FINISHED at +{:.2}ms (duration: {:.2}s)", t_start.elapsed().as_secs_f64() * 1000.0, t0.elapsed().as_secs_f64());
        res.is_some()
    });

    let h2 = std::thread::spawn(move || {
        let t0 = Instant::now();
        println!("  [Worker 2] Started at +{:.2}ms", t_start.elapsed().as_secs_f64() * 1000.0);
        let guard = eng2.lock().unwrap();
        let res = guard.generate_with_config(&chunk1, &cfg2, None::<fn(&[f32], f32) -> bool>);
        println!("  [Worker 2] FINISHED at +{:.2}ms (duration: {:.2}s)", t_start.elapsed().as_secs_f64() * 1000.0, t0.elapsed().as_secs_f64());
        res.is_some()
    });

    h1.join().unwrap();
    h2.join().unwrap();
    println!("Dual-engine concurrent test finished in {:.2}s total elapsed!", t_start.elapsed().as_secs_f64());

    println!("\n5. Testing Single Sequential Engine for all 5 chunks:");
    let t_seq_start = Instant::now();
    let eng_single = engines[0].clone();
    for (i, c) in chunks.iter().enumerate() {
        let t0 = Instant::now();
        let guard = eng_single.lock().unwrap();
        let _ = guard.generate_with_config(c, &cfg1, None::<fn(&[f32], f32) -> bool>);
        println!("  [Sequential] Chunk {} finished in {:.2}s (cumulative: {:.2}s)", i, t0.elapsed().as_secs_f64(), t_seq_start.elapsed().as_secs_f64());
    }
    println!("Single engine completed all 5 chunks in {:.2}s total elapsed!", t_seq_start.elapsed().as_secs_f64());
}
