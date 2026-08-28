import { Timestamp } from 'firebase/firestore';

export type FirestoreDateValue = Timestamp | Date | string | null | undefined;

export function firestoreDateToDate(value: FirestoreDateValue): Date | null {
  if (!value) return null;
  const date = value instanceof Timestamp
    ? value.toDate()
    : value instanceof Date
      ? value
      : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
