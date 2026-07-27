mod commands;
mod db;
mod formats;
mod platform;
mod protocol;
mod services;
mod source;

use commands::AppState;
use db::migrations;
use protocol::epub_protocol;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(platform::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("failed to resolve app data dir: {}", e))?;

            std::fs::create_dir_all(&app_data_dir)
                .map_err(|e| format!("failed to create app data dir: {}", e))?;

            let cover_cache_dir = app_data_dir.join("covers");
            std::fs::create_dir_all(&cover_cache_dir)
                .map_err(|e| format!("failed to create cover cache dir: {}", e))?;

            let source_manager = source::SourceManager::new(app_data_dir.join("source-cache"))?;

            let db_path = app_data_dir.join("epubstart.db");
            let conn = Connection::open(&db_path)
                .map_err(|e| format!("failed to open database: {}", e))?;

            migrations::run_migrations(&conn).map_err(|e| format!("migration failed: {}", e))?;

            app.manage(AppState {
                db: Mutex::new(conn),
                cover_cache_dir,
                source_manager,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::select_epub_sources::select_epub_sources,
            commands::import_book::import_book,
            commands::list_books::list_books,
            commands::open_book::open_book,
            commands::relocate_book::relocate_book,
            commands::delete_book::delete_book,
            commands::get_reading_progress::get_reading_progress,
            commands::save_reading_progress::save_reading_progress,
            commands::save_book_image::save_book_image,
            commands::notes::list_notes,
            commands::notes::create_note,
            commands::notes::update_note,
            commands::notes::delete_note,
            commands::settings::get_reading_settings,
            commands::settings::get_global_reading_settings,
            commands::settings::save_global_reading_settings,
            commands::settings::save_book_reading_settings,
            commands::settings::clear_book_reading_settings,
            commands::catalog::list_series,
            commands::catalog::create_series,
            commands::catalog::update_series,
            commands::catalog::delete_series,
            commands::catalog::set_book_series,
            commands::catalog::clear_book_series,
            commands::catalog::reorder_series_books,
            commands::catalog::list_tag_groups,
            commands::catalog::create_tag_group,
            commands::catalog::update_tag_group,
            commands::catalog::delete_tag_group,
            commands::catalog::list_tags,
            commands::catalog::create_tag,
            commands::catalog::update_tag,
            commands::catalog::delete_tag,
            commands::catalog::set_book_tags,
            commands::catalog::set_series_tags,
            commands::catalog::list_book_tags,
        ])
        .register_uri_scheme_protocol("epub", epub_protocol)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
