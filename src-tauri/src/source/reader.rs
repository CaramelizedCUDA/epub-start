use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use tauri::{AppHandle, Runtime};

use super::fingerprint::{SourceFingerprint, HEAD_SAMPLE_SIZE};
use crate::platform::{self, FileMetadata};

pub const MAX_SOURCE_SIZE: u64 = 512 * 1024 * 1024;

pub trait ReadSeek: Read + Seek + Send {}
impl<T: Read + Seek + Send> ReadSeek for T {}

pub fn open_checked_source<R: Runtime>(
    app: &AppHandle<R>,
    source_locator: &str,
) -> Result<(File, SourceFingerprint), String> {
    let metadata = platform::validate_epub_source(app, source_locator)?;
    reject_oversized_source(&metadata)?;

    let mut file = platform::open_source_file(app, source_locator)?;
    let fingerprint = fingerprint_from_file(source_locator, metadata, &mut file)?;
    file.seek(SeekFrom::Start(0))
        .map_err(|_| "BOOK_SOURCE_UNAVAILABLE: source cannot be rewound".to_string())?;
    Ok((file, fingerprint))
}

fn reject_oversized_source(metadata: &FileMetadata) -> Result<(), String> {
    if metadata.file_size_bytes > 0 && metadata.file_size_bytes as u64 > MAX_SOURCE_SIZE {
        return Err(format!(
            "BOOK_RESOURCE_LIMIT_EXCEEDED: compressed source exceeds {} bytes",
            MAX_SOURCE_SIZE
        ));
    }
    Ok(())
}

fn fingerprint_from_file(
    source_locator: &str,
    metadata: FileMetadata,
    file: &mut File,
) -> Result<SourceFingerprint, String> {
    let mut head_sample = vec![0u8; HEAD_SAMPLE_SIZE];
    let count = file
        .read(&mut head_sample)
        .map_err(|_| "BOOK_SOURCE_UNAVAILABLE: source sample cannot be read".to_string())?;
    head_sample.truncate(count);

    Ok(SourceFingerprint {
        source_locator: source_locator.to_string(),
        file_size_bytes: metadata.file_size_bytes,
        last_modified_ts: metadata.last_modified_ts,
        head_sample,
    })
}
