//! Case clock (D16, M1-T1, CLAUDE.md rule 3). Cross-camera Re-ID is
//! meaningless without a shared time base, and a recorded clip has no
//! inherent wall-clock time, so every downstream timestamp derives from a
//! source's declared start plus its frame offset. Nothing here reads system
//! time; that is the whole point of this type existing.

use time::{Duration, OffsetDateTime};

/// One registered source's mapping from frame sequence number to case-clock
/// time: `declared_start_ts + (frame_seq / fps)`.
#[derive(Debug, Clone, PartialEq)]
pub struct CaseClock {
    pub source_id: String,
    pub declared_start_ts: OffsetDateTime,
    pub fps: f64,
}

impl CaseClock {
    pub fn new(source_id: impl Into<String>, declared_start_ts: OffsetDateTime, fps: f64) -> Self {
        Self { source_id: source_id.into(), declared_start_ts, fps }
    }

    /// Converts a frame sequence number to its case-clock timestamp. Never
    /// calls `now()` or any other system-time function: the case clock is
    /// pure arithmetic over the declared start and the frame number.
    pub fn case_ts(&self, frame_seq: u64) -> OffsetDateTime {
        let offset_seconds = frame_seq as f64 / self.fps;
        self.declared_start_ts + Duration::seconds_f64(offset_seconds)
    }
}
