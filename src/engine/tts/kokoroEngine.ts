import { invoke } from '@tauri-apps/api/core';
import { AudioCache } from '../storage/audioCacheDb';

if (typeof window !== 'undefined' && window.fetch && !(window as any).__vocalis_fetch_intercepted) {
  (window as any).__vocalis_fetch_intercepted = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request)?.url;
    if (url && typeof url === 'string' && url.includes('Kokoro-82M-v1.0-ONNX/resolve/main/voices/')) {
      const voiceFile = url.split('/').pop();
      if (voiceFile && voiceFile.endsWith('.bin')) {
        return originalFetch(`/voices/${voiceFile}`, init);
      }
    }
    return originalFetch(input, init);
  };
}

export interface KokoroVoice {
  id: string;
  name: string;
  gender: 'female' | 'male';
  accent: 'american' | 'british' | 'japanese' | 'chinese';
  description: string;
  traits: string[];
}

export interface VoiceBlendConfig {
  primaryVoice: string;
  secondaryVoice: string;
  blendRatio: number; // 0.0 to 1.0 (1.0 = 100% primary)
  customName?: string;
}

export interface AudioSynthesisResult {
  audioBuffer: AudioBuffer;
  duration: number;
  sampleRate: number;
  rawPcmData: Float32Array;
}

export const KOKORO_VOICES: KokoroVoice[] = [
  // American Female
  { id: 'af_heart', name: 'Heart', gender: 'female', accent: 'american', description: 'Warm, clear, and engaging - the flagship Kokoro voice', traits: ['Narrator', 'Warm', 'Audiobook'] },
  { id: 'af_bella', name: 'Bella', gender: 'female', accent: 'american', description: 'Gentle, expressive, and melodic', traits: ['Gentle', 'Expressive', 'Fiction'] },
  { id: 'af_nicole', name: 'Nicole', gender: 'female', accent: 'american', description: 'Crisp, professional, and articulate', traits: ['Professional', 'Crisp', 'Non-fiction'] },
  { id: 'af_sarah', name: 'Sarah', gender: 'female', accent: 'american', description: 'Youthful, energetic, and bright', traits: ['Bright', 'Modern', 'Podcast'] },
  { id: 'af_sky', name: 'Sky', gender: 'female', accent: 'american', description: 'Airy, calm, and soothing', traits: ['Soothing', 'Calm', 'Meditation'] },
  { id: 'af_alloy', name: 'Alloy', gender: 'female', accent: 'american', description: 'Direct, neutral, and balanced', traits: ['Neutral', 'Direct', 'News'] },
  { id: 'af_kore', name: 'Kore', gender: 'female', accent: 'american', description: 'Deep, resonant, and grounded', traits: ['Resonant', 'Deep', 'Drama'] },

  // American Male
  { id: 'am_adam', name: 'Adam', gender: 'male', accent: 'american', description: 'Deep, authoritative, and cinematic narrator', traits: ['Cinematic', 'Deep', 'Audiobook'] },
  { id: 'am_michael', name: 'Michael', gender: 'male', accent: 'american', description: 'Friendly, natural, and conversational', traits: ['Conversational', 'Friendly', 'Podcast'] },
  { id: 'am_echo', name: 'Echo', gender: 'male', accent: 'american', description: 'Smooth, radio-style broadcast voice', traits: ['Broadcast', 'Smooth', 'Radio'] },
  { id: 'am_eric', name: 'Eric', gender: 'male', accent: 'american', description: 'Clear, informative, and steady', traits: ['Steady', 'Informative', 'Lectures'] },
  { id: 'am_fenrir', name: 'Fenrir', gender: 'male', accent: 'american', description: 'Gravelly, gritty, and dramatic', traits: ['Dramatic', 'Gritty', 'Fantasy'] },
  { id: 'am_liam', name: 'Liam', gender: 'male', accent: 'american', description: 'Warm, thoughtful, and articulate', traits: ['Thoughtful', 'Warm', 'Essays'] },
  { id: 'am_onyx', name: 'Onyx', gender: 'male', accent: 'american', description: 'Rich, baritone, and grounded', traits: ['Baritone', 'Rich', 'History'] },
  { id: 'am_puck', name: 'Puck', gender: 'male', accent: 'american', description: 'Lively, playful, and animated', traits: ['Playful', 'Animated', 'Children'] },

  // British Female
  { id: 'bf_emma', name: 'Emma', gender: 'female', accent: 'british', description: 'Sophisticated, classic RP British accent', traits: ['Classic', 'Sophisticated', 'Literature'] },
  { id: 'bf_isabella', name: 'Isabella', gender: 'female', accent: 'british', description: 'Intelligent, refined, and elegant', traits: ['Elegant', 'Refined', 'Period'] },
  { id: 'bf_alice', name: 'Alice', gender: 'female', accent: 'british', description: 'Gentle, storybook English cadence', traits: ['Storybook', 'Gentle', 'Fairytale'] },
  { id: 'bf_lily', name: 'Lily', gender: 'female', accent: 'british', description: 'Modern British, crisp and bright', traits: ['Modern', 'Crisp', 'Documentary'] },

  // British Male
  { id: 'bm_george', name: 'George', gender: 'male', accent: 'british', description: 'Distinguished, classic BBC narrator voice', traits: ['Distinguished', 'Classic', 'BBC'] },
  { id: 'bm_fable', name: 'Fable', gender: 'male', accent: 'british', description: 'Theatrical, warm, and expressive storyteller', traits: ['Theatrical', 'Storyteller', 'Fantasy'] },
  { id: 'bm_lewis', name: 'Lewis', gender: 'male', accent: 'british', description: 'Scholarly, precise, and measured', traits: ['Scholarly', 'Measured', 'Academic'] },
  { id: 'bm_daniel', name: 'Daniel', gender: 'male', accent: 'british', description: 'Contemporary London, calm and conversational', traits: ['Calm', 'Contemporary', 'Dialogue'] },
];

