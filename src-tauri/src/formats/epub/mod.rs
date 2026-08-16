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

/// A bounded plain-text document extracted from one EPUB spine item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchDocument {
    pub spine_index: i64,
    pub href: String,
    pub title: String,
    pub body: String,
    pub cfi: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct SearchExtraction {
    pub documents: Vec<SearchDocument>,
    pub total_documents: i64,
    pub bytes_extracted: u64,
    pub errors: Vec<String>,
    pub cancelled: bool,
}

pub const MAX_SEARCH_CHAPTER_SIZE: u64 = 8 * 1024 * 1024;
pub const MAX_SEARCH_BOOK_SIZE: u64 = 64 * 1024 * 1024;

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

#[derive(Debug, Clone)]
struct SearchSpineItem {
    href: String,
    title: String,
}

fn parse_search_spine(xml_bytes: &[u8]) -> Result<Vec<SearchSpineItem>, String> {
    let mut reader = Reader::from_reader(xml_bytes);
    let mut buf = Vec::new();
    let mut in_manifest = false;
    let mut in_spine = false;
    let mut manifest = std::collections::HashMap::<String, (String, String)>::new();
    let mut spine_ids = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => {
                let name = event.name().as_ref().to_vec();
                let local = strip_ns(&name, b"opf:");
                if local == b"manifest" {
                    in_manifest = true;
                } else if local == b"spine" {
                    in_spine = true;
                } else if in_manifest && local == b"item" {
                    let mut id = None;
                    let mut href = None;
                    let mut media_type = String::new();
                    for attr in event.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref());
                        let value = String::from_utf8_lossy(&attr.value).to_string();
                        match key.as_ref() {
                            "id" => id = Some(value),
                            "href" => href = Some(value),
                            "media-type" => media_type = value,
                            _ => {}
                        }
                    }
                    if let (Some(id), Some(href)) = (id, href) {
                        manifest.insert(id, (href, media_type));
                    }
                } else if in_spine && local == b"itemref" {
                    for attr in event.attributes().flatten() {
                        if attr.key.as_ref() == b"idref" {
                            spine_ids.push(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                }
            }
            Ok(Event::Empty(event)) => {
                let name = event.name().as_ref().to_vec();
                let local = strip_ns(&name, b"opf:");
                if in_manifest && local == b"item" {
                    let mut id = None;
                    let mut href = None;
                    let mut media_type = String::new();
                    for attr in event.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref());
                        let value = String::from_utf8_lossy(&attr.value).to_string();
                        match key.as_ref() {
                            "id" => id = Some(value),
                            "href" => href = Some(value),
                            "media-type" => media_type = value,
                            _ => {}
                        }
                    }
                    if let (Some(id), Some(href)) = (id, href) {
                        manifest.insert(id, (href, media_type));
                    }
                } else if in_spine && local == b"itemref" {
                    for attr in event.attributes().flatten() {
                        if attr.key.as_ref() == b"idref" {
                            spine_ids.push(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                }
            }
            Ok(Event::End(event)) => {
                let name = event.name().as_ref().to_vec();
                let local = strip_ns(&name, b"opf:");
                if local == b"manifest" {
                    in_manifest = false;
                } else if local == b"spine" {
                    in_spine = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("OPF spine parse error: {error}")),
            _ => {}
        }
        buf.clear();
    }

    Ok(spine_ids
        .into_iter()
        .filter_map(|id| manifest.remove(&id))
        .filter(|(_, media_type)| {
            media_type.is_empty() || media_type.contains("html") || media_type.contains("xhtml")
        })
        .map(|(href, _)| {
            let title = Path::new(&href)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Chapter")
                .replace(['_', '-'], " ");
            SearchSpineItem { href, title }
        })
        .collect())
}

fn resolve_search_href(opf_path: &str, href: &str) -> Result<String, String> {
    let path_end = href.find(['?', '#']).unwrap_or(href.len());
    let href_path = &href[..path_end];
    if href_path.is_empty() || href_path.starts_with('/') || href_path.contains('\\') {
        return Err("invalid spine href".to_string());
    }

    let mut segments = Vec::<String>::new();
    for segment in opf_base_dir(opf_path).split('/') {
        push_normalized_zip_segment(&mut segments, segment)?;
    }
    for segment in href_path.split('/') {
        let decoded = decode_percent_segment(segment)?;
        push_normalized_zip_segment(&mut segments, &decoded)?;
    }
    if segments.is_empty() {
        return Err("invalid empty spine path".to_string());
    }
    Ok(segments.join("/"))
}

fn push_normalized_zip_segment(segments: &mut Vec<String>, segment: &str) -> Result<(), String> {
    match segment {
        "" | "." => Ok(()),
        ".." => {
            if segments.pop().is_none() {
                return Err("spine href escapes the EPUB root".to_string());
            }
            Ok(())
        }
        _ if segment.contains(['/', '\\', '\0']) => Err("invalid spine href segment".to_string()),
        _ => {
            segments.push(segment.to_string());
            Ok(())
        }
    }
}

fn decode_percent_segment(segment: &str) -> Result<String, String> {
    let bytes = segment.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err("invalid percent encoding in spine href".to_string());
            }
            let high = decode_hex_digit(bytes[index + 1])?;
            let low = decode_hex_digit(bytes[index + 2])?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).map_err(|_| "spine href is not valid UTF-8".to_string())
}

