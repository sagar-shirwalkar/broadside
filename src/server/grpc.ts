import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import {
  Ingest,
  type MetricPoint as ProtoMetricPoint,
  type MetricBatch as ProtoMetricBatch,
} from "../gen/metrics/v1/ingest_pb.js";
import { metricsFlusher } from "../lib/flusher.js";
import type { MetricPoint } from "../types.js";

// This is a compile-time check: if the import above fails, tsc errors.
// No runtime cost. No dynamic import. Just makes the dependency explicit.

function mapProtoPoint(proto: ProtoMetricPoint, runId: string): MetricPoint {
  return {
    time: new Date(Number(proto.timeMs)),
    runId,
    endpoint: proto.endpoint,
    rps: proto.rps,
    p50: proto.p50,
    p95: proto.p95,
    p99: proto.p99,
    errorRate: proto.errorRate,
  };
}

export const routes = (router: ConnectRouter) => {
  router.service(Ingest, {
    streamMetrics: async (requestStream, _ctx: HandlerContext) => {
      let accepted = 0;
      for await (const batch of requestStream) {
        const points = batch.points.map((p) => mapProtoPoint(p, batch.runId));
        metricsFlusher.ingest(points);
        accepted += points.length;
      }
      return { accepted, dropped: 0 };
    },

    pushMetrics: async (req: ProtoMetricBatch, _ctx: HandlerContext) => {
      const points = req.points.map((p) => mapProtoPoint(p, req.runId));
      metricsFlusher.ingest(points);
      return { accepted: points.length, dropped: 0 };
    },
  });
};
