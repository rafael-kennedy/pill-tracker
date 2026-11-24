// Humanized time. "just now", "45 minutes ago", "2 hours 15 minutes ago", "yesterday", "3 days ago".
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

export function ago(t, now = Date.now()) {
  const d = Math.max(0, now - t);
  if (d < MIN) return 'just now';
  if (d < HOUR) return rtf.format(-Math.floor(d / MIN), 'minute');
  if (d < 6 * HOUR) {
    const h = Math.floor(d / HOUR), m = Math.floor((d % HOUR) / MIN);
    if (!m) return rtf.format(-h, 'hour');
    return `${h} ${h === 1 ? 'hour' : 'hours'} ${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
  }
  if (d < DAY) return rtf.format(-Math.floor(d / HOUR), 'hour');
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days < 14) return rtf.format(-Math.max(1, days), 'day');
  if (days < 60) return rtf.format(-Math.floor(days / 7), 'week');
  return rtf.format(-Math.floor(days / 30), 'month');
}

function startOfDay(t) { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); }

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export function stamp(t, now = Date.now()) {
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : dateFmt.format(t);
  return `${day}, ${timeFmt.format(t)}`;
}
