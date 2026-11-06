export const TORRES_SITE_CLIENT = "06edc104-71e0-4359-8cb3-42529d65b5d1";
export const originalIntro = {
  heading: "Considered design.", emphasis: "Personal attention.",
  description: "Websites, IT systems, and local search, shaped around your business. Work directly with the owner, from the first conversation to the details that follow.",
  photo: "", alt: "",
};
export type WebsiteIntro = typeof originalIntro;
export const maxPhotoBytes = 512 * 1024;

export function validIntro(value: unknown): value is WebsiteIntro {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const limits = { heading: 100, emphasis: 100, description: 600, alt: 180 };
  for (const [key, limit] of Object.entries(limits)) {
    const text = item[key];
    if (typeof text !== "string" || text.length > limit) return false;
  }
  if (!String(item.heading).trim() || !String(item.description).trim()) return false;
  if (item.photo === "") return true;
  if (typeof item.photo !== "string" || item.photo.length > Math.ceil(maxPhotoBytes / 3) * 4 + 24 || !String(item.alt).trim()) return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(item.photo);
  if (!match) return false;
  try {
    const bytes = atob(match[2]);
    if (bytes.length > maxPhotoBytes) return false;
    if (match[1] === "png") return bytes.startsWith("\x89PNG\r\n\x1a\n");
    if (match[1] === "jpeg") return bytes.startsWith("\xff\xd8\xff");
    return bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
  } catch { return false; }
}
