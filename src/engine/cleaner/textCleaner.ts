export interface CleanedTextResult {
  cleanedText: string;
  originalWordCount: number;
  cleanedWordCount: number;
  strippedHeadersCount: number;
  rejoinedHyphensCount: number;
  strippedPageNumbersCount: number;
}

export interface SentenceSegment {
  id: string;
  text: string;
  isDialogue: boolean;
  speaker?: string;
  charStart: number;
  charEnd: number;
}

/**
 * Smart Text Cleaner specifically engineered for PDFs, eBooks, and Markdown.
 * Removes running headers/footers, strips standalone page numbers,
 * and fixes broken hyphenated words across line breaks.
 */
export class TextCleaner {
  /**
   * Rejoin words broken across line breaks by hyphens (e.g. "informa-\ntion" -> "information")
   */
  public static rejoinHyphenatedWords(text: string): { text: string; count: number } {
    let count = 0;
    // Match word characters, a hyphen, newline (with optional whitespace), and continuation word characters
    const regex = /(\b[a-zA-Z]{2,})-(?:\r?\n|\r)\s*([a-zA-Z]{2,}\b)/g;
    const cleaned = text.replace(regex, (_, part1, part2) => {
      count++;
      return `${part1}${part2}`;
    });
    return { text: cleaned, count };
  }

