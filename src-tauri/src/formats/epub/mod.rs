// EPUB parsing: container.xml → OPF → metadata + cover extraction.
// Uses zip for ZIP traversal and quick-xml for XML parsing.

use quick_xml::events::Event;
use quick_xml::Reader;
use std::io::{Read, Seek};
use std::path::Path;
use zip::ZipArchive;

use super::capabilities::{FormatMetadata, MetadataProvider, ResourceContent, ResourceProvider};
use crate::source::ReadSeek;

pub struct EpubFormatHandler;

impl MetadataProvider for EpubFormatHandler {
    fn parse_metadata(
        &self,
        reader: Box<dyn ReadSeek>,
        cover_cache: Option<(&Path, &str)>,
    ) -> Result<FormatMetadata, String> {
        parse_epub_reader(reader, cover_cache)
            .map(|metadata| FormatMetadata {
                title: metadata.title,
                authors: metadata.authors,
                package_identifier: metadata.package_identifier,
                cover_cache_path: metadata.cover_entry_path,
            })
            .map_err(|error| format!("BOOK_PARSE_FAILED: {error}"))
    }
}

impl ResourceProvider for EpubFormatHandler {
    fn read_resource(
        &self,
        reader: Box<dyn ReadSeek>,
        entry_path: &str,
    ) -> Result<ResourceContent, String> {
        let mut archive = ZipArchive::new(reader)
            .map_err(|_| "BOOK_PARSE_FAILED: cannot open EPUB archive".to_string())?;
        validate_archive_budget(&mut archive)
            .map_err(|error| format!("BOOK_RESOURCE_LIMIT_EXCEEDED: {error}"))?;
        let body = read_zip_entry_by_name(&mut archive, entry_path, MAX_ZIP_ENTRY_SIZE).map_err(
            |error| {
                if error.contains("not found") {
                    format!("BOOK_RESOURCE_NOT_FOUND: {error}")
                } else {
                    format!("BOOK_RESOURCE_LIMIT_EXCEEDED: {error}")
                }
            },
        )?;
        Ok(ResourceContent {
            body,
            mime: mime_for_path(entry_path).to_string(),
        })
    }
}

// ── Resource budgets (ZIP bomb defence) ─────────────────────────

/// Maximum decompressed size for a single ZIP entry (50 MiB).
pub const MAX_ZIP_ENTRY_SIZE: u64 = 50 * 1024 * 1024;
/// Maximum decompressed size for tiny control files like container.xml / OPF (2 MiB).
pub const MAX_CONTROL_FILE_SIZE: u64 = 2 * 1024 * 1024;
/// Maximum number of entries in a single EPUB archive.
pub const MAX_ZIP_ENTRIES: usize = 5000;
/// Maximum sum of declared decompressed entry sizes (2 GiB).
pub const MAX_DECOMPRESSED_SIZE: u64 = 2 * 1024 * 1024 * 1024;
/// Maximum allowed decompressed-to-compressed ratio for a non-empty entry.
pub const MAX_COMPRESSION_RATIO: u64 = 200;

/// Structured metadata extracted from an EPUB.
#[derive(Debug, Clone, Default)]
pub struct EpubMetadata {
    pub title: String,
    pub authors: Vec<String>,
    pub package_identifier: Option<String>,
    pub cover_entry_path: Option<String>,
}

/// Error type for EPUB parse failures.
#[derive(Debug)]
pub enum EpubError {
    Zip(String),
    MissingContainer,
    ContainerParse(String),
    OpfNotFound(String),
    OpfParse(String),
    CoverExtract(String),
}

impl std::fmt::Display for EpubError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EpubError::Zip(e) => write!(f, "ZIP error: {}", e),
            EpubError::MissingContainer => write!(f, "META-INF/container.xml not found"),
            EpubError::ContainerParse(e) => write!(f, "container.xml parse error: {}", e),
            EpubError::OpfNotFound(e) => write!(f, "OPF not found: {}", e),
            EpubError::OpfParse(e) => write!(f, "OPF parse error: {}", e),
            EpubError::CoverExtract(e) => write!(f, "cover extraction error: {}", e),
        }
    }
}

