import { describe, expect, it } from "vitest";
import { extractTemplateVars, fillTemplate } from "@shared/types/prompt-template";

describe("extractTemplateVars", () => {
  it("extracts distinct vars in order", () => {
    expect(extractTemplateVars("Review {{area}} then {{area}} and {{depth}}")).toEqual(["area", "depth"]);
  });

  it("returns empty for no placeholders", () => {
    expect(extractTemplateVars("plain text")).toEqual([]);
  });

  it("tolerates whitespace inside braces", () => {
    expect(extractTemplateVars("a {{ x }} b {{y}}")).toEqual(["x", "y"]);
  });

  it("supports hyphen/underscore names", () => {
    expect(extractTemplateVars("{{file-path}} {{user_id}}")).toEqual(["file-path", "user_id"]);
  });
});

describe("fillTemplate", () => {
  it("replaces placeholders with values", () => {
    expect(fillTemplate("Hi {{name}}, review {{area}}", { name: "Sam", area: "auth" })).toBe(
      "Hi Sam, review auth",
    );
  });

  it("leaves unknown placeholders untouched", () => {
    expect(fillTemplate("{{a}} {{b}}", { a: "1" })).toBe("1 {{b}}");
  });

  it("tolerates whitespace inside braces", () => {
    expect(fillTemplate("{{ name }}", { name: "Sam" })).toBe("Sam");
  });
});
