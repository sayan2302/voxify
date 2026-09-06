import { useState, useEffect, useRef } from 'react';
import { ChapterSidebar } from './components/studio/ChapterSidebar';
import { TextInspector } from './components/studio/TextInspector';
import { VoiceStudio, VoicePreviewState } from './components/studio/VoiceStudio';
import { AudioPlayerBar } from './components/studio/AudioPlayerBar';
import { MiniPillPlayer } from './components/floating/MiniPillPlayer';
import { LibraryDropzone } from './components/library/LibraryDropzone';
import { ExportModal } from './components/studio/ExportModal';

import { DocumentParser, ParsedDocument } from './engine/parser/documentParser';
import { TextCleaner } from './engine/cleaner/textCleaner';
import { KokoroEngine, VoiceBlendConfig, KOKORO_VOICES, EngineStatusInfo, AudioSynthesisResult } from './engine/tts/kokoroEngine';
import { AudioMasteringEngine, MasteringConfig, DEFAULT_MASTERING_CONFIG } from './engine/audio/audioMastering';
import { LibraryStorage, LibraryItem } from './engine/storage/libraryStorage';
import { Sparkles, Volume2, Cpu, Loader2, AlertCircle, Moon, Clock, ArrowDownRight } from 'lucide-react';
import { ModelMemoryModal } from './components/studio/ModelMemoryModal';
import { GlobalReaderSettingsModal } from './components/studio/GlobalReaderSettingsModal';
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export interface HudStatusPayload {
  status: 'ready' | 'staging' | 'synthesizing' | 'speaking' | 'finished' | 'idle' | 'buffering';
  text: string;
  voiceName: string;
  speed: number;
  wordCount?: number;
}

export interface StreamingChunk {
  text: string;
  isSentenceEnd: boolean;
}

/**
 * Split text into ultra-fast streaming chunks:
 * Chunk 0 is an instant 2-word lead chunk (< 45ms synthesis!) so voice begins immediately,
 * while subsequent chunks stream seamlessly on the Web Audio hardware clock with 0ms seam.
 */
function splitTextIntoStreamingChunks(text: string): StreamingChunk[] {
  const rawSentences = TextCleaner.splitIntoSentences(text);
  const chunks: StreamingChunk[] = [];

  for (let sIdx = 0; sIdx < rawSentences.length; sIdx++) {
    const sentence = rawSentences[sIdx].trim();
    if (!sentence) continue;

    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    if (words.length <= 3) {
      // 1-3 words: entire sentence is a single quick chunk
      chunks.push({
        text: sentence,
        isSentenceEnd: true,
      });
      continue;
    }

    // For sentences with 4+ words:
    // If this is the FIRST sentence of the selection, we want an ultra-fast 2-word lead chunk
    // so speech starts in < 45ms!
    const leadChunkWordCount = (sIdx === 0 && chunks.length === 0) ? 2 : (words.length <= 6 ? words.length : 4);

    if (leadChunkWordCount < words.length) {
      // Check if there is a natural punctuation mark (comma, semicolon, dash) in the first 2-3 words
      let splitWordIndex = leadChunkWordCount;
      for (let i = 0; i < Math.min(3, words.length - 1); i++) {
        if (/[,;:\u2014\u2013]$/.test(words[i])) {
          splitWordIndex = i + 1;
          break;
        }
      }

      const head = words.slice(0, splitWordIndex).join(' ');
      chunks.push({
        text: head,
        isSentenceEnd: false,
      });

      const tailWords = words.slice(splitWordIndex);
      let curWords: string[] = [];
      for (let i = 0; i < tailWords.length; i++) {
        curWords.push(tailWords[i]);
        const hasPunct = /[,;:\u2014\u2013]$/.test(tailWords[i]);
        const isLastWord = i === tailWords.length - 1;
        // Target 5-7 words per follow-up chunk
        if (isLastWord || (curWords.length >= 5 && hasPunct) || curWords.length >= 8) {
          chunks.push({
            text: curWords.join(' '),
            isSentenceEnd: isLastWord,
          });
          curWords = [];
        }
      }
      if (curWords.length > 0) {
        chunks.push({
          text: curWords.join(' '),
          isSentenceEnd: true,
        });
      }
    } else {
      chunks.push({
        text: sentence,
        isSentenceEnd: true,
      });
    }
  }

  return chunks.length > 0 ? chunks : [{ text: text.trim(), isSentenceEnd: true }];
}

/**
 * Standalone Ultra-Lightweight HUD Window Component
 * Runs when ?mode=mini-pill is loaded - consumes ~0MB RAM, no heavy ONNX models
 */
