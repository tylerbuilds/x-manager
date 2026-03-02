import cron from 'node-cron';

type CronPart = {
  min: number;
  max: number;
  value: number;
};

function normalizeDayOfWeek(value: number): number {
  return value === 7 ? 0 : value;
}

function expandToken(token: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  const [rangePart, stepPart] = token.split('/');
  const step = stepPart ? Math.max(1, Number.parseInt(stepPart, 10) || 1) : 1;

  let start = min;
  let end = max;
  if (rangePart !== '*') {
    if (rangePart.includes('-')) {
      const [rawStart, rawEnd] = rangePart.split('-');
      start = Number.parseInt(rawStart, 10);
      end = Number.parseInt(rawEnd, 10);
    } else {
      const exact = Number.parseInt(rangePart, 10);
      start = exact;
      end = exact;
    }
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return values;
  }

  for (let current = start; current <= end; current += step) {
    if (current >= min && current <= max) {
      values.add(current);
    }
  }

  return values;
}

function matchesCronField(field: string, part: CronPart, isDow = false): boolean {
  if (field.trim() === '*') {
    return true;
  }

  const candidate = isDow ? normalizeDayOfWeek(part.value) : part.value;
  const tokens = field.split(',').map((token) => token.trim()).filter(Boolean);

  return tokens.some((token) => {
    const values = expandToken(token, part.min, part.max);
    if (isDow && values.has(7)) {
      values.add(0);
    }
    return values.has(candidate);
  });
}

export function matchesCronExpression(expression: string, date: Date): boolean {
  if (!cron.validate(expression)) {
    return false;
  }

  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return (
    matchesCronField(minute, { min: 0, max: 59, value: date.getMinutes() }) &&
    matchesCronField(hour, { min: 0, max: 23, value: date.getHours() }) &&
    matchesCronField(dayOfMonth, { min: 1, max: 31, value: date.getDate() }) &&
    matchesCronField(month, { min: 1, max: 12, value: date.getMonth() + 1 }) &&
    matchesCronField(dayOfWeek, { min: 0, max: 7, value: date.getDay() }, true)
  );
}

export function isSameMinute(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  );
}

export function shouldRunCronNow(expression: string, now: Date, lastRunAt?: Date | null): boolean {
  if (!matchesCronExpression(expression, now)) {
    return false;
  }
  if (!lastRunAt) {
    return true;
  }
  return !isSameMinute(now, lastRunAt);
}
