import { test, expect } from "bun:test";
import { parseCredentials } from "./register-helpers.ts";

test("parseCredentials keeps valid {ref,value} rows", () => {
  const out = parseCredentials([
    { ref: "elevenlabs", value: "sk_live_x" },
    { ref: "openai", value: "sk_y" },
  ]);
  expect(out).toEqual([
    { ref: "elevenlabs", value: "sk_live_x" },
    { ref: "openai", value: "sk_y" },
  ]);
});

test("parseCredentials drops blank refs/values and trims the ref", () => {
  const out = parseCredentials([
    { ref: "  elevenlabs  ", value: "k" },
    { ref: "", value: "k" },
    { ref: "x", value: "" },
    { ref: "y" },
    "garbage",
    null,
  ]);
  expect(out).toEqual([{ ref: "elevenlabs", value: "k" }]);
});

test("parseCredentials returns [] for non-array / undefined input", () => {
  expect(parseCredentials(undefined)).toEqual([]);
  expect(parseCredentials("nope")).toEqual([]);
  expect(parseCredentials({})).toEqual([]);
});
