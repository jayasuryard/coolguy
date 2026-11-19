import type { Judgement } from '../transport/timing';

/** Domain events emitted by simulation and consumed by story/world reducers. */
export type DomainEvent =
  | {
      type: 'phraseReleased';
      phrase: string;
      /** Receiver in range when released, if any. */
      receiver: string | null;
      judgement: Judgement;
      offsetMs: number;
    }
  | { type: 'landedSafely'; pad: string | null };

type Listener = (e: DomainEvent) => void;

export class EventBus {
  private readonly listeners = new Set<Listener>();

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: DomainEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}
