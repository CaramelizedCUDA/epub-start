# 第三方组件与声明

EpubStart 项目采用 GPL-3.0-only。以下组件保留各自的版权与许可证；OR 表达式可按其中许可选用，AND 表达式需同时遵守。JSZip 采用其提供的 MIT 选项。

完整原始声明随 Release 的 `EpubStart-0.1.0-licenses.zip` 提供，同时放入 Windows ZIP 和 Android APK 的 `META-INF/epubstart/`。对应第三方源码见同页 `EpubStart-0.1.0-third-party-sources.zip`。版本、源码和上游入口见 [依赖来源清单](docs/releases/DEPENDENCY_SOURCES-v0.1.0.json)。

范围包括 Windows/Android 所选 Cargo 图（含相关构建依赖）、前端生产依赖和解析后的 Android 运行时依赖；部分组件因保守收集而未进入最终二进制。上游未单独附许可证的组件按其源码头、README、包元数据或对应上游版本补充声明。

| 组件 | 版本 | 许可证 |
| --- | --- | --- |
| rust: adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 |
| rust: aes | 0.8.4 | MIT OR Apache-2.0 |
| rust: ahash | 0.8.12 | MIT OR Apache-2.0 |
| rust: aho-corasick | 1.1.4 | Unlicense OR MIT |
| rust: alloc-no-stdlib | 2.0.4 | BSD-3-Clause |
| rust: alloc-stdlib | 0.2.4 | BSD-3-Clause |
| rust: anyhow | 1.0.103 | MIT OR Apache-2.0 |
| rust: autocfg | 1.5.1 | Apache-2.0 OR MIT |
| rust: base64 | 0.22.1 | MIT OR Apache-2.0 |
| rust: base64ct | 1.8.3 | Apache-2.0 OR MIT |
| rust: bit-set | 0.8.0 | Apache-2.0 OR MIT |
| rust: bit-vec | 0.8.0 | Apache-2.0 OR MIT |
| rust: bitflags | 1.3.2 | MIT/Apache-2.0 |
| rust: bitflags | 2.13.1 | MIT OR Apache-2.0 |
| rust: block-buffer | 0.10.4 | MIT OR Apache-2.0 |
| rust: brotli | 8.0.4 | BSD-3-Clause AND MIT |
| rust: brotli-decompressor | 5.0.3 | BSD-3-Clause/MIT |
| rust: bs58 | 0.5.1 | MIT/Apache-2.0 |
| rust: byteorder | 1.5.0 | Unlicense OR MIT |
| rust: bytes | 1.12.1 | MIT |
| rust: bzip2 | 0.4.4 | MIT/Apache-2.0 |
| rust: bzip2-sys | 0.1.13+1.0.8 | MIT/Apache-2.0 |
| rust: camino | 1.2.4 | MIT OR Apache-2.0 |
| rust: cargo-platform | 0.1.9 | MIT OR Apache-2.0 |
| rust: cargo_metadata | 0.19.2 | MIT |
| rust: cargo_toml | 0.22.3 | Apache-2.0 OR MIT |
| rust: cc | 1.2.67 | MIT OR Apache-2.0 |
| rust: cfb | 0.7.3 | MIT |
| rust: cfg-if | 1.0.4 | MIT OR Apache-2.0 |
| rust: chrono | 0.4.45 | MIT OR Apache-2.0 |
| rust: cipher | 0.4.4 | MIT OR Apache-2.0 |
| rust: constant_time_eq | 0.1.5 | CC0-1.0 |
| rust: cookie | 0.18.1 | MIT OR Apache-2.0 |
| rust: cpufeatures | 0.2.17 | MIT OR Apache-2.0 |
| rust: crc32fast | 1.5.0 | MIT OR Apache-2.0 |
| rust: crossbeam-channel | 0.5.16 | MIT OR Apache-2.0 |
| rust: crossbeam-utils | 0.8.22 | MIT OR Apache-2.0 |
| rust: crypto-common | 0.1.7 | MIT OR Apache-2.0 |
| rust: cssparser | 0.36.0 | MPL-2.0 |
| rust: cssparser-macros | 0.6.1 | MPL-2.0 |
| rust: ctor | 0.8.0 | Apache-2.0 OR MIT |
| rust: ctor-proc-macro | 0.0.7 | Apache-2.0 OR MIT |
| rust: darling | 0.23.0 | MIT |
| rust: darling_core | 0.23.0 | MIT |
| rust: darling_macro | 0.23.0 | MIT |
| rust: deranged | 0.5.8 | MIT OR Apache-2.0 |
| rust: derive_more | 2.1.1 | MIT |
| rust: derive_more-impl | 2.1.1 | MIT |
| rust: digest | 0.10.7 | MIT OR Apache-2.0 |
| rust: dirs | 6.0.0 | MIT OR Apache-2.0 |
| rust: dirs-sys | 0.5.0 | MIT OR Apache-2.0 |
| rust: displaydoc | 0.2.6 | MIT OR Apache-2.0 |
| rust: dom_query | 0.27.0 | MIT |
| rust: dpi | 0.1.2 | Apache-2.0 AND MIT |
| rust: dtoa | 1.0.11 | MIT OR Apache-2.0 |
| rust: dtoa-short | 0.3.5 | MPL-2.0 |
| rust: dtor | 0.3.0 | Apache-2.0 OR MIT |
| rust: dtor-proc-macro | 0.0.6 | Apache-2.0 OR MIT |
| rust: dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 |
| rust: dyn-clone | 1.0.20 | MIT OR Apache-2.0 |
| rust: embed-resource | 3.0.11 | MIT |
| rust: equivalent | 1.0.2 | Apache-2.0 OR MIT |
| rust: erased-serde | 0.4.10 | MIT OR Apache-2.0 |
| rust: fallible-iterator | 0.3.0 | MIT/Apache-2.0 |
| rust: fallible-streaming-iterator | 0.1.9 | MIT/Apache-2.0 |
| rust: fastrand | 2.4.1 | Apache-2.0 OR MIT |
| rust: fdeflate | 0.3.7 | MIT OR Apache-2.0 |
| rust: find-msvc-tools | 0.1.9 | MIT OR Apache-2.0 |
| rust: flate2 | 1.1.9 | MIT OR Apache-2.0 |
| rust: fnv | 1.0.7 | Apache-2.0 / MIT |
| rust: foldhash | 0.2.0 | Zlib |
| rust: form_urlencoded | 1.2.2 | MIT OR Apache-2.0 |
| rust: generic-array | 0.14.7 | MIT |
| rust: getrandom | 0.3.4 | MIT OR Apache-2.0 |
| rust: getrandom | 0.4.3 | MIT OR Apache-2.0 |
| rust: glob | 0.3.3 | MIT OR Apache-2.0 |
| rust: hashbrown | 0.12.3 | MIT OR Apache-2.0 |
| rust: hashbrown | 0.14.5 | MIT OR Apache-2.0 |
| rust: hashbrown | 0.17.1 | MIT OR Apache-2.0 |
| rust: hashlink | 0.9.1 | MIT OR Apache-2.0 |
| rust: heck | 0.5.0 | MIT OR Apache-2.0 |
| rust: hex | 0.4.3 | MIT OR Apache-2.0 |
| rust: hmac | 0.12.1 | MIT OR Apache-2.0 |
| rust: html5ever | 0.38.0 | MIT OR Apache-2.0 |
| rust: http | 1.4.2 | MIT OR Apache-2.0 |
| rust: http-range | 0.1.5 | MIT |
| rust: ico | 0.5.0 | MIT |
| rust: icu_collections | 2.2.0 | Unicode-3.0 |
| rust: icu_locale_core | 2.2.0 | Unicode-3.0 |
| rust: icu_normalizer | 2.2.0 | Unicode-3.0 |
| rust: icu_normalizer_data | 2.2.0 | Unicode-3.0 |
| rust: icu_properties | 2.2.0 | Unicode-3.0 |
| rust: icu_properties_data | 2.2.0 | Unicode-3.0 |
| rust: icu_provider | 2.2.0 | Unicode-3.0 |
| rust: ident_case | 1.0.1 | MIT/Apache-2.0 |
| rust: idna | 1.1.0 | MIT OR Apache-2.0 |
| rust: idna_adapter | 1.2.2 | Apache-2.0 OR MIT |
| rust: indexmap | 1.9.3 | Apache-2.0 OR MIT |
| rust: indexmap | 2.14.0 | Apache-2.0 OR MIT |
| rust: infer | 0.19.0 | MIT |
| rust: inout | 0.1.4 | MIT OR Apache-2.0 |
| rust: itoa | 1.0.18 | MIT OR Apache-2.0 |
| rust: jobserver | 0.1.35 | MIT OR Apache-2.0 |
| rust: json-patch | 3.0.1 | MIT/Apache-2.0 |
| rust: jsonptr | 0.6.3 | MIT OR Apache-2.0 |
| rust: keyboard-types | 0.7.0 | MIT OR Apache-2.0 |
| rust: libc | 0.2.186 | MIT OR Apache-2.0 |
| rust: libsqlite3-sys | 0.28.0 | MIT |
| rust: litemap | 0.8.2 | Unicode-3.0 |
| rust: lock_api | 0.4.14 | MIT OR Apache-2.0 |
| rust: log | 0.4.33 | MIT OR Apache-2.0 |
| rust: markup5ever | 0.38.0 | MIT OR Apache-2.0 |
| rust: memchr | 2.8.3 | Unlicense OR MIT |
| rust: mime | 0.3.17 | MIT OR Apache-2.0 |
| rust: miniz_oxide | 0.8.9 | MIT OR Zlib OR Apache-2.0 |
| rust: mio | 1.2.2 | MIT |
| rust: muda | 0.19.3 | Apache-2.0 OR MIT |
| rust: new_debug_unreachable | 1.0.6 | MIT |
| rust: num-conv | 0.2.2 | MIT OR Apache-2.0 |
| rust: num-traits | 0.2.19 | MIT OR Apache-2.0 |
| rust: once_cell | 1.21.4 | MIT OR Apache-2.0 |
| rust: option-ext | 0.2.0 | MPL-2.0 |
| rust: parking_lot | 0.12.5 | MIT OR Apache-2.0 |
| rust: parking_lot_core | 0.9.12 | MIT OR Apache-2.0 |
| rust: password-hash | 0.4.2 | MIT OR Apache-2.0 |
| rust: pbkdf2 | 0.11.0 | MIT OR Apache-2.0 |
| rust: percent-encoding | 2.3.2 | MIT OR Apache-2.0 |
| rust: phf | 0.13.1 | MIT |
| rust: phf_codegen | 0.13.1 | MIT |
| rust: phf_generator | 0.13.1 | MIT |
| rust: phf_macros | 0.13.1 | MIT |
| rust: phf_shared | 0.13.1 | MIT |
| rust: pin-project-lite | 0.2.17 | Apache-2.0 OR MIT |
| rust: pkg-config | 0.3.33 | MIT OR Apache-2.0 |
| rust: plist | 1.10.0 | MIT |
| rust: png | 0.17.16 | MIT OR Apache-2.0 |
| rust: potential_utf | 0.1.5 | Unicode-3.0 |
| rust: powerfmt | 0.2.0 | MIT OR Apache-2.0 |
| rust: precomputed-hash | 0.1.1 | MIT |
| rust: proc-macro2 | 1.0.106 | MIT OR Apache-2.0 |
| rust: quick-xml | 0.31.0 | MIT |
| rust: quick-xml | 0.41.0 | MIT |
| rust: quote | 1.0.46 | MIT OR Apache-2.0 |
| rust: rand_core | 0.6.4 | MIT OR Apache-2.0 |
| rust: raw-window-handle | 0.6.2 | MIT OR Apache-2.0 OR Zlib |
| rust: ref-cast | 1.0.25 | MIT OR Apache-2.0 |
| rust: ref-cast-impl | 1.0.25 | MIT OR Apache-2.0 |
| rust: regex | 1.13.1 | MIT OR Apache-2.0 |
| rust: regex-automata | 0.4.16 | MIT OR Apache-2.0 |
| rust: regex-syntax | 0.8.11 | MIT OR Apache-2.0 |
| rust: rfd | 0.16.0 | MIT |
| rust: rusqlite | 0.31.0 | MIT |
| rust: rustc-hash | 2.1.3 | Apache-2.0 OR MIT |
| rust: rustc_version | 0.4.1 | MIT OR Apache-2.0 |
| rust: same-file | 1.0.6 | Unlicense/MIT |
| rust: schemars | 0.8.22 | MIT |
| rust: schemars | 0.9.0 | MIT |
| rust: schemars | 1.2.1 | MIT |
| rust: schemars_derive | 0.8.22 | MIT |
| rust: scopeguard | 1.2.0 | MIT OR Apache-2.0 |
| rust: selectors | 0.36.1 | MPL-2.0 |
| rust: semver | 1.0.28 | MIT OR Apache-2.0 |
| rust: serde | 1.0.228 | MIT OR Apache-2.0 |
| rust: serde-untagged | 0.1.9 | MIT OR Apache-2.0 |
| rust: serde_core | 1.0.228 | MIT OR Apache-2.0 |
| rust: serde_derive | 1.0.228 | MIT OR Apache-2.0 |
| rust: serde_derive_internals | 0.29.1 | MIT OR Apache-2.0 |
| rust: serde_json | 1.0.150 | MIT OR Apache-2.0 |
| rust: serde_repr | 0.1.20 | MIT OR Apache-2.0 |
| rust: serde_spanned | 1.1.1 | MIT OR Apache-2.0 |
| rust: serde_with | 3.21.0 | MIT OR Apache-2.0 |
| rust: serde_with_macros | 3.21.0 | MIT OR Apache-2.0 |
| rust: serialize-to-javascript | 0.1.2 | MIT OR Apache-2.0 |
| rust: serialize-to-javascript-impl | 0.1.2 | MIT OR Apache-2.0 |
| rust: servo_arc | 0.4.3 | MIT OR Apache-2.0 |
| rust: sha1 | 0.10.7 | MIT OR Apache-2.0 |
| rust: sha2 | 0.10.9 | MIT OR Apache-2.0 |
| rust: shlex | 2.0.1 | MIT OR Apache-2.0 |
| rust: simd-adler32 | 0.3.10 | MIT |
| rust: siphasher | 1.0.3 | MIT/Apache-2.0 |
| rust: smallvec | 1.15.2 | MIT OR Apache-2.0 |
| rust: socket2 | 0.6.5 | MIT OR Apache-2.0 |
| rust: softbuffer | 0.4.8 | MIT OR Apache-2.0 |
| rust: stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 |
| rust: string_cache | 0.9.0 | MIT OR Apache-2.0 |
| rust: string_cache_codegen | 0.6.1 | MIT OR Apache-2.0 |
| rust: strsim | 0.11.1 | MIT |
| rust: subtle | 2.6.1 | BSD-3-Clause |
| rust: syn | 2.0.119 | MIT OR Apache-2.0 |
| rust: synstructure | 0.13.2 | MIT |
| rust: tao | 0.35.3 | Apache-2.0 |
| rust: tauri | 2.11.5 | Apache-2.0 OR MIT |
| rust: tauri-build | 2.6.3 | Apache-2.0 OR MIT |
| rust: tauri-codegen | 2.6.3 | Apache-2.0 OR MIT |
| rust: tauri-macros | 2.6.3 | Apache-2.0 OR MIT |
| rust: tauri-plugin | 2.6.3 | Apache-2.0 OR MIT |
| rust: tauri-plugin-dialog | 2.7.1 | Apache-2.0 OR MIT |
| rust: tauri-plugin-fs | 2.5.1 | Apache-2.0 OR MIT |
| rust: tauri-runtime | 2.11.3 | Apache-2.0 OR MIT |
| rust: tauri-runtime-wry | 2.11.4 | Apache-2.0 OR MIT |
| rust: tauri-utils | 2.9.3 | Apache-2.0 OR MIT |
| rust: tauri-winres | 0.3.6 | MIT |
| rust: tendril | 0.5.1 | MIT OR Apache-2.0 |
| rust: thiserror | 1.0.69 | MIT OR Apache-2.0 |
| rust: thiserror | 2.0.18 | MIT OR Apache-2.0 |
| rust: thiserror-impl | 1.0.69 | MIT OR Apache-2.0 |
| rust: thiserror-impl | 2.0.18 | MIT OR Apache-2.0 |
| rust: time | 0.3.53 | MIT OR Apache-2.0 |
| rust: time-core | 0.1.9 | MIT OR Apache-2.0 |
| rust: time-macros | 0.2.31 | MIT OR Apache-2.0 |
| rust: tinystr | 0.8.3 | Unicode-3.0 |
| rust: tinyvec | 1.12.0 | Zlib OR Apache-2.0 OR MIT |
| rust: tinyvec_macros | 0.1.1 | MIT OR Apache-2.0 OR Zlib |
| rust: tokio | 1.53.0 | MIT |
| rust: tokio-macros | 2.7.1 | MIT |
| rust: toml | 0.9.12+spec-1.1.0 | MIT OR Apache-2.0 |
| rust: toml | 1.1.3+spec-1.1.0 | MIT OR Apache-2.0 |
| rust: toml_datetime | 0.7.5+spec-1.1.0 | MIT OR Apache-2.0 |
| rust: toml_datetime | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 |
| rust: toml_parser | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 |
| rust: toml_writer | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 |
| rust: tracing | 0.1.44 | MIT |
| rust: tracing-core | 0.1.36 | MIT |
| rust: tray-icon | 0.24.1 | MIT OR Apache-2.0 |
| rust: typeid | 1.0.3 | MIT OR Apache-2.0 |
| rust: typenum | 1.20.1 | MIT OR Apache-2.0 |
| rust: unic-char-property | 0.9.0 | MIT/Apache-2.0 |
| rust: unic-char-range | 0.9.0 | MIT/Apache-2.0 |
| rust: unic-common | 0.9.0 | MIT/Apache-2.0 |
| rust: unic-ucd-ident | 0.9.0 | MIT/Apache-2.0 |
| rust: unic-ucd-version | 0.9.0 | MIT/Apache-2.0 |
| rust: unicode-ident | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| rust: unicode-segmentation | 1.13.3 | MIT OR Apache-2.0 |
| rust: url | 2.5.8 | MIT OR Apache-2.0 |
| rust: urlpattern | 0.3.0 | MIT |
| rust: utf8_iter | 1.0.4 | Apache-2.0 OR MIT |
| rust: uuid | 1.24.0 | Apache-2.0 OR MIT |
| rust: vcpkg | 0.2.15 | MIT/Apache-2.0 |
| rust: version_check | 0.9.5 | MIT/Apache-2.0 |
| rust: vswhom | 0.1.0 | MIT |
| rust: vswhom-sys | 0.1.3 | MIT |
| rust: walkdir | 2.5.0 | Unlicense/MIT |
| rust: web_atoms | 0.2.5 | MIT OR Apache-2.0 |
| rust: webview2-com | 0.38.2 | MIT |
| rust: webview2-com-macros | 0.8.1 | MIT |
| rust: webview2-com-sys | 0.38.2 | MIT |
| rust: winapi-util | 0.1.11 | Unlicense OR MIT |
| rust: window-vibrancy | 0.6.0 | Apache-2.0 OR MIT |
| rust: windows | 0.61.3 | MIT OR Apache-2.0 |
| rust: windows-collections | 0.2.0 | MIT OR Apache-2.0 |
| rust: windows-core | 0.61.2 | MIT OR Apache-2.0 |
| rust: windows-future | 0.2.1 | MIT OR Apache-2.0 |
| rust: windows-implement | 0.60.2 | MIT OR Apache-2.0 |
| rust: windows-interface | 0.59.3 | MIT OR Apache-2.0 |
| rust: windows-link | 0.1.3 | MIT OR Apache-2.0 |
| rust: windows-link | 0.2.1 | MIT OR Apache-2.0 |
| rust: windows-numerics | 0.2.0 | MIT OR Apache-2.0 |
| rust: windows-result | 0.3.4 | MIT OR Apache-2.0 |
| rust: windows-strings | 0.4.2 | MIT OR Apache-2.0 |
| rust: windows-sys | 0.59.0 | MIT OR Apache-2.0 |
| rust: windows-sys | 0.60.2 | MIT OR Apache-2.0 |
| rust: windows-sys | 0.61.2 | MIT OR Apache-2.0 |
| rust: windows-targets | 0.52.6 | MIT OR Apache-2.0 |
| rust: windows-targets | 0.53.5 | MIT OR Apache-2.0 |
| rust: windows-threading | 0.1.0 | MIT OR Apache-2.0 |
| rust: windows-version | 0.1.7 | MIT OR Apache-2.0 |
| rust: windows_x86_64_msvc | 0.52.6 | MIT OR Apache-2.0 |
| rust: windows_x86_64_msvc | 0.53.1 | MIT OR Apache-2.0 |
| rust: winnow | 0.7.15 | MIT |
| rust: winnow | 1.0.4 | MIT |
| rust: winreg | 0.55.0 | MIT |
| rust: writeable | 0.6.3 | Unicode-3.0 |
| rust: wry | 0.55.1 | Apache-2.0 OR MIT |
| rust: yoke | 0.8.3 | Unicode-3.0 |
| rust: yoke-derive | 0.8.2 | Unicode-3.0 |
| rust: zerocopy | 0.8.54 | BSD-2-Clause OR Apache-2.0 OR MIT |
| rust: zerofrom | 0.1.8 | Unicode-3.0 |
| rust: zerofrom-derive | 0.1.7 | Unicode-3.0 |
| rust: zerotrie | 0.2.4 | Unicode-3.0 |
| rust: zerovec | 0.11.6 | Unicode-3.0 |
| rust: zerovec-derive | 0.11.3 | Unicode-3.0 |
| rust: zip | 0.6.6 | MIT |
| rust: zmij | 1.0.23 | MIT |
| rust: zstd | 0.11.2+zstd.1.5.2 | MIT |
| rust: zstd-safe | 5.0.2+zstd.1.5.2 | MIT/Apache-2.0 |
| rust: zstd-sys | 2.0.16+zstd.1.5.7 | MIT/Apache-2.0 |
| rust: android_system_properties | 0.1.5 | MIT/Apache-2.0 |
| rust: atomic-waker | 1.1.2 | Apache-2.0 OR MIT |
| rust: cesu8 | 1.1.0 | Apache-2.0/MIT |
| rust: combine | 4.6.7 | MIT |
| rust: errno | 0.3.14 | MIT OR Apache-2.0 |
| rust: futures-channel | 0.3.32 | MIT OR Apache-2.0 |
| rust: futures-core | 0.3.32 | MIT OR Apache-2.0 |
| rust: futures-io | 0.3.32 | MIT OR Apache-2.0 |
| rust: futures-macro | 0.3.32 | MIT OR Apache-2.0 |
| rust: futures-sink | 0.3.32 | MIT OR Apache-2.0 |
| rust: futures-task | 0.3.32 | MIT OR Apache-2.0 |
| rust: futures-util | 0.3.32 | MIT OR Apache-2.0 |
| rust: http-body | 1.1.0 | MIT |
| rust: http-body-util | 0.1.4 | MIT |
| rust: httparse | 1.10.1 | MIT OR Apache-2.0 |
| rust: hyper | 1.10.1 | MIT |
| rust: hyper-util | 0.1.20 | MIT |
| rust: iana-time-zone | 0.1.65 | MIT OR Apache-2.0 |
| rust: ipnet | 2.12.0 | MIT OR Apache-2.0 |
| rust: jni | 0.21.1 | MIT/Apache-2.0 |
| rust: jni-sys | 0.3.1 | MIT OR Apache-2.0 |
| rust: jni-sys | 0.4.1 | MIT OR Apache-2.0 |
| rust: jni-sys-macros | 0.4.1 | MIT OR Apache-2.0 |
| rust: ndk | 0.9.0 | MIT OR Apache-2.0 |
| rust: ndk-sys | 0.6.0+11769913 | MIT OR Apache-2.0 |
| rust: num_enum | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 |
| rust: num_enum_derive | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 |
| rust: proc-macro-crate | 3.5.0 | MIT OR Apache-2.0 |
| rust: reqwest | 0.13.4 | MIT OR Apache-2.0 |
| rust: rustversion | 1.0.23 | MIT OR Apache-2.0 |
| rust: signal-hook-registry | 1.4.8 | MIT OR Apache-2.0 |
| rust: slab | 0.4.12 | MIT |
| rust: sync_wrapper | 1.0.2 | Apache-2.0 |
| rust: tao-macros | 0.1.3 | MIT OR Apache-2.0 |
| rust: tokio-util | 0.7.18 | MIT |
| rust: toml_edit | 0.25.13+spec-1.1.0 | MIT OR Apache-2.0 |
| rust: tower | 0.5.3 | MIT |
| rust: tower-http | 0.6.11 | MIT |
| rust: tower-layer | 0.3.3 | MIT |
| rust: tower-service | 0.3.3 | MIT |
| rust: try-lock | 0.2.5 | MIT |
| rust: want | 0.3.1 | MIT |
| javascript: @tauri-apps/api | 2.11.1 | Apache-2.0 OR MIT |
| javascript: @tauri-apps/plugin-dialog | 2.7.1 | MIT OR Apache-2.0 |
| javascript: @types/localforage | 0.0.34 | MIT |
| javascript: @types/prop-types | 15.7.15 | MIT |
| javascript: @types/react | 18.3.31 | MIT |
| javascript: @xmldom/xmldom | 0.7.13 | MIT |
| javascript: core-js | 3.49.0 | MIT |
| javascript: core-util-is | 1.0.3 | MIT |
| javascript: csstype | 3.2.3 | MIT |
| javascript: d | 1.0.2 | ISC |
| javascript: epubjs | 0.3.93 | BSD-2-Clause |
| javascript: es5-ext | 0.10.64 | ISC |
| javascript: es6-iterator | 2.0.3 | MIT |
| javascript: es6-symbol | 3.1.4 | ISC |
| javascript: esniff | 2.0.1 | ISC |
| javascript: event-emitter | 0.3.5 | MIT |
| javascript: ext | 1.7.0 | ISC |
| javascript: immediate | 3.0.6 | MIT |
| javascript: inherits | 2.0.4 | ISC |
| javascript: isarray | 1.0.0 | MIT |
| javascript: js-tokens | 4.0.0 | MIT |
| javascript: jszip | 3.10.1 | (MIT OR GPL-3.0-or-later) |
| javascript: lie | 3.3.0 | MIT |
| javascript: localforage | 1.10.0 | Apache-2.0 |
| javascript: lie | 3.1.1 | MIT |
| javascript: lodash | 4.18.1 | MIT |
| javascript: loose-envify | 1.4.0 | MIT |
| javascript: marks-pane | 1.0.9 | MIT |
| javascript: next-tick | 1.1.0 | ISC |
| javascript: pako | 1.0.11 | (MIT AND Zlib) |
| javascript: path-webpack | 0.0.3 | MIT |
| javascript: process-nextick-args | 2.0.1 | MIT |
| javascript: react | 18.3.1 | MIT |
| javascript: react-dom | 18.3.1 | MIT |
| javascript: readable-stream | 2.3.8 | MIT |
| javascript: safe-buffer | 5.1.2 | MIT |
| javascript: scheduler | 0.23.2 | MIT |
| javascript: setimmediate | 1.0.5 | MIT |
| javascript: string_decoder | 1.1.1 | MIT |
| javascript: type | 2.7.3 | ISC |
| javascript: use-sync-external-store | 1.6.0 | MIT |
| javascript: util-deprecate | 1.0.2 | MIT |
| javascript: zustand | 4.5.7 | MIT |
| android: androidx.annotation:annotation-experimental | 1.4.1 | Apache-2.0 |
| android: androidx.activity:activity-ktx | 1.10.1 | Apache-2.0 |
| android: androidx.annotation:annotation | 1.9.1 | Apache-2.0 |
| android: androidx.annotation:annotation-jvm | 1.9.1 | Apache-2.0 |
| android: androidx.activity:activity | 1.10.1 | Apache-2.0 |
| android: androidx.appcompat:appcompat | 1.7.1 | Apache-2.0 |
| android: androidx.arch.core:core-common | 2.2.0 | Apache-2.0 |
| android: androidx.arch.core:core-runtime | 2.2.0 | Apache-2.0 |
| android: androidx.appcompat:appcompat-resources | 1.7.1 | Apache-2.0 |
| android: androidx.cardview:cardview | 1.0.0 | Apache-2.0 |
| android: androidx.collection:collection | 1.1.0 | Apache-2.0 |
| android: androidx.concurrent:concurrent-futures | 1.1.0 | Apache-2.0 |
| android: androidx.constraintlayout:constraintlayout | 2.0.1 | Apache-2.0 |
| android: androidx.constraintlayout:constraintlayout-solver | 2.0.1 | Apache-2.0 |
| android: androidx.coordinatorlayout:coordinatorlayout | 1.1.0 | Apache-2.0 |
| android: androidx.core:core-viewtree | 1.0.0 | Apache-2.0 |
| android: androidx.core:core-ktx | 1.13.1 | Apache-2.0 |
| android: androidx.core:core | 1.13.1 | Apache-2.0 |
| android: androidx.cursoradapter:cursoradapter | 1.0.0 | Apache-2.0 |
| android: androidx.customview:customview | 1.1.0 | Apache-2.0 |
| android: androidx.documentfile:documentfile | 1.0.0 | Apache-2.0 |
| android: androidx.drawerlayout:drawerlayout | 1.1.1 | Apache-2.0 |
| android: androidx.dynamicanimation:dynamicanimation | 1.0.0 | Apache-2.0 |
| android: androidx.emoji2:emoji2 | 1.3.0 | Apache-2.0 |
| android: androidx.emoji2:emoji2-views-helper | 1.3.0 | Apache-2.0 |
| android: androidx.interpolator:interpolator | 1.0.0 | Apache-2.0 |
| android: androidx.fragment:fragment | 1.5.4 | Apache-2.0 |
| android: androidx.legacy:legacy-support-core-utils | 1.0.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-common | 2.10.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-livedata | 2.10.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-livedata-core | 2.10.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-common-jvm | 2.10.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-livedata-core-ktx | 2.10.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-process | 2.10.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-runtime | 2.10.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-runtime-android | 2.10.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-runtime-ktx | 2.10.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-runtime-ktx-android | 2.10.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-viewmodel-android | 2.10.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-viewmodel | 2.10.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-viewmodel-ktx | 2.10.0 | Apache-2.0 |
| android: androidx.loader:loader | 1.0.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-viewmodel-savedstate | 2.10.0 | Apache-2.0 |
| android: androidx.lifecycle:lifecycle-viewmodel-savedstate-android | 2.10.0 | Apache-2.0 |
| android: androidx.localbroadcastmanager:localbroadcastmanager | 1.0.0 | Apache-2.0 |
| android: androidx.print:print | 1.0.0 | Apache-2.0 |
| android: androidx.profileinstaller:profileinstaller | 1.4.0 | Apache-2.0 |
| android: androidx.resourceinspection:resourceinspection-annotation | 1.0.1 | Apache-2.0 |
| android: androidx.savedstate:savedstate | 1.4.0 | Apache-2.0 |
| android: androidx.recyclerview:recyclerview | 1.1.0 | Apache-2.0 |
| android: androidx.savedstate:savedstate-ktx | 1.4.0 | Apache-2.0 |
| android: androidx.savedstate:savedstate-android | 1.4.0 | Apache-2.0 |
| android: androidx.startup:startup-runtime | 1.1.1 | Apache-2.0 |
| android: androidx.tracing:tracing | 1.0.0 | Apache-2.0 |
| android: androidx.vectordrawable:vectordrawable | 1.1.0 | Apache-2.0 |
| android: androidx.transition:transition | 1.5.0 | Apache-2.0 |
| android: androidx.vectordrawable:vectordrawable-animated | 1.1.0 | Apache-2.0 |
| android: androidx.versionedparcelable:versionedparcelable | 1.1.1 | Apache-2.0 |
| android: androidx.viewpager:viewpager | 1.0.0 | Apache-2.0 |
| android: androidx.viewpager2:viewpager2 | 1.0.0 | Apache-2.0 |
| android: com.fasterxml.jackson:jackson-bom | 2.15.3 | Apache-2.0 |
| android: androidx.webkit:webkit | 1.14.0 | Apache-2.0 |
| android: com.fasterxml.jackson.core:jackson-annotations | 2.15.3 | Apache-2.0 |
| android: com.google.guava:listenablefuture | 1.0 | Apache-2.0 |
| android: com.fasterxml.jackson.core:jackson-core | 2.15.3 | Apache-2.0 |
| android: com.fasterxml.jackson.core:jackson-databind | 2.15.3 | Apache-2.0 |
| android: com.google.errorprone:error_prone_annotations | 2.15.0 | Apache-2.0 |
| android: org.jetbrains:annotations | 23.0.0 | Apache-2.0 |
| android: com.google.android.material:material | 1.12.0 | Apache-2.0 |
| android: org.jetbrains.kotlin:kotlin-bom | 1.8.22 | Apache-2.0 |
| android: org.jetbrains.kotlinx:kotlinx-coroutines-android | 1.9.0 | Apache-2.0 |
| android: org.jetbrains.kotlin:kotlin-stdlib | 2.0.21 | Apache-2.0 |
| android: org.jetbrains.kotlinx:kotlinx-coroutines-bom | 1.9.0 | Apache-2.0 |
| android: org.jetbrains.kotlinx:kotlinx-serialization-bom | 1.7.3 | Apache-2.0 |
| android: org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm | 1.9.0 | Apache-2.0 |
| android: org.jetbrains.kotlinx:kotlinx-coroutines-core | 1.9.0 | Apache-2.0 |
| android: org.jetbrains.kotlinx:kotlinx-serialization-core | 1.7.3 | Apache-2.0 |
| android: org.jspecify:jspecify | 1.0.0 | Apache-2.0 |
| android: org.jetbrains.kotlinx:kotlinx-serialization-core-jvm | 1.7.3 | Apache-2.0 |
