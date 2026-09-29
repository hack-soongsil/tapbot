// Runtime traces are adapted by macro-runtime. Re-exporting keeps editor
// presentation components independent from SSE and runtime-store details.
export {
  traceErrorCode,
  traceErrorEdgeId,
  traceErrorMessage,
  traceErrorOrigin,
  traceErrorPayload,
  traceErrorSummary,
  traceGraphPath,
} from '../macro-runtime/runtime-overlay'
export type { RuntimeTrace } from '../macro-runtime/types'
