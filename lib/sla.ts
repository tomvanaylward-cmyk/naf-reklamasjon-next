// SLA-regler for bedriftskunder (arbeidsdager)
const COMPANY_SLA_DAYS: Record<string, number> = {
  'Ayvens':     1,
  'Autoringen': 1,
  'Nettbil':    2,
};

/** Finn antall arbeidsdager SLA for et firmanavn, eller null hvis standard (14 kalenderdager) */
export function getCompanySLADays(company: string | null | undefined): number | null {
  if (!company) return null;
  const lower = company.toLowerCase();
  for (const [name, days] of Object.entries(COMPANY_SLA_DAYS)) {
    if (lower.includes(name.toLowerCase())) return days;
  }
  return null;
}

/** Legg til N arbeidsdager (hopp over lørdag/søndag) */
export function addWorkingDays(from: Date, days: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

/** Beregn SLA-frist basert på opprettet-tidspunkt og firmanavn */
export function calculateSLADeadline(createdAt: string, company: string | null | undefined): string {
  const created = new Date(createdAt);
  const workingDays = getCompanySLADays(company);
  if (workingDays !== null) {
    const deadline = addWorkingDays(created, workingDays);
    // Sett fristen til slutten av arbeidsdagen (18:00)
    deadline.setHours(18, 0, 0, 0);
    return deadline.toISOString();
  }
  // Standard: 14 kalenderdager
  return new Date(created.getTime() + 14 * 86400000).toISOString();
}

/** Sjekk om gjeldende tidspunkt er et varseltidspunkt (06, 12 eller 18) på en norsk hverdag */
export function isNotificationTime(): boolean {
  const now = new Date();
  // Konverter til norsk tid (Europe/Oslo)
  const oslo = new Intl.DateTimeFormat('nb-NO', {
    timeZone: 'Europe/Oslo',
    hour: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now);

  const hour    = Number(oslo.find(p => p.type === 'hour')?.value ?? -1);
  const weekday = oslo.find(p => p.type === 'weekday')?.value ?? '';

  // Hverdager på norsk: man, tir, ons, tor, fre
  const isWeekday = ['man', 'tir', 'ons', 'tor', 'fre'].includes(weekday.toLowerCase());
  const isAlertHour = hour === 6 || hour === 12 || hour === 18;

  return isWeekday && isAlertHour;
}
