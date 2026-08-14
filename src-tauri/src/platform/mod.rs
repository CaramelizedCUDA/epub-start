#[cfg(target_os = "android")]
mod android;
#[cfg(not(target_os = "android"))]
mod desktop;

#[cfg(target_os = "android")]
pub use android::*;
#[cfg(not(target_os = "android"))]
pub use desktop::*;

#[derive(Debug, Clone)]
pub struct FileMetadata {
    pub file_size_bytes: i64,
    pub last_modified_ts: i64,
}

/// Android SAF（Storage Access Framework）选取结果到来源选择的转换。
/// 从 select_epub_sources 中抽出为纯函数，使"用户取消 → 空列表"、
/// "无持久 URI → SAF_PERMISSION_DENIED"、"非法 URI → VALIDATION_ERROR"
/// 等路径可以在桌面构建上做静态测试（Android 真机探查另计）。
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) fn selection_from_picker_response(
    cancelled: bool,
    source_locator: Option<String>,
) -> Result<Vec<crate::db::models::SelectedSource>, String> {
    if cancelled {
        return Ok(Vec::new());
    }
    let source_locator = source_locator.ok_or_else(|| {
        "SAF_PERMISSION_DENIED: Android picker returned no persisted URI".to_string()
    })?;
    if !is_content_uri(&source_locator) {
        return Err("VALIDATION_ERROR: Android picker returned an invalid URI".to_string());
    }
    Ok(vec![crate::db::models::SelectedSource {
        source_locator,
        source_kind: crate::db::models::SourceKind::AndroidContentUri,
    }])
}

/// SAF locator 必须是 content:// 前缀且带非空 authority 的持久 URI；其余一律拒绝。
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) fn is_content_uri(locator: &str) -> bool {
    locator.starts_with("content://") && locator.len() > "content://".len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::SourceKind;

    #[test]
    fn picker_cancellation_yields_empty_selection() {
        let selection = selection_from_picker_response(true, None).unwrap();
        assert!(selection.is_empty());
    }

    #[test]
    fn picker_without_persisted_uri_is_permission_denied() {
        let error = selection_from_picker_response(false, None).unwrap_err();
        assert!(
            error.starts_with("SAF_PERMISSION_DENIED:"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn picker_rejects_non_content_uris() {
        for bad in [
            "file:///storage/book.epub",
            "http://example.com/x",
            "not-a-uri",
            "",
        ] {
            let error = selection_from_picker_response(false, Some(bad.to_string())).unwrap_err();
            assert!(
                error.starts_with("VALIDATION_ERROR:"),
                "locator {bad:?} produced: {error}"
            );
        }
    }

    #[test]
    fn picker_accepts_persisted_content_uri() {
        let selection = selection_from_picker_response(
            false,
            Some("content://com.android.providers.downloads.documents/document/1234".to_string()),
        )
        .unwrap();
        assert_eq!(selection.len(), 1);
        assert_eq!(selection[0].source_kind, SourceKind::AndroidContentUri);
        assert!(is_content_uri(&selection[0].source_locator));
    }

    #[test]
    fn content_uri_prefix_requires_exact_scheme() {
        assert!(is_content_uri("content://docs/1"));
        assert!(!is_content_uri("content:/docs/1"));
        assert!(!is_content_uri("Content://docs/1"));
        assert!(!is_content_uri("content://"));
        assert!(!is_content_uri(""));
    }

    #[test]
    fn selection_values_round_trip_through_model() {
        let selection =
            selection_from_picker_response(false, Some("content://test/abc".to_string())).unwrap();
        assert_eq!(selection.len(), 1);
        assert_eq!(selection[0].source_locator, "content://test/abc");
        assert_eq!(selection[0].source_kind, SourceKind::AndroidContentUri);
    }
}
