use std::path::Path;

use super::capabilities::{FormatMetadata, MetadataProvider, ResourceContent, ResourceProvider};
use super::epub::EpubFormatHandler;
use crate::source::ReadSeek;

pub enum ActiveFormat {
    Epub(EpubFormatHandler),
}

impl ActiveFormat {
    pub fn parse_metadata(
        &self,
        reader: Box<dyn ReadSeek>,
        cover_cache: Option<(&Path, &str)>,
    ) -> Result<FormatMetadata, String> {
        match self {
            Self::Epub(handler) => handler.parse_metadata(reader, cover_cache),
        }
    }

    pub fn read_resource(
        &self,
        reader: Box<dyn ReadSeek>,
        entry_path: &str,
    ) -> Result<ResourceContent, String> {
        match self {
            Self::Epub(handler) => handler.read_resource(reader, entry_path),
        }
    }
}
