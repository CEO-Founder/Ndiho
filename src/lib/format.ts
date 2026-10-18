// Date/label formatting shared by server and client components.
import { BOOKABLE_SERVICES } from "./schemas";
import { PLATFORM_TIMEZONE } from "./time";

const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: PLATFORM_TIMEZONE, weekday: "short", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: PLATFORM_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function formatDate(iso: string) {
  return dateFmt.format(new Date(iso));
}
export function formatTime(iso: string) {
  return timeFmt.format(new Date(iso));
}
export function formatWhen(iso: string) {
  return `${formatDate(iso)} · ${formatTime(iso)}`;
}
export function serviceLabel(id: string) {
  return BOOKABLE_SERVICES.find((s) => s.id === id)?.label ?? id;
}
