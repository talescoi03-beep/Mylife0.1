import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';

// Fixed namespace for deterministic ids (any constant UUID works; never change it).
const NAMESPACE = '6f1d8b7e-3c2a-4e59-9b1f-2d7a5c8e4f10';

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : uuidv4();
}

/**
 * Same input → same id on every device. Used for records that must exist at
 * most once (one habit check-in per day, the next copy of a recurring task),
 * so two offline devices produce the same row instead of a duplicate.
 */
export function stableId(...parts: string[]): string {
  return uuidv5(parts.join('|'), NAMESPACE);
}
