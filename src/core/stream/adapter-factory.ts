import type { Profile } from "../../schemas/config-schema.js";
import type { LifecycleStream } from "./lifecycle-stream.js";
import type { StreamAdapter } from "./stream-adapter.js";
import { RpcWebSocketAdapter } from "./ws-adapter.js";
import { GrpcAdapter } from "./grpc-adapter.js";

export function createAdapter(profile: Profile, stream: LifecycleStream): StreamAdapter {
  if (profile.adapter === "ws") {
    return new RpcWebSocketAdapter(profile.rpcEndpoint, profile.wsEndpoint, stream);
  }
  return new GrpcAdapter(
    profile.grpcEndpoint,
    profile.grpcXToken,
    profile.rpcEndpoint,
    stream,
  );
}
