//! TypeScript export registry (D30).
//!
//! Every struct and enum that crosses the client↔server HTTP boundary,
//! in one explicit list. `cargo xtask generate-types` calls
//! [`export_all`]; the generated files are the sole source of the
//! client-side API types (`client/src/types/generated/`, gitignored).
//!
//! Why a registry instead of `#[ts(export)]`: the export attribute makes
//! ts-rs emit a file-writing test per type, so every `cargo test` run
//! would rewrite dozens of files into `./bindings` (parallel writers on
//! the same paths — flaky on Windows file locking). An explicit list
//! exports only on demand, exactly once per type, with no test-time
//! side effects. Private error-envelope copies stay private: they are
//! listed here, inside the owning crate, so no visibility is widened
//! for the sake of tooling.

use std::path::Path;

use ts_rs::TS;

/// Export every registered API type (plus its dependencies) into
/// `out_dir`, one `<TypeName>.ts` file per type.
pub fn export_all(out_dir: &Path) -> Result<(), ts_rs::ExportError> {
    macro_rules! export {
        ($($t:ty),* $(,)?) => {
            $(<$t>::export_all_to(out_dir)?;)*
        };
    }
    export!(
        // Foundation: auth, audit, ledger, health.
        crate::auth::AppRole,
        crate::auth::UserRecord,
        crate::audit::AuditRow,
        crate::ledger::Endorsement,
        crate::startup::DependencyStatus,
        crate::startup::HealthReport,
        // Cameras and topology (D15, D32).
        crate::api::cameras::Camera,
        crate::api::cameras::RegisterCameraRequest,
        crate::api::cameras::CreateEdgeRequest,
        crate::reid::topology::CameraEdge,
        // Engine nodes (§2.8).
        crate::api::nodes::Node,
        crate::api::nodes::RegisterNodeRequest,
        // Re-ID (§2.6, §4).
        crate::api::reid::Target,
        crate::api::reid::Candidate,
        crate::api::reid::CreateTargetRequest,
        crate::api::reid::CreateTargetResponse,
        crate::api::reid::DecideRequest,
        crate::api::reid::DecideDecision,
        crate::api::reid::DecideResponse,
        crate::reid::search::TimeWindow,
        crate::reid::search::CandidateMatch,
        crate::reid::pipeline::ProposedCandidate,
        crate::reid::pipeline::DecisionStatus,
        crate::reid::pipeline::LostEvent,
        // Entities and merges (§2.5). NOTE: entities::DecideDecision is
        // shape-identical to reid::DecideDecision; both write the same
        // DecideDecision.ts. If either shape changes, rename one.
        crate::api::entities::Entity,
        crate::api::entities::SyncState,
        crate::api::entities::MergeStatus,
        crate::api::entities::MergeProposal,
        crate::api::entities::EntityNote,
        crate::api::entities::ProposeMergeRequest,
        crate::api::entities::ProposeMergeResponse,
        crate::api::entities::DecideMergeRequest,
        crate::api::entities::DecideDecision,
        crate::api::entities::DecideMergeResponse,
        crate::api::entities::EntityListItem,
        crate::api::entities::ListEntitiesResponse,
        crate::api::entities::EntityDetailResponse,
        crate::api::entities::CreateNoteRequest,
        // Review queue (§2.3).
        crate::api::review::ReviewStatus,
        crate::api::review::ReviewItem,
        crate::api::review::DecideReviewRequest,
        crate::api::review::TerminalStatus,
        crate::api::review::DecideReviewResponse,
        crate::api::review::PreviewSurface,
        crate::api::review::PreviewExtractionRequest,
        crate::api::review::PreviewSpan,
        // Files (§2.2).
        crate::api::files::FileRecord,
        crate::api::files::IngestJob,
        crate::api::files::FileDetailResponse,
        crate::api::files::VerifyStatus,
        crate::api::files::VerifyFileResponse,
        // Search (§2.12).
        crate::api::search::CaseRecord,
        crate::api::search::EntityHit,
        crate::api::search::CaseHit,
        crate::api::search::FileHit,
        crate::api::search::IdentifierHit,
        crate::api::search::SearchResponse,
        // Timeline (§2.10).
        crate::api::timeline::Clock,
        crate::api::timeline::TimelineEvent,
        crate::api::timeline::TimelineResponse,
        // Map (§2.7).
        crate::api::map::MovementPoint,
        crate::api::map::MovementTimelineResponse,
        crate::api::map::RoutineCluster,
        crate::api::map::RoutineResponse,
        // Auditor view (§2.11/FR-7.5).
        crate::api::audit::VerifyRowResponse,
        // Admin (§2.11).
        crate::api::admin::CreateUserRequest,
        crate::api::admin::DeactivateUserRequest,
        // Graph (§2.4).
        crate::graph::EntityType,
        crate::graph::GraphNode,
        crate::graph::GraphEdge,
        crate::graph::GraphPayload,
        crate::graph::TamperState,
        crate::graph::EvidenceItem,
        // Error envelope (§1.1): one copy per module, all shape-identical,
        // all writing the same ErrorEnvelope.ts / ErrorBody.ts.
        crate::api::admin::ErrorEnvelope,
        crate::api::admin::ErrorBody,
        crate::api::cameras::ErrorEnvelope,
        crate::api::cameras::ErrorBody,
        crate::api::entities::ErrorEnvelope,
        crate::api::entities::ErrorBody,
        crate::api::files::ErrorEnvelope,
        crate::api::files::ErrorBody,
        crate::api::map::ErrorEnvelope,
        crate::api::map::ErrorBody,
        crate::api::reid::ErrorEnvelope,
        crate::api::reid::ErrorBody,
        crate::api::review::ErrorEnvelope,
        crate::api::review::ErrorBody,
        crate::api::search::ErrorEnvelope,
        crate::api::search::ErrorBody,
        crate::api::timeline::ErrorEnvelope,
        crate::api::timeline::ErrorBody,
        crate::auth::ErrorEnvelope,
        crate::auth::ErrorBody,
        crate::graph::ErrorEnvelope,
        crate::graph::ErrorBody,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use ts_rs::TS;

    /// The registry writes several same-named files from multiple source
    /// modules (nine ErrorEnvelope/ErrorBody copies, two DecideDecisions).
    /// That is only sound while the copies stay shape-identical: the last
    /// export wins, so a silent fork would ship one module's shape under
    /// every module's name. This test fails the build on any fork.
    #[test]
    fn duplicate_export_sources_stay_shape_identical() {
        let envelope = crate::api::admin::ErrorEnvelope::decl();
        for decl in [
            crate::api::cameras::ErrorEnvelope::decl(),
            crate::api::entities::ErrorEnvelope::decl(),
            crate::api::files::ErrorEnvelope::decl(),
            crate::api::map::ErrorEnvelope::decl(),
            crate::api::reid::ErrorEnvelope::decl(),
            crate::api::review::ErrorEnvelope::decl(),
            crate::api::search::ErrorEnvelope::decl(),
            crate::api::timeline::ErrorEnvelope::decl(),
            crate::auth::ErrorEnvelope::decl(),
            crate::graph::ErrorEnvelope::decl(),
        ] {
            assert_eq!(decl, envelope, "ErrorEnvelope forked in one module");
        }
        let body = crate::api::admin::ErrorBody::decl();
        for decl in [
            crate::api::cameras::ErrorBody::decl(),
            crate::api::entities::ErrorBody::decl(),
            crate::api::files::ErrorBody::decl(),
            crate::api::map::ErrorBody::decl(),
            crate::api::reid::ErrorBody::decl(),
            crate::api::review::ErrorBody::decl(),
            crate::api::search::ErrorBody::decl(),
            crate::api::timeline::ErrorBody::decl(),
            crate::auth::ErrorBody::decl(),
            crate::graph::ErrorBody::decl(),
        ] {
            assert_eq!(decl, body, "ErrorBody forked in one module");
        }
        assert_eq!(
            crate::api::reid::DecideDecision::decl(),
            crate::api::entities::DecideDecision::decl(),
            "DecideDecision forked between reid and entities",
        );
    }
}
