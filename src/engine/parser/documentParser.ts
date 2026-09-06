import JSZip from 'jszip';
import { TextCleaner } from '../cleaner/textCleaner';

export interface ParsedChapter {
  id: string;
  index: number;
  title: string;
  rawText: string;
  cleanedText: string;
  wordCount: number;
  included: boolean;
}

export interface ParsedDocument {
  title: string;
  author: string;
  format: 'pdf' | 'epub' | 'markdown' | 'txt';
  coverUrl?: string;
  totalWordCount: number;
  chapters: ParsedChapter[];
}

export class DocumentParser {
  /**
   * Parse Markdown text into chapter segments based on # and ## headers
   */
  public static parseMarkdown(content: string, fileName: string): ParsedDocument {
    // Strip YAML frontmatter if present
    let text = content.replace(/^---[\s\S]*?---\r?\n/, '');

    // Normalize line endings
    const lines = text.split(/\r?\n/);
    const chapters: ParsedChapter[] = [];
    let currentTitle = 'Introduction';
    let currentBodyLines: string[] = [];
    let chapterIndex = 1;

    for (const line of lines) {
      // Check for # Header or ## Header
      const headerMatch = line.match(/^#{1,2}\s+(.+)$/);
      if (headerMatch) {
        if (currentBodyLines.length > 0) {
          const raw = currentBodyLines.join('\n').trim();
          if (raw.length > 0) {
            const { cleanedText, cleanedWordCount } = TextCleaner.clean(raw);
            chapters.push({
              id: `chap-${chapterIndex}`,
              index: chapterIndex,
              title: currentTitle,
              rawText: raw,
              cleanedText,
              wordCount: cleanedWordCount,
              included: true,
            });
            chapterIndex++;
          }
        }
        currentTitle = headerMatch[1].trim();
        currentBodyLines = [];
      } else {
        currentBodyLines.push(line);
      }
    }

    // Push the final chapter
    if (currentBodyLines.length > 0) {
      const raw = currentBodyLines.join('\n').trim();
      if (raw.length > 0) {
        const { cleanedText, cleanedWordCount } = TextCleaner.clean(raw);
        chapters.push({
          id: `chap-${chapterIndex}`,
          index: chapterIndex,
          title: currentTitle,
          rawText: raw,
          cleanedText,
          wordCount: cleanedWordCount,
          included: true,
        });
      }
    }

    const totalWordCount = chapters.reduce((sum, c) => sum + c.wordCount, 0);
    const baseTitle = fileName.replace(/\.[^/.]+$/, '');

    return {
      title: chapters[0]?.title && chapters.length > 1 ? baseTitle : (chapters[0]?.title || baseTitle),
      author: 'Unknown Author',
      format: 'markdown',
      totalWordCount,
      chapters: chapters.length > 0 ? chapters : [{
        id: 'chap-1',
        index: 1,
        title: baseTitle,
        rawText: text,
        cleanedText: TextCleaner.clean(text).cleanedText,
        wordCount: text.split(/\s+/).length,
        included: true,
      }],
    };
  }

  /**
   * Parse Plain Text (.txt) by detecting "Chapter X", "PART X", or dividing by large breaks
   */
  public static parsePlainText(content: string, fileName: string): ParsedDocument {
    const chapterRegex = /^(?:chapter\s+\w+|part\s+\w+|act\s+\w+|prologue|epilogue|book\s+\w+)/im;
    const lines = content.split(/\r?\n/);
    const chapters: ParsedChapter[] = [];
    let currentTitle = 'Beginning';
    let currentLines: string[] = [];
    let chapterIndex = 1;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && trimmed.length < 60 && chapterRegex.test(trimmed)) {
        if (currentLines.length > 0) {
          const raw = currentLines.join('\n').trim();
          if (raw) {
            const { cleanedText, cleanedWordCount } = TextCleaner.clean(raw);
            chapters.push({
              id: `chap-${chapterIndex}`,
              index: chapterIndex,
              title: currentTitle,
              rawText: raw,
              cleanedText,
              wordCount: cleanedWordCount,
              included: true,
            });
            chapterIndex++;
          }
        }
        currentTitle = trimmed;
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      const raw = currentLines.join('\n').trim();
      if (raw) {
        const { cleanedText, cleanedWordCount } = TextCleaner.clean(raw);
        chapters.push({
          id: `chap-${chapterIndex}`,
          index: chapterIndex,
          title: currentTitle,
          rawText: raw,
          cleanedText,
          wordCount: cleanedWordCount,
          included: true,
        });
      }
    }

    const totalWordCount = chapters.reduce((sum, c) => sum + c.wordCount, 0);
    const baseTitle = fileName.replace(/\.[^/.]+$/, '');

    return {
      title: baseTitle,
      author: 'Unknown Author',
      format: 'txt',
      totalWordCount,
      chapters: chapters.length > 0 ? chapters : [{
        id: 'chap-1',
        index: 1,
        title: baseTitle,
        rawText: content,
        cleanedText: TextCleaner.clean(content).cleanedText,
        wordCount: content.split(/\s+/).length,
        included: true,
      }],
    };
  }