function MiniPillStandalone() {
  const [hudStatus, setHudStatus] = useState<HudStatusPayload>({
    status: 'idle',
    text: '',
    voiceName: 'Sarah',
    speed: 0.9,
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
  // 1. Generous 12s idle timeout ONLY starts when Play button actively blooms in 'controls' phase
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

    // ONLY start auto-dismiss countdown once the Play button is presented in 'controls' phase!
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
      invoke('stop_native').catch(() => {});
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

export function App() {
  // Check if opened as mini-pill window
  const isMiniPillWindow = typeof window !== 'undefined' && 
    (window.location.search.includes('mode=mini-pill') || window.location.hash.includes('mini-pill'));

  if (isMiniPillWindow) {
    return <MiniPillStandalone />;
  }

  // Application State
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [activeBook, setActiveBook] = useState<LibraryItem | null>(null);
  const [activeChapterIndex, setActiveChapterIndex] = useState<number>(0);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number>(0);

  // Voice & Audio Settings
  const [selectedVoice, setSelectedVoice] = useState<string>('af_heart');
  const [dialogueVoice, setDialogueVoice] = useState<string>('am_adam');
  const [enableDialogueSeparation, setEnableDialogueSeparation] = useState<boolean>(true);
  const [voiceBlends, setVoiceBlends] = useState<VoiceBlendConfig[]>([]);
  const [speed, setSpeed] = useState<number>(0.9);
  const [masteringConfig, setMasteringConfig] = useState<MasteringConfig>(DEFAULT_MASTERING_CONFIG);

  // Playback & Engine States
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isSynthesizingSentence, setIsSynthesizingSentence] = useState<boolean>(false);
  const [bufferedSentenceIndices, setBufferedSentenceIndices] = useState<Set<number>>(new Set());
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [deviceLabel, setDeviceLabel] = useState<string>('WASM SIMD • ~85MB');
  const [engineStatus, setEngineStatus] = useState<EngineStatusInfo>(KokoroEngine.getInstance().getStatus());
  const [previewState, setPreviewState] = useState<VoicePreviewState | null>(null);
  const [isMemoryModalOpen, setIsMemoryModalOpen] = useState<boolean>(false);
  const [idleUnloadMinutes, setIdleUnloadMinutes] = useState<number>(30);

  // Text selection reading states
  const [isReadingSelection, setIsReadingSelection] = useState<boolean>(false);
  const [readingSelectionText, setReadingSelectionText] = useState<string | null>(null);
  const playbackSessionId = useRef<number>(0);

  // Windows Global Selection Reader States (Primary Feature)
  const [autoReadSelection, setAutoReadSelection] = useState<boolean>(true);
  const [autoReadCopy, setAutoReadCopy] = useState<boolean>(false);
  const [settleDelayMs, setSettleDelayMs] = useState<number>(10);
  const [earconEnabled, setEarconEnabled] = useState<boolean>(true);
  const [isGlobalReaderSettingsOpen, setIsGlobalReaderSettingsOpen] = useState<boolean>(false);

  // Floating HUD Status for Windows Selection Reader
  const [hudStatus, setHudStatus] = useState<HudStatusPayload>({
    status: 'idle',
    text: '',
    voiceName: 'Sarah',
    speed: 0.9,
  });

  const emitHudStatus = (
    status: 'synthesizing' | 'speaking' | 'finished' | 'idle',
    text: string,
    voiceName: string,
    speedVal: number
  ) => {
    setHudStatus({ status, text, voiceName, speed: speedVal });
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      emit('global-hud-status', { status, text, voiceName, speed: speedVal }).catch(() => {});
      if (status === 'synthesizing') {
        invoke('show_quick_reader').catch(() => {});
      }
    }
  };

  // Floating Mini-Pill Toggle
  const [showFloatingPill, setShowFloatingPill] = useState<boolean>(false);
  const floatingPillText = 'Select any text in Windows and press Win+Alt+S';

  // Ref to track playback loop and prefetch queue
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // Lookahead Prefetch Queue: holds synthesis promises for upcoming sentences
  const prefetchQueue = useRef<Map<number, Promise<any>>>(new Map());

  const getVoiceForSentence = (sentenceText: string) => {
    const isQuote = /["“][^"”]+["”]/.test(sentenceText);
    return (enableDialogueSeparation && isQuote) ? dialogueVoice : selectedVoice;
  };

  const prefetchSentence = (idx: number) => {
    if (idx < 0 || idx >= sentences.length) return;
    if (prefetchQueue.current.has(idx)) return;

    const sText = sentences[idx];
    if (!sText || !sText.trim()) return;

    const v = getVoiceForSentence(sText);
    const p = KokoroEngine.getInstance().synthesize(sText, v, speed, 'low');
    prefetchQueue.current.set(idx, p);
  };

  const prefetchAhead = (idx: number) => {
    prefetchSentence(idx + 1);
    prefetchSentence(idx + 2);
    prefetchSentence(idx + 3);
  };

  // Load initial settings & library
  useEffect(() => {
    if (isMiniPillWindow) return;

    const loadedLib = LibraryStorage.getLibrary();
    setLibrary(loadedLib);

    const savedBlends = LibraryStorage.getVoiceBlends();
    setVoiceBlends(savedBlends);

    const savedSettings = LibraryStorage.getSettings();
    setSelectedVoice(savedSettings.primaryVoice);
    setDialogueVoice(savedSettings.dialogueVoice);
    setEnableDialogueSeparation(savedSettings.enableDialogueSeparation);
    setSpeed(savedSettings.speed);
    setMasteringConfig(savedSettings.mastering);
    const timeoutMin = savedSettings.idleUnloadMinutes ?? 30;
    setIdleUnloadMinutes(timeoutMin);
    KokoroEngine.getInstance().setIdleTimeoutMinutes(timeoutMin);

    // If there is an active book, select it
    const activeId = LibraryStorage.getActiveBookId();
    if (activeId && loadedLib.length > 0) {
      const found = loadedLib.find(b => b.id === activeId);
      if (found) {
        setActiveBook(found);
        setActiveChapterIndex(found.activeChapterIndex || 0);
        setActiveSentenceIndex(found.activeSentenceIndex || 0);
      }
    }

    // Subscribe to Kokoro engine status
    const unsubscribeStatus = KokoroEngine.getInstance().subscribeStatus(info => {
      setEngineStatus(info);
      if (info.status === 'ready') {
        setDeviceLabel('WASM SIMD • ~85MB');
      }
    });

    // Initialize TTS engine in background (ultra-lightweight WASM)
    KokoroEngine.getInstance().initialize().then(() => {
      setDeviceLabel('WASM SIMD • ~85MB');
    }).catch(() => {
      setDeviceLabel('CPU Fallback');
    });

    return () => {
      unsubscribeStatus();
    };
  }, []);

  const activeChapter = activeBook?.document.chapters[activeChapterIndex];
  const sentences = activeChapter ? TextCleaner.splitIntoSentences(activeChapter.cleanedText) : [];
  const currentSentenceText = isReadingSelection && readingSelectionText ? readingSelectionText : (sentences[activeSentenceIndex] || '');

  // Check which sentences in the active chapter are already cached in IndexedDB or memory
  useEffect(() => {
    let isCancelled = false;
    async function checkExistingCache() {
      if (!sentences.length) {
        setBufferedSentenceIndices(new Set());
        return;
      }
      const initialBuffered = new Set<number>();
      for (let i = 0; i < sentences.length; i++) {
        const text = sentences[i];
        if (!text || !text.trim()) continue;
        const v = getVoiceForSentence(text);
        const isCached = await KokoroEngine.getInstance().isSentenceCached(text, v, speed);
        if (isCached && !isCancelled) {
          initialBuffered.add(i);
        }
      }
      if (!isCancelled) {
        setBufferedSentenceIndices(new Set(initialBuffered));
      }
    }
    checkExistingCache();
    return () => {
      isCancelled = true;
    };
  }, [activeBook?.id, activeChapterIndex, sentences.length, selectedVoice, dialogueVoice, speed]);

  // Continuous background pre-buffering of the active chapter for guaranteed instant playback
  useEffect(() => {
    let isCancelled = false;
    async function bufferChapter() {
      if (!sentences.length || engineStatus.status !== 'ready') return;

      // Start pre-buffering from activeSentenceIndex forward, then from start
      const order: number[] = [];
      for (let i = activeSentenceIndex; i < sentences.length; i++) order.push(i);
      for (let i = 0; i < activeSentenceIndex; i++) order.push(i);

      for (const idx of order) {
        if (isCancelled) break;
        const text = sentences[idx];
        if (!text || !text.trim()) continue;
        const v = getVoiceForSentence(text);

        const alreadyCached = await KokoroEngine.getInstance().isSentenceCached(text, v, speed);
        if (alreadyCached) {
          if (!isCancelled) {
            setBufferedSentenceIndices(prev => {
              if (prev.has(idx)) return prev;
              const next = new Set(prev);
              next.add(idx);
              return next;
            });
          }
          continue;
        }

        try {
          await KokoroEngine.getInstance().synthesize(text, v, speed, 'low');
          if (!isCancelled) {
            setBufferedSentenceIndices(prev => {
              const next = new Set(prev);
              next.add(idx);
              return next;
            });
          }
        } catch {
          if (isCancelled) break;
        }
      }
    }

    const timer = setTimeout(() => {
      bufferChapter();
    }, 250);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [activeBook?.id, activeChapterIndex, sentences.length, selectedVoice, dialogueVoice, speed, engineStatus.status, activeSentenceIndex]);

  const handleUpdateIdleMinutes = (minutes: number) => {
    setIdleUnloadMinutes(minutes);
    KokoroEngine.getInstance().setIdleTimeoutMinutes(minutes);
    const settings = LibraryStorage.getSettings();
    settings.idleUnloadMinutes = minutes;
    LibraryStorage.saveSettings(settings);
  };

  // Handle Play / Pause
  const handleTogglePlay = async () => {
    if (isPlaying || isReadingSelection) {
      playbackSessionId.current++;
      AudioMasteringEngine.getInstance().stop();
      setIsPlaying(false);
      isPlayingRef.current = false;
      setIsReadingSelection(false);
      setReadingSelectionText(null);
      setIsSynthesizingSentence(false);
      return;
    }

    if (!activeChapter || sentences.length === 0) return;

    setIsPlaying(true);
    isPlayingRef.current = true;
    playSentence(activeSentenceIndex);
  };

  // Play a specific sentence with instant 0ms playback when pre-buffered
  const playSentence = async (index: number) => {
    if (!isPlayingRef.current && index !== activeSentenceIndex) return;
    if (index >= sentences.length) {
      // Chapter finished: advance to next included chapter
      const nextChapIdx = activeChapterIndex + 1;
      if (activeBook && nextChapIdx < activeBook.document.chapters.length) {
        setActiveChapterIndex(nextChapIdx);
        setActiveSentenceIndex(0);
        prefetchQueue.current.clear();
        setIsSynthesizingSentence(false);
        setTimeout(() => playSentence(0), masteringConfig.chapterPauseMs);
      } else {
        setIsPlaying(false);
        setIsSynthesizingSentence(false);
      }
      return;
    }

    const sessionId = ++playbackSessionId.current;
    setActiveSentenceIndex(index);
    const text = sentences[index];
    if (!text || !text.trim()) {
      if (playbackSessionId.current === sessionId && isPlayingRef.current) {
        playSentence(index + 1);
      }
      return;
    }

    // 1. Prune past sentences from lookahead queue
    for (const k of prefetchQueue.current.keys()) {
      if (k < index) {
        prefetchQueue.current.delete(k);
      }
    }

    const voiceToUse = getVoiceForSentence(text);

    try {
      const isAlreadyCached = bufferedSentenceIndices.has(index) || await KokoroEngine.getInstance().isSentenceCached(text, voiceToUse, speed);
      if (playbackSessionId.current !== sessionId) return;

      if (!isAlreadyCached) {
        setIsSynthesizingSentence(true);
      }

      const synthResult = await KokoroEngine.getInstance().synthesize(text, voiceToUse, speed, 'high');
      if (playbackSessionId.current !== sessionId) return;

      setIsSynthesizingSentence(false);
      setBufferedSentenceIndices(prev => {
        if (prev.has(index)) return prev;
        const next = new Set(prev);
        next.add(index);
        return next;
      });

      if (!isPlayingRef.current || playbackSessionId.current !== sessionId) return;

      prefetchAhead(index);

      const normalized = AudioMasteringEngine.getInstance().normalizeLufs(
        synthResult.audioBuffer,
        masteringConfig.targetLufs
      );

      await AudioMasteringEngine.getInstance().playBuffer(
        normalized,
        () => {
          if (isPlayingRef.current && playbackSessionId.current === sessionId) {
            setTimeout(() => {
              if (isPlayingRef.current && playbackSessionId.current === sessionId) {
                playSentence(index + 1);
              }
            }, masteringConfig.sentencePauseMs);
          }
        },
        masteringConfig.ambientSound,
        masteringConfig.ambientVolume
      );
    } catch (err) {
      console.error('Synthesis error:', err);
      if (playbackSessionId.current === sessionId) {
        setIsSynthesizingSentence(false);
        if (isPlayingRef.current) {
          setTimeout(() => {
            if (isPlayingRef.current && playbackSessionId.current === sessionId) {
              playSentence(index + 1);
            }
          }, 200);
        }
      }
    }
  };

  // Read ONLY the selected text or sentence with instant sub-second streaming
  const handlePlaySelection = async (textToRead: string, sentenceIndex?: number | null) => {
    if (!textToRead || !textToRead.trim()) return;

    // 1. Cancel previous audio and background tasks
    playbackSessionId.current++;
    AudioMasteringEngine.getInstance().stop();
    KokoroEngine.getInstance().cancelPendingBackground();
    prefetchQueue.current.clear();

    const sessionId = ++playbackSessionId.current;
    setIsPlaying(false);
    isPlayingRef.current = false;
    setIsReadingSelection(true);
    setReadingSelectionText(textToRead);
    setIsSynthesizingSentence(true);

    if (sentenceIndex !== undefined && sentenceIndex !== null) {
      setActiveSentenceIndex(sentenceIndex);
    }

    const voiceToUse = getVoiceForSentence(textToRead);
    const voiceObj = KOKORO_VOICES.find(v => v.id === voiceToUse);
    const voiceName = voiceObj ? voiceObj.name : 'Sarah';

    // Broadcast synthesizing status to HUD immediately (< 5ms)
    emitHudStatus('synthesizing', textToRead, voiceName, speed);

    // 2. Break down text into quick-start streaming chunks
    const chunks = splitTextIntoStreamingChunks(textToRead);

    try {
      // 3. Immediately synthesize Chunk 0 with HIGH priority (< 45ms)
      const chunk0Promise = KokoroEngine.getInstance().synthesize(
        chunks[0].text,
        voiceToUse,
        speed,
        'high'
      );

      // Start prefetching remaining chunks sequentially in background with HIGH priority
      const remainingChunkPromises: Promise<AudioSynthesisResult>[] = [];
      for (let i = 1; i < chunks.length; i++) {
        remainingChunkPromises.push(
          KokoroEngine.getInstance().synthesize(chunks[i].text, voiceToUse, speed, 'high')
        );
      }

      // Await Chunk 0 (ultra-fast < 45ms)
      const chunk0Result = await chunk0Promise;
      if (playbackSessionId.current !== sessionId) return;

      setIsSynthesizingSentence(false);
      setIsPlaying(true);
      isPlayingRef.current = true;

      // Broadcast speaking status to HUD immediately!
      emitHudStatus('speaking', textToRead, voiceName, speed);

      // Start hardware-clock sample-accurate streaming session
      const audioEngine = AudioMasteringEngine.getInstance();
      audioEngine.startStreamSession();

      const onPlaybackFinished = () => {
        if (playbackSessionId.current === sessionId) {
          setIsPlaying(false);
          isPlayingRef.current = false;
          setIsReadingSelection(false);
          setReadingSelectionText(null);
          setIsSynthesizingSentence(false);
          emitHudStatus('finished', textToRead, voiceName, speed);
          setTimeout(() => {
            if (playbackSessionId.current === sessionId) {
              emitHudStatus('idle', '', voiceName, speed);
              const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
              if (isTauri) {
                invoke('hide_quick_reader').catch(() => {});
              }
            }
          }, 2500);
        }
      };

      // Play Chunk 0 immediately on the Web Audio hardware clock!
      const chunk0Pause = chunks[0].isSentenceEnd ? (masteringConfig.sentencePauseMs / 1000) : 0;
      audioEngine.scheduleStreamingChunk(
        chunk0Result.audioBuffer,
        chunk0Pause,
        chunks.length === 1 ? onPlaybackFinished : undefined
      );

      // Stream schedule all remaining chunks seamlessly as each completes
      (async () => {
        for (let i = 1; i < chunks.length; i++) {
          try {
            const nextResult = await remainingChunkPromises[i - 1];
            if (playbackSessionId.current !== sessionId) return;

            const isLast = i === chunks.length - 1;
            const pauseSec = chunks[i].isSentenceEnd ? (masteringConfig.sentencePauseMs / 1000) : 0;

            audioEngine.scheduleStreamingChunk(
              nextResult.audioBuffer,
              pauseSec,
              isLast ? onPlaybackFinished : undefined
            );
          } catch (chunkErr) {
            console.warn(`Error in streaming chunk ${i}:`, chunkErr);
          }
        }
      })();

    } catch (err) {
      console.error('Selection reading error:', err);
      if (playbackSessionId.current === sessionId) {
        setIsSynthesizingSentence(false);
        setIsPlaying(false);
        isPlayingRef.current = false;
        setIsReadingSelection(false);
        setReadingSelectionText(null);
        emitHudStatus('idle', '', voiceName, speed);
      }
    }
  };

  const handleStopSelection = () => {
    playbackSessionId.current++;
    AudioMasteringEngine.getInstance().stop();
    KokoroEngine.getInstance().cancelPendingBackground();
    setIsPlaying(false);
    isPlayingRef.current = false;
    setIsReadingSelection(false);
    setReadingSelectionText(null);
    setIsSynthesizingSentence(false);
    emitHudStatus('idle', '', '', speed);
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      invoke('stop_kokoro_native').catch(() => {});
      invoke('stop_native').catch(() => {});
    }
  };

  // Windows Global Selection Reader Event Listeners & Handlers
  useEffect(() => {
    let unlistenText: (() => void) | null = null;
    let unlistenStop: (() => void) | null = null;
    let unlistenConfig: (() => void) | null = null;
    let unlistenSpeed: (() => void) | null = null;
    let unlistenReplay: (() => void) | null = null;

    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      // Load current backend config
      invoke<any>('get_auto_read_config')
        .then((cfg) => {
          if (cfg) {
            setAutoReadSelection(cfg.auto_read_selection);
            setAutoReadCopy(cfg.auto_read_copy);
            setSettleDelayMs(cfg.settle_delay_ms);
            if (typeof cfg.earcon_enabled === 'boolean') {
              setEarconEnabled(cfg.earcon_enabled);
            }
          }
        })
        .catch(() => {});

      // Listen for text selected anywhere in Windows OS
      listen<string>('global-selection-text', (event) => {
        const text = event.payload;
        if (text && text.trim()) {
          // Native Kokoro neural speech is ALREADY speaking text via native ONNX Runtime!
          // Update the visual UI in the studio without starting heavy browser WebAssembly
          setIsReadingSelection(true);
          setReadingSelectionText(text.trim());
        }
      }).then((unsub) => {
        unlistenText = unsub;
      });

      // Listen for global stop hotkey (Win+Alt+X)
      listen('global-stop-speech', () => {
        handleStopSelection();
      }).then((unsub) => {
        unlistenStop = unsub;
      });

      // Listen for speed change from floating HUD
      listen<{ speed: number }>('global-set-speed', (event) => {
        if (event.payload?.speed) {
          setSpeed(event.payload.speed);
        }
      }).then((unsub) => {
        unlistenSpeed = unsub;
      });

      // Listen for replay request from floating HUD
      listen<{ text: string }>('global-replay-selection', (event) => {
        if (event.payload?.text) {
          invoke('speak_kokoro_native', { text: event.payload.text, voice: 'Sarah', speed: speed }).catch(() => {});
        }
      }).then((unsub) => {
        unlistenReplay = unsub;
      });

      // Listen for tray menu config changes
      listen('auto-read-config-changed', () => {
        invoke<any>('get_auto_read_config')
          .then((cfg) => {
            if (cfg) {
              setAutoReadSelection(cfg.auto_read_selection);
              setAutoReadCopy(cfg.auto_read_copy);
              setSettleDelayMs(cfg.settle_delay_ms);
              if (typeof cfg.earcon_enabled === 'boolean') {
                setEarconEnabled(cfg.earcon_enabled);
              }
            }
          })
          .catch(() => {});
      }).then((unsub) => {
        unlistenConfig = unsub;
      });
    }

    return () => {
      unlistenText?.();
      unlistenStop?.();
      unlistenConfig?.();
      unlistenSpeed?.();
      unlistenReplay?.();
    };
  }, []);

  const handleToggleAutoReadSelection = async (enabled: boolean) => {
    setAutoReadSelection(enabled);
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      await invoke('set_auto_read_enabled', { enabled });
    }
  };

  const handleToggleAutoReadCopy = async (enabled: boolean) => {
    setAutoReadCopy(enabled);
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      await invoke('set_auto_read_copy_enabled', { enabled });
    }
  };

  const handleToggleEarcon = async (enabled: boolean) => {
    setEarconEnabled(enabled);
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      await invoke('set_earcon_enabled', { enabled });
      if (enabled) {
        invoke('play_test_earcon').catch(() => {});
      }
    }
  };

  const handleChangeSettleDelay = async (ms: number) => {
    setSettleDelayMs(ms);
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      await invoke('set_settle_delay_ms', { delayMs: ms });
    }
  };

  const handleHideToTray = async () => {
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      await invoke('hide_main_window_to_tray');
    }
  };

  const handleTestSelectionRead = () => {
    const sample = 'Voxify is active in your Windows taskbar. Whenever you select any piece of text anywhere in Windows, I will read it aloud for you in Sarah\'s natural human voice.';
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      invoke('speak_kokoro_native', { text: sample, voice: 'Sarah', speed: 1.0 }).catch(() => {});
    } else {
      handlePlaySelection(sample, null);
    }
  };

  const handleNextSentence = () => {
    playbackSessionId.current++;
    AudioMasteringEngine.getInstance().stop();
    setIsSynthesizingSentence(false);
    setIsReadingSelection(false);
    setReadingSelectionText(null);
    const next = Math.min(sentences.length - 1, activeSentenceIndex + 1);
    setActiveSentenceIndex(next);
    if (isPlaying) playSentence(next);
  };

  const handlePrevSentence = () => {
    playbackSessionId.current++;
    AudioMasteringEngine.getInstance().stop();
    setIsSynthesizingSentence(false);
    setIsReadingSelection(false);
    setReadingSelectionText(null);
    const prev = Math.max(0, activeSentenceIndex - 1);
    setActiveSentenceIndex(prev);
    if (isPlaying) playSentence(prev);
  };

  // Handle Document Ingestion
  const handleFileSelected = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    let doc: ParsedDocument;

    if (ext === 'md') {
      const text = await file.text();
      doc = DocumentParser.parseMarkdown(text, file.name);
    } else if (ext === 'epub') {
      const buffer = await file.arrayBuffer();
      doc = await DocumentParser.parseEpub(buffer, file.name);
    } else if (ext === 'pdf') {
      const buffer = await file.arrayBuffer();
      doc = await DocumentParser.parsePdf(buffer, file.name);
    } else {
      const text = await file.text();
      doc = DocumentParser.parsePlainText(text, file.name);
    }

    const saved = LibraryStorage.saveBook(doc);
    setLibrary(LibraryStorage.getLibrary());
    setActiveBook(saved);
    setActiveChapterIndex(0);
    setActiveSentenceIndex(0);
  };

  // Load Built-In Demos
  const handleLoadSample = (sampleType: 'fiction' | 'academic') => {
    let sampleDoc: ParsedDocument;
    if (sampleType === 'fiction') {
      sampleDoc = {
        title: 'Alice’s Adventures in Wonderland',
        author: 'Lewis Carroll',
        format: 'epub',
        totalWordCount: 850,
        chapters: [
          {
            id: 'demo-1',
            index: 1,
            title: 'Down the Rabbit-Hole',
            rawText: `Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do. Once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it.

"And what is the use of a book," thought Alice, "without pictures or conversations?"

Suddenly a White Rabbit with pink eyes ran close by her. There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself:

"Oh dear! Oh dear! I shall be late!"

When the Rabbit actually took a watch out of its waistcoat-pocket, and looked at it, and then hurried on, Alice started to her feet, for it flashed across her mind that she had never before seen a rabbit with either a waistcoat-pocket, or a watch to take out of it. Burning with curiosity, she ran across the field after it, and fortunately was just in time to see it pop down a large rabbit-hole under the hedge.

In another moment down went Alice after it, never once considering how in the world she was to get out again.`,
            cleanedText: '',
            wordCount: 185,
            included: true,
          },
          {
            id: 'demo-2',
            index: 2,
            title: 'The Pool of Tears',
            rawText: `"Curiouser and curiouser!" cried Alice (she was so much surprised, that for the moment she quite forgot how to speak good English). "Now I'm opening out like the largest telescope that ever was! Good-bye, feet!"

For when she looked down at her feet, they seemed to be almost out of sight, they were getting so far off. "Oh, my poor little feet, I wonder who will put on your shoes and stockings for you now, dears? I'm sure I shan't be able! I shall be a great deal too far off to trouble myself about you!"

Just at this moment her head struck against the roof of the hall: in fact she was now more than nine feet high. She at once took up the little golden key and hurried off to the garden door. Poor Alice! It was as much as she could do, lying down on one side, to look through into the garden with one eye; but to get through was more hopeless than ever: she sat down and began to cry again.`,
            cleanedText: '',
            wordCount: 172,
            included: true,
          }
        ]
      };
    } else {
      sampleDoc = {
        title: 'Neural Flow Matching for Real-Time Speech Synthesis',
        author: 'Aura Research Lab',
        format: 'pdf',
        totalWordCount: 650,
        chapters: [
          {
            id: 'paper-1',
            index: 1,
            title: 'Section 1: Introduction & Architecture',
            rawText: `IEEE Transactions on Audio, Speech, and Language Processing
Page 1 of 12

Text-to-speech synthesis has undergone a major paradigm shift with the introduc-
tion of flow matching and discrete acoustic representations. Tradi-
tional autoregressive architectures suffer from high inference latency and error accumula-
tion during long-form synthesis.

In this work, we demonstrate that non-autoregressive diffusion transformers (DiT)
achieve superior naturalness (MOS 4.25) with minimal real-time factor (RTF < 0.08).
Furthermore, by eliminating explicit phoneme alignment modules, the model exhibits ro-
bustness against unseen vocabulary and multi-lingual code-switching.

Page 2 of 12
IEEE Transactions on Audio, Speech, and Language Processing`,
            cleanedText: '',
            wordCount: 120,
            included: true,
          }
        ]
      };
    }

    // Run TextCleaner on sample chapters
    sampleDoc.chapters.forEach(c => {
      c.cleanedText = TextCleaner.clean(c.rawText).cleanedText;
      c.wordCount = c.cleanedText.split(/\s+/).length;
    });

    const saved = LibraryStorage.saveBook(sampleDoc);
    setLibrary(LibraryStorage.getLibrary());
    setActiveBook(saved);
    setActiveChapterIndex(0);
    setActiveSentenceIndex(0);
  };

  // Update chapter text after user edits or auto-cleans
  const handleUpdateChapterText = (newText: string) => {
    if (!activeBook || !activeChapter) return;
    const updatedChapters = [...activeBook.document.chapters];
    updatedChapters[activeChapterIndex] = {
      ...activeChapter,
      cleanedText: newText,
      wordCount: newText.split(/\s+/).filter(Boolean).length,
    };

    const updatedBook: LibraryItem = {
      ...activeBook,
      document: {
        ...activeBook.document,
        chapters: updatedChapters,
      }
    };

    setActiveBook(updatedBook);
    LibraryStorage.updateBook(updatedBook);
  };

  // Toggle chapter inclusion for export
  const handleToggleChapterInclusion = (index: number) => {
    if (!activeBook) return;
    const updatedChapters = [...activeBook.document.chapters];
    updatedChapters[index] = {
      ...updatedChapters[index],
      included: !updatedChapters[index].included,
    };
    const updatedBook = {
      ...activeBook,
      document: { ...activeBook.document, chapters: updatedChapters },
    };
    setActiveBook(updatedBook);
    LibraryStorage.updateBook(updatedBook);
  };

  // Preview Voice Sample with Instant Pre-Warmed Cache & State Management
  const handlePreviewVoice = async (voiceId: string) => {
    // If this voice is currently playing, clicking it stops playback immediately
    if (previewState?.voiceId === voiceId && previewState.status === 'playing') {
      AudioMasteringEngine.getInstance().stop();
      setPreviewState(null);
      return;
    }

    try {
      AudioMasteringEngine.getInstance().stop();
      setPreviewState({ voiceId, status: 'synthesizing' });

      const voiceObj = KOKORO_VOICES.find(v => v.id === voiceId);
      const audioBuffer = await KokoroEngine.getInstance().getVoicePreview(voiceId, voiceObj?.name || 'Kokoro');

      setPreviewState({ voiceId, status: 'playing' });
      await AudioMasteringEngine.getInstance().playBuffer(audioBuffer, () => {
        setPreviewState(null);
      });
    } catch (e) {
      console.error('Voice preview error:', e);
      setPreviewState(null);
    }
  };

  // Preview Custom Blended Voice
  const handlePreviewBlend = async (blend: VoiceBlendConfig) => {
    if (previewState?.voiceId === 'blend_preview' && previewState.status === 'playing') {
      AudioMasteringEngine.getInstance().stop();
      setPreviewState(null);
      return;
    }

    try {
      AudioMasteringEngine.getInstance().stop();
      setPreviewState({ voiceId: 'blend_preview', status: 'synthesizing' });

      const sample = `Hi there! This is a preview of your custom blended voice.`;
      const res = await KokoroEngine.getInstance().synthesizeBlended(sample, blend, speed);

      setPreviewState({ voiceId: 'blend_preview', status: 'playing' });
      await AudioMasteringEngine.getInstance().playBuffer(res.audioBuffer, () => {
        setPreviewState(null);
      });
    } catch (e) {
      console.error('Voice blend preview error:', e);
      setPreviewState(null);
    }
  };

  // Full Audiobook Export
  const handleStartExport = async (format: 'm4b' | 'mp3' | 'wav') => {
    if (!activeBook) return;
    const included = activeBook.document.chapters.filter(c => c.included);
    const audioBuffers: AudioBuffer[] = [];

    // Synthesize each chapter
    for (const chap of included) {
      const chapSentences = TextCleaner.splitIntoSentences(chap.cleanedText);
      for (const sent of chapSentences) {
        const isQuote = /["“][^"”]+["”]/.test(sent);
        const v = (enableDialogueSeparation && isQuote) ? dialogueVoice : selectedVoice;
        const res = await KokoroEngine.getInstance().synthesize(sent, v, speed);
        audioBuffers.push(res.audioBuffer);
      }
      // Add chapter break pause
      audioBuffers.push(AudioMasteringEngine.getInstance().createSilence(masteringConfig.chapterPauseMs));
    }

    // Concatenate all buffers
    const masterBuffer = AudioMasteringEngine.getInstance().concatenateBuffers(audioBuffers, masteringConfig.sentencePauseMs);
    const normalized = AudioMasteringEngine.getInstance().normalizeLufs(masterBuffer, masteringConfig.targetLufs);

    // Export as WAV Blob and trigger automatic browser download
    const wavBlob = AudioMasteringEngine.getInstance().exportToWavBlob(normalized);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeBook.document.title.replace(/\s+/g, '_')}.${format === 'wav' ? 'wav' : format === 'm4b' ? 'm4b' : 'mp3'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // If in dedicated mini-pill mode (from Tauri window)
  if (isMiniPillWindow) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-transparent p-2">
        <MiniPillPlayer
          currentText={floatingPillText}
          isPlaying={isPlaying}
          speed={speed}
          voiceName={KOKORO_VOICES.find(v => v.id === selectedVoice)?.name || 'Kokoro 82M'}
          onTogglePlay={handleTogglePlay}
          onChangeSpeed={setSpeed}
          onClose={() => window.close()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-screen h-screen bg-background overflow-hidden select-none font-sans text-slate-100">
      {/* Top Application Navigation Bar */}
      <header className="h-14 px-5 glass-panel border-b border-white/5 flex items-center justify-between shrink-0 z-40 bg-slate-950/80">
        <div className="flex items-center gap-3">
          {/* Brand Logo with animated wave indicator */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
              <Volume2 className="w-4 h-4" />
            </div>
            <div>
              <span className="font-extrabold text-sm tracking-tight text-white">
                Vox<span className="text-indigo-400">ify</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono ml-2">v1.0 • Kokoro-82M</span>
            </div>
          </div>

          {activeBook && (
            <div className="flex items-center gap-2 ml-4 pl-4 border-l border-white/10">
              <span className="text-xs text-slate-400 truncate max-w-xs font-medium">
                {activeBook.document.title}
              </span>
              <button
                onClick={() => setActiveBook(null)}
                className="text-[11px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                Change Book
              </button>
            </div>
          )}
        </div>

        {/* Right Header: Acceleration badge & Quick Reader Pill trigger */}
        <div className="flex items-center gap-3">
          {/* Engine Initialization Progress or Status */}
          {engineStatus.status === 'loading' ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-[11px] text-amber-300 animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
              <span className="font-medium max-w-[200px] truncate">{engineStatus.message}</span>
              <div className="w-14 h-1.5 bg-slate-800 rounded-full overflow-hidden shrink-0">
                <div
                  className="h-full bg-amber-400 transition-all duration-300"
                  style={{ width: `${Math.max(5, engineStatus.percent)}%` }}
                />
              </div>
            </div>
          ) : engineStatus.status === 'error' ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-[11px] text-rose-300 font-medium">
              <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>{engineStatus.message}</span>
            </div>
          ) : engineStatus.status === 'unloaded' ? (
            <button
              onClick={() => setIsMemoryModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-300 font-mono transition-all cursor-pointer shadow-sm"
              title="Click to manage model memory and auto-unload settings"
            >
              <Moon className="w-3 h-3 text-indigo-400" />
              <span>Model Unloaded (~28MB Idle)</span>
            </button>
          ) : (
            <button
              onClick={() => setIsMemoryModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-[11px] text-emerald-300 font-mono transition-all cursor-pointer shadow-sm"
              title="Click to manage model memory and auto-unload settings"
            >
              <Cpu className="w-3 h-3 text-emerald-400" />
              <span>Kokoro-82M Ready ({deviceLabel})</span>
            </button>
          )}

          {/* PRIMARY FEATURE: Windows Global Selection Reader Status & Controls */}
          <button
            onClick={() => setIsGlobalReaderSettingsOpen(true)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              autoReadSelection
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25 shadow-sm shadow-emerald-500/10'
                : 'bg-slate-800/80 text-slate-400 border-white/10 hover:bg-slate-800'
            }`}
            title="Configure Windows Global Selection Reader (Win+Alt+S)"
          >
            <span className={`w-2 h-2 rounded-full ${autoReadSelection ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            <span className="font-semibold">
              {autoReadSelection ? 'Windows Reader: ON' : 'Windows Reader: OFF'}
            </span>
            <span className="text-[10px] text-slate-400 font-mono hidden md:inline">
              (Win+Alt+S)
            </span>
          </button>

          {/* Hide to Windows System Tray ("Gray Bar") */}
          <button
            onClick={handleHideToTray}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-indigo-900/60 to-violet-900/60 hover:from-indigo-800/80 hover:to-violet-800/80 text-indigo-200 border border-indigo-500/30 transition-all shadow-sm"
            title="Minimize and hide to Windows System Tray (Gray Bar)"
          >
            <ArrowDownRight className="w-3.5 h-3.5 text-indigo-400" />
            <span>Hide to Tray</span>
          </button>

          {/* Model Memory & Idle Settings Trigger */}
          <button
            onClick={() => setIsMemoryModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-700 border border-white/5 text-slate-300 transition-all shadow-sm"
            title="Configure idle auto-unload timeout (RAM saver)"
          >
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            <span>Memory ({idleUnloadMinutes === 0 ? 'Always Warm' : `${idleUnloadMinutes}m Idle`})</span>
          </button>

          {/* Test Floating Mini-Pill button */}
          <button
            onClick={() => setShowFloatingPill(!showFloatingPill)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
              showFloatingPill
                ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                : 'bg-slate-800/80 border-white/5 text-slate-300 hover:bg-slate-700'
            }`}
            title="Toggle Handy-style Floating Quick-Reader Pill"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
            <span>Floating Quick-Reader</span>
          </button>
        </div>
      </header>

      {/* Floating HUD Overlay (Live in-studio for immediate visual feedback) */}
      {(showFloatingPill || hudStatus.status !== 'idle' || isReadingSelection) && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50">
          <MiniPillPlayer
            currentText={hudStatus.text || readingSelectionText || currentSentenceText || 'Select any text in Windows to hear it read'}
            isPlaying={isPlaying || hudStatus.status === 'speaking'}
            isSynthesizing={isSynthesizingSentence || hudStatus.status === 'synthesizing'}
            status={hudStatus.status}
            speed={speed}
            voiceName={KOKORO_VOICES.find(v => v.id === selectedVoice)?.name || 'Sarah'}
            onTogglePlay={() => {
              if (isPlaying || hudStatus.status === 'speaking') {
                handleStopSelection();
              } else if (readingSelectionText || hudStatus.text) {
                handlePlaySelection(readingSelectionText || hudStatus.text);
              }
            }}
            onStop={handleStopSelection}
            onChangeSpeed={setSpeed}
            onClose={() => {
              setShowFloatingPill(false);
              setHudStatus(prev => ({ ...prev, status: 'idle' }));
              handleStopSelection();
            }}
          />
        </div>
      )}

      {/* Main Workspace Body */}
      <main className="flex-1 flex overflow-hidden relative">
        {activeBook ? (
          <>
            {/* Left Sidebar: Chapter Navigator & Exclude Toggles */}
            <ChapterSidebar
              chapters={activeBook.document.chapters}
              activeChapterIndex={activeChapterIndex}
              onSelectChapter={(idx) => {
                AudioMasteringEngine.getInstance().stop();
                setIsPlaying(false);
                setIsSynthesizingSentence(false);
                setActiveChapterIndex(idx);
                setActiveSentenceIndex(0);
              }}
              onToggleChapterInclusion={handleToggleChapterInclusion}
              onSelectAll={() => {
                const updated = activeBook.document.chapters.map(c => ({ ...c, included: true }));
                const nb = { ...activeBook, document: { ...activeBook.document, chapters: updated } };
                setActiveBook(nb);
                LibraryStorage.updateBook(nb);
              }}
              onDeselectAll={() => {
                const updated = activeBook.document.chapters.map(c => ({ ...c, included: false }));
                const nb = { ...activeBook, document: { ...activeBook.document, chapters: updated } };
                setActiveBook(nb);
                LibraryStorage.updateBook(nb);
              }}
            />

            {/* Center Area: Visual Text Inspector, Karaoke & Auto-Cleaner */}
            {activeChapter && (
              <TextInspector
                chapter={activeChapter}
                activeSentenceIndex={activeSentenceIndex}
                isPlaying={isPlaying}
                isSynthesizing={isSynthesizingSentence}
                bufferedSentenceIndices={bufferedSentenceIndices}
                isReadingSelection={isReadingSelection}
                readingSelectionText={readingSelectionText}
                onUpdateChapterText={handleUpdateChapterText}
                onPlaySelection={handlePlaySelection}
                onStopSelection={handleStopSelection}
              />
            )}

            {/* Right Sidebar: Voice Catalog, Blender & Dialogue Splitter */}
            <VoiceStudio
              selectedVoice={selectedVoice}
              dialogueVoice={dialogueVoice}
              enableDialogueSeparation={enableDialogueSeparation}
              voiceBlends={voiceBlends}
              previewState={previewState}
              onSelectVoice={(voiceId) => {
                setSelectedVoice(voiceId);
                prefetchQueue.current.clear();
                if (isPlaying) {
                  AudioMasteringEngine.getInstance().stop();
                  playSentence(activeSentenceIndex);
                } else {
                  handlePreviewVoice(voiceId);
                }
              }}
              onSelectDialogueVoice={(voiceId) => {
                setDialogueVoice(voiceId);
                handlePreviewVoice(voiceId);
              }}
              onToggleDialogueSeparation={setEnableDialogueSeparation}
              onSaveVoiceBlend={(blend) => {
                LibraryStorage.saveVoiceBlend(blend);
                setVoiceBlends(LibraryStorage.getVoiceBlends());
              }}
              onPreviewVoice={handlePreviewVoice}
              onPreviewBlend={handlePreviewBlend}
            />
          </>
        ) : (
          /* Empty / Ingestion State: Drag-and-Drop Library */
          <LibraryDropzone
            library={library}
            onFileSelected={handleFileSelected}
            onLoadSample={handleLoadSample}
            onSelectBook={(b) => {
              setActiveBook(b);
              setActiveChapterIndex(b.activeChapterIndex || 0);
              setActiveSentenceIndex(b.activeSentenceIndex || 0);
            }}
            onDeleteBook={(id) => {
              LibraryStorage.deleteBook(id);
              setLibrary(LibraryStorage.getLibrary());
            }}
          />
        )}
      </main>

      {/* Docked Bottom Audio Player Bar */}
      {activeBook && (
        <AudioPlayerBar
          isPlaying={isPlaying}
          isSynthesizing={isSynthesizingSentence}
          synthesizingVoiceName={KOKORO_VOICES.find(v => v.id === getVoiceForSentence(currentSentenceText))?.name}
          currentSentence={currentSentenceText}
          currentSentenceIndex={activeSentenceIndex}
          totalSentences={sentences.length}
          speed={speed}
          masteringConfig={masteringConfig}
          onTogglePlay={handleTogglePlay}
          onNextSentence={handleNextSentence}
          onPrevSentence={handlePrevSentence}
          onChangeSpeed={setSpeed}
          onUpdateMasteringConfig={setMasteringConfig}
          onExportAudiobook={() => setIsExportModalOpen(true)}
          idleUnloadMinutes={idleUnloadMinutes}
          onUpdateIdleMinutes={handleUpdateIdleMinutes}
          onOpenMemoryModal={() => setIsMemoryModalOpen(true)}
          isReadingSelection={isReadingSelection}
          readingSelectionText={readingSelectionText}
        />
      )}

      {/* Audiobook Export Modal */}
      {activeBook && (
        <ExportModal
          isOpen={isExportModalOpen}
          bookTitle={activeBook.document.title}
          author={activeBook.document.author}
          chapters={activeBook.document.chapters}
          onClose={() => setIsExportModalOpen(false)}
          onStartExport={handleStartExport}
        />
      )}

      {/* Model Memory & Idle Auto-Unload Modal */}
      <ModelMemoryModal
        isOpen={isMemoryModalOpen}
        onClose={() => setIsMemoryModalOpen(false)}
        engineStatus={engineStatus}
      />

      {/* Windows Global Selection Reader Settings Modal */}
      <GlobalReaderSettingsModal
        isOpen={isGlobalReaderSettingsOpen}
        onClose={() => setIsGlobalReaderSettingsOpen(false)}
        autoReadSelection={autoReadSelection}
        autoReadCopy={autoReadCopy}
        settleDelayMs={settleDelayMs}
        earconEnabled={earconEnabled}
        onToggleAutoReadSelection={handleToggleAutoReadSelection}
        onToggleAutoReadCopy={handleToggleAutoReadCopy}
        onToggleEarcon={handleToggleEarcon}
        onChangeSettleDelay={handleChangeSettleDelay}
        onHideToTray={handleHideToTray}
        onTestSelectionRead={handleTestSelectionRead}
      />
    </div>
  );
}

export default App;
