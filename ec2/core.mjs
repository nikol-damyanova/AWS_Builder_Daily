export const TIME_ZONE = 'Europe/Sofia';
export function localDay(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function addDays(day, count) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid date');
  const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+count); return d.toISOString().slice(0,10);
}
export function inWindow(day, startDay) { return Boolean(startDay && day >= startDay && day < addDays(startDay, 90)); }
export function articleUrl(raw) {
  const u = new URL(raw, 'https://builder.aws.com');
  if (u.origin !== 'https://builder.aws.com' || !/^\/content\/[A-Za-z0-9]+\//.test(u.pathname)) throw new Error('Unexpected article URL');
  return u.origin + u.pathname;
}
export function validateDraft(raw) {
  const v = JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  if (v.skip === true) return null;
  if (typeof v.comment !== 'string' || typeof v.evidence !== 'string') throw new Error('Invalid model output');
  const comment = v.comment.trim();
  if (comment.length < 30 || comment.length > 600 || /https?:\/\/|www\.|@[\w]/i.test(comment)) throw new Error('Invalid comment length or unsolicited link/mention');
  return {comment, evidence:v.evidence.trim()};
}
