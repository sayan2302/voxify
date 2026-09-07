import React, { useState, useEffect, useRef } from 'react';
import { MiniPillPlayer } from './components/floating/MiniPillPlayer';
import {
  Sparkles,
  Volume2,
  MousePointer,
  Copy,
  Keyboard,
  Sliders,
  ShieldCheck,
  ArrowDownRight,
  Bell,
  Play,
  Square,
  Check,
  Zap,
  Minimize2,
} from 'lucide-react';
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export interface HudStatusPayload {
  status: 'ready' | 'staging' | 'synthesizing' | 'speaking' | 'finished' | 'idle' | 'buffering';
  text: string;
  voiceName: string;
  speed: number;
  wordCount?: number;
}

export interface KokoroVoiceInfo {
  id: string;
  name: string;
  sid: number;
  gender: string;
  description: string;
}

export interface AutoReadConfig {
  auto_read_selection: boolean;
  auto_read_copy: boolean;
  settle_delay_ms: number;
  earcon_enabled: boolean;
}

const FALLBACK_VOICES: KokoroVoiceInfo[] = [
  { id: 'af_sarah', name: 'Sarah', sid: 1, gender: 'female', description: 'Youthful, bright, and natural podcast narrator' },
  { id: 'af_bella', name: 'Bella', sid: 0, gender: 'female', description: 'Gentle, melodic, and expressive' },
  { id: 'am_adam', name: 'Adam', sid: 2, gender: 'male', description: 'Deep, authoritative, and cinematic narrator' },
  { id: 'af_nicole', name: 'Nicole', sid: 8, gender: 'female', description: 'Articulate, crisp, and professional' },
  { id: 'af_sky', name: 'Sky', sid: 9, gender: 'female', description: 'Calm, airy, and soothing' },
  { id: 'am_michael', name: 'Michael', sid: 3, gender: 'male', description: 'Conversational, natural, and friendly' },
  { id: 'bf_emma', name: 'Emma', sid: 4, gender: 'female', description: 'British English, warm and clear' },
  { id: 'bf_isabella', name: 'Isabella', sid: 5, gender: 'female', description: 'British English, melodic and refined' },
  { id: 'bm_george', name: 'George', sid: 6, gender: 'male', description: 'British English, resonant and polished' },
  { id: 'bm_lewis', name: 'Lewis', sid: 7, gender: 'male', description: 'British English, rich and engaging' },
  { id: 'am_eric', name: 'Eric', sid: 10, gender: 'male', description: 'Clear, informative, and steady' },
];

/**
 * Standalone Ultra-Lightweight HUD Window Component
 * Runs when ?mode=mini-pill is loaded - consumes ~0MB RAM, displays the floating audio pill.
 */
