use voxify_lib::native_kokoro;
use std::time::{Duration, Instant};

struct TestScenario {
    name: &'static str,
    genre: &'static str,
    text: &'static str,
}

fn main() {
    println!("================================================================================");
    println!("        VOXIFY - AUTONOMOUS ZERO-STALL AUDIO PIPELINE VERIFICATION SUITE        ");
    println!("================================================================================");
    println!("Target CPU Architecture: Intel Core Ultra (2 P-cores, 8 E-cores, 15W TDP)");
    println!("Single Focused Engine: 4 threads, sequential non-contending synthesis");
    println!("Playout Safety Invariant: B(t) = Queued(t) - Played(t) > 0 for all t in [0, T]");
    println!("================================================================================\n");

    let scenarios = vec![
        TestScenario {
            name: "Scenario 1: User's Exact Reported Text",
            genre: "Technical Prose with Quotes & Parentheses",
            text: "Even though Chunk 1 was ALREADY sitting in RAM ready to play, speak() refused to play Chunk 1 until Chunk 2 and 8.5s+ of audio were also generated!\nBecause generation was running on a single sequential thread, Chunk 2 took another 6–8 seconds to synthesize.\nResult: You clicked Play, and the application froze in complete dead silence for 10+ seconds while you waited for Chunk 2, even though Chunk 1 was already in memory!",
        },
        TestScenario {
            name: "Scenario 2: Rapid Dialogue & Exclamations",
            genre: "Fiction Dialogue with Punctuated Exclamations",
            text: "\"Wait! Why?\" she cried, turning around abruptly. \"You didn't tell me what happened!\" He sighed deeply. \"Because,\" he whispered, \"it wasn't safe. Not then. Not now.\" She stared in complete disbelief. \"And tomorrow? Will it be safe tomorrow?\" He didn't answer.",
        },
        TestScenario {
            name: "Scenario 3: Classic Multi-Clause Literature",
            genre: "O. Henry Flowing Multi-Clause Prose",
            text: "The \"Dillingham\" had been flung to the breeze during a former period of prosperity when its possessor was being paid $30 per week. Now, when the income was shrunk to $20, the letters of \"Dillingham\" looked blurred, as though they were thinking seriously of contracting to a modest and unassuming D. But whenever Mr. James Dillingham Young came home and reached his flat above he was called \"Jim\" and greatly hugged by Mrs. James Dillingham Young, already introduced to you as Della. Which is all very good.",
        },
        TestScenario {
            name: "Scenario 4: Structured Technical Documentation",
            genre: "Numbered Lists, Acronyms & Colons",
            text: "Architectural Overview: Vocalis Studio employs a pipelined neural synthesis architecture. Key components include: 1: A single-instance ONNX runtime engine operating with four intra-op threads; 2: An ironclad safe runway gate requiring minimum buffer depth before playback; 3: Seamless Rodio audio sink feeding. Consequently, CPU utilization remains balanced, and buffer starvation is eliminated.",
        },
        TestScenario {
            name: "Scenario 5: Extreme Stress Test",
            genre: "Short Fragments, Ellipses, Em-dashes & Commas",
            text: "Look... here it is — finally! Yes, indeed. One, two, three, four, five. Stop. Go. Wait... are you sure? Yes, absolutely! We must proceed immediately, without any hesitation, or all our prior efforts will be lost forever.",
        },
    ];

    println!("[Init] Initializing Kokoro Neural Engine...");
    let t_init = Instant::now();
    native_kokoro::init(None).expect("Failed to initialize Kokoro engine");
    println!("[Init] Engine ready in {:.2}ms\n", t_init.elapsed().as_secs_f64() * 1000.0);

    let voice = "Sarah";
    let speed = 0.9f32;

    let mut results = Vec::new();

    for (idx, scenario) in scenarios.iter().enumerate() {
        println!("--------------------------------------------------------------------------------");
        println!("TEST {}/{}: {}", idx + 1, scenarios.len(), scenario.name);
        println!("Genre: {}", scenario.genre);
        println!("--------------------------------------------------------------------------------");

        let chunks = native_kokoro::split_into_speech_chunks(scenario.text);
        let word_count = scenario.text.split_whitespace().count();
        println!("  Text metrics: {} words -> split into {} speech chunks:", word_count, chunks.len());
        for (ci, c) in chunks.iter().enumerate() {
            println!("    Chunk [{}]: \"{}\" ({} words)", ci + 1, c, c.split_whitespace().count());
        }

        // Clean slate: reset any previous session
        let _ = native_kokoro::stop();
        std::thread::sleep(Duration::from_millis(50));

        // Start pipelined background synthesis (identical to user selecting text)
        println!("\n  [Action] Starting background pre-buffering (prebuffer_first_chunk)...");
        let t_start = Instant::now();
        native_kokoro::prebuffer_first_chunk(scenario.text, voice, speed);

        // Phase 1: Monitor runway unlatch
        let mut runway_time = None;
        let mut total_audio_dur = 0.0f32;
        let mut underruns = 0usize;
        let mut min_active_buffer_depth = f32::MAX;
        let mut peak_buffer_depth = 0.0f32;

        let poll_interval = Duration::from_millis(50);
        let max_wait = Duration::from_secs(60);

        // Wait for safe runway gate
        while t_start.elapsed() < max_wait {
            if let Some(stats) = native_kokoro::get_pipeline_session_stats(scenario.text, voice, speed) {
                if stats.is_runway_safe && runway_time.is_none() {
                    let elapsed = t_start.elapsed().as_secs_f32();
                    runway_time = Some(elapsed);
                    println!(
                        "  [RUNWAY SAFE] Gate unlatched at T = {:.2}s! (Ready chunks: {}/{}, Buffered audio: {:.2}s)",
                        elapsed, stats.ready_chunks, stats.total_chunks, stats.ready_audio_secs
                    );
                    break;
                }
            }
            std::thread::sleep(poll_interval);
        }

        let runway_secs = runway_time.expect("Timed out waiting for safe runway condition!");

        // Phase 2: Simulate real-time sound card playout
        // Playout consumes audio at configured speed (0.9x speed)
        println!("  [Action] Simulating playout consumption with 50ms buffer telemetry...");
        let playout_start = Instant::now();
        let mut last_reported_sec = 0;

        loop {
            let elapsed_real = playout_start.elapsed().as_secs_f32();
            let elapsed_audio_played = elapsed_real * speed;

            let stats = native_kokoro::get_pipeline_session_stats(scenario.text, voice, speed)
                .expect("Lost pipeline session during playback!");

            let buffered_audio = stats.ready_audio_secs;
            total_audio_dur = total_audio_dur.max(buffered_audio);

            // Buffer Depth B(t) = buffered audio in RAM - audio played on sound card
            let buffer_depth = buffered_audio - elapsed_audio_played;

            // Check for buffer underrun while synthesis is pending
            if buffer_depth <= 0.0 && !stats.is_fully_buffered {
                println!(
                    "  [UNDERRUN DETECTED] At playout t = {:.2}s: Buffer depth = {:.3}s (audio starved while synthesis pending!)",
                    elapsed_real, buffer_depth
                );
                underruns += 1;
            }

            // Track minimum buffer depth while background synthesis is actively generating chunks:
            if !stats.is_fully_buffered && buffer_depth < min_active_buffer_depth {
                min_active_buffer_depth = buffer_depth;
            }
            if buffer_depth > peak_buffer_depth {
                peak_buffer_depth = buffer_depth;
            }

            // Periodic heartbeat log every 2 seconds of playout
            let current_sec = elapsed_real as u32;
            if current_sec > 0 && current_sec % 2 == 0 && current_sec != last_reported_sec {
                last_reported_sec = current_sec;
                println!(
                    "    -> Playout t = {:.1}s: Buffer Depth B(t) = {:.2}s | Ready: {}/{} chunks ({:.1}s audio buffered)",
                    elapsed_real, buffer_depth, stats.ready_chunks, stats.total_chunks, buffered_audio
                );
            }

            // Finish condition: all chunks generated AND all audio played to the end
            if stats.is_fully_buffered && elapsed_audio_played >= buffered_audio {
                println!("  [Complete] All {} chunks synthesized and fully played out!", stats.total_chunks);
                break;
            }

            // Safety timeout: 2x total estimated audio
            if elapsed_real > 120.0 {
                panic!("Playout loop exceeded safety timeout!");
            }

            std::thread::sleep(poll_interval);
        }

        let min_margin = if min_active_buffer_depth == f32::MAX { total_audio_dur } else { min_active_buffer_depth };
        let passed = underruns == 0 && min_margin > 0.0;
        println!("\n  >>> VERIFICATION RESULT: {}", if passed { "PASSED (ZERO STALLS)" } else { "FAILED (STALL DETECTED)" });
        println!("      Runway Ready Time: {:.2}s", runway_secs);
        println!("      Total Audio Duration: {:.2}s", total_audio_dur);
        println!("      Minimum Active Buffer Depth B_min: {:.2}s (Safety margin above starvation)", min_margin);
        println!("      Peak Buffer Depth: {:.2}s", peak_buffer_depth);
        println!("      Underrun Events: {}\n", underruns);

        assert!(passed, "Test {} failed with underruns: {}", scenario.name, underruns);

        results.push((
            scenario.name,
            word_count,
            chunks.len(),
            total_audio_dur,
            runway_secs,
            min_margin,
            if passed { "PASS" } else { "FAIL" },
        ));
    }

    // Phase 3: Real Soundcard Playout Test using native_kokoro::speak
    println!("================================================================================");
    println!("PHASE 3: REAL HARDWARE SOUNDCARD PLAYOUT TEST (AudioPlayer / Rodio)");
    println!("================================================================================");
    let sample_text = "Voxify zero-stall audio pipeline fully verified across all test scenarios. Audio flows with zero pauses.";
    println!("Invoking native_kokoro::speak with live sound card playout...");
    let t_speak = Instant::now();
    native_kokoro::speak(sample_text, voice, speed).expect("speak() failed on real soundcard");

    // Wait for playback to finish
    std::thread::sleep(Duration::from_millis(200));
    while native_kokoro::is_speaking() {
        std::thread::sleep(Duration::from_millis(100));
    }
    println!("Live soundcard playback completed cleanly in {:.2}s!\n", t_speak.elapsed().as_secs_f32());

    // Final Summary Matrix
    println!("================================================================================");
    println!("                       AUTONOMOUS TEST HARNESS SUMMARY MATRIX                  ");
    println!("================================================================================");
    println!("{:<42} | {:<5} | {:<6} | {:<9} | {:<10} | {:<10} | {:<6}", "Scenario", "Words", "Chunks", "Audio (s)", "Runway (s)", "Min Buffer", "Status");
    println!("--------------------------------------------------------------------------------");
    for (name, words, chunks, audio_dur, runway, min_buf, status) in results {
        println!("{:<42} | {:<5} | {:<6} | {:<9.2} | {:<10.2} | {:<10.2} | {:<6}", name, words, chunks, audio_dur, runway, min_buf, status);
    }
    println!("================================================================================");
    println!("ALL 5 SCENARIOS PASSED WITH ZERO BUFFER UNDERRUNS AND ZERO PAUSES!");
    println!("================================================================================");
}
