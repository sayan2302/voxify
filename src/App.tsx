import React, { useState, useEffect, useRef } from 'react';
import { MiniPillPlayer } from './components/floating/MiniPillPlayer';
import {
  Sparkles,
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
  Power,
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

export interface AutoReadConfig {
  master_enabled?: boolean;
  auto_read_selection: boolean;
  auto_read_copy: boolean;
  activation_shortcut?: string;
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

const FIXED_VOICE = 'Sarah';
const FIXED_SPEED = 1.0;

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
        <span className="absolute left-6 top-1/2 -translate-y-1/2 z-50 w-60 p-2.5 rounded-lg bg-[#18181b]/95 border border-[#2563eb]/40 text-[11px] text-slate-200 shadow-2xl backdrop-blur-md leading-relaxed pointer-events-none">
          {text}
        </span>
      )}
    </span>
  );
};

/**
 * Handy-Style Smooth Toggle Switch in Blue (#2563eb)
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
          checked ? 'bg-[#2563eb]' : 'bg-[#27272a]'
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
    voiceName: FIXED_VOICE,
    speed: FIXED_SPEED,
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
            voiceName: FIXED_VOICE,
            speed: FIXED_SPEED,
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
        voiceName={FIXED_VOICE}
        speed={FIXED_SPEED}
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

type TabKey = 'general' | 'history' | 'advanced' | 'about';

/**
 * Main Window: Handy-Style Sorted Two-Column Preferences Layout
 * Themed with shades of Electric Blue (#2563eb)
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

  // Master Switch State (turns entire Voxify quick reader service ON/OFF)
  const [masterEnabled, setMasterEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('voxify_master_enabled');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  // Activation Shortcut State
  const [activationShortcut, setActivationShortcut] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('voxify_activation_shortcut');
      if (!saved || saved === 'Shift + Space' || saved === 'Win + Space' || saved === 'Ctrl + Shift + Space') {
        return 'Win + Alt + S';
      }
      return saved;
    } catch {
      return 'Win + Alt + S';
    }
  });
  const [isRecordingShortcut, setIsRecordingShortcut] = useState<boolean>(false);

  // Preferences State
  const [autoReadSelection, setAutoReadSelection] = useState<boolean>(false);
  const [earconEnabled, setEarconEnabled] = useState<boolean>(true);
  const [settleDelayMs, setSettleDelayMs] = useState<number>(10);
  const [auditioningSarah, setAuditioningSarah] = useState<boolean>(false);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('voxify_history');
      if (!saved) return [];
      const parsed: HistoryItem[] = JSON.parse(saved);
      const pruned = parsed.slice(0, 5);
      if (parsed.length > 5) {
        localStorage.setItem('voxify_history', JSON.stringify(pruned));
      }
      return pruned;
    } catch {
      return [];
    }
  });

  const auditionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  // Interactive Shortcut Recording Listener
  useEffect(() => {
    if (!isRecordingShortcut) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Skip bare modifier keypresses alone
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
        return;
      }

      const parts: string[] = [];
      if (e.metaKey) parts.push('Win');
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');

      let key = e.key;
      if (key === ' ') key = 'Space';
      else if (key.length === 1) key = key.toUpperCase();

      parts.push(key);
      const newShortcut = parts.join(' + ');

      setActivationShortcut(newShortcut);
      setIsRecordingShortcut(false);

      try {
        localStorage.setItem('voxify_activation_shortcut', newShortcut);
      } catch {}

      if (isTauri) {
        invoke('set_activation_shortcut', { shortcut: newShortcut }).catch(() => {});
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isRecordingShortcut, isTauri]);

  // Sync settings from Tauri backend & enforce Sarah + 1.0x speed
  useEffect(() => {
    if (isTauri) {
      invoke('set_kokoro_voice', { voice: FIXED_VOICE }).catch(() => {});
      invoke('set_kokoro_speed', { speed: FIXED_SPEED }).catch(() => {});

      invoke<AutoReadConfig>('get_auto_read_config')
        .then((config) => {
          if (config) {
            if (config.master_enabled !== undefined) setMasterEnabled(config.master_enabled);
            setAutoReadSelection(config.auto_read_selection);
            if (config.activation_shortcut) setActivationShortcut(config.activation_shortcut);
            setSettleDelayMs(config.settle_delay_ms);
            setEarconEnabled(config.earcon_enabled);
          }
        })
        .catch(() => {});

      // Listen for new selections to record into history (strictly last 5 cached recordings)
      const unlisten = listen<string>('global-selection-text', (event) => {
        if (event.payload && event.payload.trim()) {
          const newItem: HistoryItem = {
            id: Date.now().toString(),
            text: event.payload.trim(),
            voiceName: FIXED_VOICE,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            wordCount: event.payload.trim().split(/\s+/).length,
          };
          setHistory(prev => {
            // Keep strictly last 5 recordings; older ones are automatically deleted
            const updated = [newItem, ...prev.filter(item => item.text !== newItem.text)].slice(0, 5);
            try {
              localStorage.setItem('voxify_history', JSON.stringify(updated));
            } catch {}
            return updated;
          });
        }
      });

      // Listen for speech completion to reset preview button
      const unlistenStatus = listen<HudStatusPayload>('global-hud-status', (event) => {
        if (event.payload?.status === 'finished') {
          setAuditioningSarah(false);
          if (auditionTimerRef.current) {
            clearTimeout(auditionTimerRef.current);
            auditionTimerRef.current = null;
          }
        }
      });

      // Pre-warm the last 5 cached history recordings in background for instant re-reading
      setTimeout(() => {
        const saved = localStorage.getItem('voxify_history');
        if (saved) {
          try {
            const items: HistoryItem[] = JSON.parse(saved).slice(0, 5);
            for (const item of items) {
              invoke('prebuffer_text_background', {
                text: item.text,
                voice: item.voiceName || FIXED_VOICE,
                speed: FIXED_SPEED,
              }).catch(() => {});
            }
          } catch {}
        }
      }, 1500);

      return () => {
        unlisten.then(u => u());
        unlistenStatus.then(u => u());
      };
    }
  }, [isTauri]);

  const handleToggleMaster = (enabled: boolean) => {
    setMasterEnabled(enabled);
    try {
      localStorage.setItem('voxify_master_enabled', JSON.stringify(enabled));
    } catch {}
    if (isTauri) {
      invoke('set_master_enabled', { enabled }).catch(() => {});
      if (!enabled) {
        invoke('hide_quick_reader').catch(() => {});
        invoke('stop_speech').catch(() => {});
      }
    }
  };

  const handleResetShortcut = () => {
    const defaultShortcut = 'Win + Alt + S';
    setActivationShortcut(defaultShortcut);
    setIsRecordingShortcut(false);
    try {
      localStorage.setItem('voxify_activation_shortcut', defaultShortcut);
    } catch {}
    if (isTauri) {
      invoke('set_activation_shortcut', { shortcut: defaultShortcut }).catch(() => {});
    }
  };

  const handleToggleAutoReadSelection = (enabled: boolean) => {
    setAutoReadSelection(enabled);
    if (isTauri) {
      invoke('set_auto_read_enabled', { enabled }).catch(() => {});
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

  const handleAuditionSarah = () => {
    if (auditioningSarah) {
      setAuditioningSarah(false);
      if (auditionTimerRef.current) {
        clearTimeout(auditionTimerRef.current);
        auditionTimerRef.current = null;
      }
      if (isTauri) {
        invoke('stop_kokoro_native').catch(() => {});
      }
      return;
    }

    setAuditioningSarah(true);
    if (isTauri) {
      invoke('speak_kokoro_native', {
        text: "Hi, I'm Sarah. I read any highlighted text across your Windows apps with natural human expression.",
        voice: FIXED_VOICE,
        speed: FIXED_SPEED,
      }).catch(() => {});
    }

    if (auditionTimerRef.current) clearTimeout(auditionTimerRef.current);
    auditionTimerRef.current = setTimeout(() => {
      setAuditioningSarah(false);
      auditionTimerRef.current = null;
    }, 6200);
  };

  const handlePreviewEarcon = () => {
    if (isTauri) {
      invoke('play_test_earcon').catch(() => {});
    }
  };

  const handleTestAudioPill = async () => {
    const sampleText = "Voxify Audio Pill is running! Select any text anywhere in Windows to hear it read in Sarah's natural human voice.";
    const wordCount = sampleText.split(/\s+/).length;

    if (isTauri) {
      await invoke('show_quick_reader').catch(() => {});
      await emit('global-selection-text', sampleText).catch(() => {});
      await emit('global-hud-status', {
        status: 'staging',
        text: sampleText,
        voiceName: FIXED_VOICE,
        speed: FIXED_SPEED,
        wordCount: wordCount,
      } as HudStatusPayload).catch(() => {});

      setTimeout(async () => {
        await emit('global-hud-status', {
          status: 'speaking',
          text: sampleText,
          voiceName: FIXED_VOICE,
          speed: FIXED_SPEED,
          wordCount: wordCount,
        } as HudStatusPayload).catch(() => {});

        invoke('speak_kokoro_native', {
          text: sampleText,
          voice: FIXED_VOICE,
          speed: FIXED_SPEED,
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
        voiceName: FIXED_VOICE,
        speed: FIXED_SPEED,
        wordCount: item.wordCount,
      } as HudStatusPayload).catch(() => {});

      setTimeout(() => {
        invoke('speak_kokoro_native', {
          text: item.text,
          voice: FIXED_VOICE,
          speed: FIXED_SPEED,
        }).catch(() => {});
      }, 350);
    }
  };

  const handleDeleteHistoryItem = (id: string) => {
    setHistory(prev => {
      const updated = prev.filter(item => item.id !== id);
      try {
        localStorage.setItem('voxify_history', JSON.stringify(updated));
      } catch {}
      return updated;
    });
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
            {/* App Logo: Blue Bubbly Font */}
            <div className="pt-2 px-2 flex items-center justify-between">
              <div className="relative">
                <span className="text-2xl font-black tracking-tight text-[#3b82f6] font-sans drop-shadow-[0_2px_10px_rgba(37,99,235,0.55)]">
                  voxify
                </span>
                <span className="absolute -bottom-1 right-0 w-1.5 h-1.5 rounded-full bg-[#2563eb] ring-2 ring-[#121214]" />
              </div>
            </div>

            {/* Navigation Tabs in Blue */}
            <nav className="space-y-1">
              {/* General Tab */}
              <button
                onClick={() => setActiveTab('general')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'general'
                    ? 'bg-gradient-to-r from-[#1d4ed8] to-[#2563eb] text-white font-semibold shadow-md shadow-[#1d4ed8]/40 border border-[#3b82f6]/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Sliders className="w-4 h-4 shrink-0" />
                <span>General</span>
              </button>

              {/* History Tab */}
              <button
                onClick={() => setActiveTab('history')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'history'
                    ? 'bg-gradient-to-r from-[#1d4ed8] to-[#2563eb] text-white font-semibold shadow-md shadow-[#1d4ed8]/40 border border-[#3b82f6]/30'
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
                    ? 'bg-gradient-to-r from-[#1d4ed8] to-[#2563eb] text-white font-semibold shadow-md shadow-[#1d4ed8]/40 border border-[#3b82f6]/30'
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
                    ? 'bg-gradient-to-r from-[#1d4ed8] to-[#2563eb] text-white font-semibold shadow-md shadow-[#1d4ed8]/40 border border-[#3b82f6]/30'
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
              className="w-full py-2 px-3 rounded-xl bg-white/5 hover:bg-[#2563eb]/25 hover:border-[#2563eb]/40 text-xs text-slate-300 hover:text-white font-medium flex items-center justify-center gap-2 border border-white/5 transition-all active:scale-95"
            >
              <Zap className="w-3.5 h-3.5 text-[#3b82f6]" />
              <span>Test Audio Pill</span>
            </button>
          </div>
        </aside>

        {/* Right Content Area */}
        <main className="flex-1 overflow-y-auto p-6 bg-[#18181b]">
          {/* TAB 1: GENERAL */}
          {activeTab === 'general' && (
            <div className="max-w-2xl space-y-7 animate-in fade-in duration-150">
              {/* MASTER SERVICE HERO BANNER */}
              <div className={`p-4 rounded-2xl border transition-all shadow-lg ${
                masterEnabled
                  ? 'bg-gradient-to-r from-[#202024] via-[#0f1d36] to-[#0b1329] border-[#2563eb]/50 shadow-black/40'
                  : 'bg-[#202024] border-white/5'
              }`}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all shrink-0 ${
                      masterEnabled
                        ? 'bg-[#2563eb]/35 border-[#3b82f6]/50 text-[#93c5fd] shadow-[0_0_15px_rgba(37,99,235,0.45)]'
                        : 'bg-white/5 border-white/10 text-slate-500'
                    }`}>
                      <Power className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-white tracking-wide">Master Service Switch</h2>
                        <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                          masterEnabled
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
                            : 'bg-white/5 text-slate-400 border border-white/10'
                        }`}>
                          {masterEnabled ? 'ACTIVE' : 'OFF'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {masterEnabled
                          ? 'Highlight text anywhere in Windows and press your shortcut to summon the audio pill.'
                          : 'Service is turned off. Global shortcuts and floating audio pill will not trigger.'}
                      </p>
                    </div>
                  </div>
                  <HandySwitch
                    checked={masterEnabled}
                    onChange={handleToggleMaster}
                  />
                </div>
              </div>

              {/* SECTION: GENERAL / SHORTCUTS */}
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase px-1">
                  GENERAL & SHORTCUTS
                </h3>

                <div className="space-y-2">
                  {/* Row: Read Selection Shortcut */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Read Selection Shortcut
                      </span>
                      <InfoTooltip text="Global hotkey to capture highlighted text and summon the floating audio pill." />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsRecordingShortcut(true)}
                        className={`px-3 py-1 bg-[#151517] rounded-lg text-xs font-mono font-medium transition-all ${
                          isRecordingShortcut
                            ? 'border border-[#3b82f6] text-[#93c5fd] shadow-[0_0_10px_rgba(59,130,246,0.5)] animate-pulse'
                            : 'border border-white/10 text-slate-200 hover:border-[#3b82f6]/50 hover:text-white'
                        }`}
                        title="Click to record new shortcut"
                      >
                        {isRecordingShortcut ? 'Press new keys...' : activationShortcut}
                      </button>
                      <button
                        title="Reset hotkey to default (Win + Alt + S)"
                        onClick={handleResetShortcut}
                        className="p-1 text-slate-500 hover:text-slate-300 transition-colors active:scale-95"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Row: Stop Speech Shortcut */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors">
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
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors">
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
                </div>
              </div>

              {/* SECTION: VOICE & FEEDBACK */}
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase px-1">
                  VOICE & FEEDBACK
                </h3>

                <div className="space-y-2">
                  {/* Row: Single Signature Voice (Sarah) in Blue */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/40 transition-colors">
                    <div className="flex items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-200">
                          Neural Voice
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#2563eb]/25 text-[#93c5fd] font-semibold border border-[#2563eb]/40">
                          Sarah (Signature)
                        </span>
                      </div>
                      <InfoTooltip text="Kokoro-82M neural narrator running 100% offline. Calibrated at locked 1.0x natural tempo to prevent buffer underruns and eliminate lag." />
                    </div>
                    <button
                      onClick={handleAuditionSarah}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition-all ${
                        auditioningSarah
                          ? 'bg-[#2563eb] text-white border-[#3b82f6] shadow-sm shadow-[#2563eb]/50'
                          : 'bg-[#151517] border-white/10 text-slate-300 hover:text-white hover:bg-[#2563eb]/20 hover:border-[#2563eb]/40'
                      }`}
                    >
                      {auditioningSarah ? (
                        <>
                          <Square className="w-3 h-3 fill-current" />
                          <span>Playing</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-current text-[#3b82f6]" />
                          <span>Preview Voice</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Row: Audio Feedback (Earcon Chime) */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Instant Selection Haptic Chime
                      </span>
                      <InfoTooltip text="Soft < 2ms acoustic feedback confirming text capture while the neural voice prepares." />
                      <button
                        onClick={handlePreviewEarcon}
                        className="ml-3 text-[10px] text-[#3b82f6] hover:underline font-medium"
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
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors">
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
                        className="w-28 h-1.5 bg-[#151517] rounded-lg appearance-none cursor-pointer accent-[#2563eb]"
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

          {/* TAB 2: HISTORY (Last 5 Cached Recordings) */}
          {activeTab === 'history' && (
            <div className="max-w-2xl space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                    RECENT READINGS ({history.length}/5)
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#2563eb]/20 text-[#93c5fd] font-medium border border-[#2563eb]/30">
                    Last 5 Cached
                  </span>
                </div>
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
                  <p className="text-sm font-medium text-slate-400">No cached readings yet</p>
                  <p className="text-xs text-slate-500">
                    Highlight any text in any app, or press <code className="text-slate-300 font-mono text-[11px] px-1 py-0.5 rounded bg-white/5 border border-white/10">{activationShortcut}</code> to read and cache up to 5 recordings.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span className="font-medium text-slate-300 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#2563eb]" />
                          Sarah • {item.wordCount} words
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono font-medium">
                            CACHED
                          </span>
                        </span>
                        <span className="font-mono text-[11px]">{item.timestamp}</span>
                      </div>
                      <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed font-serif select-text">
                        "{item.text}"
                      </p>
                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleReReadHistoryItem(item)}
                            className="px-2.5 py-1 rounded-lg bg-[#151517] hover:bg-[#2563eb] hover:text-white text-[11px] text-slate-300 border border-white/5 flex items-center gap-1.5 transition-colors"
                            title="Re-read instantly from cache"
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            <span>Re-Read</span>
                          </button>
                          <button
                            onClick={() => navigator.clipboard.writeText(item.text)}
                            className="px-2.5 py-1 rounded-lg bg-[#151517] hover:bg-slate-700 text-[11px] text-slate-400 hover:text-white border border-white/5 flex items-center gap-1.5 transition-colors"
                            title="Copy text to clipboard"
                          >
                            <Copy className="w-2.5 h-2.5" />
                            <span>Copy</span>
                          </button>
                        </div>
                        <button
                          onClick={() => handleDeleteHistoryItem(item.id)}
                          className="p-1 rounded-lg bg-[#151517] hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 border border-white/5 transition-colors"
                          title="Delete from cached history"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ADVANCED */}
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
                        Voice Persona
                      </span>
                      <InfoTooltip text="Locked to Sarah (af_sarah) for maximum quality and zero variance in pronunciation." />
                    </div>
                    <span className="text-xs font-mono text-slate-300 bg-[#151517] px-2 py-1 rounded-lg border border-white/5">
                      Sarah (Exclusive)
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Playout Cadence
                      </span>
                      <InfoTooltip text="Locked to calibrated 1.0x natural speed to eliminate buffer drainage lag and guarantee glitch-free playback." />
                    </div>
                    <span className="text-xs font-mono text-[#93c5fd] bg-[#2563eb]/20 border border-[#2563eb]/40 px-2 py-0.5 rounded-full font-bold">
                      1.00x Calibrated
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
                    <span className="text-xs font-mono text-[#93c5fd] bg-[#2563eb]/20 border border-[#2563eb]/40 px-2 py-0.5 rounded-full font-bold">
                      &lt; 35ms Playout
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: ABOUT */}
          {activeTab === 'about' && (
            <div className="max-w-2xl space-y-6 animate-in fade-in duration-150">
              <div className="p-6 rounded-2xl bg-[#202024] border border-white/5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#1d4ed8] via-[#2563eb] to-[#3b82f6] flex items-center justify-center text-white shadow-lg shadow-[#1d4ed8]/40">
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
                  Voxify runs silently in your Windows background and instantly speaks any highlighted text across any application using Sarah's natural human voice powered by Kokoro-82M.
                </p>

                <div className="pt-3 border-t border-white/5 grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-[#151517] border border-white/5">
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">Voice Model</span>
                    <span className="font-mono text-slate-200">Sarah (Kokoro-82M)</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#151517] border border-white/5">
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">Speed</span>
                    <span className="text-[#93c5fd] font-medium font-mono">1.00x Natural Pace</span>
                  </div>
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#151517] hover:bg-[#2563eb]/25 text-xs text-slate-300 hover:text-white border border-white/5 hover:border-[#2563eb]/40 transition-colors"
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

      {/* Bottom Status Bar */}
      <footer className="h-8 bg-[#121214] border-t border-white/5 px-4 flex items-center justify-between text-[11px] text-slate-500 select-none shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#3b82f6] animate-pulse" />
          <span className="text-slate-400 font-medium">Kokoro-82M (Sarah) • 1.0x Calibrated</span>
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
