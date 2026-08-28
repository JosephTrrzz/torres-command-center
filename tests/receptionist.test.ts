import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RECEPTIONIST_KNOWLEDGE,
  allowedReceptionistOrigins,
  answerFromApprovedKnowledge,
  answerReceptionist,
  cleanReceptionistText,
  receptionistCorsHeaders,
  validReceptionistEmail,
  validReceptionistPhone,
} from "../functions/_shared/receptionist";

describe("website receptionist input safety", () => {
  it("cleans control characters and caps visitor text", () => {
    expect(cleanReceptionistText("  hello\u0000 world  ")).toBe("hello world");
    expect(cleanReceptionistText("abcdef", 4)).toBe("abcd");
    expect(cleanReceptionistText({ message: "hello" })).toBe("");
  });

  it("accepts practical contact details and rejects malformed values", () => {
    expect(validReceptionistEmail("client@example.com")).toBe(true);
    expect(validReceptionistEmail("client@example")).toBe(false);
    expect(validReceptionistPhone("+1 (503) 555-0123")).toBe(true);
    expect(validReceptionistPhone("123")).toBe(false);
  });
});

describe("website receptionist origin controls", () => {
  it("allows only exact configured production origins", () => {
    const origins = allowedReceptionistOrigins("https://chat.example.com,not-a-url");
    expect(origins.has("https://torrescotechnology.com")).toBe(true);
    expect(origins.has("https://www.torrescotechnology.com")).toBe(true);
    expect(origins.has("https://chat.example.com")).toBe(true);
    expect(origins.has("https://torrescotechnology.com.attacker.test")).toBe(false);
  });

  it("returns CORS headers only for an exact allowlisted origin", () => {
    expect(receptionistCorsHeaders("https://torrescotechnology.com")?.["Access-Control-Allow-Origin"])
      .toBe("https://torrescotechnology.com");
    expect(receptionistCorsHeaders("https://evil.example")).toBeNull();
  });
});

describe("approved receptionist knowledge", () => {
  it("answers from approved content when a topic matches", () => {
    const answer = answerFromApprovedKnowledge(
      "Do you provide website design services?",
      DEFAULT_RECEPTIONIST_KNOWLEDGE,
      "I do not know.",
    );
    expect(answer.matched).toBe(true);
    expect(answer.source).toBe("Services");
    expect(answer.body).toContain("website design");
  });

  it("uses the safe fallback instead of guessing", () => {
    const fallback = "I do not want to guess. I can ask the team to follow up.";
    expect(answerFromApprovedKnowledge("What color is your delivery van?", DEFAULT_RECEPTIONIST_KNOWLEDGE, fallback))
      .toEqual({ body: fallback, matched: false, source: "fallback" });
  });

  it("does not call the AI binding for an unapproved topic", async () => {
    const run = vi.fn();
    const fallback = "I do not want to guess.";
    const answer = await answerReceptionist({
      message: "What is your bank account number?",
      knowledge: DEFAULT_RECEPTIONIST_KNOWLEDGE,
      fallback,
      ai: { run },
    });
    expect(run).not.toHaveBeenCalled();
    expect(answer.body).toBe(fallback);
  });

  it("falls back to approved deterministic content when AI fails", async () => {
    const answer = await answerReceptionist({
      message: "What services do you offer?",
      knowledge: DEFAULT_RECEPTIONIST_KNOWLEDGE,
      fallback: "I do not want to guess.",
      ai: { run: vi.fn().mockRejectedValue(new Error("provider unavailable")) },
    });
    expect(answer.source).toBe("Services");
    expect(answer.body).toContain("small-business IT support");
  });
});
