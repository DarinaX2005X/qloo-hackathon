/** The v2 agent, visit and constraint shapes the F3 UI reads, from the backend's contracts (plan §8). */
export type {
  AblationV2,
  AddressResultV2,
  AgentCardV2,
  AgentEventV2,
  AgentRequestV2,
  AreaDecision,
  AuditV2,
  CityComparisonV2,
  Claim,
  Constraint,
  GoalState,
  HomeMatchV2,
  PlaceConnection,
  ResultMeta,
  SessionMemory,
  VenueEvidence,
  VenueRole,
  VisitResultV2,
} from "@/shared/contracts-09";
import type { GoalState, VisitResultV2 } from "@/shared/contracts-09";

export type GoalKind = GoalState["kind"];
export type GoalStatus = GoalState["status"];
export type RecoveryAction = VisitResultV2["recoveryLog"][number]["action"];
