import React, { useState, useEffect } from 'react';
import { X, Sparkles, MousePointer, Copy, Keyboard, Sliders, Volume2, ShieldCheck, ArrowDownRight, Bell } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export interface NativeVoiceInfo {
  id: string;
  name: string;
  language: string;
  gender?: string;
}

export interface KokoroVoiceInfo {
  id: string;
  name: string;
  sid: number;
  gender: string;
  description: string;
}

interface GlobalReaderSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  autoReadSelection: boolean;
  autoReadCopy: boolean;
  settleDelayMs: number;
  earconEnabled: boolean;
  onToggleAutoReadSelection: (enabled: boolean) => void;
  onToggleAutoReadCopy: (enabled: boolean) => void;
  onToggleEarcon: (enabled: boolean) => void;
  onChangeSettleDelay: (ms: number) => void;
  onHideToTray: () => void;
  onTestSelectionRead: () => void;
}

export const GlobalReaderSettingsModal: React.FC<GlobalReaderSettingsModalProps> = ({
  isOpen,
  onClose,
  autoReadSelection,
  autoReadCopy,
  settleDelayMs,
  earconEnabled,
  onToggleAutoReadSelection,
  onToggleAutoReadCopy,
  onToggleEarcon,
  onChangeSettleDelay,
  onHideToTray,
  onTestSelectionRead,
}) => {
  const [kokoroVoices, setKokoroVoices] = useState<KokoroVoiceInfo[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('Sarah');

  useEffect(() => {
    if (isOpen) {
      const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
      if (isTauri) {
        invoke<KokoroVoiceInfo[]>('get_kokoro_voices')
          .then((voices) => {
            if (voices && voices.length > 0) {
              setKokoroVoices(voices);
            }
          })
          .catch(() => {});
      }
    }
  }, [isOpen]);

  const handleVoiceChange = (voiceName: string) => {
    setSelectedVoice(voiceName);
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      invoke('set_kokoro_voice', { voice: voiceName }).catch(() => {});
    }
  };

  const handleTestVoice = () => {
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      invoke('speak_kokoro_native', {
        text: `Voxify is active in your Windows taskbar. Whenever you select text, I will read it in ${selectedVoice}'s natural human voice.`,
        voice: selectedVoice,
        speed: 1.0,
      }).catch(() => {});
    } else {
      onTestSelectionRead();
    }
  };

  const handlePreviewEarcon = () => {
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      invoke('play_test_earcon').catch(() => {});
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-indigo-500/30 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                Windows Global Selection Reader
              </h2>
              <p className="text-xs text-slate-400">
                Primary Mode: Reads text selected anywhere across your Windows OS
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Primary Feature Highlight */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-950/40 to-violet-950/40 border border-indigo-500/20 text-xs text-indigo-200 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-indigo-300">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>System Tray ("Windows Gray Bar") Background Operation</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              Voxify stays alive silently in your Windows system tray. Whenever you highlight or select any piece of text in any application (browser, Word, PDF, Notepad, Slack, etc.), it will read that part immediately.
            </p>
          </div>

          {/* Setting 1: Auto-Read on Mouse Selection */}
          <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-950/50 border border-white/5 hover:border-indigo-500/20 transition-all">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 mt-0.5">
                <MousePointer className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-slate-200">
                  Auto-Read on Mouse Selection
                </h3>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Automatically speaks aloud as soon as you finish dragging your mouse across text or double-clicking a word in any app.
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
              <input
                type="checkbox"
                checked={autoReadSelection}
                onChange={(e) => onToggleAutoReadSelection(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          {/* Setting: Instant Selection Haptic Chime (Earcon) */}
          <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-950/50 border border-white/5 hover:border-amber-500/20 transition-all">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 mt-0.5">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-slate-200">
                    Instant Selection Haptic Chime
                  </h3>
                  <span className="text-[10px] text-amber-400 font-mono font-medium px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                    ⚡ &lt; 2ms Feedback
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Plays an instant acoustic chime the exact millisecond you highlight text anywhere in Windows, confirming text capture while the neural voice prepares.
                </p>
                <button
                  type="button"
                  onClick={handlePreviewEarcon}
                  className="mt-2 text-[11px] text-amber-400 hover:text-amber-300 inline-flex items-center gap-1.5 font-medium hover:underline focus:outline-none"
                >
                  <Bell className="w-3 h-3" />
                  <span>Preview Chime Sound</span>
                </button>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
              <input
                type="checkbox"
                checked={earconEnabled}
                onChange={(e) => onToggleEarcon(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>

          {/* Setting 2: Auto-Read on Copy (Ctrl+C) */}
          <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-950/50 border border-white/5 hover:border-indigo-500/20 transition-all">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 mt-0.5">
                <Copy className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-slate-200">
                  Auto-Read on Copy (Ctrl+C)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Whenever you copy text via keyboard shortcut or context menu anywhere in Windows, speak it immediately.
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
              <input
                type="checkbox"
                checked={autoReadCopy}
                onChange={(e) => onToggleAutoReadCopy(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
            </label>
          </div>

          {/* Setting 3: Kokoro Neural Voice Selector */}
          <div className="p-4 rounded-xl bg-slate-950/50 border border-white/5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <Volume2 className="w-4 h-4 text-indigo-400" />
                <span>Kokoro-82M Neural Voice (Native Windows ONNX)</span>
              </div>
              <span className="text-[10px] text-emerald-400 font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                🎙️ Human Quality
              </span>
            </div>
            {kokoroVoices.length > 0 ? (
              <select
                value={selectedVoice}
                onChange={(e) => handleVoiceChange(e.target.value)}
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-medium"
              >
                {kokoroVoices.map((v) => (
                  <option key={v.id} value={v.name}>
                    {v.name} ({v.gender} • {v.description})
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={selectedVoice}
                onChange={(e) => handleVoiceChange(e.target.value)}
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-medium"
              >
                <option value="Sarah">Sarah (Female • Youthful, natural narrator)</option>
                <option value="Bella">Bella (Female • Gentle, melodic, expressive)</option>
                <option value="Adam">Adam (Male • Deep, authoritative, cinematic)</option>
                <option value="Nicole">Nicole (Female • Articulate, crisp, professional)</option>
                <option value="Sky">Sky (Female • Calm, airy, soothing)</option>
                <option value="Michael">Michael (Male • Conversational, natural, friendly)</option>
                <option value="Emma">Emma (Female • British English, warm and clear)</option>
                <option value="George">George (Male • British English, resonant and polished)</option>
              </select>
            )}
            <p className="text-[11px] text-slate-400">
              100% offline, private neural AI speech running multi-threaded on your Intel Core Ultra processor.
            </p>
          </div>

          {/* Global Hotkeys Info Card */}
          <div className="p-4 rounded-xl bg-slate-950/50 border border-white/5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Keyboard className="w-4 h-4 text-indigo-400" />
              <span>Universal Windows Hotkeys (Always Active)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-900 border border-white/5 flex items-center justify-between">
                <span className="text-slate-400">Read Selection:</span>
                <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-medium text-[11px] border border-indigo-500/30">
                  Win + Alt + S
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-white/5 flex items-center justify-between">
                <span className="text-slate-400">Stop Speech:</span>
                <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono font-medium text-[11px] border border-rose-500/30">
                  Win + Alt + X
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Tip: Hotkeys also accept <code className="text-slate-300">Ctrl + Alt + S</code> and <code className="text-slate-300">Ctrl + Alt + X</code>.
            </p>
          </div>

          {/* Setting 4: Settle Delay Slider */}
          <div className="p-4 rounded-xl bg-slate-950/50 border border-white/5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <span>Selection Settle Delay</span>
              </div>
              <span className="text-xs font-mono font-semibold text-indigo-300">
                {settleDelayMs} ms
              </span>
            </div>
            <input
              type="range"
              min="5"
              max="250"
              step="5"
              value={settleDelayMs}
              onChange={(e) => onChangeSettleDelay(Number(e.target.value))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <p className="text-[11px] text-slate-400">
              Brief pause after mouse release to allow the active application to highlight text before reading.
            </p>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-6 border-t border-white/5 bg-slate-950/40 flex items-center justify-between gap-3">
          <button
            onClick={handleTestVoice}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/5 transition-all active:scale-95"
          >
            <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>Test Voice Synthesis</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onHideToTray}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-600/30 transition-all font-semibold"
            >
              <ArrowDownRight className="w-3.5 h-3.5" />
              <span>Hide to Windows Gray Bar (Tray)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
