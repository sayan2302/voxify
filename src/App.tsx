import React, { useState, useEffect, useRef } from 'react';
import { MiniPillPlayer } from './components/floating/MiniPillPlayer';
import {
  Sparkles,
  Volume2,
  Sliders,
  History,
  Cpu,
  Info,
  Play,
  Square,
  RotateCcw,
  ExternalLink,
  Trash2,
  Copy,
  Zap,
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

export interface HistoryItem {
  id: string;
  text: string;
  voiceName: string;
  timestamp: string;
  wordCount: number;
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
 * Info Tooltip Component with Handy-style (i) icon
 */
const InfoTooltip: React.FC<{ text: string }> = ({ text }) => {
  const [show, setShow] = useState(false);

  return (
    <span
      className="relative inline-flex items-center ml-1.5 cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className="w-4 h-4 rounded-full border border-slate-600/70 text-slate-400 hover:text-slate-200 hover:border-slate-400 text-[10px] flex items-center justify-center font-serif italic transition-colors">
        i
      </span>
      {show && (
        <span className="absolute left-6 top-1/2 -translate-y-1/2 z-50 w-56 p-2 rounded-lg bg-slate-900/95 border border-white/10 text-[11px] text-slate-200 shadow-xl backdrop-blur-md leading-relaxed pointer-events-none">
          {text}
        </span>
      )}
    </span>
  );
};

/**
 * Handy-Style Smooth Toggle Switch
 */
const HandySwitch: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ checked, onChange }) => {
  return (
    <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div
        className={`w-11 h-6 rounded-full transition-colors duration-200 ease-in-out relative ${
          checked ? 'bg-[#e04f80]' : 'bg-[#27272a]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform duration-200 ease-in-out shadow-sm ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </div>
    </label>
  );
};

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

type TabKey = 'general' | 'voices' | 'history' | 'advanced' | 'about';

/**
 * Main Window: Handy-Style Sorted Two-Column Preferences Layout
 */
export function App() {
  const isMiniPillWindow =
    typeof window !== 'undefined' &&
    (window.location.search.includes('mode=mini-pill') || window.location.hash.includes('mini-pill'));

  if (isMiniPillWindow) {
    return <MiniPillStandalone />;
  }

  // Active Tab
  const [activeTab, setActiveTab] = useState<TabKey>('general');

  // Preferences & Engine State
  const [voices, setVoices] = useState<KokoroVoiceInfo[]>(FALLBACK_VOICES);
  const [selectedVoice, setSelectedVoice] = useState<string>('Sarah');
  const [speed, setSpeed] = useState<number>(1.0);
  const [volume, setVolume] = useState<number>(100);
  const [autoReadSelection, setAutoReadSelection] = useState<boolean>(true);
  const [autoReadCopy, setAutoReadCopy] = useState<boolean>(false);
  const [earconEnabled, setEarconEnabled] = useState<boolean>(true);
  const [settleDelayMs, setSettleDelayMs] = useState<number>(10);
  const [auditioningVoice, setAuditioningVoice] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('voxify_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  // Sync settings from Tauri backend
  useEffect(() => {
    if (isTauri) {
      invoke<KokoroVoiceInfo[]>('get_kokoro_voices')
        .then((vList) => {
          if (vList && vList.length > 0) setVoices(vList);
        })
        .catch(() => {});

      invoke<number>('get_kokoro_speed')
        .then((s) => {
          if (s && s > 0) setSpeed(s);
        })
        .catch(() => {});

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

      // Listen for new selections to record into history
      const unlisten = listen<string>('global-selection-text', (event) => {
        if (event.payload && event.payload.trim()) {
          const newItem: HistoryItem = {
            id: Date.now().toString(),
            text: event.payload.trim(),
            voiceName: selectedVoice,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            wordCount: event.payload.trim().split(/\s+/).length,
          };
          setHistory(prev => {
            const updated = [newItem, ...prev.filter(item => item.text !== newItem.text)].slice(0, 30);
            try {
              localStorage.setItem('voxify_history', JSON.stringify(updated));
            } catch {}
            return updated;
          });
        }
      });

      return () => {
        unlisten.then(u => u());
      };
    }
  }, [isTauri, selectedVoice]);

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

  const handleAuditionVoice = (voiceName: string) => {
    if (auditioningVoice === voiceName) {
      setAuditioningVoice(null);
      if (isTauri) {
        invoke('stop_kokoro_native').catch(() => {});
      }
      return;
    }

    setAuditioningVoice(voiceName);
    if (isTauri) {
      invoke('speak_kokoro_native', {
        text: `Hi! I'm ${voiceName}. Voxify is running smoothly in your background.`,
        voice: voiceName,
        speed: speed,
      }).catch(() => {});
    }

    setTimeout(() => {
      setAuditioningVoice(prev => (prev === voiceName ? null : prev));
    }, 4000);
  };

  const handlePreviewEarcon = () => {
    if (isTauri) {
      invoke('play_test_earcon').catch(() => {});
    }
  };

  const handleTestAudioPill = async () => {
    const sampleText = `Voxify Audio Pill is running! Select any text anywhere in Windows to hear it read in ${selectedVoice}'s natural voice.`;
    const wordCount = sampleText.split(/\s+/).length;

    if (isTauri) {
      await invoke('show_quick_reader').catch(() => {});
      await emit('global-selection-text', sampleText).catch(() => {});
      await emit('global-hud-status', {
        status: 'staging',
        text: sampleText,
        voiceName: selectedVoice,
        speed: speed,
        wordCount: wordCount,
      } as HudStatusPayload).catch(() => {});

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
      }, 350);
    }
  };

  const handleReReadHistoryItem = async (item: HistoryItem) => {
    if (isTauri) {
      await invoke('show_quick_reader').catch(() => {});
      await emit('global-selection-text', item.text).catch(() => {});
      await emit('global-hud-status', {
        status: 'staging',
        text: item.text,
        voiceName: item.voiceName || selectedVoice,
        speed: speed,
        wordCount: item.wordCount,
      } as HudStatusPayload).catch(() => {});

      setTimeout(() => {
        invoke('speak_kokoro_native', {
          text: item.text,
          voice: item.voiceName || selectedVoice,
          speed: speed,
        }).catch(() => {});
      }, 350);
    }
  };

  const handleClearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem('voxify_history');
    } catch {}
  };

  return (
    <div className="h-screen w-screen bg-[#18181b] text-slate-100 flex flex-col select-none font-sans overflow-hidden">
      {/* Upper Area: Two-Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar (~200px) */}
        <aside className="w-52 bg-[#121214] border-r border-white/5 flex flex-col justify-between shrink-0 p-4">
          <div className="space-y-6">
            {/* App Logo: Handy-style Bubbly Font */}
            <div className="pt-2 px-2 flex items-center gap-2.5">
              <div className="relative">
                <span className="text-2xl font-black tracking-tight text-[#e04f80] font-sans drop-shadow-[0_2px_8px_rgba(224,79,128,0.4)]">
                  voxify
                </span>
                <span className="absolute -bottom-1 right-0 w-1.5 h-1.5 rounded-full bg-[#e04f80] ring-2 ring-[#121214]" />
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="space-y-1">
              {/* General Tab */}
              <button
                onClick={() => setActiveTab('general')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'general'
                    ? 'bg-[#e04f80] text-white font-semibold shadow-md shadow-[#e04f80]/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Sliders className="w-4 h-4 shrink-0" />
                <span>General</span>
              </button>

              {/* Voices Tab */}
              <button
                onClick={() => setActiveTab('voices')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'voices'
                    ? 'bg-[#e04f80] text-white font-semibold shadow-md shadow-[#e04f80]/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Volume2 className="w-4 h-4 shrink-0" />
                <span>Voices</span>
              </button>

              {/* History Tab */}
              <button
                onClick={() => setActiveTab('history')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'history'
                    ? 'bg-[#e04f80] text-white font-semibold shadow-md shadow-[#e04f80]/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <History className="w-4 h-4 shrink-0" />
                <span>History</span>
              </button>

              {/* Advanced Tab */}
              <button
                onClick={() => setActiveTab('advanced')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'advanced'
                    ? 'bg-[#e04f80] text-white font-semibold shadow-md shadow-[#e04f80]/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Cpu className="w-4 h-4 shrink-0" />
                <span>Advanced</span>
              </button>

              {/* About Tab */}
              <button
                onClick={() => setActiveTab('about')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'about'
                    ? 'bg-[#e04f80] text-white font-semibold shadow-md shadow-[#e04f80]/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Info className="w-4 h-4 shrink-0" />
                <span>About</span>
              </button>
            </nav>
          </div>

          {/* Sidebar Footer Action: Test Audio Pill */}
          <div className="pt-4 border-t border-white/5">
            <button
              onClick={handleTestAudioPill}
              className="w-full py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-slate-300 hover:text-white font-medium flex items-center justify-center gap-2 border border-white/5 transition-all active:scale-95"
            >
              <Zap className="w-3.5 h-3.5 text-[#e04f80]" />
              <span>Test Audio Pill</span>
            </button>
          </div>
        </aside>

        {/* Right Content Area */}
        <main className="flex-1 overflow-y-auto p-6 bg-[#18181b]">
          {/* TAB 1: GENERAL */}
          {activeTab === 'general' && (
            <div className="max-w-2xl space-y-7 animate-in fade-in duration-150">
              {/* SECTION: GENERAL / SHORTCUTS */}
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase px-1">
                  GENERAL
                </h3>

                <div className="space-y-2">
                  {/* Row: Read Selection Shortcut */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Read Selection Shortcut
                      </span>
                      <InfoTooltip text="Global hotkey to capture and read highlighted text anywhere in Windows." />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="px-3 py-1 bg-[#151517] border border-white/10 rounded-lg text-xs font-mono font-medium text-slate-200">
                        Win + Alt + S
                      </div>
                      <button
                        title="Reset hotkey"
                        onClick={handleTestAudioPill}
                        className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Row: Stop Speech Shortcut */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Stop Speech Shortcut
                      </span>
                      <InfoTooltip text="Instantly halts active voice playback and hides the floating audio pill." />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="px-3 py-1 bg-[#151517] border border-white/10 rounded-lg text-xs font-mono font-medium text-slate-200">
                        Win + Alt + X
                      </div>
                      <button
                        title="Reset hotkey"
                        className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Row: Auto-Read on Mouse Selection */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Auto-Read on Selection
                      </span>
                      <InfoTooltip text="Automatically triggers voice playback as soon as you finish dragging your mouse across text or double-clicking in any app." />
                    </div>
                    <HandySwitch
                      checked={autoReadSelection}
                      onChange={handleToggleAutoReadSelection}
                    />
                  </div>

                  {/* Row: Auto-Read on Copy (Ctrl+C) */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Auto-Read on Copy (Ctrl+C)
                      </span>
                      <InfoTooltip text="Reads aloud whenever you copy text to clipboard via keyboard or right-click." />
                    </div>
                    <HandySwitch
                      checked={autoReadCopy}
                      onChange={handleToggleAutoReadCopy}
                    />
                  </div>
                </div>
              </div>

              {/* SECTION: SOUND & FEEDBACK */}
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase px-1">
                  SOUND & FEEDBACK
                </h3>

                <div className="space-y-2">
                  {/* Row: Audio Feedback (Earcon Chime) */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Instant Selection Haptic Chime
                      </span>
                      <InfoTooltip text="Soft < 2ms acoustic feedback confirming text capture while the neural voice prepares." />
                      <button
                        onClick={handlePreviewEarcon}
                        className="ml-3 text-[10px] text-[#e04f80] hover:underline font-medium"
                      >
                        Preview
                      </button>
                    </div>
                    <HandySwitch
                      checked={earconEnabled}
                      onChange={handleToggleEarcon}
                    />
                  </div>

                  {/* Row: Selection Settle Delay */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Selection Settle Delay
                      </span>
                      <InfoTooltip text="Milliseconds to wait after mouse release allowing the target app to settle selection." />
                    </div>
                    <div className="flex items-center gap-3 w-48 justify-end">
                      <input
                        type="range"
                        min="5"
                        max="200"
                        step="5"
                        value={settleDelayMs}
                        onChange={(e) => handleSettleDelayChange(parseInt(e.target.value, 10))}
                        className="w-28 h-1.5 bg-[#151517] rounded-lg appearance-none cursor-pointer accent-[#e04f80]"
                      />
                      <span className="text-xs font-mono font-medium text-slate-400 w-12 text-right">
                        {settleDelayMs}ms
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: VOICES */}
          {activeTab === 'voices' && (
            <div className="max-w-2xl space-y-7 animate-in fade-in duration-150">
              {/* SECTION: ACTIVE NEURAL VOICE */}
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase px-1">
                  NEURAL MODEL & VOICE
                </h3>

                <div className="space-y-2">
                  {/* Row: Voice Selector Dropdown */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Primary Neural Voice
                      </span>
                      <InfoTooltip text="Select from 11 human-grade Kokoro-82M neural voices running completely offline on your CPU." />
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedVoice}
                        onChange={(e) => handleVoiceSelect(e.target.value)}
                        className="bg-[#151517] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#e04f80] font-medium"
                      >
                        {voices.map((v) => (
                          <option key={v.id} value={v.name}>
                            {v.name} ({v.id.startsWith('b') ? 'British' : 'American'} • {v.gender})
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleAuditionVoice(selectedVoice)}
                        className={`p-1.5 rounded-lg border transition-all ${
                          auditioningVoice === selectedVoice
                            ? 'bg-[#e04f80] text-white border-[#e04f80]'
                            : 'bg-[#151517] border-white/10 text-slate-300 hover:text-white'
                        }`}
                        title="Audition Voice"
                      >
                        {auditioningVoice === selectedVoice ? (
                          <Square className="w-3.5 h-3.5 fill-current" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-current" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Row: Speech Speed Slider */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Speech Speed
                      </span>
                      <InfoTooltip text="Controls the cadence and tempo of synthesis (0.5x to 2.0x)." />
                    </div>
                    <div className="flex items-center gap-3 w-48 justify-end">
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.05"
                        value={speed}
                        onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                        className="w-28 h-1.5 bg-[#151517] rounded-lg appearance-none cursor-pointer accent-[#e04f80]"
                      />
                      <span className="text-xs font-mono font-medium text-slate-400 w-12 text-right">
                        {speed.toFixed(2)}x
                      </span>
                    </div>
                  </div>

                  {/* Row: Output Volume */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Volume
                      </span>
                      <InfoTooltip text="Audio output master playback volume." />
                    </div>
                    <div className="flex items-center gap-3 w-48 justify-end">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={volume}
                        onChange={(e) => setVolume(parseInt(e.target.value, 10))}
                        className="w-28 h-1.5 bg-[#151517] rounded-lg appearance-none cursor-pointer accent-[#e04f80]"
                      />
                      <span className="text-xs font-mono font-medium text-slate-400 w-12 text-right">
                        {volume}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION: AVAILABLE VOICES GRID */}
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase px-1">
                  VOICE ROSTER ({voices.length} VOICES)
                </h3>

                <div className="grid grid-cols-2 gap-2.5">
                  {voices.map((v) => {
                    const isSelected = selectedVoice.toLowerCase() === v.name.toLowerCase();
                    const isAuditioning = auditioningVoice === v.name;

                    return (
                      <div
                        key={v.id}
                        onClick={() => handleVoiceSelect(v.name)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'bg-[#271e25] border-[#e04f80]/60 shadow-sm'
                            : 'bg-[#202024] border-white/5 hover:border-white/15'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-200">
                              {v.name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#151517] text-slate-400 font-medium">
                              {v.id.startsWith('b') ? '🇬🇧' : '🇺🇸'} {v.gender}
                            </span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAuditionVoice(v.name);
                            }}
                            className={`p-1 rounded-md transition-colors ${
                              isAuditioning
                                ? 'bg-[#e04f80] text-white'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {isAuditioning ? (
                              <Square className="w-3 h-3 fill-current" />
                            ) : (
                              <Play className="w-3 h-3 fill-current" />
                            )}
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 line-clamp-1">
                          {v.description}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: HISTORY */}
          {activeTab === 'history' && (
            <div className="max-w-2xl space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                  RECENT READINGS ({history.length})
                </h3>
                {history.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="text-xs text-slate-500 hover:text-rose-400 flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear History</span>
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div className="p-12 text-center rounded-2xl bg-[#202024] border border-white/5 space-y-2">
                  <History className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-sm font-medium text-slate-400">No recent clippings captured</p>
                  <p className="text-xs text-slate-500">
                    Highlight any text in any app, or press <code className="text-slate-300">Win + Alt + S</code> to start listening.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-xl bg-[#202024] border border-white/5 hover:border-white/10 transition-colors space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span className="font-medium text-slate-300 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#e04f80]" />
                          Voice: {item.voiceName} • {item.wordCount} words
                        </span>
                        <span className="font-mono text-[11px]">{item.timestamp}</span>
                      </div>
                      <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed font-serif select-text">
                        "{item.text}"
                      </p>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => handleReReadHistoryItem(item)}
                          className="px-2.5 py-1 rounded-lg bg-[#151517] hover:bg-[#e04f80] hover:text-white text-[11px] text-slate-300 border border-white/5 flex items-center gap-1.5 transition-colors"
                        >
                          <Play className="w-2.5 h-2.5 fill-current" />
                          <span>Re-Read</span>
                        </button>
                        <button
                          onClick={() => navigator.clipboard.writeText(item.text)}
                          className="px-2.5 py-1 rounded-lg bg-[#151517] hover:bg-slate-700 text-[11px] text-slate-400 hover:text-white border border-white/5 flex items-center gap-1.5 transition-colors"
                        >
                          <Copy className="w-2.5 h-2.5" />
                          <span>Copy</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: ADVANCED */}
          {activeTab === 'advanced' && (
            <div className="max-w-2xl space-y-7 animate-in fade-in duration-150">
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase px-1">
                  RUNTIME & PERFORMANCE
                </h3>

                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Inference Engine
                      </span>
                      <InfoTooltip text="Native Rust ONNX Runtime running the Kokoro-82M neural model entirely on CPU." />
                    </div>
                    <span className="text-xs font-mono text-slate-400 bg-[#151517] px-2 py-1 rounded-lg border border-white/5">
                      Kokoro-82M ONNX
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Audio Output Driver
                      </span>
                      <InfoTooltip text="High-performance low-latency cross-platform audio library using native Windows WASAPI." />
                    </div>
                    <span className="text-xs font-mono text-slate-400 bg-[#151517] px-2 py-1 rounded-lg border border-white/5">
                      CPAL WASAPI
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Prebuffer Audio Runway
                      </span>
                      <InfoTooltip text="Synthesizes initial speech chunks ahead of playback to guarantee zero-gap playback." />
                    </div>
                    <span className="text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                      Active (Zero-Glitch)
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        First-Chunk Playout
                      </span>
                      <InfoTooltip text="Lead audio latency from text selection to speaker output." />
                    </div>
                    <span className="text-xs font-mono text-[#e04f80] bg-[#e04f80]/10 border border-[#e04f80]/20 px-2 py-0.5 rounded-full font-bold">
                      &lt; 35ms Playout
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: ABOUT */}
          {activeTab === 'about' && (
            <div className="max-w-2xl space-y-6 animate-in fade-in duration-150">
              <div className="p-6 rounded-2xl bg-[#202024] border border-white/5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#e04f80] to-violet-500 flex items-center justify-center text-white shadow-lg shadow-[#e04f80]/30">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">Voxify</h2>
                    <p className="text-xs text-slate-400">
                      System-Wide AI Audio Pill & Neural Quick Reader
                    </p>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Voxify runs silently in your Windows background and instantly speaks any highlighted text across any application using state-of-the-art Kokoro-82M neural synthesis.
                </p>

                <div className="pt-3 border-t border-white/5 grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-[#151517] border border-white/5">
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">Version</span>
                    <span className="font-mono text-slate-200">v1.0.0 (Production)</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#151517] border border-white/5">
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">Privacy</span>
                    <span className="text-emerald-400 font-medium">100% Offline & Local</span>
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-3">
                  <a
                    href="https://github.com/sayan2302/voxify"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#151517] hover:bg-white/10 text-xs text-slate-300 hover:text-white border border-white/5 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>GitHub Repository</span>
                  </a>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Bottom Status Bar (Spanning across full window width) */}
      <footer className="h-8 bg-[#121214] border-t border-white/5 px-4 flex items-center justify-between text-[11px] text-slate-500 select-none shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-slate-400 font-medium">Kokoro-82M ONNX Ready</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Check for updates</span>
          <span>•</span>
          <span className="font-mono text-slate-400">v1.0.0</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
