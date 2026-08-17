use std::path::Path;

use super::capabilities::{
    FormatMetadata, MetadataProvider, ResourceContent, ResourceProvider, SearchContentProvider,
    SearchExtraction,
};
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

    pub fn extract_search_documents(
        &self,
        reader: Box<dyn ReadSeek>,
        cancelled: &mut dyn FnMut() -> bool,
    ) -> Result<SearchExtraction, String> {
        match self {
            Self::Epub(handler) => handler.extract_search_documents(reader, cancelled),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::db::models::BookFormat;

    #[test]
    fn search_content_uses_the_active_format_interface_and_stable_parse_error() {
        let format = crate::formats::active_format(&BookFormat::Epub).unwrap();
        let mut cancelled = || false;
        let error = format
            .extract_search_documents(
                Box::new(std::io::Cursor::new(b"not an epub".to_vec())),
                &mut cancelled,
            )
            .unwrap_err();

        assert!(error.starts_with("BOOK_PARSE_FAILED:"), "got {error}");
    }
}