fn decode_hex_digit(value: u8) -> Result<u8, String> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err("invalid percent encoding in spine href".to_string()),
    }
}

fn html_text(bytes: &[u8]) -> Result<(String, String), String> {
    let mut reader = Reader::from_reader(bytes);
    let mut buf = Vec::new();
    let mut body = String::new();
    let mut title = String::new();
    let mut current_tag = String::new();
    let mut hidden_depth = 0usize;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => {
                let tag = String::from_utf8_lossy(event.name().as_ref()).to_ascii_lowercase();
                if tag == "script" || tag == "style" || tag == "svg" {
                    hidden_depth += 1;
                }
                current_tag = tag;
            }
            Ok(Event::End(event)) => {
                let tag = String::from_utf8_lossy(event.name().as_ref()).to_ascii_lowercase();
                if (tag == "script" || tag == "style" || tag == "svg") && hidden_depth > 0 {
                    hidden_depth -= 1;
                }
                current_tag.clear();
            }
            Ok(Event::Text(event)) => {
                if hidden_depth == 0 {
                    let text = event
                        .unescape()
                        .map_err(|error| format!("HTML text decode error: {error}"))?
                        .trim()
                        .to_string();
                    if !text.is_empty() {
                        if !body.is_empty() {
                            body.push(' ');
                        }
                        body.push_str(&text);
                        if title.is_empty() && (current_tag == "title" || current_tag == "h1") {
                            title = text;
                        }
                    }
                }
            }
            Ok(Event::CData(event)) => {
                if hidden_depth == 0 {
                    let text = String::from_utf8_lossy(event.as_ref()).trim().to_string();
                    if !text.is_empty() {
                        if !body.is_empty() {
                            body.push(' ');
                        }
                        body.push_str(&text);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("XHTML parse error: {error}")),
            _ => {}
        }
        buf.clear();
    }
    Ok((title, body))
}

/// Extracts bounded, plain-text spine documents for the B2 search index.
/// The callback is checked between chapters so a running task can be cancelled.
pub fn extract_search_documents<R: Read + Seek, F: FnMut() -> bool>(
    reader: R,
    mut cancelled: F,
) -> Result<SearchExtraction, String> {
    let mut archive = ZipArchive::new(reader).map_err(|error| format!("ZIP error: {error}"))?;
    validate_archive_budget(&mut archive)?;
    let container = read_zip_entry_by_name(
        &mut archive,
        "META-INF/container.xml",
        MAX_CONTROL_FILE_SIZE,
    )?;
    let opf_path = parse_container(&container).map_err(|error| error.to_string())?;
    let opf = read_zip_entry_by_name(&mut archive, &opf_path, MAX_CONTROL_FILE_SIZE)?;
    let spine = parse_search_spine(&opf)?;
    let total_documents = spine.len() as i64;
    let mut extraction = SearchExtraction {
        total_documents,
        ..SearchExtraction::default()
    };
    for (index, item) in spine.into_iter().enumerate() {
        if cancelled() {
            extraction.cancelled = true;
            break;
        }
        let entry_path = match resolve_search_href(&opf_path, &item.href) {
            Ok(path) => path,
            Err(error) => {
                extraction.errors.push(format!("{}: {}", item.href, error));
                continue;
            }
        };
        let bytes = match read_zip_entry_by_name(&mut archive, &entry_path, MAX_SEARCH_CHAPTER_SIZE)
        {
            Ok(bytes) => bytes,
            Err(error) => {
                extraction.errors.push(format!("{}: {}", item.href, error));
                continue;
            }
        };
        extraction.bytes_extracted = checked_search_bytes(extraction.bytes_extracted, bytes.len())?;
        if extraction.bytes_extracted > MAX_SEARCH_BOOK_SIZE {
            return Err(format!(
                "BOOK_RESOURCE_LIMIT_EXCEEDED: search extraction exceeds {} bytes",
                MAX_SEARCH_BOOK_SIZE
            ));
        }
        match html_text(&bytes) {
            Ok((parsed_title, body)) => {
                if !body.is_empty() {
                    extraction.documents.push(SearchDocument {
                        spine_index: index as i64,
                        href: item.href,
                        title: if parsed_title.is_empty() {
                            item.title
                        } else {
                            parsed_title
                        },
                        body,
                        cfi: Some(format!("epubcfi(/6/{})", (index + 1) * 2)),
                    });
                }
            }
            Err(error) => extraction.errors.push(format!("{}: {}", item.href, error)),
        }
    }
    Ok(extraction)
}

