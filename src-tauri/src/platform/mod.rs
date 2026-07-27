#[cfg(target_os = "android")]
mod android;
#[cfg(not(target_os = "android"))]
mod desktop;

#[cfg(target_os = "android")]
pub use android::*;
#[cfg(not(target_os = "android"))]
pub use desktop::*;

#[derive(Debug, Clone)]
pub struct FileMetadata {
    pub file_size_bytes: i64,
    pub last_modified_ts: i64,
}
