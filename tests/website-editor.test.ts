import { expect, it } from "vitest";
import { originalIntro, validIntro } from "../lib/website-editor";
it("accepts the existing text without an image", () => expect(validIntro(originalIntro)).toBe(true));
it("rejects SVG and disguised text uploads", () => {
  for (const photo of ["data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,SGVsbG8="]) {
    expect(validIntro({ ...originalIntro, alt: "Feature", photo })).toBe(false);
  }
});
