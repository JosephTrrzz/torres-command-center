import { describe, expect, it } from "vitest";
import {
  formspreeSubmissionFingerprint,
  mapFormspreeLead,
  matchesFormspreeForm,
  missingFormspreeLeadContact,
  verifyFormspreeWebhook,
} from "../functions/_shared/formspree";

async function signedHeader(secret: string, timestamp: number, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
  const hex = Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

describe("Formspree CRM intake", () => {
  it("verifies a current signature and rejects tampering or replay", async () => {
    const secret = "formspree-test-secret";
    const now = Date.parse("2026-08-28T18:00:00.000Z");
    const timestamp = Math.floor(now / 1000);
    const body = JSON.stringify({ form: "mrennqzo", submission: { name: "New Lead" } });
    const signature = await signedHeader(secret, timestamp, body);

    await expect(verifyFormspreeWebhook({ FORMSPREE_WEBHOOK_SECRET: secret }, body, signature, now)).resolves.toBe(true);
    await expect(verifyFormspreeWebhook({ FORMSPREE_WEBHOOK_SECRET: secret }, `${body} `, signature, now)).resolves.toBe(false);
    await expect(verifyFormspreeWebhook({ FORMSPREE_WEBHOOK_SECRET: secret }, body, signature, now + 6 * 60 * 1000)).resolves.toBe(false);
  });

  it("maps the Torres website form into the existing CRM lead shape", () => {
    expect(mapFormspreeLead({
      form: "mrennqzo",
      submission: {
        name: "Alex Client",
        businessName: "Example Company",
        email: " ALEX@EXAMPLE.COM ",
        phone: "+1 503 555 0100",
        service: "Managed IT",
        contactMethod: "Email",
        description: "Please contact me about support.",
        _date: "2026-08-28T17:30:00Z",
        _url: "https://torrescotechnology.com/contact",
      },
    })).toEqual({
      fullName: "Alex Client",
      email: "alex@example.com",
      phone: "+1 503 555 0100",
      company: "Example Company",
      serviceInterest: "Managed IT",
      message: "Please contact me about support.\n\nPreferred contact: Email.",
      contactMethod: "Email",
      submittedAt: "2026-08-28T17:30:00.000Z",
      sourceUrl: "https://torrescotechnology.com/contact",
      isSpam: false,
    });
  });

  it("recognizes the configured form and generates stable retry fingerprints", async () => {
    expect(matchesFormspreeForm("mrennqzo", "mrennqzo")).toBe(true);
    expect(matchesFormspreeForm("https://formspree.io/f/mrennqzo", "mrennqzo")).toBe(true);
    expect(matchesFormspreeForm("different", "mrennqzo")).toBe(false);
    await expect(formspreeSubmissionFingerprint("same payload")).resolves.toBe(await formspreeSubmissionFingerprint("same payload"));
    await expect(formspreeSubmissionFingerprint("same payload")).resolves.not.toBe(await formspreeSubmissionFingerprint("different payload"));
  });

  it("marks the honeypot field as spam", () => {
    expect(mapFormspreeLead({ submission: { name: "Bot", email: "bot@example.com", _gotcha: "spam" } }).isSpam).toBe(true);
  });

  it("recognizes common Formspree email labels without storing arbitrary fields", () => {
    expect(mapFormspreeLead({ submission: {
      "Full Name": "Taylor Customer",
      "Email Address": " Taylor@Example.com ",
      "Phone Number": "+1 360 555 0188",
    } })).toMatchObject({
      fullName: "Taylor Customer",
      email: "taylor@example.com",
      phone: "+1 360 555 0188",
    });
    expect(mapFormspreeLead({ submission: { name: "Reply To", _replyto: "reply@example.com" } }).email).toBe("reply@example.com");
  });

  it("repairs missing contact details without overwriting existing CRM values", () => {
    const incoming = mapFormspreeLead({ submission: {
      name: "Alex Client",
      email: "alex@example.com",
      phone: "503-555-0100",
      businessName: "Incoming Company",
      description: "Incoming message",
    } });
    expect(missingFormspreeLeadContact({
      email: "",
      phone: "503-555-9999",
      company: "Saved Company",
      service_interest: "",
      message: "",
    }, incoming)).toEqual({
      email: "alex@example.com",
      message: "Incoming message",
    });
  });
});
