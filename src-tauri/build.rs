fn main() {
    // Re-run build if the baked-in Supabase config env vars change.
    // `option_env!()` reads these at compile time inside lib.rs as a
    // production fallback for when no `.env` is present (e.g. installed dmg).
    println!("cargo:rerun-if-env-changed=POSTER_SUPABASE_URL");
    println!("cargo:rerun-if-env-changed=POSTER_SUPABASE_ANON_KEY");

    tauri_build::build()
}