fn checked_search_bytes(current: u64, added: usize) -> Result<u64, String> {
    current.checked_add(added as u64).ok_or_else(|| {
        "BOOK_RESOURCE_LIMIT_EXCEEDED: search extraction byte counter overflow".to_string()
    })
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
        let options =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);

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

    fn build_search_epub() -> Vec<u8> {
        build_search_epub_with_second(b"<html><body>second chapter</body></html>")
    }

    fn build_search_epub_with_second(second: &[u8]) -> Vec<u8> {
        let cursor = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        let options =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        writer
            .start_file("META-INF/container.xml", options)
            .unwrap();
        writer
            .write_all(br#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#)
            .unwrap();
        writer.start_file("OEBPS/content.opf", options).unwrap();
        writer
            .write_all(
                br#"<package><metadata><dc:title xmlns:dc="x">Search</dc:title></metadata><manifest>
                <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
                <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
                </manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>"#,
            )
            .unwrap();
        writer.start_file("OEBPS/c1.xhtml", options).unwrap();
        writer
            .write_all(
                "<html><head><title>第一章</title></head><body>你好世界 Rust</body></html>"
                    .as_bytes(),
            )
            .unwrap();
        writer.start_file("OEBPS/c2.xhtml", options).unwrap();
        writer.write_all(second).unwrap();
        writer.finish().unwrap().into_inner()
    }

    fn build_search_epub_with_relative_encoded_href() -> Vec<u8> {
        let cursor = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        let options =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        writer
            .start_file("META-INF/container.xml", options)
            .unwrap();
        writer
            .write_all(br#"<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>"#)
            .unwrap();
        writer.start_file("OPS/content.opf", options).unwrap();
        writer
            .write_all(
                br#"<package><manifest>
                <item id="c1" href="../Text/chapter%201.xhtml?edition=1#part" media-type="application/xhtml+xml"/>
                </manifest><spine><itemref idref="c1"/></spine></package>"#,
            )
            .unwrap();
        writer.start_file("Text/chapter 1.xhtml", options).unwrap();
        writer
            .write_all(b"<html><body>relative path chapter</body></html>")
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

    #[test]
    fn search_extraction_preserves_spine_order_and_cjk_text() {
        let extraction =
            extract_search_documents(std::io::Cursor::new(build_search_epub()), || false).unwrap();
        assert_eq!(extraction.total_documents, 2);
        assert_eq!(extraction.documents.len(), 2);
        assert_eq!(extraction.documents[0].spine_index, 0);
        assert!(extraction.documents[0].body.contains("你好世界"));
        assert_eq!(extraction.documents[0].title, "第一章");
        assert_eq!(extraction.documents[1].spine_index, 1);
    }

    #[test]
    fn search_extraction_honors_cancellation_between_chapters() {
        let extraction =
            extract_search_documents(std::io::Cursor::new(build_search_epub()), || true).unwrap();
        assert!(extraction.cancelled);
        assert!(extraction.documents.is_empty());
    }

    #[test]
    fn search_extraction_keeps_partial_results_for_damaged_chapter() {
        let extraction = extract_search_documents(
            std::io::Cursor::new(build_search_epub_with_second(
                b"<html><body>&invalid;</body></html>",
            )),
            || false,
        )
        .unwrap();
        assert_eq!(extraction.documents.len(), 1);
        assert_eq!(extraction.total_documents, 2);
        assert_eq!(extraction.errors.len(), 1);
    }

    #[test]
    fn search_extraction_rejects_chapter_over_eight_mib() {
        let mut chapter = b"<html><body>".to_vec();
        chapter.extend(std::iter::repeat_n(b'x', MAX_SEARCH_CHAPTER_SIZE as usize));
        chapter.extend_from_slice(b"</body></html>");
        let extraction = extract_search_documents(
            std::io::Cursor::new(build_search_epub_with_second(&chapter)),
            || false,
        )
        .unwrap();
        assert!(extraction.documents.len() <= 1);
        assert!(extraction
            .errors
            .iter()
            .any(|error| error.contains("size limit")));
    }

    #[test]
    fn search_extraction_byte_counter_rejects_overflow() {
        let error = checked_search_bytes(u64::MAX, 1).unwrap_err();
        assert!(error.starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:"));
    }

    #[test]
    fn search_extraction_resolves_relative_and_percent_encoded_spine_hrefs() {
        let extraction = extract_search_documents(
            std::io::Cursor::new(build_search_epub_with_relative_encoded_href()),
            || false,
        )
        .unwrap();
        assert_eq!(extraction.documents.len(), 1);
        assert!(extraction.documents[0]
            .body
            .contains("relative path chapter"));
        assert!(extraction.errors.is_empty());
        assert!(resolve_search_href("OPS/content.opf", "../../secret.xhtml").is_err());
    }
}