/// Parse container.xml from a byte buffer, returning the first rootfile full-path.
fn parse_container(xml_bytes: &[u8]) -> Result<String, EpubError> {
    // Simple byte-level extraction: find full-path="..." attribute.
    // Avoids quick-xml namespace resolution complexity for this trivial XML.
    let text = String::from_utf8_lossy(xml_bytes);

    // Find the rootfile element's full-path attribute.
    let rootfile_start = text
        .find("<rootfile")
        .ok_or_else(|| EpubError::ContainerParse("no <rootfile> element".to_string()))?;

    let after = &text[rootfile_start..];
    let full_path_marker = "full-path=\"";
    let fp_start = after
        .find(full_path_marker)
        .ok_or_else(|| EpubError::ContainerParse("no full-path attribute".to_string()))?;

    let val_start = fp_start + full_path_marker.len();
    let val_end = after[val_start..]
        .find('"')
        .ok_or_else(|| EpubError::ContainerParse("unclosed full-path attribute".to_string()))?;

    Ok(after[val_start..val_start + val_end].to_string())
}

/// Parse OPF to extract title, authors, package identifier, and cover image ref.
fn parse_opf(xml_bytes: &[u8]) -> Result<EpubMetadata, EpubError> {
    let mut reader = Reader::from_reader(xml_bytes);

    let mut meta = EpubMetadata::default();
    let mut buf = Vec::new();

    // State tracking
    let mut in_metadata = false;
    let mut in_manifest = false;
    let mut current_tag: Option<String> = None;
    let mut cover_id_from_meta: Option<String> = None;
    // Map: item id → href
    let mut manifest_items: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    // dc: namespace prefix in OPF is usually "dc"
    let dc_ns = b"dc:";

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = e.name().as_ref().to_vec();
                let local = strip_ns(&name, dc_ns);

                if local == b"metadata" {
                    in_metadata = true;
                } else if local == b"manifest" {
                    in_manifest = true;
                    in_metadata = false;
                } else if in_metadata {
                    match local {
                        b"title" => current_tag = Some("title".into()),
                        b"creator" => current_tag = Some("creator".into()),
                        b"identifier" => current_tag = Some("identifier".into()),
                        b"meta" => {
                            // Check for cover meta tag: <meta name="cover" content="id"/>
                            let mut meta_name: Option<String> = None;
                            let mut meta_content: Option<String> = None;
                            for attr in e.attributes().flatten() {
                                let key = String::from_utf8_lossy(attr.key.as_ref());
                                if key == "name" {
                                    meta_name =
                                        Some(String::from_utf8_lossy(&attr.value).to_string());
                                } else if key == "content" {
                                    meta_content =
                                        Some(String::from_utf8_lossy(&attr.value).to_string());
                                }
                            }
                            if meta_name.as_deref() == Some("cover") {
                                cover_id_from_meta = meta_content;
                            }
                            current_tag = None;
                        }
                        _ => current_tag = None,
                    }
                } else if in_manifest {
                    if local == b"item" {
                        let mut item_id: Option<String> = None;
                        let mut item_href: Option<String> = None;
                        for attr in e.attributes().flatten() {
                            let key = String::from_utf8_lossy(attr.key.as_ref());
                            match key.as_ref() {
                                "id" => {
                                    item_id = Some(String::from_utf8_lossy(&attr.value).to_string())
                                }
                                "href" => {
                                    item_href =
                                        Some(String::from_utf8_lossy(&attr.value).to_string())
                                }
                                _ => {}
                            }
                        }
                        if let (Some(id), Some(href)) = (item_id, item_href) {
                            manifest_items.insert(id, href);
                        }
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let name = e.name().as_ref().to_vec();
                let local = strip_ns(&name, dc_ns);

                if in_metadata
                    && (local == b"metadata" || (local == b"metadata" && name == b"metadata"))
                {
                    in_metadata = false;
                }
                if in_manifest && local == b"manifest" {
                    in_manifest = false;
                }
                current_tag = None;
            }
            // Self-closing tags: <meta ... />, <item ... /> etc.
            Ok(Event::Empty(ref e)) => {
                let name = e.name().as_ref().to_vec();
                let local = strip_ns(&name, dc_ns);

                if in_metadata && local == b"meta" {
                    let mut meta_name: Option<String> = None;
                    let mut meta_content: Option<String> = None;
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref());
                        if key == "name" {
                            meta_name = Some(String::from_utf8_lossy(&attr.value).to_string());
                        } else if key == "content" {
                            meta_content = Some(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                    if meta_name.as_deref() == Some("cover") {
                        cover_id_from_meta = meta_content;
                    }
                } else if in_manifest && local == b"item" {
                    let mut item_id: Option<String> = None;
                    let mut item_href: Option<String> = None;
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref());
                        match key.as_ref() {
                            "id" => {
                                item_id = Some(String::from_utf8_lossy(&attr.value).to_string())
                            }
                            "href" => {
                                item_href = Some(String::from_utf8_lossy(&attr.value).to_string())
                            }
                            _ => {}
                        }
                    }
                    if let (Some(id), Some(href)) = (item_id, item_href) {
                        manifest_items.insert(id, href);
                    }
                }
            }
            Ok(Event::Text(ref e)) => {
                if let Some(ref tag) = current_tag {
                    let text = e.unescape().unwrap_or_default().trim().to_string();
                    if text.is_empty() {
                        buf.clear();
                        continue;
                    }
                    match tag.as_str() {
                        "title" if meta.title.is_empty() => {
                            meta.title = text.to_string();
                        }
                        "creator" => {
                            meta.authors.push(text.to_string());
                        }
                        "identifier" if meta.package_identifier.is_none() => {
                            meta.package_identifier = Some(text.to_string());
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(EpubError::OpfParse(e.to_string())),
            _ => {}
        }
        buf.clear();
    }

    // Resolve cover path from meta cover id → manifest item
    if let Some(ref cover_id) = cover_id_from_meta {
        if let Some(href) = manifest_items.get(cover_id) {
            meta.cover_entry_path = Some(resolve_opf_relative(href));
        }
    }

    // Fallback: look for manifest items with "cover" in the id
    if meta.cover_entry_path.is_none() {
        for (id, href) in &manifest_items {
            if id.to_lowercase().contains("cover") && is_image_path(href) {
                meta.cover_entry_path = Some(resolve_opf_relative(href));
                break;
            }
        }
    }

    Ok(meta)
}

/// Strip a namespace prefix, e.g. "dc:title" → "title".
fn strip_ns<'a>(name: &'a [u8], ns: &[u8]) -> &'a [u8] {
    if name.starts_with(ns) {
        &name[ns.len()..]
    } else {
        name
    }
}

