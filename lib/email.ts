const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 320) : "";
}

export function isValidEmail(value: unknown) {
  const email = normalizeEmail(value);
  return email.length > 3 && EMAIL_PATTERN.test(email);
}

