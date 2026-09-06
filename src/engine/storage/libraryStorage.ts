import { ParsedDocument } from '../parser/documentParser';
import { VoiceBlendConfig } from '../tts/kokoroEngine';
import { MasteringConfig, DEFAULT_MASTERING_CONFIG } from '../audio/audioMastering';

export interface LibraryItem {
  id: string;
  document: ParsedDocument;
  createdAt: number;
  lastReadAt: number;
  activeChapterIndex: number;
  activeSentenceIndex: number;
  completedPercent: number;
}

export interface PhoneticEntry {
  id: string;
  word: string;
  replacement: string;
}

export interface UserSettings {
  primaryVoice: string;
  dialogueVoice: string;
  enableDialogueSeparation: boolean;
  speed: number;
  mastering: MasteringConfig;
  globalHotkey: string;
  minimizeToTrayOnClose: boolean;
  idleUnloadMinutes: number; // 0 = never, or 5, 15, 30, 60
}

const STORAGE_KEYS = {
  LIBRARY: 'vocalis_library_books',
  VOICE_BLENDS: 'vocalis_voice_blends',
  LEXICON: 'vocalis_phonetic_lexicon',
  SETTINGS: 'vocalis_user_settings',
  ACTIVE_BOOK_ID: 'vocalis_active_book_id',
};

export class LibraryStorage {
  public static getLibrary(): LibraryItem[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.LIBRARY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  public static saveBook(doc: ParsedDocument): LibraryItem {
    const library = this.getLibrary();
    const id = 'book_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const item: LibraryItem = {
      id,
      document: doc,
      createdAt: Date.now(),
      lastReadAt: Date.now(),
      activeChapterIndex: 0,
      activeSentenceIndex: 0,
      completedPercent: 0,
    };
    library.unshift(item);
    localStorage.setItem(STORAGE_KEYS.LIBRARY, JSON.stringify(library));
    this.setActiveBookId(id);
    return item;
  }

  public static updateBook(item: LibraryItem): void {
    const library = this.getLibrary();
    const idx = library.findIndex(b => b.id === item.id);
    if (idx !== -1) {
      library[idx] = item;
      localStorage.setItem(STORAGE_KEYS.LIBRARY, JSON.stringify(library));
    }
  }

  public static deleteBook(id: string): void {
    let library = this.getLibrary();
    library = library.filter(b => b.id !== id);
    localStorage.setItem(STORAGE_KEYS.LIBRARY, JSON.stringify(library));
    if (this.getActiveBookId() === id) {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_BOOK_ID);
    }
  }

  public static getActiveBookId(): string | null {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_BOOK_ID);
  }

  public static setActiveBookId(id: string): void {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_BOOK_ID, id);
  }

  public static getVoiceBlends(): VoiceBlendConfig[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.VOICE_BLENDS);
      return data ? JSON.parse(data) : [
        { primaryVoice: 'af_heart', secondaryVoice: 'af_bella', blendRatio: 0.7, customName: 'Velvet Narrator' },
        { primaryVoice: 'am_adam', secondaryVoice: 'am_onyx', blendRatio: 0.65, customName: 'Deep Cinematic' },
        { primaryVoice: 'bm_george', secondaryVoice: 'bm_fable', blendRatio: 0.8, customName: 'Classic BBC' },
      ];
    } catch {
      return [];
    }
  }

  public static saveVoiceBlend(blend: VoiceBlendConfig): void {
    const blends = this.getVoiceBlends();
    blends.push(blend);
    localStorage.setItem(STORAGE_KEYS.VOICE_BLENDS, JSON.stringify(blends));
  }

  public static getLexicon(): PhoneticEntry[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.LEXICON);
      return data ? JSON.parse(data) : [
        { id: '1', word: 'API', replacement: 'A-P-I' },
        { id: '2', word: 'GUI', replacement: 'Gooey' },
      ];
    } catch {
      return [];
    }
  }

  public static saveLexicon(entries: PhoneticEntry[]): void {
    localStorage.setItem(STORAGE_KEYS.LEXICON, JSON.stringify(entries));
  }

  public static getSettings(): UserSettings {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (data) return JSON.parse(data);
    } catch {}

    return {
      primaryVoice: 'af_heart',
      dialogueVoice: 'am_michael',
      enableDialogueSeparation: true,
      speed: 1.0,
      mastering: DEFAULT_MASTERING_CONFIG,
      globalHotkey: 'Win+Alt+S',
      minimizeToTrayOnClose: true,
      idleUnloadMinutes: 30,
    };
  }

  public static saveSettings(settings: UserSettings): void {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }
}
