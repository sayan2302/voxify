export interface DialogueChunk {
  id: string;
  text: string;
  isDialogue: boolean;
  detectedSpeaker?: string;
}

/**
 * Dialogue vs Narrator Parser.
 * Separates spoken dialogue inside quotation marks from narrative prose,
 * and extracts speaker cues (e.g. 'said Alice', 'cried Bob').
 */
export class DialogueSplitter {
  /**
   * Split a block of text into alternating narrative and dialogue chunks
   */
  public static split(text: string): DialogueChunk[] {
    const chunks: DialogueChunk[] = [];
    if (!text.trim()) return chunks;

    // Matches speech in standard straight quotes or curly quotes
    // Match anything between "..." or “...”
    const quoteRegex = /(["“][^"”]+["”])/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let indexCounter = 0;

    while ((match = quoteRegex.exec(text)) !== null) {
      const matchIndex = match.index;
      const quoteText = match[0];

      // Add preceding narrative text if any
      if (matchIndex > lastIndex) {
        const narrativeText = text.substring(lastIndex, matchIndex).trim();
        if (narrativeText) {
          chunks.push({
            id: `chunk-narrative-${indexCounter++}`,
            text: narrativeText,
            isDialogue: false,
          });
        }
      }

      // Try to detect speaker from the preceding or succeeding narrative context
      const precedingSnippet = text.substring(Math.max(0, matchIndex - 60), matchIndex);
      const succeedingSnippet = text.substring(matchIndex + quoteText.length, Math.min(text.length, matchIndex + quoteText.length + 60));
      const detectedSpeaker = this.extractSpeaker(precedingSnippet, succeedingSnippet);

      // Clean the outer quotes for speech synthesis
      const cleanDialogue = quoteText.replace(/^["“]|["”]$/g, '').trim();

      chunks.push({
        id: `chunk-dialogue-${indexCounter++}`,
        text: cleanDialogue,
        isDialogue: true,
        detectedSpeaker,
      });

      lastIndex = matchIndex + quoteText.length;
    }

    // Add trailing narrative text
    if (lastIndex < text.length) {
      const remainingNarrative = text.substring(lastIndex).trim();
      if (remainingNarrative) {
        chunks.push({
          id: `chunk-narrative-${indexCounter++}`,
          text: remainingNarrative,
          isDialogue: false,
        });
      }
    }

    return chunks;
  }

  /**
   * Heuristic speaker detection from dialogue tags (e.g., "Alice said", "whispered John", "asked Mary")
   */
  private static extractSpeaker(preceding: string, succeeding: string): string | undefined {
    // Dialogue tags like: said [Name], whispered [Name], asked [Name]
    const tagKeywords = '(?:said|whispered|cried|asked|muttered|replied|shouted|exclaimed|answered|yelled|sighed)';
    
    // Check succeeding: e.g. ", said Alice with a grin."
    const succPattern = new RegExp(`^[,.]?\\s*${tagKeywords}\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)`, 'i');
    const succMatch = succeeding.match(succPattern);
    if (succMatch && succMatch[1]) {
      return succMatch[1];
    }

    // Check preceding: e.g. "Alice looked up and whispered:"
    const precPattern = new RegExp(`([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)\\s+${tagKeywords}[:,-]?\\s*$`, 'i');
    const precMatch = preceding.match(precPattern);
    if (precMatch && precMatch[1]) {
      return precMatch[1];
    }

    return undefined;
  }
}
