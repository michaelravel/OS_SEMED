const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeInstitutionalEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeGoogleDomain(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
}

export function allowedGoogleDomains(
  configured = process.env.ALLOWED_GOOGLE_DOMAINS ?? "",
) {
  return [...new Set(configured.split(",").map(normalizeGoogleDomain).filter(Boolean))]
    .filter((domain) => domainPattern.test(domain));
}

export function institutionalEmailDomain(email: string) {
  const normalized = normalizeInstitutionalEmail(email);
  const separator = normalized.lastIndexOf("@");
  return separator > 0 ? normalized.slice(separator + 1) : "";
}

export function isAllowedGoogleEmail(
  email: string,
  domains = allowedGoogleDomains(),
) {
  const normalized = normalizeInstitutionalEmail(email);
  return normalized.length <= 254 && emailPattern.test(normalized) &&
    domains.includes(institutionalEmailDomain(normalized));
}
