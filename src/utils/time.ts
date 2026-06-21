import { Schedule } from '../types';

/**
 * Converts a time string in "HH:MM" format to minutes since midnight.
 */
export function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

/**
 * Checks if the current local time falls within a task's schedule.
 * Handles tasks that cross midnight (e.g., 23:00 to 01:00).
 */
export function isTaskActiveNow(task: Schedule): boolean {
  const now = new Date();

  // If daysOfWeek is defined, check if today is included
  if (task.daysOfWeek && task.daysOfWeek.length > 0) {
    const currentDay = now.getDay(); // 0=Sunday, 1=Monday, etc.
    if (!task.daysOfWeek.includes(currentDay)) {
      return false;
    }
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  const start = timeToMinutes(task.startTime);
  const end = timeToMinutes(task.endTime);

  if (start <= end) {
    return currentMinutes >= start && currentMinutes < end;
  } else {
    // Crosses midnight (e.g. 23:00 to 02:00)
    return currentMinutes >= start || currentMinutes < end;
  }
}


/**
 * Finds the currently active schedule from the list.
 */
export function getCurrentTask(schedules: Schedule[]): Schedule | null {
  for (const schedule of schedules) {
    if (isTaskActiveNow(schedule)) {
      return schedule;
    }
  }
  return null;
}

/**
 * Calculates remaining seconds until the active task's end time.
 */
export function getRemainingSeconds(endTimeStr: string): number {
  const now = new Date();
  const [endH, endM] = endTimeStr.split(':').map(Number);
  if (isNaN(endH) || isNaN(endM)) return 0;

  const target = new Date();
  target.setHours(endH, endM, 0, 0);

  // If the target time is earlier than now, it means it ends tomorrow (e.g., crossing midnight)
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  const diffMs = target.getTime() - now.getTime();
  return Math.max(0, Math.floor(diffMs / 1000));
}

/**
 * Formats seconds into HH:MM:SS
 */
export function formatRemainingTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => v.toString().padStart(2, '0')).join(':');
}

/**
 * Formats the time display of a schedule slot (e.g. "09:00 AM - 11:30 AM")
 */
export function formatTimeSlot(startTime: string, endTime: string): string {
  const toAmPm = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    return `${h12.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };
  return `${toAmPm(startTime)} - ${toAmPm(endTime)}`;
}