function MiniPillStandalone() {
  const [hudStatus, setHudStatus] = useState<HudStatusPayload>({
    status: 'idle',
    text: '',
    voiceName: 'Sarah',
    speed: 1.0,
  });
  const [isPrebufferReady, setIsPrebufferReady] = useState<boolean>(false);
  const [isRunwaySafe, setIsRunwaySafe] = useState<boolean>(false);
  const [bufferedChunks, setBufferedChunks] = useState<number>(0);
  const [totalChunks, setTotalChunks] = useState<number>(0);
  const [pillPhase, setPillPhase] = useState<'compact' | 'expanding' | 'controls'>('compact');
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const finishTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('mini-pill-mode');
    document.body.classList.add('mini-pill-mode');

    let unlistenStatus: (() => void) | null = null;
    let unlistenText: (() => void) | null = null;
    let unlistenPrebuffer: (() => void) | null = null;

    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

    if (isTauri) {
      listen<HudStatusPayload>('global-hud-status', (event) => {
        if (event.payload) {
          if (event.payload.status === 'staging') {
            setIsPrebufferReady(false);
            setIsRunwaySafe(false);
            setBufferedChunks(0);
            setTotalChunks(0);
            setPillPhase('compact');
            if (idleTimerRef.current) {
              clearTimeout(idleTimerRef.current);
              idleTimerRef.current = null;
            }
            if (finishTimerRef.current) {
              clearTimeout(finishTimerRef.current);
              finishTimerRef.current = null;
            }
          }
          setHudStatus(event.payload);
        }
      }).then((u) => { unlistenStatus = u; });

      listen<string>('global-selection-text', (event) => {
        if (event.payload) {
          setIsPrebufferReady(false);
          setIsRunwaySafe(false);
          setBufferedChunks(0);
          setTotalChunks(0);
          setPillPhase('compact');
          if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
          }
          if (finishTimerRef.current) {
            clearTimeout(finishTimerRef.current);
            finishTimerRef.current = null;
          }
          setHudStatus(prev => ({
            ...prev,
            status: 'staging',
            text: event.payload,
          }));
        }
      }).then((u) => { unlistenText = u; });

      listen<{ chunkIndex: number; totalChunks?: number; chunksBuffered: number; durationSecs: number; isRunwaySafe?: boolean }>('global-prebuffer-ready', (event) => {
        setIsPrebufferReady(true);
        if (event.payload) {
          setBufferedChunks(event.payload.chunksBuffered);
          if (event.payload.totalChunks) setTotalChunks(event.payload.totalChunks);
          if (event.payload.isRunwaySafe !== undefined) setIsRunwaySafe(event.payload.isRunwaySafe);
        }
      }).then((u) => { unlistenPrebuffer = u; });
    }

    return () => {
      unlistenStatus?.();
      unlistenText?.();
      unlistenPrebuffer?.();
    };
  }, []);

  // Auto-Dismiss lifecycle:
  // 1. 12s idle timeout starts when Play button actively blooms in 'controls' phase
  // 2. Pauses on hover
  // 3. 2.5s auto-close after speech completes ('finished' state)
  useEffect(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }

    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

    if (hudStatus.status !== 'speaking' && pillPhase === 'controls') {
      if (!isHovered) {
        idleTimerRef.current = setTimeout(() => {
          if (isTauri) {
            invoke('hide_quick_reader').catch(() => {});
          }
          setHudStatus(prev => ({ ...prev, status: 'idle' }));
          setPillPhase('compact');
        }, 12000);
      }
    } else if (hudStatus.status === 'finished') {
      finishTimerRef.current = setTimeout(() => {
        if (isTauri) {
          invoke('hide_quick_reader').catch(() => {});
        }
        setHudStatus(prev => ({ ...prev, status: 'idle' }));
        setPillPhase('compact');
      }, 2500);
    }

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
    };
  }, [hudStatus.status, pillPhase, isHovered]);

  const handleStop = () => {
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      invoke('stop_speech').catch(() => {});
      invoke('stop_kokoro_native').catch(() => {});
    }
    setHudStatus(prev => ({ ...prev, status: 'idle' }));
  };

  const handleTogglePlay = () => {
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (hudStatus.status === 'speaking') {
      handleStop();
    } else {
      if (isTauri) {
        invoke('play_selection').catch(() => {});
      }
      setHudStatus(prev => ({
        ...prev,
        status: 'speaking',
      }));
    }
  };

  const handleClose = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      invoke('stop_speech').catch(() => {});
      invoke('hide_quick_reader').catch(() => {});
    }
    setHudStatus(prev => ({ ...prev, status: 'idle' }));
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-transparent select-none m-0 p-0">
      <MiniPillPlayer
        currentText={hudStatus.text}
        isPlaying={hudStatus.status === 'speaking'}
        status={hudStatus.status}
        wordCount={hudStatus.wordCount}
        voiceName={hudStatus.voiceName}
        speed={hudStatus.speed}
        isPrebufferReady={isPrebufferReady}
        isRunwaySafe={isRunwaySafe}
        bufferedChunks={bufferedChunks}
        totalChunks={totalChunks}
        onPhaseChange={setPillPhase}
        onTogglePlay={handleTogglePlay}
        onClose={handleClose}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />
    </div>
  );
}

/**
 * Main Window: Preferences & Voice Control Card
 * Clean, modern, high-performance desktop control center for Voxify
 */
