mod active;
pub(crate) mod capabilities;
pub(crate) mod epub;
mod registry;

pub use capabilities::{FormatMetadata, ResourceContent, SearchExtraction};
pub use registry::active_format;
