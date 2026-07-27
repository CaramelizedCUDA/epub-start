use std::path::{Component, Path};

use crate::db::models::{Book, BookFormat};
use crate::formats::{self, FormatMetadata, ResourceContent};
use crate::source::ReadSeek;

pub fn parse_book_metadata(
    format: &BookFormat,
    reader: Box<dyn ReadSeek>,
    cover_cache: Option<(&Path, &str)>,
) -> Result<FormatMetadata, String> {
    formats::active_format(format)?.parse_metadata(reader, cover_cache)
}

pub fn read_book_resource(
    book: &Book,
    reader: Box<dyn ReadSeek>,
    entry_path: &str,
) -> Result<ResourceContent, String> {
    formats::active_format(&book.format)?.read_resource(reader, entry_path)
}

pub fn normalize_entry_path(path: &str) -> Result<String, String> {
    if path.is_empty() || path.contains('\\') || path.starts_with('/') {
        return Err("VALIDATION_ERROR: invalid EPUB entry path".into());
    }

    let mut segments = Vec::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(value) => {
                let value = value
                    .to_str()
                    .ok_or_else(|| "VALIDATION_ERROR: invalid EPUB entry encoding".to_string())?;
                if value.is_empty() {
                    return Err("VALIDATION_ERROR: invalid EPUB entry path".into());
                }
                segments.push(value);
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("VALIDATION_ERROR: EPUB entry traversal rejected".into());
            }
        }
    }

    if segments.is_empty() {
        Err("VALIDATION_ERROR: invalid EPUB entry path".into())
    } else {
        Ok(segments.join("/"))
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_entry_path;

    #[test]
    fn entry_path_rejects_traversal_and_backslashes() {
        assert!(normalize_entry_path("../secret").is_err());
        assert!(normalize_entry_path("item\\secret").is_err());
        assert_eq!(
            normalize_entry_path("item/./image.png").unwrap(),
            "item/image.png"
        );
    }
}
