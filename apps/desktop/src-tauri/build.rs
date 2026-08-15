use url::Url;

const DEFAULT_ORIGIN: &str = "https://skitza.app";

fn exact_https_origin(raw: &str) -> Result<String, String> {
    if raw.contains('*') {
        return Err("SKITZA_DESKTOP_ORIGIN must not contain a wildcard".into());
    }
    let parsed = Url::parse(raw.trim())
        .map_err(|_| "SKITZA_DESKTOP_ORIGIN must be a valid URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("SKITZA_DESKTOP_ORIGIN must use HTTPS".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("SKITZA_DESKTOP_ORIGIN must not include credentials".into());
    }
    if (parsed.path() != "/" && !parsed.path().is_empty())
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(
            "SKITZA_DESKTOP_ORIGIN must be an origin without path, query, or fragment".into(),
        );
    }
    Ok(parsed.origin().ascii_serialization())
}

fn main() {
    println!("cargo:rerun-if-env-changed=SKITZA_DESKTOP_ORIGIN");
    let configured =
        std::env::var("SKITZA_DESKTOP_ORIGIN").unwrap_or_else(|_| DEFAULT_ORIGIN.to_string());
    let origin = exact_https_origin(&configured).unwrap_or_else(|message| panic!("{message}"));
    println!("cargo:rustc-env=SKITZA_DESKTOP_ORIGIN={origin}");
    let manifest = tauri_build::AppManifest::new().commands(&[
        "retry_launch",
        "begin_social_sign_in",
        "record_gate1_sample",
        "consume_reveal_elapsed_ms",
        "export_gate1_samples",
        "report_session_validation",
        "hide_main_window",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to build the explicit Skitza command manifest");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_exact_https_origins() {
        assert_eq!(
            exact_https_origin("https://proof.example:8443/").unwrap(),
            "https://proof.example:8443"
        );
        for invalid in [
            "http://proof.example",
            "https://*.example",
            "https://proof.example/path",
            "https://proof.example?query=1",
            "https://user:pass@proof.example",
        ] {
            assert!(exact_https_origin(invalid).is_err());
        }
    }
}
