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
export function getBedRow(bedNum: number, rowsConfig?: Record<number, number>): number {
  if (rowsConfig) {
    const val = rowsConfig[bedNum];
    if (val !== undefined) return Number(val);
  }
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
  pricingConfigs: any[],
  rowsConfig?: Record<number, number>
): number {
  const row = getBedRow(bedNumber, rowsConfig);
  if (!dateStr) return slot === "full_day" ? 30 : 15;
  
  // Extract month from date YYYY-MM-DD
  const parts = dateStr.split("-");
  if (parts.length < 2) return slot === "full_day" ? 30 : 15;
  const month = parts[1]; // e.g. "07"
  
  // Check custom configs
  const customConfig = pricingConfigs?.find((c) => c.id === month);
  if (customConfig && customConfig.prices && customConfig.prices[row]) {
    const rowPrice = customConfig.prices[row];
    const fullDayPrice = toNumberOr(rowPrice.fullDay, 30);
    const halfDayPrice = toNumberOr(rowPrice.halfDay, 15);
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

/**
 * Returns the count of lettini for a given bed, based on the custom configuration or default.
 */
export function getBedLettiniCount(bedNum: number, bedsConfig?: Record<number, number>): number {
  if (bedsConfig && bedsConfig[bedNum] !== undefined) {
    return bedsConfig[bedNum];
  }
  return 2; // Default
}

/**
 * Returns the list of available items (ombrellone, lettino_1, lettino_2, etc.) for a bed.
 */
export function getBedItems(bedNum: number, numLettini: number): string[] {
  const items = ["ombrellone"];
  for (let i = 1; i <= numLettini; i++) {
    items.push(`lettino_${i}`);
  }
  return items;
}

/**
 * Calculates the booking price proportionally based on the booked sub-resources.
 */
export function getBookingPriceProportional(
  booking: any,
  pricingConfigs: any[],
  bedsConfig?: Record<number, number>,
  rowsConfig?: Record<number, number>
): number {
  if (!booking) return 0;

  const risorseList = booking.risorse && booking.risorse.length > 0
    ? booking.risorse
    : [{ postazione: booking.bedNumber, items: [] }];

  let totalPrice = 0;

  risorseList.forEach((res: any) => {
    const bedNum = res.postazione;
    const row = getBedRow(bedNum, rowsConfig);
    const slot = booking.slot;

    // Determine price per single lettino based on row and slot
    let fullDayLettinoPrice = row === 1 ? 20 : 15;
    let halfDayLettinoPrice = row === 1 ? 15 : 12;

    // Check custom configs for this month and row if they exist
    if (booking.date) {
      const parts = booking.date.split("-");
      if (parts.length >= 2) {
        const month = parts[1];
        const customConfig = pricingConfigs?.find((c) => c.id === month);
        if (customConfig && customConfig.prices && customConfig.prices[row]) {
          const rowPrice = customConfig.prices[row];
          const fullDayTotal = toNumberOr(rowPrice.fullDay, 30);
          const halfDayTotal = toNumberOr(rowPrice.halfDay, 15);
          const numLettini = getBedLettiniCount(bedNum, bedsConfig);

          // Proportional single-lettino price if custom configs exist
          fullDayLettinoPrice = numLettini > 0 ? (fullDayTotal / numLettini) : 15;
          halfDayLettinoPrice = numLettini > 0 ? (halfDayTotal / numLettini) : 12;
        }
      }
    }

    const pricePerLettino = slot === "full_day" ? fullDayLettinoPrice : halfDayLettinoPrice;

    // Count how many items in this resource are lettini (start with "lettino_")
    let bookedLettiniCount = 0;
    if (res.items && res.items.length > 0) {
      bookedLettiniCount = res.items.filter((it: string) => it.startsWith("lettino")).length;
    } else {
      // Legacy booking fallback: occupies all lettini of this postazione
      bookedLettiniCount = getBedLettiniCount(bedNum, bedsConfig);
    }

    totalPrice += bookedLettiniCount * pricePerLettino;
  });

  return Math.round(totalPrice * 100) / 100; // Round to 2 decimal places
}

/**
 * Helper to get the list of items occupied by a booking on a given bed.
 */
export function getOccupiedItemsForBooking(b: any, bedNumber: number, bedsConfig?: Record<number, number>): string[] {
  if (b.risorse && b.risorse.length > 0) {
    const res = b.risorse.find((r: any) => r.postazione === bedNumber);
    if (res) return res.items;
  }
  // Fallback / legacy: complete postazione
  const numL = getBedLettiniCount(bedNumber, bedsConfig);
  return getBedItems(bedNumber, numL);
}

/**
 * Assigns items for a subscription booking. If slotTypeId is "1LIG", assigns only one free lettino.
 */
export function getSubscriptionItemsForBooking(
  bNum: number,
  slotTypeId: string | undefined,
  existingBookings: any[],
  bedsConfig?: Record<number, number>
): string[] {
  const numLettini = getBedLettiniCount(bNum, bedsConfig);
  const defaultItems = getBedItems(bNum, numLettini);

  if (slotTypeId === "1LIG") {
    const occupiedLettini = new Set<string>();
    existingBookings.forEach((eb) => {
      const items = getOccupiedItemsForBooking(eb, bNum, bedsConfig);
      items.forEach((it) => {
        if (it.startsWith("lettino")) {
          occupiedLettini.add(it);
        }
      });
    });

    if (!occupiedLettini.has("lettino_1")) {
      return ["ombrellone", "lettino_1"];
    } else if (!occupiedLettini.has("lettino_2") && numLettini >= 2) {
      return ["ombrellone", "lettino_2"];
    } else {
      return ["ombrellone", "lettino_1"];
    }
  }

  return defaultItems;
}

/**
 * Central conflict checker based on CR-3.
 * Two bookings on the same day and same postazione and same item conflict if their slots overlap.
 */
export function hasConflict(
  itemBookings: Array<any>,
  nuovaFascia: "morning" | "afternoon" | "full_day",
  currentItem?: string,
  nuoviItems?: string[]
): boolean {
  return itemBookings.some((b) => {
    const slotA = b.tipoPrenotazione === "abbonato" ? "full_day" : b.slot;
    const slotB = nuovaFascia;
    
    let slotsOverlap = false;
    if (slotA === "full_day" || slotB === "full_day") {
      slotsOverlap = true;
    } else {
      slotsOverlap = slotA === slotB;
    }

    if (!slotsOverlap) {
      return false;
    }

    // Exception for shared "ombrellone":
    // If checking "ombrellone" and we have details of the items, they can share if their lettini do not overlap.
    if (currentItem === "ombrellone" && nuoviItems) {
      const existingItems = getOccupiedItemsForBooking(b, b.bedNumber || b.postazione);
      
      const hasLettino1A = existingItems.includes("lettino_1");
      const hasLettino2A = existingItems.includes("lettino_2");
      const hasLettino1B = nuoviItems.includes("lettino_1");
      const hasLettino2B = nuoviItems.includes("lettino_2");

      const overlapLettino1 = hasLettino1A && hasLettino1B;
      const overlapLettino2 = hasLettino2A && hasLettino2B;

      if (!overlapLettino1 && !overlapLettino2) {
        return false; // they can share the ombrellone!
      }
    }

    return true;
  });
}

/**
 * Safe numeric conversion helper. Converts a value to a number, and if the result
 * is NaN, returns the provided fallback value instead.
 */
export function toNumberOr(value: any, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return isNaN(num) ? fallback : num;
}



