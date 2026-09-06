# Voxify

Local, studio-grade neural text-to-speech desktop application powered by Kokoro-82M, ONNX Runtime, and Tauri v2.

## Features
- **Instant Speech & Selection Earcon**: Under 2ms acoustic earcon chime and fast pipelined neural streaming.
- **Authentic Human Prosody**: Full sentence prosodic integrity preserved without robotic mechanical chunking.
- **Deep Buffer Runway Pipeline**: Pipelined background synthesis that maintains a continuous 6+ second buffer reservoir, eliminating playback pauses or underruns.
- **Global Selection Reader**: Select text in any desktop app (browser, PDF reader, editor, Word) and Voxify speaks immediately.
- **Comprehensive Text Normalization**: Handles honorifics, middle initials, Latin citations, units of measurement, dialogue attribution tags, markdown links, and HTML tags effortlessly.

## Architecture Documentation
For the complete technical specification, core invariants, abbreviation registry, clause splitting algorithm, and testing guide, see:
- [Audio Engine Architecture & Invariants](docs/AUDIO_ENGINE_ARCHITECTURE.md)

## Development & Verification
To run the full automated verification test suite:
```powershell
cd src-tauri
cargo test --lib -- --nocapture
```

To run the application locally:
```powershell
.\start-voxify.bat
# Or
npm run tauri dev
```
