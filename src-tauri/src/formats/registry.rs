use super::active::ActiveFormat;
use super::epub::EpubFormatHandler;
use crate::db::models::BookFormat;

pub fn active_format(format: &BookFormat) -> Result<ActiveFormat, String> {
    match format {
        BookFormat::Epub => Ok(ActiveFormat::Epub(EpubFormatHandler)),
        BookFormat::Txt | BookFormat::Pdf | BookFormat::Cbz | BookFormat::Cbr => Err(format!(
            "FORMAT_NOT_SUPPORTED: {} support is not approved for Phase 2",
            format_name(format)
        )),
    }
}

fn format_name(format: &BookFormat) -> &'static str {
    match format {
        BookFormat::Epub => "EPUB",
        BookFormat::Txt => "TXT",
        BookFormat::Pdf => "PDF",
        BookFormat::Cbz => "CBZ",
        BookFormat::Cbr => "CBR",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_formats_return_stable_error() {
        let error = active_format(&BookFormat::Pdf).err().unwrap();
        assert!(error.starts_with("FORMAT_NOT_SUPPORTED:"));
    }
}
