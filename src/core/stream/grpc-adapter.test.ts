import { describe, it, expect } from "vitest";
import { normalizeEndpoint } from "./grpc-adapter.js";

describe("normalizeEndpoint", () => {
  it("(a) adds https:// when no scheme present", () => {
    expect(normalizeEndpoint("fra.grpc.solinfra.dev:443")).toBe("https://fra.grpc.solinfra.dev:443");
  });

  it("(b) leaves existing https:// scheme untouched", () => {
    expect(normalizeEndpoint("https://fra.grpc.solinfra.dev:443")).toBe("https://fra.grpc.solinfra.dev:443");
  });

  it("(c) leaves existing http:// scheme untouched", () => {
    expect(normalizeEndpoint("http://localhost:10000")).toBe("http://localhost:10000");
  });

  it("(d) adds https:// for bare host:port", () => {
    expect(normalizeEndpoint("localhost:10000")).toBe("https://localhost:10000");
  });
});