/// Resolve a manifest href relative to the OPF's directory.
/// The href in the manifest is relative to the OPF's location.
/// Since OPF is inside the ZIP root (e.g. "OEBPS/content.opf"),
/// an href of "images/cover.jpg" → "OEBPS/images/cover.jpg".
fn resolve_opf_relative(href: &str) -> String {
    // For simplicity, we store the raw href. The caller will
    // resolve it against the OPF's base directory when needed.
    href.to_string()
}

/// Best-effort: the path is relative to the OPF base.
/// The caller must prepend the OPF directory.
pub fn opf_base_dir(opf_path_in_zip: &str) -> String {
    let p = Path::new(opf_path_in_zip);
    p.parent()
        .and_then(|parent| parent.to_str())
        .unwrap_or("")
        .to_string()
}

fn is_image_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".png")
        || lower.ends_with(".gif")
        || lower.ends_with(".svg")
        || lower.ends_with(".webp")
}

// ── Public API ─────────────────────────────────────────────────────

/// Open an EPUB file, parse its metadata, and extract cover image
/// to the given cache directory. Returns parsed metadata.

pub fn parse_epub_reader<R: Read + Seek>(
    reader: R,
    cover_cache: Option<(&Path, &str)>,
) -> Result<EpubMetadata, EpubError> {
    let mut archive = ZipArchive::new(reader).map_err(|e| EpubError::Zip(e.to_string()))?;

    validate_archive_budget(&mut archive).map_err(EpubError::Zip)?;

    // ── 1. container.xml ──
    let container_bytes = read_zip_entry_by_name(
        &mut archive,
        "META-INF/container.xml",
        MAX_CONTROL_FILE_SIZE,
    )
    .map_err(|_| EpubError::MissingContainer)?;
    let opf_path = parse_container(&container_bytes)?;

    // ── 2. OPF ──
    let opf_bytes = read_zip_entry_by_name(&mut archive, &opf_path, MAX_CONTROL_FILE_SIZE)
        .map_err(|e| EpubError::OpfNotFound(format!("OPF path '{}': {}", opf_path, e)))?;
    let mut meta = parse_opf(&opf_bytes)?;

    // ── 3. Cover extraction ──
    if let (Some(ref cover_entry), Some((cover_cache_dir, book_id))) =
        (meta.cover_entry_path.clone(), cover_cache)
    {
        let opf_base = opf_base_dir(&opf_path);
        let full_cover_path = if opf_base.is_empty() {
            cover_entry.clone()
        } else {
            format!("{}/{}", opf_base, cover_entry)
        };

        match read_zip_entry_by_name(&mut archive, &full_cover_path, MAX_ZIP_ENTRY_SIZE) {
            Ok(cover_bytes) => {
                let ext = Path::new(cover_entry)
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .unwrap_or("jpg");
                let cache_file = cover_cache_dir.join(format!("{}.{}", book_id, ext));

                std::fs::create_dir_all(cover_cache_dir)
                    .map_err(|error| EpubError::CoverExtract(error.to_string()))?;
                std::fs::write(&cache_file, &cover_bytes)
                    .map_err(|error| EpubError::CoverExtract(error.to_string()))?;
                meta.cover_entry_path = Some(cache_file.to_string_lossy().to_string());
            }
            Err(_) => meta.cover_entry_path = None,
        }
    }

    Ok(meta)
}