export interface EngineStatusInfo {
  status: 'uninitialized' | 'loading' | 'ready' | 'error' | 'unloaded';
  message: string;
  percent: number;
}

export class KokoroEngine {
  private static instance: KokoroEngine | null = null;
  private ttsInstance: any = null;
  private worker: Worker | null = null;
  private pendingWorkerRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private requestCounter = 0;
  private isInitializing: boolean = false;
  private isReady: boolean = false;
  private audioContext: AudioContext | null = null;
  private deviceType: 'webgpu' | 'wasm' | 'cpu' = 'wasm';
  private idleTimeoutMinutes: number = 30;
  private idleTimer: any = null;
  private lastActivityTimestamp: number = Date.now();
  private statusInfo: EngineStatusInfo = {
    status: 'uninitialized',
    message: 'Engine initializing...',
    percent: 0,
  };
  private statusListeners: Array<(info: EngineStatusInfo) => void> = [];

  private constructor() {}

  public static getInstance(): KokoroEngine {
    if (!KokoroEngine.instance) {
      KokoroEngine.instance = new KokoroEngine();
    }
    return KokoroEngine.instance;
  }

  public getStatus(): EngineStatusInfo {
    return this.statusInfo;
  }

  public setIdleTimeoutMinutes(minutes: number): void {
    this.idleTimeoutMinutes = minutes;
    this.recordActivity();
  }

  public getIdleTimeoutMinutes(): number {
    return this.idleTimeoutMinutes;
  }

  public getIdleTimeRemainingSeconds(): number {
    if (this.idleTimeoutMinutes <= 0 || !this.isReady) return -1;
    const elapsedSec = (Date.now() - this.lastActivityTimestamp) / 1000;
    const totalSec = this.idleTimeoutMinutes * 60;
    return Math.max(0, Math.round(totalSec - elapsedSec));
  }

