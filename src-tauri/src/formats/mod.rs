mod active;
mod capabilities;
pub(crate) mod epub;
mod registry;

pub use capabilities::{FormatMetadata, ResourceContent};
pub use registry::active_format;