/// Read a named entry from the ZIP as bytes (case-insensitive, public for protocol use).
///
/// `max_size` limits the decompressed byte count; exceeding it produces an error.
pub fn read_zip_entry_by_name(
    archive: &mut zip::ZipArchive<impl Read + Seek>,
    name: &str,
    max_size: u64,
) -> Result<Vec<u8>, String> {
    // Try case-insensitive match first, then exact
    let mut index: Option<usize> = None;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.name().eq_ignore_ascii_case(name) {
            index = Some(i);
            break;
        }
    }

    let idx = index.ok_or_else(|| format!("entry not found: {}", name))?;
    let entry = archive.by_index(idx).map_err(|e| e.to_string())?;

    validate_entry_budget(&entry, max_size)?;

    let mut buf = Vec::new();
    let mut limited = entry.take(max_size.saturating_add(1));
    std::io::copy(&mut limited, &mut buf).map_err(|e| e.to_string())?;
    if buf.len() as u64 > max_size {
        return Err(format!(
            "entry '{}' exceeds the size limit of {} bytes",
            name, max_size
        ));
    }
    Ok(buf)
}

pub fn validate_archive_budget<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<(), String> {
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(format!(
            "EPUB contains {} entries, exceeding the limit of {}",
            archive.len(),
            MAX_ZIP_ENTRIES
        ));
    }

    let mut total = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| error.to_string())?;
        validate_entry_ratio(&entry)?;
        total = total
            .checked_add(entry.size())
            .ok_or_else(|| "declared decompressed size overflow".to_string())?;
        if total > MAX_DECOMPRESSED_SIZE {
            return Err(format!(
                "declared decompressed size exceeds {} bytes",
                MAX_DECOMPRESSED_SIZE
            ));
        }
    }
    Ok(())
}

fn validate_entry_budget(entry: &zip::read::ZipFile<'_>, max_size: u64) -> Result<(), String> {
    if entry.size() > max_size {
        return Err(format!(
            "entry '{}' exceeds the size limit of {} bytes",
            entry.name(),
            max_size
        ));
    }
    validate_entry_ratio(entry)
}

