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

/**
 * Recursively removes any keys with undefined values from an object,
 * safely handling arrays, Date instances, and Firestore FieldValues.
 */
export function sanitizeForFirestore<T>(obj: T): T {
  if (obj === undefined) {
    return undefined as any;
  }
  if (obj === null) {
    return null as any;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForFirestore(item)) as any;
  }
  if (obj instanceof Date) {
    return obj;
  }
  if (typeof obj === "object") {
    const proto = Object.getPrototypeOf(obj);
    if (proto !== null && proto !== Object.prototype) {
      return obj;
    }
    const res: any = {};
    for (const key of Object.keys(obj as any)) {
      const val = (obj as any)[key];
      if (val !== undefined) {
        res[key] = sanitizeForFirestore(val);
      }
    }
    return res;
  }
  return obj;
}

/**
 * Determines the row (1-5) for a given bed number based on the beach club rows.
 */
export function getBedRow(bedNum: number): number {
  const row1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70];
  const row2 = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81];
  const row3 = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92];
  const row4 = [31, 32, 33, 34, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103];
  const row5 = [104, 105, 106, 107, 108, 109];

  if (row1.includes(bedNum)) return 1;
  if (row2.includes(bedNum)) return 2;
  if (row3.includes(bedNum)) return 3;
  if (row4.includes(bedNum)) return 4;
  if (row5.includes(bedNum)) return 5;
  
  return 1; // Fallback
}

/**
 * Calculates the booking price dynamically based on custom configurations or fallbacks.
 */
export function getPriceForBooking(
  dateStr: string,
  bedNumber: number,
  slot: "morning" | "afternoon" | "full_day",
  pricingConfigs: any[]
): number {
  const row = getBedRow(bedNumber);
  if (!dateStr) return slot === "full_day" ? 30 : 15;
  
  // Extract month from date YYYY-MM-DD
  const parts = dateStr.split("-");
  if (parts.length < 2) return slot === "full_day" ? 30 : 15;
  const month = parts[1]; // e.g. "07"
  
  // Check custom configs
  const customConfig = pricingConfigs?.find((c) => c.id === month);
  if (customConfig && customConfig.prices && customConfig.prices[row]) {
    const rowPrice = customConfig.prices[row];
    const fullDayPrice = Number(rowPrice.fullDay) ?? 30;
    const halfDayPrice = Number(rowPrice.halfDay) ?? 15;
    return slot === "full_day" ? fullDayPrice : halfDayPrice;
  }
  
  // Fallback default prices
  const defaults: Record<string, Record<number, { fullDay: number; halfDay: number }>> = {
    "05": {
      1: { fullDay: 25, halfDay: 15 },
      2: { fullDay: 20, halfDay: 12 },
      3: { fullDay: 18, halfDay: 10 },
      4: { fullDay: 15, halfDay: 9 },
      5: { fullDay: 15, halfDay: 9 }
    },
    "06": {
      1: { fullDay: 30, halfDay: 18 },
      2: { fullDay: 25, halfDay: 15 },
      3: { fullDay: 22, halfDay: 13 },
      4: { fullDay: 20, halfDay: 12 },
      5: { fullDay: 18, halfDay: 10 }
    },
    "07": {
      1: { fullDay: 35, halfDay: 20 },
      2: { fullDay: 30, halfDay: 18 },
      3: { fullDay: 25, halfDay: 15 },
      4: { fullDay: 22, halfDay: 13 },
      5: { fullDay: 20, halfDay: 12 }
    },
    "08": {
      1: { fullDay: 40, halfDay: 25 },
      2: { fullDay: 35, halfDay: 20 },
      3: { fullDay: 30, halfDay: 18 },
      4: { fullDay: 25, halfDay: 15 },
      5: { fullDay: 22, halfDay: 13 }
    },
    "09": {
      1: { fullDay: 25, halfDay: 15 },
      2: { fullDay: 20, halfDay: 12 },
      3: { fullDay: 18, halfDay: 10 },
      4: { fullDay: 15, halfDay: 9 },
      5: { fullDay: 15, halfDay: 9 }
    }
  };

  const defaultMonth = defaults[month] || defaults["06"];
  const rowPrice = defaultMonth[row] || defaultMonth[1];
  return slot === "full_day" ? rowPrice.fullDay : rowPrice.halfDay;
}


