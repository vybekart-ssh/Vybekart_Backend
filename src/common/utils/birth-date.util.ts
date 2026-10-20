import { BadRequestException } from '@nestjs/common';

/** Birthdate wire format: `YYYY-MM-DD`. */
export const BIRTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const BIRTH_DATE_FORMAT_MESSAGE = 'birthDate must be a date in YYYY-MM-DD format';

/** Parses a `YYYY-MM-DD` birthdate; rejects impossible dates, future dates and years before 1900. */
export function parseBirthDate(raw: string): Date {
  const value = raw.trim();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !BIRTH_DATE_PATTERN.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Please enter a valid birthdate');
  }
  if (date.getTime() > Date.now()) {
    throw new BadRequestException('Birthdate cannot be in the future');
  }
  if (date.getUTCFullYear() < 1900) {
    throw new BadRequestException('Please enter a valid birthdate');
  }
  return date;
}

export function formatBirthDate(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}
