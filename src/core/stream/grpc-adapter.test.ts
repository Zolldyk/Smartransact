import { describe, it, expect } from "vitest";
import { normalizeEndpoint, describeGrpcError, closeGrpcStream } from "./grpc-adapter.js";

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

describe("describeGrpcError", () => {
  it("(a) surfaces the deepest cause with the top-level for context", () => {
    const deep = new Error('max concurrent streams (1) reached for your tier');
    const mid = new Error("gRPC status: resource exhausted", { cause: deep });
    const top = new Error("failed to open subscribe stream", { cause: mid });
    const out = describeGrpcError(top);
    expect(out).toContain("max concurrent streams (1) reached for your tier");
    expect(out).toContain("failed to open subscribe stream");
  });

  it("(b) returns the single message when there is no cause chain", () => {
    expect(describeGrpcError(new Error("plain failure"))).toBe("plain failure");
  });

  it("(c) handles non-Error and cyclic causes without looping", () => {
    const a: { message: string; cause?: unknown } = { message: "a" };
    a.cause = a; // cycle
    expect(describeGrpcError(a)).toContain("a");
    expect(describeGrpcError("just a string")).toBe("just a string");
  });
});

describe("closeGrpcStream", () => {
  it("(a) destroys a stream that exposes destroy() — frees the rationed stream slot", () => {
    let destroyed = 0;
    closeGrpcStream({ destroy: () => { destroyed += 1; } });
    expect(destroyed).toBe(1);
  });

  it("(b) is a no-op for undefined or a stream without destroy()", () => {
    expect(() => closeGrpcStream(undefined)).not.toThrow();
    expect(() => closeGrpcStream({})).not.toThrow();
  });

  it("(c) swallows a throwing destroy() (stream already closing)", () => {
    expect(() => closeGrpcStream({ destroy: () => { throw new Error("already closed"); } })).not.toThrow();
  });
});
