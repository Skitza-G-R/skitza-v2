use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, LOCATION, SET_COOKIE},
    ClientBuilder, RequestBuilder, StatusCode,
};
use subtle::ConstantTimeEq;
use tauri::webview::{cookie::SameSite, Cookie};
use url::Url;
use zeroize::Zeroize;

use crate::origin::OriginPolicy;

const BYPASS_ENV: &str = "SKITZA_DESKTOP_PROTECTION_BYPASS";
const BYPASS_PARAMETER: &str = "x-vercel-protection-bypass";
const SET_BYPASS_COOKIE_PARAMETER: &str = "x-vercel-set-bypass-cookie";
const BYPASS_COOKIE_NAME: &str = "_vercel_jwt";
const PRODUCTION_HOST: &str = "skitza.app";

pub struct ProtectionBypass {
    value: String,
}

impl ProtectionBypass {
    pub fn from_env(origin: &OriginPolicy) -> Result<Option<Self>, &'static str> {
        let value = match std::env::var(BYPASS_ENV) {
            Ok(value) => Some(value),
            Err(std::env::VarError::NotPresent) => None,
            Err(std::env::VarError::NotUnicode(_)) => return Err("protection-bypass-invalid"),
        };
        Self::for_origin(origin, value)
    }

    pub(crate) fn for_origin(
        origin: &OriginPolicy,
        mut value: Option<String>,
    ) -> Result<Option<Self>, &'static str> {
        let Some(value) = value.take() else {
            return Ok(None);
        };
        if is_production_origin(origin) {
            let mut value = value;
            value.zeroize();
            return Err("protection-bypass-production-forbidden");
        }
        Self::parse(value).map(Some)
    }

    fn parse(mut value: String) -> Result<Self, &'static str> {
        let valid = value.len() == 32
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'));
        if !valid {
            value.zeroize();
            return Err("protection-bypass-invalid");
        }
        Ok(Self { value })
    }

    pub fn configure_client(&self, builder: ClientBuilder) -> ClientBuilder {
        builder.default_headers(self.default_headers())
    }

    pub fn configure_cookie_request(&self, builder: RequestBuilder) -> RequestBuilder {
        builder.header(
            HeaderName::from_static(SET_BYPASS_COOKIE_PARAMETER),
            HeaderValue::from_static("samesitenone"),
        )
    }

    fn default_headers(&self) -> HeaderMap {
        let mut value = HeaderValue::from_str(&self.value)
            .expect("validated protection bypass must be a valid header value");
        value.set_sensitive(true);
        let mut headers = HeaderMap::new();
        headers.insert(HeaderName::from_static(BYPASS_PARAMETER), value);
        headers
    }

    fn add_entry_query(&self, mut url: Url) -> Url {
        url.query_pairs_mut()
            .append_pair(BYPASS_PARAMETER, &self.value)
            .append_pair(SET_BYPASS_COOKIE_PARAMETER, "true");
        url
    }
}

fn is_production_origin(origin: &OriginPolicy) -> bool {
    let Ok(url) = Url::parse(origin.as_str()) else {
        return false;
    };
    url.scheme().eq_ignore_ascii_case("https")
        && url.host_str().is_some_and(|host| {
            host.trim_end_matches('.')
                .eq_ignore_ascii_case(PRODUCTION_HOST)
        })
        && url.port_or_known_default() == Some(443)
}

impl Drop for ProtectionBypass {
    fn drop(&mut self) {
        self.value.zeroize();
    }
}

pub fn protected_entry_url(base: Url, bypass: Option<&ProtectionBypass>) -> Url {
    match bypass {
        Some(value) => value.add_entry_query(base),
        None => base,
    }
}

