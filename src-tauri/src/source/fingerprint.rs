use serde::{Deserialize, Serialize};

pub const HEAD_SAMPLE_SIZE: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceFingerprint {
    pub source_locator: String,
    pub file_size_bytes: i64,
    pub last_modified_ts: i64,
    pub head_sample: Vec<u8>,
}

impl SourceFingerprint {
    pub fn cache_matches(&self, current: &Self) -> bool {
        if self.source_locator != current.source_locator || self.head_sample != current.head_sample
        {
            return false;
        }

        let size_matches = self.file_size_bytes == 0
            || current.file_size_bytes == 0
            || self.file_size_bytes == current.file_size_bytes;
        let modified_matches = self.last_modified_ts == 0
            || current.last_modified_ts == 0
            || self.last_modified_ts == current.last_modified_ts;

        size_matches && modified_matches
    }

    pub fn can_persist_across_restarts(&self) -> bool {
        self.file_size_bytes > 0 || self.last_modified_ts > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fingerprint(size: i64, modified: i64, sample: &[u8]) -> SourceFingerprint {
        SourceFingerprint {
            source_locator: "content://book".into(),
            file_size_bytes: size,
            last_modified_ts: modified,
            head_sample: sample.to_vec(),
        }
    }

    #[test]
    fn cache_match_rejects_changed_sample() {
        assert!(!fingerprint(10, 20, b"a").cache_matches(&fingerprint(10, 20, b"b")));
    }

    #[test]
    fn unknown_metadata_uses_sample_but_is_not_persistent() {
        let value = fingerprint(0, 0, b"same");
        assert!(value.cache_matches(&value));
        assert!(!value.can_persist_across_restarts());
    }
}
