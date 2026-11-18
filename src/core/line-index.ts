export interface LinePosition {
  readonly line: number;
  readonly character: number;
}

/** Converts UTF-16 offsets to zero-based line/character, treating CRLF, LF and CR as line ends. */
export class LineIndex {
  private readonly starts: number[] = [0];
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 10) this.starts.push(i + 1);
      else if (c === 13 && text.charCodeAt(i + 1) !== 10) this.starts.push(i + 1);
    }
  }

  positionAt(offset: number): LinePosition {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= clamped) low = mid;
      else high = mid - 1;
    }
    return { line: low, character: clamped - (this.starts[low] ?? 0) };
  }
}
