import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import {
  Ingest,
  type MetricPoint as ProtoMetricPoint,
  type MetricBatch as ProtoMetricBatch,
} from "../gen/metrics/v1/ingest_pb.ts";
import { metricsFlusher } from "../lib/flusher.ts";
import { config } from "../config.ts";
import { logger } from "../logger.ts";
import type { MetricPoint } from "../types.ts";

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
      let dropped = 0;
      for await (const batch of requestStream) {
        const { points, dropped: batchDropped } = cappedPoints(
          batch.points,
          batch.runId,
        );
        dropped += batchDropped;
        metricsFlusher.ingest(points);
        accepted += points.length;
      }
      return { accepted, dropped };
    },

    pushMetrics: async (req: ProtoMetricBatch, _ctx: HandlerContext) => {
      const { points, dropped } = cappedPoints(req.points, req.runId);
      metricsFlusher.ingest(points);
      return { accepted: points.length, dropped };
    },
  });
};

/** Bound a batch to the configured maximum; excess points are dropped
 *  (counted, and logged when any round exceeds it) rather than buffering
 *  unbounded producer data into the process. */
function cappedPoints(
  protoPoints: ProtoMetricPoint[],
  runId: string,
): { points: MetricPoint[]; dropped: number } {
  const capped = protoPoints.slice(0, config.ingest.maxBatchPoints);
  const dropped = protoPoints.length - capped.length;
  if (dropped > 0) {
    logger.warn(
      { runId, dropped, cap: config.ingest.maxBatchPoints },
      "[grpc] batch exceeds cap, dropping excess points",
    );
  }
  return { points: capped.map((p) => mapProtoPoint(p, runId)), dropped };
}
