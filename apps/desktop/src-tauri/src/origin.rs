use url::Url;

#[derive(Clone, Debug)]
pub struct OriginPolicy {
    origin: String,
}

impl OriginPolicy {
    pub fn compile_time() -> Self {
        Self::parse(env!("SKITZA_DESKTOP_ORIGIN")).expect("invalid compile-time desktop origin")
    }

    pub fn parse(raw: &str) -> Result<Self, String> {
        if raw.contains('*') {
            return Err("origin-wildcard-forbidden".into());
        }
        let parsed = Url::parse(raw.trim()).map_err(|_| "origin-invalid".to_string())?;
        if parsed.scheme() != "https"
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || (parsed.path() != "/" && !parsed.path().is_empty())
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err("origin-must-be-exact-https".into());
        }
        Ok(Self {
            origin: parsed.origin().ascii_serialization(),
        })
    }

    pub fn as_str(&self) -> &str {
        &self.origin
    }

    pub fn endpoint(&self, path: &str) -> Result<Url, String> {
        if !path.starts_with('/') || path.starts_with("//") {
            return Err("endpoint-invalid".into());
        }
        Url::parse(&format!("{}{}", self.origin, path)).map_err(|_| "endpoint-invalid".into())
    }

    pub fn is_trusted_remote(&self, url: &Url) -> bool {
        url.origin().ascii_serialization() == self.origin
            && url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
    }

    pub fn is_trusted_production_clerk_handshake(&self, url: &Url) -> bool {
        self.origin == "https://skitza.app"
            && url.scheme() == "https"
            && url.host_str() == Some("clerk.skitza.app")
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/v1/client/handshake"
            && url.fragment().is_none()
    }

    pub fn allows_navigation(&self, url: &Url) -> bool {
        self.is_trusted_remote(url)
            || self.is_trusted_production_clerk_handshake(url)
            || (matches!(url.scheme(), "http" | "https")
                && url.host_str() == Some("tauri.localhost")
                && url.port().is_none()
                && url.username().is_empty()
                && url.password().is_none())
            || (url.scheme() == "tauri"
                && url.host_str() == Some("localhost")
                && url.port().is_none()
                && url.username().is_empty()
                && url.password().is_none())
    }

    pub fn is_external_web_url(&self, url: &Url) -> bool {
        matches!(url.scheme(), "http" | "https") && !self.allows_navigation(url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_exact_https_origin_is_trusted() {
        let policy = OriginPolicy::parse("https://proof.example").unwrap();
        assert!(policy.is_trusted_remote(&Url::parse("https://proof.example/launch").unwrap()));
        assert!(
            !policy.is_trusted_remote(&Url::parse("https://evil.proof.example/launch").unwrap())
        );
        assert!(!policy.is_trusted_remote(&Url::parse("http://proof.example/launch").unwrap()));
    }

    #[test]
    fn local_asset_and_exact_remote_are_the_only_navigation_targets() {
        let policy = OriginPolicy::parse("https://proof.example").unwrap();
        assert!(policy.allows_navigation(&Url::parse("http://tauri.localhost/index.html").unwrap()));
        assert!(
            policy.allows_navigation(&Url::parse("https://tauri.localhost/index.html").unwrap())
        );
        assert!(!policy.allows_navigation(&Url::parse("http://tauri.localhost:3000/").unwrap()));
        assert!(policy.allows_navigation(&Url::parse("https://proof.example/dashboard").unwrap()));
        assert!(!policy.allows_navigation(&Url::parse("https://example.com/").unwrap()));
        assert!(!policy.allows_navigation(&Url::parse("file:///tmp/secret").unwrap()));
        assert!(policy.is_external_web_url(&Url::parse("https://example.com/help").unwrap()));
        assert!(policy.is_external_web_url(&Url::parse("http://localhost:3000/help").unwrap()));
        assert!(!policy
            .is_external_web_url(&Url::parse("skitza://auth/callback?code=x&state=y").unwrap()));
    }

    #[test]
    fn production_allows_only_the_exact_clerk_session_handshake() {
        let production = OriginPolicy::parse("https://skitza.app").unwrap();
        assert!(production.allows_navigation(
            &Url::parse(
                "https://clerk.skitza.app/v1/client/handshake?redirect_url=https%3A%2F%2Fskitza.app%2Fdashboard"
            )
            .unwrap()
        ));

        for denied in [
            "http://clerk.skitza.app/v1/client/handshake",
            "https://clerk.skitza.app/v1/client",
            "https://evil.clerk.skitza.app/v1/client/handshake",
            "https://clerk.skitza.app/v1/client/handshake#fragment",
        ] {
            assert!(!production.allows_navigation(&Url::parse(denied).unwrap()));
        }

        let proof = OriginPolicy::parse("https://proof.example").unwrap();
        assert!(!proof.allows_navigation(
            &Url::parse("https://clerk.skitza.app/v1/client/handshake").unwrap()
        ));
    }

    #[test]
    fn endpoint_rejects_origin_replacement() {
        let policy = OriginPolicy::parse("https://proof.example").unwrap();
        assert_eq!(
            policy.endpoint("/api/desktop/auth/start").unwrap().as_str(),
            "https://proof.example/api/desktop/auth/start"
        );
        assert!(policy.endpoint("//evil.example/path").is_err());
    }
}
