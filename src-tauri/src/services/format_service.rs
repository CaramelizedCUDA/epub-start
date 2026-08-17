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
    use super::*;
    use crate::db::models::{Book, BookFormat, BookStatus, SourceKind};
    use std::io::Write;

    #[test]
    fn entry_path_rejects_traversal_and_backslashes() {
        assert!(normalize_entry_path("../secret").is_err());
        assert!(normalize_entry_path("item\\secret").is_err());
        assert_eq!(
            normalize_entry_path("item/./image.png").unwrap(),
            "item/image.png"
        );
    }

    fn book() -> Book {
        Book {
            id: "book".into(),
            title: "Title".into(),
            authors: Vec::new(),
            format: BookFormat::Epub,
            cover_cache_path: None,
            source_locator: "/test.epub".into(),
            source_kind: SourceKind::DesktopPath,
            file_size_bytes: 0,
            last_modified_ts: 0,
            package_identifier: None,
            status: BookStatus::Available,
            status_detail: None,
            added_at: 0,
            updated_at: 0,
        }
    }

    fn epub_bytes() -> Vec<u8> {
        let cursor = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        let options =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        writer
            .start_file("META-INF/container.xml", options)
            .unwrap();
        writer
            .write_all(
                br#"<?xml version="1.0"?><container><rootfiles><rootfile full-path="item/book.opf"/></rootfiles></container>"#,
            )
            .unwrap();
        writer.start_file("item/book.opf", options).unwrap();
        writer
            .write_all(
                br#"<?xml version="1.0"?><package><metadata><title>T</title></metadata><manifest><item href="chapter.xhtml" media-type="application/xhtml+xml"/><item href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item href="toc.ncx" media-type="application/x-dtbncx+xml"/><item href="img.png" media-type="image/png"/></manifest></package>"#,
            )
            .unwrap();
        writer.start_file("item/chapter.xhtml", options).unwrap();
        writer.write_all(b"<html>hello</html>").unwrap();
        writer.start_file("item/nav.xhtml", options).unwrap();
        writer.write_all(b"<html><nav/></html>").unwrap();
        writer.start_file("item/toc.ncx", options).unwrap();
        writer.write_all(b"<ncx/>").unwrap();
        writer.start_file("item/img.png", options).unwrap();
        writer.write_all(b"\x89PNGfake").unwrap();
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn read_book_resource_serves_xhtml_with_mime() {
        let resource = read_book_resource(
            &book(),
            Box::new(std::io::Cursor::new(epub_bytes())),
            "item/chapter.xhtml",
        )
        .unwrap();
        assert_eq!(resource.mime, "application/xhtml+xml");
        assert_eq!(resource.body, b"<html>hello</html>");
    }

    #[test]
    fn read_book_resource_serves_image_mime() {
        let resource = read_book_resource(
            &book(),
            Box::new(std::io::Cursor::new(epub_bytes())),
            "item/img.png",
        )
        .unwrap();
        assert_eq!(resource.mime, "image/png");
        assert_eq!(resource.body, b"\x89PNGfake");
    }

    #[test]
    fn read_book_resource_serves_epub_control_and_navigation_documents() {
        let cases: [(&str, &str, &[u8]); 4] = [
            ("META-INF/container.xml", "application/xml", b"<?xml version=\"1.0\"?><container><rootfiles><rootfile full-path=\"item/book.opf\"/></rootfiles></container>"),
            ("item/book.opf", "application/oebps-package+xml", b"<?xml version=\"1.0\"?><package><metadata><title>T</title></metadata><manifest><item href=\"chapter.xhtml\" media-type=\"application/xhtml+xml\"/><item href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/><item href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/><item href=\"img.png\" media-type=\"image/png\"/></manifest></package>"),
            ("item/nav.xhtml", "application/xhtml+xml", b"<html><nav/></html>"),
            ("item/toc.ncx", "application/x-dtbncx+xml", b"<ncx/>"),
        ];

        for (entry_path, expected_mime, expected_body) in cases {
            let resource = read_book_resource(
                &book(),
                Box::new(std::io::Cursor::new(epub_bytes())),
                entry_path,
            )
            .unwrap();
            assert_eq!(resource.mime, expected_mime, "entry {entry_path}");
            assert_eq!(resource.body, expected_body, "entry {entry_path}");
        }
    }

    #[test]
    fn read_book_resource_unknown_entry_returns_stable_not_found() {
        let error = read_book_resource(
            &book(),
            Box::new(std::io::Cursor::new(epub_bytes())),
            "missing.xhtml",
        )
        .unwrap_err();
        assert!(error.starts_with("BOOK_RESOURCE_NOT_FOUND:"), "got {error}");
    }
}
