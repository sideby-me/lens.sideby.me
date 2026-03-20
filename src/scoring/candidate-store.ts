import type { Candidate } from './types.js';

export class CandidateStore {
  private candidates: Candidate[] = [];

  add(candidate: Candidate): void {
    this.candidates.push(candidate);
  }

  list(): Candidate[] {
    return [...this.candidates]; // defensive copy
  }

  count(): number {
    return this.candidates.length;
  }
}