fn validate_entry_ratio(entry: &zip::read::ZipFile<'_>) -> Result<(), String> {
    let decompressed = entry.size();
    let compressed = entry.compressed_size();
    if decompressed == 0 {
        return Ok(());
    }
    if compressed == 0 || decompressed > compressed.saturating_mul(MAX_COMPRESSION_RATIO) {
        return Err(format!(
            "entry '{}' exceeds the compression ratio limit of {}:1",
            entry.name(),
            MAX_COMPRESSION_RATIO
        ));
    }
    Ok(())
}

fn mime_for_path(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".xhtml") || lower.ends_with(".html") || lower.ends_with(".htm") {
        "application/xhtml+xml"
    } else if lower.ends_with(".css") {
        "text/css"
    } else if lower.ends_with(".js") {
        "application/javascript"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".woff") {
        "font/woff"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else if lower.ends_with(".ttf") || lower.ends_with(".otf") {
        "font/opentype"
    } else if lower.ends_with(".ncx") {
        "application/x-dtbncx+xml"
    } else if lower.ends_with(".opf") {
        "application/oebps-package+xml"
    } else if lower.ends_with(".xml") {
        "application/xml"
    } else {
        "application/octet-stream"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn build_test_epub() -> Vec<u8> {
        let cursor = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        let options = zip::write::FileOptions::default();

        writer
            .start_file("META-INF/container.xml", options)
            .unwrap();
        writer
            .write_all(
                br#"<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="item/book.opf"/></rootfiles></container>"#,
            )
            .unwrap();
        writer.start_file("item/book.opf", options).unwrap();
        writer
            .write_all(
                br#"<?xml version="1.0"?>
<package><metadata><title>Byte Book</title><creator>Byte Author</creator><identifier>byte-id</identifier></metadata></package>"#,
            )
            .unwrap();

        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn test_parse_container() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;
        let result = parse_container(xml).unwrap();
        assert_eq!(result, "OEBPS/content.opf");
    }

    #[test]
    fn test_parse_opf_minimal() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:creator>Author One</dc:creator>
    <dc:creator>Author Two</dc:creator>
    <dc:identifier id="book-id">urn:uuid:abc123</dc:identifier>
  </metadata>
</package>"#;
        let meta = parse_opf(xml).unwrap();
        assert_eq!(meta.title, "Test Book");
        assert_eq!(meta.authors, vec!["Author One", "Author Two"]);
        assert_eq!(meta.package_identifier, Some("urn:uuid:abc123".into()));
    }

    #[test]
    fn test_inspect_epub_bytes() {
        let bytes = build_test_epub();
        let metadata = parse_epub_reader(std::io::Cursor::new(bytes), None).unwrap();
        assert_eq!(metadata.title, "Byte Book");
        assert_eq!(metadata.authors, vec!["Byte Author"]);
        assert_eq!(metadata.package_identifier.as_deref(), Some("byte-id"));
    }

    #[test]
    fn test_parse_epub_bytes_rejects_invalid_zip() {
        let error = parse_epub_reader(std::io::Cursor::new(b"not a zip"), None).unwrap_err();
        assert!(matches!(error, EpubError::Zip(_)));
    }

    #[test]
    fn test_archive_budget_rejects_high_compression_ratio() {
        let cursor = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        let options =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        writer.start_file("large.txt", options).unwrap();
        writer.write_all(&vec![0u8; 1024 * 1024]).unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let mut archive = ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();

        let error = validate_archive_budget(&mut archive).unwrap_err();
        assert!(error.contains("compression ratio"));
    }

    #[test]
    fn test_entry_read_rejects_declared_size_over_limit() {
        let cursor = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        let options =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        writer.start_file("entry.bin", options).unwrap();
        writer.write_all(&[0u8; 9]).unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let mut archive = ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();

        let error = read_zip_entry_by_name(&mut archive, "entry.bin", 8).unwrap_err();
        assert!(error.contains("size limit"));
    }
}