pub fn protection_cookie_from_redirect(
    status: StatusCode,
    response_url: &Url,
    headers: &HeaderMap,
    expected_launch: &Url,
    origin: &OriginPolicy,
) -> Result<Cookie<'static>, &'static str> {
    if status != StatusCode::TEMPORARY_REDIRECT || response_url != expected_launch {
        return Err("protection-cookie-response-invalid");
    }
    let mut locations = headers.get_all(LOCATION).iter();
    let location = locations
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or("protection-cookie-redirect-invalid")?;
    if locations.next().is_some() {
        return Err("protection-cookie-redirect-invalid");
    }
    let redirected = response_url
        .join(location)
        .map_err(|_| "protection-cookie-redirect-invalid")?;
    if &redirected != expected_launch || !origin.is_trusted_remote(&redirected) {
        return Err("protection-cookie-redirect-invalid");
    }

    let mut matching_cookie = None;
    for header in headers.get_all(SET_COOKIE) {
        let Ok(raw) = header.to_str() else {
            return Err("protection-cookie-invalid");
        };
        let Ok(cookie) = Cookie::parse(raw.to_owned()) else {
            return Err("protection-cookie-invalid");
        };
        if cookie.name() != BYPASS_COOKIE_NAME {
            continue;
        }
        if matching_cookie.is_some() {
            return Err("protection-cookie-invalid");
        }
        matching_cookie = Some(cookie.into_owned());
    }

    let host = Url::parse(origin.as_str())
        .ok()
        .and_then(|url| url.host_str().map(ToOwned::to_owned))
        .ok_or("protection-cookie-origin-invalid")?;
    let cookie = matching_cookie.ok_or("protection-cookie-missing")?;
    if cookie.value().is_empty()
        || cookie.value().len() > 4096
        || cookie
            .domain()
            .is_some_and(|domain| !domain.eq_ignore_ascii_case(&host))
        || cookie.path() != Some("/")
        || cookie.secure() != Some(true)
        || cookie.http_only() != Some(true)
        || cookie.same_site() != Some(SameSite::None)
    {
        return Err("protection-cookie-invalid");
    }

    Ok(
        Cookie::build((BYPASS_COOKIE_NAME, cookie.value().to_owned()))
            .domain(host)
            .path("/")
            .secure(true)
            .http_only(true)
            .same_site(SameSite::None)
            .build(),
    )
}

