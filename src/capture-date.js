export function captureDateKey(value) {
  const match = String(value || '').trim().match(/^(20\d{2})\s*[.년/-]\s*(0?[1-9]|1[0-2])(?:\s*월)?\s*$/);
  return match ? `${match[1]}.${match[2].padStart(2, '0')}` : '';
}

export function captureDateLabel(value) {
  const key = captureDateKey(value);
  return key ? `${key.slice(0, 4)}년 ${Number(key.slice(5))}월` : '';
}