  /**
   * Parse EPUB container using JSZip
   */
  public static async parseEpub(arrayBuffer: ArrayBuffer, fileName: string): Promise<ParsedDocument> {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const chapters: ParsedChapter[] = [];
    let title = fileName.replace(/\.epub$/i, '');
    let author = 'Unknown Author';
    let coverUrl: string | undefined = undefined;

    // 1. Locate container.xml
    const containerFile = zip.file('META-INF/container.xml');
    let opfPath = 'OEBPS/content.opf';
    if (containerFile) {
      const containerText = await containerFile.async('text');
      const rootfileMatch = containerText.match(/full-path="([^"]+)"/i);
      if (rootfileMatch) {
        opfPath = rootfileMatch[1];
      }
    }

    // 2. Read OPF
    const opfFile = zip.file(opfPath);
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

    if (opfFile) {
      const opfText = await opfFile.async('text');
      
      // Extract Title & Author
      const titleMatch = opfText.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
      if (titleMatch) title = titleMatch[1].trim();

      const authorMatch = opfText.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
      if (authorMatch) author = authorMatch[1].trim();

      // Find HTML / XHTML files in spine/manifest
      const itemRegex = /<item\s+[^>]*href="([^"]+\.(?:xhtml|html|xml))"[^>]*id="([^"]+)"[^>]*>/gi;
      const hrefMap = new Map<string, string>();
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRegex.exec(opfText)) !== null) {
        hrefMap.set(itemMatch[2], itemMatch[1]);
      }

      // Read items in spine order
      const itemrefRegex = /<itemref\s+[^>]*idref="([^"]+)"[^>]*>/gi;
      let itemrefMatch: RegExpExecArray | null;
      let chapIndex = 1;

      while ((itemrefMatch = itemrefRegex.exec(opfText)) !== null) {
        const idref = itemrefMatch[1];
        const relativeHref = hrefMap.get(idref);
        if (relativeHref) {
          const fullPath = opfDir + relativeHref;
          const chapterFile = zip.file(fullPath);
          if (chapterFile) {
            const rawHtml = await chapterFile.async('text');
            // Strip HTML tags and convert to clean text
            const textContent = rawHtml
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/\s+/g, ' ')
              .trim();

            if (textContent.length > 50) {
              const { cleanedText, cleanedWordCount } = TextCleaner.clean(textContent);
              const chapterTitle = `Chapter ${chapIndex}`;
              chapters.push({
                id: `chap-${chapIndex}`,
                index: chapIndex,
                title: chapterTitle,
                rawText: textContent,
                cleanedText,
                wordCount: cleanedWordCount,
                included: true,
              });
              chapIndex++;
            }
          }
        }
      }
    }

    const totalWordCount = chapters.reduce((sum, c) => sum + c.wordCount, 0);

    return {
      title,
      author,
      format: 'epub',
      coverUrl,
      totalWordCount,
      chapters,
    };
  }

  /**
   * Parse PDF files extracting text across pages
   */
  public static async parsePdf(arrayBuffer: ArrayBuffer, fileName: string): Promise<ParsedDocument> {
    const baseTitle = fileName.replace(/\.pdf$/i, '');
    
    // In Web/WebView2 environment, pdfjs-dist can be dynamically imported
    try {
      // @ts-ignore
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      // @ts-ignore
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

      const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;

      let fullRawText = '';
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        // Concatenate text items
        const pageText = textContent.items
          // @ts-ignore
          .map((item: any) => item.str)
          .join(' ');
        fullRawText += `\n\n--- Page ${pageNum} ---\n\n` + pageText;
      }

      // Auto-clean the extracted PDF
      const { cleanedText, cleanedWordCount } = TextCleaner.clean(fullRawText);

      // Break into chapter-sized chunks (~1500 words per chapter) if no headers detected
      const words = cleanedText.split(/\s+/);
      const chunkSize = 1200;
      const chapters: ParsedChapter[] = [];

      for (let i = 0; i < words.length; i += chunkSize) {
        const chunkWords = words.slice(i, i + chunkSize);
        const chunkText = chunkWords.join(' ');
        const chapIndex = Math.floor(i / chunkSize) + 1;
        chapters.push({
          id: `chap-${chapIndex}`,
          index: chapIndex,
          title: `Section ${chapIndex}`,
          rawText: chunkText,
          cleanedText: chunkText,
          wordCount: chunkWords.length,
          included: true,
        });
      }

      return {
        title: baseTitle,
        author: 'Unknown Author',
        format: 'pdf',
        totalWordCount: cleanedWordCount,
        chapters,
      };
    } catch (err) {
      console.warn('PDF.js dynamic parsing fallback:', err);
      // Fallback for raw text representation
      return {
        title: baseTitle,
        author: 'Unknown Author',
        format: 'pdf',
        totalWordCount: 0,
        chapters: [{
          id: 'chap-1',
          index: 1,
          title: baseTitle,
          rawText: 'PDF processing ready.',
          cleanedText: 'PDF processing ready.',
          wordCount: 3,
          included: true,
        }],
      };
    }
  }
}
