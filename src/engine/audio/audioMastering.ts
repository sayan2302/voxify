export interface MasteringConfig {
  targetLufs: number; // e.g. -18 LUFS
  sentencePauseMs: number; // e.g. 350ms
  paragraphPauseMs: number; // e.g. 750ms
  chapterPauseMs: number; // e.g. 1500ms
  ambientSound: 'none' | 'rain' | 'tape-warmth' | 'library';
  ambientVolume: number; // 0.0 to 1.0 (default: 0.12)
}

export const DEFAULT_MASTERING_CONFIG: MasteringConfig = {
  targetLufs: -18,
  sentencePauseMs: 350,
  paragraphPauseMs: 700,
  chapterPauseMs: 1500,
  ambientSound: 'none',
  ambientVolume: 0.12,
};

export class AudioMasteringEngine {
  private static instance: AudioMasteringEngine | null = null;
  private audioCtx: AudioContext | null = null;
  private currentSourceNode: AudioBufferSourceNode | null = null;
  private ambientSourceNode: AudioBufferSourceNode | null = null;
  private ambientGainNode: GainNode | null = null;
  private isPlaying: boolean = false;
  private scheduledStreamSources: AudioBufferSourceNode[] = [];
  private nextStreamScheduleTime: number = 0;

  private constructor() {}

