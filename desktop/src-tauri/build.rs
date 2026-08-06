fn main() {
    // The backend executable is embedded with include_bytes!, which needs a
    // literal path at compile time — so it arrives as an env var that
    // server/build.ts sets after it has produced the binary. Rebuild whenever
    // that path changes, or cargo would happily reuse a stale blob.
    println!("cargo:rerun-if-env-changed=FREEDUNGEON_BACKEND");
    if let Ok(path) = std::env::var("FREEDUNGEON_BACKEND") {
        println!("cargo:rerun-if-changed={path}");
    }
    tauri_build::build()
}