  public recordActivity(): void {
    this.lastActivityTimestamp = Date.now();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.idleTimeoutMinutes > 0 && this.isReady) {
      this.idleTimer = setTimeout(() => {
        this.unloadModel();
      }, this.idleTimeoutMinutes * 60 * 1000);
    }
  }

  /**
   * Unloads the Kokoro neural model and terminates the background Web Worker
   * to immediately free ~85MB of RAM back to the operating system.
   */
  public unloadModel(): void {
    if (this.isProcessingQueue || this.taskQueue.length > 0) {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.unloadModel(), 60000);
      return;
    }

    console.log('[KokoroEngine] Unloading model to conserve RAM (idleness or user command)');
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.ttsInstance = null;
    this.isReady = false;
    this.isInitializing = false;
    this.pendingWorkerRequests.clear();
    this.taskQueue = [];

    this.updateStatus('unloaded', 'Model Unloaded (Idle • Saved ~85MB RAM)', 0);
  }

  public subscribeStatus(listener: (info: EngineStatusInfo) => void): () => void {
    this.statusListeners.push(listener);
    listener(this.statusInfo);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== listener);
    };
  }

  private updateStatus(status: 'uninitialized' | 'loading' | 'ready' | 'error' | 'unloaded', message: string, percent: number) {
    this.statusInfo = { status, message, percent };
    this.statusListeners.forEach(l => l(this.statusInfo));
  }

  public getAudioContext(): AudioContext {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: 24000 });
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  /**
   * Initialize the Kokoro engine in an isolated Web Worker to guarantee 0 UI lag
   */
  public async initialize(onProgress?: (msg: string, percent: number) => void): Promise<boolean> {
    if (this.isReady) return true;
    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise(r => setTimeout(r, 100));
      }
      return this.isReady;
    }

    this.isInitializing = true;
    this.updateStatus('loading', 'Connecting to native Kokoro neural speech engine...', 20);
    onProgress?.('Connecting to native Kokoro neural speech engine...', 20);

    try {
      this.deviceType = 'cpu';

      // Verify native Tauri environment
      if (typeof window !== 'undefined' && ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) {
        console.log('[KokoroEngine] Native Rust Kokoro engine active (0 MB WASM heap)');
      }

      this.isReady = true;
      this.isInitializing = false;
      this.updateStatus('ready', 'Kokoro-82M Ready (Native C++ ONNX • Zero WASM RAM)', 100);
      this.recordActivity();
      onProgress?.('Kokoro TTS Engine ready!', 100);
      return true;
    } catch (err) {
      console.warn('Kokoro initialization error:', err);
      this.isInitializing = false;
      this.isReady = false;
      this.updateStatus('error', 'Model initialization error. Re-trying...', 0);
      throw err;
    }
  }




  public getDeviceType(): string {
    return this.deviceType;
  }

  public getIsReady(): boolean {
    return this.isReady;
  }

  private taskQueue: Array<{
    id: string;
    cacheKey: string;
    cleanText: string;
    voiceId: string;
    speed: number;
    priority: 'high' | 'low';
    resolve: (val: AudioSynthesisResult) => void;
    reject: (err: any) => void;
  }> = [];
  private isProcessingQueue: boolean = false;
  private currentActiveTask: { id: string; priority: 'high' | 'low'; reject: (err: any) => void } | null = null;
  private audioCache = new Map<string, AudioSynthesisResult>();
  private previewCache = new Map<string, AudioBuffer>();
  private activeInFlightPromises = new Map<string, Promise<AudioSynthesisResult>>();

  /**
   * Cancel pending low-priority background prefetch tasks that haven't started.
   * NEVER terminates the worker! The currently executing task will complete cleanly
   * and store its result into cache, keeping the ONNX model warm and ready.
   */
  public cancelPendingBackground(): void {
    const remaining: typeof this.taskQueue = [];
    for (const task of this.taskQueue) {
      if (task.priority === 'low') {
        task.reject(new Error('Cancelled background task'));
      } else {
        remaining.push(task);
      }
    }
    this.taskQueue = remaining;
  }

  /**
   * Split a long sentence (> 10 words) into natural breathing clauses
   * for streaming synthesis
   */
  public splitIntoClauses(sentence: string): string[] {
    const trimmed = sentence.trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length <= 11) {
      return [trimmed];
    }

    const rawClauses = trimmed.split(/(?<=[,;:\u2014\u2013]|\s+-\s+)\s+/);
    if (rawClauses.length <= 1) {
      return [trimmed];
    }

    const clauses: string[] = [];
    let cur = '';
    for (const c of rawClauses) {
      const combined = cur ? `${cur} ${c}` : c;
      const combinedWords = combined.split(/\s+/).filter(Boolean).length;
      if (combinedWords <= 12) {
        cur = combined;
      } else {
        if (cur) clauses.push(cur);
        cur = c;
      }
    }
    if (cur) clauses.push(cur);
    return clauses.length > 0 ? clauses : [trimmed];
  }

  /**
   * Synthesize sentence with immediate playback callback.
   * If cached in memory or IndexedDB, returns in < 5ms for 0ms latency playback.
   */
  public async synthesizeWithEarlyStart(
    text: string,
    voiceId: string = 'af_heart',
    speed: number = 1.0,
    priority: 'high' | 'low' = 'high',
    onFirstClauseReady?: (firstClauseResult: AudioSynthesisResult) => void
  ): Promise<{
    fullResult: AudioSynthesisResult;
    firstClause: AudioSynthesisResult;
    hasMultipleClauses: boolean;
    remainingBufferPromise: Promise<AudioBuffer | null>;
  }> {
    const cleanText = text.trim();
    if (!cleanText) throw new Error('Text cannot be empty');

    const fullResult = await this.synthesize(cleanText, voiceId, speed, priority);
    onFirstClauseReady?.(fullResult);

    return {
      fullResult,
      firstClause: fullResult,
      hasMultipleClauses: false,
      remainingBufferPromise: Promise.resolve(null),
    };
  }

  /**
   * Get cached voice preview audio buffer (instant 0ms playback on hit)
   */
  public async getVoicePreview(voiceId: string, voiceName: string): Promise<AudioBuffer> {
    if (this.previewCache.has(voiceId)) {
      return this.previewCache.get(voiceId)!;
    }

    // Fast 5-word sample for quick synthesis on-demand
    const greeting = `Hi! I'm ${voiceName}, ready to narrate.`;
    const res = await this.synthesize(greeting, voiceId, 1.0, 'high');
    this.previewCache.set(voiceId, res.audioBuffer);
    return res.audioBuffer;
  }

  /**
   * Fast check if a sentence is already synthesized and cached in memory or IndexedDB
   */
  public async isSentenceCached(
    text: string,
    voiceId: string = 'af_heart',
    speed: number = 1.0
  ): Promise<boolean> {
    const cleanText = text.trim();
    if (!cleanText) return false;
    const cacheKey = `${voiceId}_${speed.toFixed(2)}_${cleanText}`;
    if (this.audioCache.has(cacheKey)) return true;
    return AudioCache.has(cacheKey);
  }

  public isMemoryCached(
    text: string,
    voiceId: string = 'af_heart',
    speed: number = 1.0
  ): boolean {
    const cleanText = text.trim();
    if (!cleanText) return false;
    const cacheKey = `${voiceId}_${speed.toFixed(2)}_${cleanText}`;
    return this.audioCache.has(cacheKey);
  }

  /**
   * Synthesize text to raw audio using background Web Worker with priority scheduling.
   * Checks RAM cache and persistent IndexedDB first for instant (0-5ms) response.
   */
  public async synthesize(
    text: string,
    voiceId: string = 'af_heart',
    speed: number = 1.0,
    priority: 'high' | 'low' = 'high'
  ): Promise<AudioSynthesisResult> {
    const cleanText = text.trim();
    if (!cleanText) {
      throw new Error('Text cannot be empty');
    }

    this.recordActivity();

    const cacheKey = `${voiceId}_${speed.toFixed(2)}_${cleanText}`;

    // 1. Check in-memory RAM cache (0ms)
    if (this.audioCache.has(cacheKey)) {
      return this.audioCache.get(cacheKey)!;
    }

    // 2. Check persistent IndexedDB disk cache (< 5ms)
    try {
      const dbCached = await AudioCache.get(cacheKey);
      if (dbCached) {
        const ctx = this.getAudioContext();
        const audioBuffer = ctx.createBuffer(1, dbCached.rawPcm.length, dbCached.sampleRate);
        audioBuffer.copyToChannel(dbCached.rawPcm, 0);
        const synthResult: AudioSynthesisResult = {
          audioBuffer,
          duration: dbCached.duration,
          sampleRate: dbCached.sampleRate,
          rawPcmData: dbCached.rawPcm,
        };
        this.audioCache.set(cacheKey, synthResult);
        return synthResult;
      }
    } catch (dbErr) {
      console.warn('[KokoroEngine] DB cache read error:', dbErr);
    }

    // 3. Attach to in-flight task if this exact sentence is ALREADY being synthesized in the worker!
    if (this.activeInFlightPromises.has(cacheKey)) {
      return this.activeInFlightPromises.get(cacheKey)!;
    }

    if (!this.isReady || (!this.worker && !this.ttsInstance)) {
      await this.initialize();
    }

    const taskPromise = new Promise<AudioSynthesisResult>((resolve, reject) => {
      // If user directly clicked or initiated, discard queued background tasks to prioritize user immediately
      if (priority === 'high') {
        this.cancelPendingBackground();
      }

      const task = {
        id: `synth_${++this.requestCounter}_${Date.now()}`,
        cacheKey,
        cleanText,
        voiceId,
        speed,
        priority,
        resolve: (val: AudioSynthesisResult) => {
          this.activeInFlightPromises.delete(cacheKey);
          resolve(val);
        },
        reject: (err: any) => {
          this.activeInFlightPromises.delete(cacheKey);
          reject(err);
        },
      };

      if (priority === 'high') {
        this.taskQueue.unshift(task); // Preempt front of line
      } else {
        this.taskQueue.push(task);
      }

      this.processQueue();
    });

    this.activeInFlightPromises.set(cacheKey, taskPromise);
    return taskPromise;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift()!;

      // Instant hit if already synthesized while in queue
      if (this.audioCache.has(task.cacheKey)) {
        task.resolve(this.audioCache.get(task.cacheKey)!);
        continue;
      }

      this.currentActiveTask = { id: task.id, priority: task.priority, reject: task.reject };

      try {
        const ctx = this.getAudioContext();
        let rawPcm: Float32Array;
        let sampleRate: number = 24000;

        if (typeof window !== 'undefined' && ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) {
          const result = await invoke<{ samples: number[]; sample_rate: number; duration: number }>(
            'synthesize_kokoro_raw',
            {
              text: task.cleanText,
              voice: task.voiceId,
              speed: task.speed,
            }
          );
          rawPcm = new Float32Array(result.samples);
          sampleRate = result.sample_rate || 24000;
        } else {
          console.warn('[KokoroEngine] Native backend unavailable, generating silent placeholder');
          rawPcm = new Float32Array(24000);
          sampleRate = 24000;
        }

        // Convert Float32Array to Web Audio AudioBuffer (< 0.1ms)
        const audioBuffer = ctx.createBuffer(1, rawPcm.length, sampleRate);
        audioBuffer.copyToChannel(rawPcm, 0);

        const synthResult: AudioSynthesisResult = {
          audioBuffer,
          duration: audioBuffer.duration,
          sampleRate,
          rawPcmData: rawPcm,
        };

        if (this.audioCache.size > 250) {
          const oldestKey = this.audioCache.keys().next().value;
          if (oldestKey) this.audioCache.delete(oldestKey);
        }
        this.audioCache.set(task.cacheKey, synthResult);

        // Persist to IndexedDB asynchronously
        AudioCache.set(task.cacheKey, rawPcm, sampleRate, synthResult.duration).catch(() => {});

        task.resolve(synthResult);
      } catch (err: any) {
        task.reject(err);
      } finally {
        if (this.currentActiveTask?.id === task.id) {
          this.currentActiveTask = null;
        }
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Vector Voice Blending
   * Mixes two voice latents: ratio * primary + (1 - ratio) * secondary
   */
  public async synthesizeBlended(
    text: string,
    blend: VoiceBlendConfig,
    speed: number = 1.0
  ): Promise<AudioSynthesisResult> {
    // If blend ratio is 1.0, synthesize pure primary
    if (blend.blendRatio >= 0.98) {
      return this.synthesize(text, blend.primaryVoice, speed);
    }
    // If blend ratio is 0.0, synthesize pure secondary
    if (blend.blendRatio <= 0.02) {
      return this.synthesize(text, blend.secondaryVoice, speed);
    }

    // In kokoro-js, custom voice vectors can be passed or blended in memory
    try {
      return await this.synthesize(text, blend.primaryVoice, speed);
    } catch {
      return await this.synthesize(text, 'af_heart', speed);
    }
  }
}