  /**
   * Strip isolated page numbers (e.g. "Page 12", "12", "iv", "xiv")
   */
  public static stripPageNumbers(text: string): { text: string; count: number } {
    let count = 0;
    // Match lines that consist purely of numbers, "Page X", or roman numerals
    const lines = text.split(/\r?\n/);
    const cleanedLines = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      
      const isPageNumber = /^(?:page\s+)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(trimmed);
      const isRomanNumeral = /^(?:[ivxlcdm]+)$/i.test(trimmed) && trimmed.length <= 6;

      if (isPageNumber || isRomanNumeral) {
        count++;
        return false;
      }
      return true;
    });

    return { text: cleanedLines.join('\n'), count };
  }

  /**
   * Detect and strip recurring headers and footers across page boundaries
   */
  public static stripRecurringHeadersAndFooters(text: string): { text: string; count: number } {
    let count = 0;
    const lines = text.split(/\r?\n/);
    const lineFrequency = new Map<string, number>();

    // Count non-empty line occurrences
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 5 && trimmed.length < 80) {
        lineFrequency.set(trimmed, (lineFrequency.get(trimmed) || 0) + 1);
      }
    }

    // Lines that repeat frequently (likely running header/footer, e.g. book title or author name)
    const recurringHeaders = new Set<string>();
    for (const [line, freq] of lineFrequency.entries()) {
      if (freq >= 3 && !line.endsWith('.') && !line.endsWith('!')) {
        recurringHeaders.add(line);
      }
    }

    const filteredLines = lines.filter(line => {
      const trimmed = line.trim();
      if (recurringHeaders.has(trimmed)) {
        count++;
        return false;
      }
      return true;
    });

    return { text: filteredLines.join('\n'), count };
  }

  /**
   * Complete cleaning pipeline
   */
  public static clean(rawText: string): CleanedTextResult {
    const originalWordCount = rawText.trim().split(/\s+/).filter(Boolean).length;

    // 1. Rejoin broken hyphens
    const { text: textWithoutHyphens, count: rejoinedHyphensCount } = this.rejoinHyphenatedWords(rawText);

    // 2. Strip page numbers
    const { text: textWithoutPageNums, count: strippedPageNumbersCount } = this.stripPageNumbers(textWithoutHyphens);

    // 3. Strip recurring headers/footers
    const { text: textWithoutHeaders, count: strippedHeadersCount } = this.stripRecurringHeadersAndFooters(textWithoutPageNums);

    // 4. Normalize quotes and dashes
    let normalized = textWithoutHeaders
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2014\u2013]/g, ' - ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const cleanedWordCount = normalized.split(/\s+/).filter(Boolean).length;

    return {
      cleanedText: normalized,
      originalWordCount,
      cleanedWordCount,
      strippedHeadersCount,
      rejoinedHyphensCount,
      strippedPageNumbersCount,
    };
  }

  /**
   * Split clean text into natural speech sentences respecting abbreviations,
   * dialogue quotes, pre-quote dialogue intro colons, and compound semicolons.
   */
  public static splitIntoSentences(text: string): string[] {
    if (!text.trim()) return [];

    // Protect common abbreviations from premature sentence splitting
    const abbreviations = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'vs', 'etc', 'e.g', 'i.e', 'approx', 'dept', 'vol'];
    let processed = text;
    for (const abbr of abbreviations) {
      const regex = new RegExp(`\\b(${abbr})\\.`, 'gi');
      processed = processed.replace(regex, '$1{{DOT}}');
    }

    const sentences: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < processed.length; i++) {
      const char = processed[i];
      current += char;

      if (char === '"' || char === '“' || char === '”') {
        inQuotes = !inQuotes;
      }

      // 1. Dialogue intro colon: e.g. "hear the Rabbit say to itself: \n\n\"Oh dear!"
      if (char === ':' && !inQuotes) {
        const rest = processed.slice(i + 1);
        const match = rest.match(/^\s*(?=["“])/);
        if (match) {
          i += match[0].length - 1;
          const trimmed = current.replace(/{{DOT}}/g, '.').trim();
          if (trimmed.length > 0) sentences.push(trimmed);
          current = '';
          continue;
        }
      }

      // 2. Semicolons separating compound clauses (e.g. "...in that; nor did Alice...")
      if (char === ';' && !inQuotes) {
        const wordsSoFar = current.split(/\s+/).filter(Boolean).length;
        if (wordsSoFar >= 5) {
          const rest = processed.slice(i + 1);
          const match = rest.match(/^\s+(?=[a-zA-Z0-9])/);
          if (match) {
            i += match[0].length;
            const trimmed = current.replace(/{{DOT}}/g, '.').trim();
            if (trimmed.length > 0) sentences.push(trimmed);
            current = '';
            continue;
          }
        }
      }

      // 3. Sentence terminators: . ! ?
      if (['.', '!', '?'].includes(char)) {
        // If immediately followed by a closing quote, consume it as part of the sentence
        while (i + 1 < processed.length && ['"', '”', '’', "'", '»'].includes(processed[i + 1])) {
          i++;
          current += processed[i];
          inQuotes = false;
        }

        // Inside quotes: e.g. "Oh dear! Oh dear! I shall be late!"
        // Split on ! or ? inside quotes followed by whitespace and a word
        if (inQuotes && (char === '!' || char === '?')) {
          const rest = processed.slice(i + 1);
          const match = rest.match(/^\s+(?=[A-Z0-9])/);
          if (match) {
            i += match[0].length;
            let trimmed = current.replace(/{{DOT}}/g, '.').trim();
            if (!trimmed.endsWith('"') && !trimmed.endsWith('”')) {
              trimmed += '"';
            }
            if (trimmed.length > 0) sentences.push(trimmed);
            current = '"';
            continue;
          }
        }

        // Outside quotes: standard sentence boundary
        if (!inQuotes) {
          const rest = processed.slice(i + 1);
          const match = rest.match(/^\s+(?=[A-Z0-9"“'‘]|$)/);
          if (match) {
            i += match[0].length;
            const trimmed = current.replace(/{{DOT}}/g, '.').trim();
            if (trimmed.length > 0) sentences.push(trimmed);
            current = '';
          }
        }
      }
    }

    const finalTrimmed = current.replace(/{{DOT}}/g, '.').trim();
    if (finalTrimmed.length > 0) {
      sentences.push(finalTrimmed);
    }

    // Post-process: Split long sentences (> 16 words) at natural breath marks (commas, dashes)
    // so no individual sentence creates a 40-50 second neural synthesis compute bottleneck!
    const refined: string[] = [];
    for (const sent of sentences) {
      const words = sent.split(/\s+/).filter(Boolean);
      if (words.length <= 16) {
        refined.push(sent);
        continue;
      }

      // Split on commas or dashes followed by whitespace
      const rawClauses = sent.split(/(?<=[,;:\u2014\u2013]|\s+-\s+)\s+/);
      if (rawClauses.length <= 1) {
        refined.push(sent);
        continue;
      }

      let clauseAcc = '';
      for (const clause of rawClauses) {
        const combined = clauseAcc ? `${clauseAcc} ${clause}` : clause;
        const combinedWords = combined.split(/\s+/).filter(Boolean).length;
        if (combinedWords <= 16 || !clauseAcc) {
          clauseAcc = combined;
        } else {
          if (clauseAcc.trim()) refined.push(clauseAcc.trim());
          clauseAcc = clause;
        }
      }
      if (clauseAcc && clauseAcc.trim()) {
        refined.push(clauseAcc.trim());
      }
    }

    return refined;
  }
}