export function App() {
  const isMiniPillWindow =
    typeof window !== 'undefined' &&
    (window.location.search.includes('mode=mini-pill') || window.location.hash.includes('mini-pill'));

  if (isMiniPillWindow) {
    return <MiniPillStandalone />;
  }

  // Preferences & Engine State
  const [voices, setVoices] = useState<KokoroVoiceInfo[]>(FALLBACK_VOICES);
  const [selectedVoice, setSelectedVoice] = useState<string>('Sarah');
  const [speed, setSpeed] = useState<number>(1.0);
  const [autoReadSelection, setAutoReadSelection] = useState<boolean>(true);
  const [autoReadCopy, setAutoReadCopy] = useState<boolean>(false);
  const [earconEnabled, setEarconEnabled] = useState<boolean>(true);
  const [settleDelayMs, setSettleDelayMs] = useState<number>(10);
  const [auditioningVoice, setAuditioningVoice] = useState<string | null>(null);
  const [testPillActive, setTestPillActive] = useState<boolean>(false);

  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  // Load configuration from Rust backend
  useEffect(() => {
    if (isTauri) {
      // 1. Fetch available voices
      invoke<KokoroVoiceInfo[]>('get_kokoro_voices')
        .then((vList) => {
          if (vList && vList.length > 0) {
            setVoices(vList);
          }
        })
        .catch(() => {});

      // 2. Fetch current speed
      invoke<number>('get_kokoro_speed')
        .then((s) => {
          if (s && s > 0) setSpeed(s);
        })
        .catch(() => {});

      // 3. Fetch auto-read configuration
      invoke<AutoReadConfig>('get_auto_read_config')
        .then((config) => {
          if (config) {
            setAutoReadSelection(config.auto_read_selection);
            setAutoReadCopy(config.auto_read_copy);
            setSettleDelayMs(config.settle_delay_ms);
            setEarconEnabled(config.earcon_enabled);
          }
        })
        .catch(() => {});
    }
  }, [isTauri]);

  const handleVoiceSelect = (voiceName: string) => {
    setSelectedVoice(voiceName);
    if (isTauri) {
      invoke('set_kokoro_voice', { voice: voiceName }).catch(() => {});
    }
  };

  const handleSpeedChange = (newSpeed: number) => {
    setSpeed(newSpeed);
    if (isTauri) {
      invoke('set_kokoro_speed', { speed: newSpeed }).catch(() => {});
    }
  };

  const handleToggleAutoReadSelection = (enabled: boolean) => {
    setAutoReadSelection(enabled);
    if (isTauri) {
      invoke('set_auto_read_enabled', { enabled }).catch(() => {});
    }
  };

  const handleToggleAutoReadCopy = (enabled: boolean) => {
    setAutoReadCopy(enabled);
    if (isTauri) {
      invoke('set_auto_read_copy_enabled', { enabled }).catch(() => {});
    }
  };

  const handleToggleEarcon = (enabled: boolean) => {
    setEarconEnabled(enabled);
    if (isTauri) {
      invoke('set_earcon_enabled', { enabled }).catch(() => {});
    }
  };

  const handleSettleDelayChange = (delayMs: number) => {
    setSettleDelayMs(delayMs);
    if (isTauri) {
      invoke('set_settle_delay_ms', { delayMs }).catch(() => {});
    }
  };

  const handleAuditionVoice = (voiceName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (auditioningVoice === voiceName) {
      // Stop current audition
      setAuditioningVoice(null);
      if (isTauri) {
        invoke('stop_kokoro_native').catch(() => {});
      }
      return;
    }

    setAuditioningVoice(voiceName);
    if (isTauri) {
      invoke('speak_kokoro_native', {
        text: `Hello, I'm ${voiceName}. Voxify will read any text on your screen in my natural voice.`,
        voice: voiceName,
        speed: speed,
      }).catch(() => {});
    }

    // Reset audition state after preview
    setTimeout(() => {
      setAuditioningVoice(prev => (prev === voiceName ? null : prev));
    }, 4500);
  };

  const handlePreviewEarcon = () => {
    if (isTauri) {
      invoke('play_test_earcon').catch(() => {});
    }
  };

  const handleTestAudioPill = async () => {
    setTestPillActive(true);
    const sampleText = `Voxify Audio Pill is running! Select any text in any app to hear it read aloud in ${selectedVoice}'s natural human voice.`;
    const wordCount = sampleText.split(/\s+/).length;

    if (isTauri) {
      // 1. Show the HUD window at top-center
      await invoke('show_quick_reader').catch(() => {});

      // 2. Emit staging status and text to the floating pill
      await emit('global-selection-text', sampleText).catch(() => {});
      await emit('global-hud-status', {
        status: 'staging',
        text: sampleText,
        voiceName: selectedVoice,
        speed: speed,
        wordCount: wordCount,
      } as HudStatusPayload).catch(() => {});

      // 3. Trigger speech through native Kokoro
      setTimeout(async () => {
        await emit('global-hud-status', {
          status: 'speaking',
          text: sampleText,
          voiceName: selectedVoice,
          speed: speed,
          wordCount: wordCount,
        } as HudStatusPayload).catch(() => {});

        invoke('speak_kokoro_native', {
          text: sampleText,
          voice: selectedVoice,
          speed: speed,
        }).catch(() => {});
      }, 300);
    }

    setTimeout(() => setTestPillActive(false), 3000);
  };

  const handleHideToTray = () => {
    if (isTauri) {
      invoke('hide_main_window_to_tray').catch(() => {});
    }
  };

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 flex flex-col select-none font-sans overflow-hidden">
      {/* Top Header Bar */}
      <header className="px-6 py-4 border-b border-white/5 bg-slate-900/60 backdrop-blur-md flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-cyan-400 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 ring-1 ring-white/20">
            <Sparkles className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white">Voxify</h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Audio Pill
              </span>
            </div>
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
              <span>Kokoro-82M ONNX · 100% Offline Multi-Threaded</span>
            </p>
          </div>
        </div>

        <button
          onClick={handleHideToTray}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-700/80 border border-white/5 transition-all active:scale-95"
          title="Minimize Voxify to System Tray"
        >
          <Minimize2 className="w-3.5 h-3.5" />
          <span>To Tray</span>
        </button>
      </header>

      {/* Main Content Area: Scrollable Preferences Panel */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Section 1: Neural Voice Selection */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-indigo-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Neural Voice Model
              </h2>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              {voices.length} Available
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1">
            {voices.map((v) => {
              const isSelected = selectedVoice.toLowerCase() === v.name.toLowerCase();
              const isAuditioning = auditioningVoice === v.name;
              const isFemale = v.gender.toLowerCase() === 'female';
              const isBritish = v.id.startsWith('b');

              return (
                <div
                  key={v.id}
                  onClick={() => handleVoiceSelect(v.name)}
                  className={`relative p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between group ${
                    isSelected
                      ? 'bg-indigo-950/40 border-indigo-500/50 shadow-md shadow-indigo-950/50 ring-1 ring-indigo-500/30'
                      : 'bg-slate-900/60 border-white/5 hover:border-white/15 hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-200 group-hover:text-white">
                        {v.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-medium border border-white/5">
                        {isBritish ? '🇬🇧' : '🇺🇸'} {isFemale ? 'F' : 'M'}
                      </span>
                    </div>

                    {isSelected && (
                      <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center text-white shrink-0">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </div>
                    )}
                  </div>

                  <p className="text-[10px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {v.description}
                  </p>

                  <div className="mt-2.5 flex items-center justify-end">
                    <button
                      onClick={(e) => handleAuditionVoice(v.name, e)}
                      className={`text-[10px] px-2 py-1 rounded-md flex items-center gap-1 font-medium transition-all ${
                        isAuditioning
                          ? 'bg-amber-500 text-slate-950 font-bold'
                          : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
                      }`}
                      title="Audition voice sample"
                    >
                      {isAuditioning ? (
                        <>
                          <Square className="w-2.5 h-2.5 fill-current" />
                          <span>Playing</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-2.5 h-2.5 fill-current" />
                          <span>Preview</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 2: Speech Speed Control */}
        <section className="p-4 rounded-xl bg-slate-900/60 border border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-semibold text-slate-200">Playback Speed</span>
            </div>
            <span className="text-xs font-mono font-bold text-indigo-400 px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">
              {speed.toFixed(2)}x
            </span>
          </div>

          <div className="space-y-2">
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.05"
              value={speed}
              onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <button onClick={() => handleSpeedChange(0.75)} className="hover:text-slate-300">0.75x</button>
              <button onClick={() => handleSpeedChange(1.0)} className="hover:text-slate-300 font-bold text-slate-400">1.00x Normal</button>
              <button onClick={() => handleSpeedChange(1.25)} className="hover:text-slate-300">1.25x</button>
              <button onClick={() => handleSpeedChange(1.5)} className="hover:text-slate-300">1.50x</button>
              <button onClick={() => handleSpeedChange(2.0)} className="hover:text-slate-300">2.00x</button>
            </div>
          </div>
        </section>

        {/* Section 3: Detection Triggers & Behavior */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              System-Wide Detection Triggers
            </h2>
          </div>

          {/* Trigger 1: Auto-Read on Mouse Selection */}
          <div className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-slate-900/60 border border-white/5 hover:border-indigo-500/20 transition-all">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0">
                <MousePointer className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-slate-200">
                  Auto-Read on Text Highlight
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                  Automatically summons the audio pill when you finish selecting text or double-clicking in any app.
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
              <input
                type="checkbox"
                checked={autoReadSelection}
                onChange={(e) => handleToggleAutoReadSelection(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          {/* Trigger 2: Instant Earcon Haptic Chime */}
          <div className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-slate-900/60 border border-white/5 hover:border-amber-500/20 transition-all">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold text-slate-200">
                    Instant Acoustic Earcon Chime
                  </h3>
                  <span className="text-[9px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 rounded">
                    ⚡ &lt;2ms
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                  Confirms text capture with a soft earcon while the Kokoro neural voice prepares.
                </p>
                <button
                  type="button"
                  onClick={handlePreviewEarcon}
                  className="mt-1.5 text-[10px] text-amber-400 hover:text-amber-300 font-medium inline-flex items-center gap-1 hover:underline"
                >
                  <Bell className="w-2.5 h-2.5" />
                  <span>Preview Chime</span>
                </button>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
              <input
                type="checkbox"
                checked={earconEnabled}
                onChange={(e) => handleToggleEarcon(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>

          {/* Trigger 3: Auto-Read on Copy */}
          <div className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-slate-900/60 border border-white/5 hover:border-cyan-500/20 transition-all">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0">
                <Copy className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-slate-200">
                  Auto-Read on Copy (Ctrl+C)
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                  Speaks aloud whenever you copy text to your clipboard.
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
              <input
                type="checkbox"
                checked={autoReadCopy}
                onChange={(e) => handleToggleAutoReadCopy(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-600"></div>
            </label>
          </div>

          {/* Trigger 4: Selection Settle Delay */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">Selection Settle Delay</span>
              <span className="font-mono text-indigo-400 font-bold">{settleDelayMs} ms</span>
            </div>
            <input
              type="range"
              min="5"
              max="200"
              step="5"
              value={settleDelayMs}
              onChange={(e) => handleSettleDelayChange(parseInt(e.target.value, 10))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <p className="text-[10px] text-slate-500">
              Brief pause after mouse release allowing the target app to finalize highlighting.
            </p>
          </div>
        </section>

        {/* Section 4: Universal Hotkeys Card */}
        <section className="p-4 rounded-xl bg-gradient-to-br from-indigo-950/30 to-violet-950/30 border border-indigo-500/20 space-y-2.5">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-indigo-400" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-200">
              Global Windows Hotkeys
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded-lg bg-slate-900/80 border border-white/5 flex items-center justify-between">
              <span className="text-slate-400 text-[11px]">Read Selection:</span>
              <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-semibold text-[10px] border border-indigo-500/30">
                Win + Alt + S
              </span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/80 border border-white/5 flex items-center justify-between">
              <span className="text-slate-400 text-[11px]">Stop Speech:</span>
              <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono font-semibold text-[10px] border border-rose-500/30">
                Win + Alt + X
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Bottom Action Footer */}
      <footer className="px-6 py-4 border-t border-white/5 bg-slate-900/80 backdrop-blur-md flex items-center justify-between gap-3 shrink-0">
        <button
          onClick={handleTestAudioPill}
          disabled={testPillActive}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 transition-all active:scale-95 disabled:opacity-50"
        >
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>{testPillActive ? 'Summoning Pill...' : 'Test Audio Pill'}</span>
        </button>

        <button
          onClick={handleHideToTray}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-600/25 transition-all active:scale-95"
        >
          <ArrowDownRight className="w-3.5 h-3.5" />
          <span>Hide to System Tray</span>
        </button>
      </footer>
    </div>
  );
}

export default App;
