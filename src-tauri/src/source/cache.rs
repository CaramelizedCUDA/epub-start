use std::collections::HashMap;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};

#[cfg(target_os = "android")]
use std::io::{Read, Seek, SeekFrom, Write};

use tauri::{AppHandle, Runtime};

use super::fingerprint::SourceFingerprint;
#[cfg(target_os = "android")]
use super::reader::MAX_SOURCE_SIZE;
use super::reader::{open_checked_source, ReadSeek};

#[cfg(target_os = "android")]
const MAX_CACHE_SIZE: u64 = 1024 * 1024 * 1024;

pub struct SourceLease {
    path: PathBuf,
    _guard: Arc<()>,
}

impl SourceLease {
    pub fn open_reader(&self) -> Result<Box<dyn ReadSeek>, String> {
        File::open(&self.path)
            .map(|file| Box::new(file) as Box<dyn ReadSeek>)
            .map_err(|_| "BOOK_SOURCE_UNAVAILABLE: leased source cannot be opened".to_string())
    }
}

pub struct SourceManager {
    cache_dir: PathBuf,
    active: Mutex<HashMap<String, Weak<()>>>,
}

impl SourceManager {
    pub fn new(cache_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&cache_dir)
            .map_err(|_| "internal error: source cache directory cannot be created".to_string())?;
        cleanup_temporary_files(&cache_dir);
        Ok(Self {
            cache_dir,
            active: Mutex::new(HashMap::new()),
        })
    }

    pub fn acquire<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        book_id: &str,
        source_locator: &str,
    ) -> Result<(SourceLease, SourceFingerprint), String> {
        #[cfg(not(target_os = "android"))]
        {
            let (_file, fingerprint) = open_checked_source(app, source_locator)?;
            let guard = self.guard_for(book_id)?;
            return Ok((
                SourceLease {
                    path: PathBuf::from(source_locator),
                    _guard: guard,
                },
                fingerprint,
            ));
        }

        #[cfg(target_os = "android")]
        {
            self.acquire_android(app, book_id, source_locator)
        }
    }

    fn guard_for(&self, book_id: &str) -> Result<Arc<()>, String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "internal error: source lease lock poisoned".to_string())?;
        if let Some(existing) = active.get(book_id).and_then(Weak::upgrade) {
            return Ok(existing);
        }
        let guard = Arc::new(());
        active.insert(book_id.to_string(), Arc::downgrade(&guard));
        Ok(guard)
    }

    #[cfg(target_os = "android")]
    fn acquire_android<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        book_id: &str,
        source_locator: &str,
    ) -> Result<(SourceLease, SourceFingerprint), String> {
        let (mut source, before) = open_checked_source(app, source_locator)?;
        let cache_path = self.cache_dir.join(format!("{book_id}.source"));
        let fingerprint_path = self.cache_dir.join(format!("{book_id}.fingerprint.json"));

        if before.can_persist_across_restarts()
            && cache_path.is_file()
            && read_fingerprint(&fingerprint_path)
                .map(|stored| stored.cache_matches(&before))
                .unwrap_or(false)
        {
            let guard = self.guard_for(book_id)?;
            return Ok((
                SourceLease {
                    path: cache_path,
                    _guard: guard,
                },
                before,
            ));
        }

        remove_if_exists(&cache_path);
        remove_if_exists(&fingerprint_path);
        self.copy_source_atomically(book_id, &mut source, &cache_path)?;

        let (_after_file, after) = open_checked_source(app, source_locator)?;
        if !before.cache_matches(&after) {
            remove_if_exists(&cache_path);
            return Err("BOOK_SOURCE_UNAVAILABLE: source changed while being cached".into());
        }
        if after.can_persist_across_restarts() {
            write_fingerprint(&fingerprint_path, &after)?;
        }
        self.evict_if_needed(book_id)?;
        let guard = self.guard_for(book_id)?;
        Ok((
            SourceLease {
                path: cache_path,
                _guard: guard,
            },
            after,
        ))
    }

    #[cfg(target_os = "android")]
    fn copy_source_atomically(
        &self,
        book_id: &str,
        source: &mut File,
        cache_path: &Path,
    ) -> Result<(), String> {
        let temp_path = self.cache_dir.join(format!("{book_id}.source.tmp"));
        let mut target = File::create(&temp_path)
            .map_err(|_| "BOOK_SOURCE_UNAVAILABLE: source cache cannot be created".to_string())?;
        source
            .seek(SeekFrom::Start(0))
            .map_err(|_| "BOOK_SOURCE_UNAVAILABLE: Android source cannot be rewound".to_string())?;
        let mut limited = source.take(MAX_SOURCE_SIZE + 1);
        let copied = std::io::copy(&mut limited, &mut target)
            .map_err(|_| "BOOK_SOURCE_UNAVAILABLE: source cache copy failed".to_string())?;
        target
            .flush()
            .map_err(|_| "BOOK_SOURCE_UNAVAILABLE: source cache flush failed".to_string())?;
        if copied > MAX_SOURCE_SIZE {
            remove_if_exists(&temp_path);
            return Err("BOOK_RESOURCE_LIMIT_EXCEEDED: compressed source is too large".into());
        }
        fs::rename(&temp_path, cache_path)
            .map_err(|_| "BOOK_SOURCE_UNAVAILABLE: source cache commit failed".to_string())
    }

    #[cfg(target_os = "android")]
    fn evict_if_needed(&self, current_book_id: &str) -> Result<(), String> {
        let mut entries = fs::read_dir(&self.cache_dir)
            .map_err(|_| "internal error: source cache cannot be enumerated".to_string())?
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                if path.extension().and_then(|value| value.to_str()) != Some("source") {
                    return None;
                }
                let metadata = entry.metadata().ok()?;
                let modified = metadata.modified().ok();
                Some((path, metadata.len(), modified))
            })
            .collect::<Vec<_>>();
        let mut total = entries.iter().map(|(_, size, _)| *size).sum::<u64>();
        entries.sort_by_key(|(_, _, modified)| *modified);

        for (path, size, _) in entries {
            if total <= MAX_CACHE_SIZE {
                break;
            }
            let id = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if id == current_book_id || self.is_active(id)? {
                continue;
            }
            remove_if_exists(&path);
            remove_if_exists(&self.cache_dir.join(format!("{id}.fingerprint.json")));
            total = total.saturating_sub(size);
        }
        Ok(())
    }

    #[cfg(target_os = "android")]
    fn is_active(&self, book_id: &str) -> Result<bool, String> {
        self.active
            .lock()
            .map(|active| active.get(book_id).and_then(Weak::upgrade).is_some())
            .map_err(|_| "internal error: source lease lock poisoned".to_string())
    }

    pub fn invalidate(&self, book_id: &str) {
        remove_if_exists(&self.cache_dir.join(format!("{book_id}.source")));
        remove_if_exists(&self.cache_dir.join(format!("{book_id}.fingerprint.json")));
    }
}

fn cleanup_temporary_files(cache_dir: &Path) {
    if let Ok(entries) = fs::read_dir(cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) == Some("tmp") {
                remove_if_exists(&path);
            }
        }
    }
}

fn remove_if_exists(path: &Path) {
    let _ = fs::remove_file(path);
}

#[cfg(target_os = "android")]
fn read_fingerprint(path: &Path) -> Option<SourceFingerprint> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(target_os = "android")]
fn write_fingerprint(path: &Path, fingerprint: &SourceFingerprint) -> Result<(), String> {
    let bytes = serde_json::to_vec(fingerprint)
        .map_err(|_| "internal error: source fingerprint cannot be encoded".to_string())?;
    fs::write(path, bytes)
        .map_err(|_| "internal error: source fingerprint cannot be persisted".to_string())
}
