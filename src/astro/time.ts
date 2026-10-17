// Time for the orbit model: Julian dates.
//
// Conventions
// - A Julian date (JD) is a count of days, with fraction, since noon on 1 January 4713 BC (proleptic
//   Julian calendar). Plain numbers, no wrapper type.
// - J2000 = JD 2451545.0 = 2000-01-01 12:00, the epoch of the fact sheets' "Mean Orbital Elements
//   (J2000)" ("12:00 UT 1 Jan 2000"), of their pole-of-rotation formulas, and of the Horizons frame.
// - JavaScript Dates are read and written as UTC (milliseconds since 1970-01-01T00:00Z, no leap
//   seconds). The model does not tell UTC from the dynamical time scales (TT, TDB) that the elements and
//   JPL's ephemerides strictly use: TT − UTC was 64.184 s at J2000 and is 69.184 s in 2026. A minute
//   moves Mercury, the fastest planet, 0.003° along its orbit — far below the model's own error.

/** JD 2451545.0, 2000-01-01 12:00, the reference epoch of the mean orbital elements. */
export const J2000 = 2451545.0;

/** Days in a Julian century, the unit of T in NASA's pole formulas ("RA = 317.681 − 0.106T"). */
export const DAYS_PER_JULIAN_CENTURY = 36525;

/** An instant: a JavaScript Date (UTC), or a Julian date. */
export type Instant = Date | number;

const MS_PER_DAY = 86_400_000;
/** JD of the Unix epoch, 1970-01-01T00:00Z. */
const UNIX_EPOCH_JD = 2440587.5;
/** J2000 as Unix milliseconds: 2000-01-01T12:00:00Z. */
const J2000_MS = 946_728_000_000;

/** Julian date of a Date, taken as UTC. */
export function julianDate(date: Date): number {
  return date.getTime() / MS_PER_DAY + UNIX_EPOCH_JD;
}

/** The Date (UTC) of a Julian date, to the millisecond. */
export function dateFromJulian(jd: number): Date {
  return new Date(Math.round((jd - UNIX_EPOCH_JD) * MS_PER_DAY));
}

/** Julian date of an instant: a Date is converted, a number is taken to be a JD already. */
export function toJulian(when: Instant): number {
  return typeof when === 'number' ? when : julianDate(when);
}

/** Days (with fraction) from J2000 to an instant; negative before 2000-01-01 12:00. */
export function daysSinceJ2000(when: Instant): number {
  // From a Date, count milliseconds from J2000 directly: exact, without a 2.45-million-day offset.
  return typeof when === 'number' ? when - J2000 : (when.getTime() - J2000_MS) / MS_PER_DAY;
}

/** Julian centuries from J2000, the T of NASA's pole-of-rotation formulas. */
export function centuriesSinceJ2000(when: Instant): number {
  return daysSinceJ2000(when) / DAYS_PER_JULIAN_CENTURY;
}