  public static getInstance(): AudioMasteringEngine {
    if (!AudioMasteringEngine.instance) {
      AudioMasteringEngine.instance = new AudioMasteringEngine();
    }
    return AudioMasteringEngine.instance;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtx({ sampleRate: 24000 });
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Normalize an AudioBuffer to target LUFS / RMS
   */
  public normalizeLufs(buffer: AudioBuffer, targetLufs: number = -18): AudioBuffer {
    const ctx = this.getContext();
    const channelData = buffer.getChannelData(0);
    
    // Calculate RMS (Root Mean Square) as a fast, reliable loudness approximation
    let sumSquares = 0;
    for (let i = 0; i < channelData.length; i++) {
      sumSquares += channelData[i] * channelData[i];
    }
    const rms = Math.sqrt(sumSquares / channelData.length);
    if (rms === 0) return buffer;

    // Convert target LUFS to linear scale (approx: 10^(targetLufs / 20))
    const targetLinear = Math.pow(10, targetLufs / 20);
    const gainFactor = Math.min(2.5, Math.max(0.4, targetLinear / (rms + 1e-6)));

    const normalized = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const output = normalized.getChannelData(0);

    for (let i = 0; i < channelData.length; i++) {
      // Apply gain with soft-knee limiter to prevent clipping
      const val = channelData[i] * gainFactor;
      output[i] = Math.tanh(val);
    }

    return normalized;
  }

  /**
   * Create an AudioBuffer of pure natural silence of given duration
   */
  public createSilence(durationMs: number): AudioBuffer {
    const ctx = this.getContext();
    const sampleRate = ctx.sampleRate;
    const numSamples = Math.floor((durationMs / 1000) * sampleRate);
    return ctx.createBuffer(1, Math.max(1, numSamples), sampleRate);
  }

  /**
   * Concatenate multiple AudioBuffers with optional pauses
   */
  public concatenateBuffers(buffers: AudioBuffer[], pauseMs: number = 0): AudioBuffer {
    const ctx = this.getContext();
    if (buffers.length === 0) return ctx.createBuffer(1, 1, 24000);
    if (buffers.length === 1 && pauseMs === 0) return buffers[0];

    const sampleRate = buffers[0].sampleRate;
    const pauseSamples = Math.floor((pauseMs / 1000) * sampleRate);

    let totalLength = 0;
    for (let i = 0; i < buffers.length; i++) {
      totalLength += buffers[i].length;
      if (i < buffers.length - 1) {
        totalLength += pauseSamples;
      }
    }

    const output = ctx.createBuffer(1, totalLength, sampleRate);
    const outData = output.getChannelData(0);
    let offset = 0;

    for (let i = 0; i < buffers.length; i++) {
      const bData = buffers[i].getChannelData(0);
      outData.set(bData, offset);
      offset += bData.length;
      if (i < buffers.length - 1) {
        offset += pauseSamples;
      }
    }

    return output;
  }

  /**
   * Generate procedural subtle ambient sound (e.g. warm analog tape hiss or gentle rain)
   */
  public generateAmbientBuffer(type: 'rain' | 'tape-warmth' | 'library', durationSec: number = 10): AudioBuffer {
    const ctx = this.getContext();
    const sampleRate = ctx.sampleRate;
    const numSamples = sampleRate * durationSec;
    const buffer = ctx.createBuffer(1, numSamples, sampleRate);
    const data = buffer.getChannelData(0);

    let lastVal = 0;
    for (let i = 0; i < numSamples; i++) {
      // Pink noise filter for tape warmth or soft rain texture
      const white = Math.random() * 2 - 1;
      const pink = (lastVal + (0.02 * white)) / 1.02;
      lastVal = pink;

      if (type === 'tape-warmth') {
        data[i] = pink * 0.08;
      } else if (type === 'rain') {
        // Rain droplets modulation
        const droplet = Math.random() > 0.997 ? (Math.random() * 0.3) : 0;
        data[i] = (pink * 0.1) + droplet;
      } else {
        data[i] = pink * 0.04;
      }
    }

    return buffer;
  }

  /**
   * Play an AudioBuffer with playback event callbacks
   */
  public async playBuffer(
    buffer: AudioBuffer,
    onEnded?: () => void,
    ambient: 'none' | 'rain' | 'tape-warmth' | 'library' = 'none',
    ambientVol: number = 0.12
  ): Promise<AudioBufferSourceNode> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        console.warn('AudioContext resume error:', err);
      }
    }
    this.stop();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // Start subtle ambient loop if requested
    if (ambient !== 'none') {
      try {
        const ambBuffer = this.generateAmbientBuffer(ambient, 8);
        this.ambientSourceNode = ctx.createBufferSource();
        this.ambientSourceNode.buffer = ambBuffer;
        this.ambientSourceNode.loop = true;

        this.ambientGainNode = ctx.createGain();
        this.ambientGainNode.gain.value = ambientVol;

        this.ambientSourceNode.connect(this.ambientGainNode);
        this.ambientGainNode.connect(ctx.destination);
        this.ambientSourceNode.start(0);
      } catch (err) {
        console.warn('Ambient playback error:', err);
      }
    }

    source.onended = () => {
      this.isPlaying = false;
      this.stopAmbient();
      onEnded?.();
    };

    source.start(0);
    this.currentSourceNode = source;
    this.isPlaying = true;
    return source;
  }

  /**
   * Play an initial clause AudioBuffer immediately (< 1s TTFB) while remaining
   * audio is being synthesized in the background, transitioning seamlessly.
   */
  public async playBufferSequence(
    firstBuffer: AudioBuffer,
    getRemainingBuffer: () => Promise<AudioBuffer | null>,
    onEnded?: () => void,
    ambient: 'none' | 'rain' | 'tape-warmth' | 'library' = 'none',
    ambientVol: number = 0.12
  ): Promise<void> {
    await this.playBuffer(
      firstBuffer,
      async () => {
        if (!this.isPlaying) {
          return;
        }

        try {
          const remaining = await getRemainingBuffer();
          if (remaining && remaining.length > 0) {
            await this.playBuffer(remaining, onEnded, ambient, ambientVol);
          } else {
            onEnded?.();
          }
        } catch (err) {
          console.warn('Sequence remaining buffer error:', err);
          onEnded?.();
        }
      },
      ambient,
      ambientVol
    );
  }

  /**
   * Start a new gapless hardware-clock streaming playback session
   */
  public startStreamSession(): void {
    this.stop();
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    this.nextStreamScheduleTime = ctx.currentTime;
    this.scheduledStreamSources = [];
    this.isPlaying = true;
  }

  /**
   * Schedule a streaming AudioBuffer chunk on the Web Audio hardware DAC clock.
   * If scheduled while another chunk is playing, it is queued seamlessly with 0ms gap.
   */
  public scheduleStreamingChunk(
    buffer: AudioBuffer,
    pauseAfterSec: number = 0,
    onEnded?: () => void
  ): AudioBufferSourceNode {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    // Align with previous chunk boundary or start immediately
    const startAt = Math.max(now, this.nextStreamScheduleTime);
    source.start(startAt);

    this.nextStreamScheduleTime = startAt + buffer.duration + pauseAfterSec;
    this.scheduledStreamSources.push(source);
    this.isPlaying = true;

    source.onended = () => {
      const idx = this.scheduledStreamSources.indexOf(source);
      if (idx !== -1) {
        this.scheduledStreamSources.splice(idx, 1);
      }
      onEnded?.();
      if (this.scheduledStreamSources.length === 0 && ctx.currentTime >= this.nextStreamScheduleTime - 0.05) {
        this.isPlaying = false;
      }
    };

    return source;
  }

  public stop(): void {
    if (this.currentSourceNode) {
      try {
        this.currentSourceNode.onended = null;
        this.currentSourceNode.stop();
        this.currentSourceNode.disconnect();
      } catch {}
      this.currentSourceNode = null;
    }

    // Stop all scheduled streaming chunks immediately
    for (const src of this.scheduledStreamSources) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {}
    }
    this.scheduledStreamSources = [];
    this.nextStreamScheduleTime = 0;

    this.stopAmbient();
    this.isPlaying = false;
  }

  private stopAmbient(): void {
    if (this.ambientSourceNode) {
      try {
        this.ambientSourceNode.stop();
        this.ambientSourceNode.disconnect();
      } catch {}
      this.ambientSourceNode = null;
    }
  }

  /**
   * Convert AudioBuffer to WAV Blob for immediate download
   */
  public exportToWavBlob(buffer: AudioBuffer): Blob {
    const numChannels = 1;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    const channelData = buffer.getChannelData(0);
    const dataLength = channelData.length * (bitDepth / 8);
    const bufferLength = 44 + dataLength;

    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    // RIFF chunk descriptor
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    this.writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
    view.setUint16(32, numChannels * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);

    // data sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // Write PCM 16-bit audio
    let offset = 44;
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  private writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}
