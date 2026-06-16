import { describe, it, expect } from "vitest";
import { assertJitoAuthKeypair } from "./config.js";

describe("assertJitoAuthKeypair (Story 5.8 AC2)", () => {
  it("throws when the searcher auth keypair equals the funded payer keypair", () => {
    expect(() => assertJitoAuthKeypair("/keys/payer.json", "/keys/payer.json")).toThrow(
      /must not be the funded payer keypair/,
    );
  });

  it("passes when the auth keypair differs from the payer", () => {
    expect(() => assertJitoAuthKeypair("jito-auth-keypair.json", "/keys/payer.json")).not.toThrow();
  });

  it("passes when no searcher auth keypair is configured (undefined)", () => {
    expect(() => assertJitoAuthKeypair(undefined, "/keys/payer.json")).not.toThrow();
  });
});
