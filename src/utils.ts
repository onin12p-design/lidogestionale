/**
 * Returns the current date in Europe/Rome timezone in YYYY-MM-DD format.
 */
export function getRomeTodayString(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

/**
 * Returns a friendly Italian description of the date (e.g. "Sabato, 4 Luglio 2026").
 */
export function formatItalianDate(dateStr: string): string {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  
  return date.toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

/**
 * Adjusts a date string (YYYY-MM-DD) by a number of days.
 */
export function adjustDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Validates if a bed number is part of the Samarinda Beach immutable map.
 */
export function isValidBedNumber(bedNum: number): boolean {
  const VALID_BEDS = new Set([
    // PEDANA SINISTRA — LEFT
    1, 2, 3, 4, 5,
    11, 12, 13, 14, 15,
    21, 22, 23, 24, 25,
    31, 32, 33, 34,
    // PEDANA SINISTRA — RIGHT
    6, 7, 8, 9, 10,
    16, 17, 18, 19, 20,
    26, 27, 28, 29, 30,
    // PEDANA DESTRA — LEFT
    60, 61, 62, 63, 64,
    71, 72, 73, 74, 75,
    82, 83, 84, 85, 86,
    93, 94, 95, 96, 97,
    // PEDANA DESTRA — RIGHT
    65, 66, 67, 68, 69, 70,
    76, 77, 78, 79, 80, 81,
    87, 88, 89, 90, 91, 92,
    98, 99, 100, 101, 102, 103,
    104, 105, 106, 107, 108, 109
  ]);
  return VALID_BEDS.has(bedNum);
}
