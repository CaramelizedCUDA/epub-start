use std::path::Path;

use crate::source::ReadSeek;

#[derive(Debug, Clone, Default)]
pub struct FormatMetadata {
    pub title: String,
    pub authors: Vec<String>,
    pub package_identifier: Option<String>,
    pub cover_cache_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceContent {
    pub body: Vec<u8>,
    pub mime: String,
}

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

pub trait MetadataProvider {
    fn parse_metadata(
        &self,
        reader: Box<dyn ReadSeek>,
        cover_cache: Option<(&Path, &str)>,
    ) -> Result<FormatMetadata, String>;
}

pub trait ResourceProvider {
    fn read_resource(
        &self,
        reader: Box<dyn ReadSeek>,
        entry_path: &str,
    ) -> Result<ResourceContent, String>;
}

pub trait SearchContentProvider {
    fn extract_search_documents(
        &self,
        reader: Box<dyn ReadSeek>,
        cancelled: &mut dyn FnMut() -> bool,
    ) -> Result<SearchExtraction, String>;
}
