export interface MemoryRecord {
  id: string;
  content: string;
  speaker: 'user' | 'assistant' | 'summary';
  timestamp: string;
  compaction?: {
    coversUntil: string;
    folded: boolean;
    gen: number;
  };
}

export interface ArchivedRecord extends MemoryRecord {
  archiveId: string;
  archivedAt: string;
}

export interface FadingMemory {
  summary: string;
  rawTurns: MemoryRecord[];
  archive: ArchivedRecord[];
  /** Turni archiviati in totale; `archive` ne tiene in RAM solo la coda. */
  archivedCount?: number;
}

export interface MemoryState {
  conversationId: string;
  fadingMemory: FadingMemory;
  lastCompacted: string;
  cursor: string | null;
}

export type MemoryType = 'conversation' | 'meta' | 'dream' | 'consolidated' | 'heartbeat';

export interface LegacyMemory {
  id: string;
  content: string;
  memoryType: MemoryType;
  emotions: Record<string, number>;
  createdAt: Date;
  metadata: Record<string, any>;
}
