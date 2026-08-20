pub const MIB: u64 = 1024 * 1024;

#[cfg(any(target_os = "android", test))]
pub const SOURCE_CACHE_SOFT_LIMIT_BYTES: u64 = 256 * MIB;
#[cfg(any(target_os = "android", test))]
pub const SOURCE_CACHE_HARD_LIMIT_BYTES: u64 = 512 * MIB;
pub const COVER_CACHE_SOFT_LIMIT_BYTES: u64 = 64 * MIB;
pub const COVER_CACHE_HARD_LIMIT_BYTES: u64 = 128 * MIB;
pub const SEARCH_INDEX_HARD_LIMIT_BYTES: u64 = 256 * MIB;
#[cfg(any(target_os = "android", test))]
pub const REBUILDABLE_DATA_HARD_LIMIT_BYTES: u64 = 1024 * MIB;

#[cfg(any(target_os = "android", test))]
const _: () = assert!(
    SOURCE_CACHE_HARD_LIMIT_BYTES + COVER_CACHE_HARD_LIMIT_BYTES + SEARCH_INDEX_HARD_LIMIT_BYTES
        <= REBUILDABLE_DATA_HARD_LIMIT_BYTES
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rebuildable_data_budgets_are_frozen_below_one_gibibyte() {
        assert_eq!(SOURCE_CACHE_SOFT_LIMIT_BYTES, 256 * MIB);
        assert_eq!(SOURCE_CACHE_HARD_LIMIT_BYTES, 512 * MIB);
        assert_eq!(COVER_CACHE_SOFT_LIMIT_BYTES, 64 * MIB);
        assert_eq!(COVER_CACHE_HARD_LIMIT_BYTES, 128 * MIB);
        assert_eq!(SEARCH_INDEX_HARD_LIMIT_BYTES, 256 * MIB);
        assert!(
            SOURCE_CACHE_HARD_LIMIT_BYTES
                + COVER_CACHE_HARD_LIMIT_BYTES
                + SEARCH_INDEX_HARD_LIMIT_BYTES
                <= REBUILDABLE_DATA_HARD_LIMIT_BYTES
        );
    }
}