pub fn protection_cookie_matches(
    cookie: &Cookie<'_>,
    expected_value: &[u8],
    expected_host: &str,
) -> bool {
    cookie.name() == BYPASS_COOKIE_NAME
        && cookie.domain().is_some_and(|domain| {
            domain
                .trim_start_matches('.')
                .eq_ignore_ascii_case(expected_host)
        })
        && cookie.path() == Some("/")
        && cookie.secure() == Some(true)
        && cookie.http_only() == Some(true)
        && cookie.same_site() == Some(SameSite::None)
        && bool::from(expected_value.ct_eq(cookie.value().as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_exact_proof_secret_shape() {
        for value in [
            "A234567890bcdefghijklmnopqrstu_-",
            "0123456789abcdefghijklmnopqrstuv",
        ] {
            assert!(ProtectionBypass::parse(value.into()).is_ok());
        }

        for value in [
            "",
            "short",
            "A234567890bcdefghijklmnopqrstu_ ",
            "A234567890bcdefghijklmnopqrstu_!",
            "A234567890bcdefghijklmnopqrstu_é",
            "A234567890bcdefghijklmnopqrstu_-x",
        ] {
            assert!(ProtectionBypass::parse(value.into()).is_err());
        }
    }

    #[test]
    fn absent_value_keeps_production_and_proof_behavior_unchanged() {
        for origin in ["https://skitza.app", "https://proof.example"] {
            let origin = OriginPolicy::parse(origin).unwrap();
            assert!(ProtectionBypass::for_origin(&origin, None)
                .unwrap()
                .is_none());
        }
    }

    #[test]
    fn dns_equivalent_production_origins_reject_even_a_valid_value() {
        for raw_origin in [
            "https://skitza.app",
            "https://skitza.app.",
            "https://SKITZA.APP",
            "https://skitza.app:443",
        ] {
            let origin = OriginPolicy::parse(raw_origin).unwrap();
            match ProtectionBypass::for_origin(&origin, Some("A".repeat(32))) {
                Err(error) => assert_eq!(error, "protection-bypass-production-forbidden"),
                Ok(_) => panic!("production origin accepted a protection bypass: {raw_origin}"),
            }
        }
    }

    #[test]
    fn exact_vercel_proof_origin_still_accepts_a_valid_value() {
        let origin = OriginPolicy::parse("https://skitza-desktop-gate1-proof.vercel.app").unwrap();
        assert!(ProtectionBypass::for_origin(&origin, Some("A".repeat(32)))
            .unwrap()
            .is_some());
    }

    #[test]
    fn native_header_is_exact_and_marked_sensitive() {
        let bypass = ProtectionBypass::parse("A".repeat(32)).unwrap();
        let headers = bypass.default_headers();
        let value = headers.get(BYPASS_PARAMETER).unwrap();

        assert_eq!(value.as_bytes(), "A".repeat(32).as_bytes());
        assert!(value.is_sensitive());
        assert_eq!(headers.len(), 1);
        assert!(!format!("{headers:?}").contains(&"A".repeat(32)));
    }

    #[test]
    fn cookie_seed_request_adds_only_the_documented_non_secret_header() {
        let bypass = ProtectionBypass::parse("A".repeat(32)).unwrap();
        let client = reqwest::Client::new();
        let request = bypass
            .configure_cookie_request(client.get("https://proof.example/launch"))
            .build()
            .unwrap();

        assert_eq!(
            request.headers().get(SET_BYPASS_COOKIE_PARAMETER).unwrap(),
            "samesitenone"
        );
        assert_eq!(request.headers().len(), 1);
        assert_eq!(request.url().as_str(), "https://proof.example/launch");
    }

    #[test]
    fn protected_entry_query_keeps_the_exact_origin_and_sets_cookie() {
        let base = Url::parse("https://proof.example/launch").unwrap();
        assert_eq!(protected_entry_url(base.clone(), None), base);

        let bypass = ProtectionBypass::parse("z".repeat(32)).unwrap();
        let launch = protected_entry_url(base, Some(&bypass));
        let pairs: Vec<_> = launch.query_pairs().into_owned().collect();

        assert_eq!(
            launch.origin().ascii_serialization(),
            "https://proof.example"
        );
        assert_eq!(launch.path(), "/launch");
        assert_eq!(
            pairs,
            vec![
                (BYPASS_PARAMETER.into(), "z".repeat(32)),
                (SET_BYPASS_COOKIE_PARAMETER.into(), "true".into()),
            ]
        );
    }

    #[test]
    fn converts_only_the_exact_protected_redirect_cookie_to_a_session_cookie() {
        let origin = OriginPolicy::parse("https://proof.example").unwrap();
        let expected_launch = Url::parse("https://proof.example/launch").unwrap();
        let response_url = expected_launch.clone();
        let mut headers = HeaderMap::new();
        headers.insert(LOCATION, HeaderValue::from_static("/launch"));
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static(
                "_vercel_jwt=proof.jwt.value; Max-Age=604800; Path=/; Secure; HttpOnly; SameSite=None",
            ),
        );

        let cookie = protection_cookie_from_redirect(
            StatusCode::TEMPORARY_REDIRECT,
            &response_url,
            &headers,
            &expected_launch,
            &origin,
        )
        .unwrap();

        assert_eq!(cookie.name(), BYPASS_COOKIE_NAME);
        assert_eq!(cookie.value(), "proof.jwt.value");
        assert_eq!(cookie.domain(), Some("proof.example"));
        assert_eq!(cookie.path(), Some("/"));
        assert_eq!(cookie.secure(), Some(true));
        assert_eq!(cookie.http_only(), Some(true));
        assert_eq!(cookie.same_site(), Some(SameSite::None));
        assert!(cookie.max_age().is_none());
        assert!(cookie.expires().is_none());
    }

    #[test]
    fn rejects_missing_insecure_duplicate_or_cross_origin_protection_cookies() {
        let origin = OriginPolicy::parse("https://proof.example").unwrap();
        let expected_launch = Url::parse("https://proof.example/launch").unwrap();
        let response_url = expected_launch.clone();

        let mut missing = HeaderMap::new();
        missing.insert(LOCATION, HeaderValue::from_static("/launch"));
        assert!(protection_cookie_from_redirect(
            StatusCode::TEMPORARY_REDIRECT,
            &response_url,
            &missing,
            &expected_launch,
            &origin,
        )
        .is_err());

        let mut duplicate_location = HeaderMap::new();
        duplicate_location.append(LOCATION, HeaderValue::from_static("/launch"));
        duplicate_location.append(LOCATION, HeaderValue::from_static("/launch"));
        duplicate_location.insert(
            SET_COOKIE,
            HeaderValue::from_static("_vercel_jwt=value; Path=/; Secure; HttpOnly; SameSite=None"),
        );
        assert!(protection_cookie_from_redirect(
            StatusCode::TEMPORARY_REDIRECT,
            &response_url,
            &duplicate_location,
            &expected_launch,
            &origin,
        )
        .is_err());

        let mut insecure = missing.clone();
        insecure.insert(
            SET_COOKIE,
            HeaderValue::from_static("_vercel_jwt=value; Path=/; HttpOnly; SameSite=None"),
        );
        assert!(protection_cookie_from_redirect(
            StatusCode::TEMPORARY_REDIRECT,
            &response_url,
            &insecure,
            &expected_launch,
            &origin,
        )
        .is_err());

        let mut duplicate = missing.clone();
        for value in ["first", "second"] {
            duplicate.append(
                SET_COOKIE,
                HeaderValue::from_str(&format!(
                    "_vercel_jwt={value}; Path=/; Secure; HttpOnly; SameSite=None"
                ))
                .unwrap(),
            );
        }
        assert!(protection_cookie_from_redirect(
            StatusCode::TEMPORARY_REDIRECT,
            &response_url,
            &duplicate,
            &expected_launch,
            &origin,
        )
        .is_err());

        let mut wrong_domain = HeaderMap::new();
        wrong_domain.insert(LOCATION, HeaderValue::from_static("/launch"));
        wrong_domain.insert(
            SET_COOKIE,
            HeaderValue::from_static(
                "_vercel_jwt=value; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=None",
            ),
        );
        assert!(protection_cookie_from_redirect(
            StatusCode::TEMPORARY_REDIRECT,
            &response_url,
            &wrong_domain,
            &expected_launch,
            &origin,
        )
        .is_err());

        let mut cross_origin = missing;
        cross_origin.insert(
            LOCATION,
            HeaderValue::from_static("https://example.com/launch"),
        );
        cross_origin.insert(
            SET_COOKIE,
            HeaderValue::from_static("_vercel_jwt=value; Path=/; Secure; HttpOnly; SameSite=None"),
        );
        assert!(protection_cookie_from_redirect(
            StatusCode::TEMPORARY_REDIRECT,
            &response_url,
            &cross_origin,
            &expected_launch,
            &origin,
        )
        .is_err());
    }

    #[test]
    fn stored_cookie_match_requires_the_exact_value_and_security_scope() {
        let expected = b"proof.jwt.value";
        let valid = Cookie::build((BYPASS_COOKIE_NAME, "proof.jwt.value"))
            .domain("proof.example")
            .path("/")
            .secure(true)
            .http_only(true)
            .same_site(SameSite::None)
            .build();
        assert!(protection_cookie_matches(&valid, expected, "proof.example"));

        for invalid in [
            Cookie::build((BYPASS_COOKIE_NAME, "wrong"))
                .domain("proof.example")
                .path("/")
                .secure(true)
                .http_only(true)
                .same_site(SameSite::None)
                .build(),
            Cookie::build((BYPASS_COOKIE_NAME, "proof.jwt.value"))
                .domain("example.com")
                .path("/")
                .secure(true)
                .http_only(true)
                .same_site(SameSite::None)
                .build(),
            Cookie::build((BYPASS_COOKIE_NAME, "proof.jwt.value"))
                .domain("proof.example")
                .path("/other")
                .secure(true)
                .http_only(true)
                .same_site(SameSite::None)
                .build(),
            Cookie::build((BYPASS_COOKIE_NAME, "proof.jwt.value"))
                .domain("proof.example")
                .path("/")
                .secure(false)
                .http_only(true)
                .same_site(SameSite::None)
                .build(),
        ] {
            assert!(!protection_cookie_matches(
                &invalid,
                expected,
                "proof.example"
            ));
        }
    }
}
