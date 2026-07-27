use std::path::Path;

use crate::source::ReadSeek;

#[derive(Debug, Clone, Default)]
pub struct FormatMetadata {
    pub title: String,
    pub authors: Vec<String>,
    pub package_identifier: Option<String>,
    pub cover_cache_path: Option<String>,
}

pub struct ResourceContent {
    pub body: Vec<u8>,
    pub mime: String,
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

#[allow(dead_code)]
pub trait TocProvider {
    type Toc;

    fn read_toc(&self, reader: Box<dyn ReadSeek>) -> Result<Self::Toc, String>;
}

#[allow(dead_code)]
pub trait TextContentProvider {
    type TextContent;

    fn read_text_content(
        &self,
        reader: Box<dyn ReadSeek>,
        entry_path: &str,
    ) -> Result<Self::TextContent, String>;
}
