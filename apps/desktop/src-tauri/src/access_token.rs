use subtle::ConstantTimeEq;
use tauri::{
    webview::{
        cookie::{time::Duration as CookieDuration, time::OffsetDateTime, SameSite},
        Cookie,
    },
    WebviewWindow,
};
use url::Url;
use zeroize::{Zeroize, Zeroizing};

use crate::origin::OriginPolicy;

const ACCESS_TOKEN_ENV: &str = "SKITZA_DESKTOP_ACCESS_TOKEN";
const ACCESS_COOKIE_NAME: &str = "skitza-access";
const CANONICAL_PRODUCTION_ORIGIN: &str = "https://skitza.app";
const MAX_ACCESS_TOKEN_LENGTH: usize = 2_048;
const ACCESS_COOKIE_MAX_AGE: CookieDuration = CookieDuration::days(30);
const ACCESS_COOKIE_EXPIRY_TOLERANCE: CookieDuration = CookieDuration::minutes(1);

pub struct DesktopAccessToken {
    value: Zeroizing<String>,
}

impl DesktopAccessToken {
    pub fn from_env(
        origin: &OriginPolicy,
        protection_bypass_present: bool,
    ) -> Result<Option<Self>, &'static str> {
        let value = match std::env::var(ACCESS_TOKEN_ENV) {
            Ok(value) => Some(value),
            Err(std::env::VarError::NotPresent) => None,
            Err(std::env::VarError::NotUnicode(_)) => {
                std::env::remove_var(ACCESS_TOKEN_ENV);
                return Err("desktop-access-token-invalid");
            }
        };
        std::env::remove_var(ACCESS_TOKEN_ENV);
        Self::for_origin(origin, value, protection_bypass_present)
    }

    pub(crate) fn for_origin(
        origin: &OriginPolicy,
        mut value: Option<String>,
        protection_bypass_present: bool,
    ) -> Result<Option<Self>, &'static str> {
        let Some(mut value) = value.take() else {
            return Ok(None);
        };
        if protection_bypass_present {
            value.zeroize();
            return Err("desktop-access-token-protection-bypass-conflict");
        }
        if origin.as_str() != CANONICAL_PRODUCTION_ORIGIN {
            value.zeroize();
            return Err("desktop-access-token-origin-forbidden");
        }
        Self::parse(value).map(Some)
    }

    fn parse(mut value: String) -> Result<Self, &'static str> {
        let valid = !value.is_empty()
            && value.len() <= MAX_ACCESS_TOKEN_LENGTH
            && value.bytes().all(is_cookie_octet);
        if !valid {
            value.zeroize();
            return Err("desktop-access-token-invalid");
        }
        Ok(Self {
            value: Zeroizing::new(value),
        })
    }

    pub fn seed_cookie(
        &self,
        window: &WebviewWindow,
        launch_url: &Url,
        origin: &OriginPolicy,
    ) -> Result<(), &'static str> {
        validate_launch_url(launch_url, origin)?;
        let expected_host = launch_url
            .host_str()
            .ok_or("desktop-access-cookie-origin-invalid")?;

        let existing_cookies = window
            .cookies()
            .map_err(|_| "desktop-access-cookie-store-unavailable")?;
        let mut removed_existing = false;
        for existing in existing_cookies
            .into_iter()
            .filter(|existing| access_cookie_covers_host(existing, expected_host))
        {
            window
                .delete_cookie(existing)
                .map_err(|_| "desktop-access-cookie-store-unavailable")?;
            removed_existing = true;
        }
        if removed_existing
            && window
                .cookies()
                .map_err(|_| "desktop-access-cookie-store-unavailable")?
                .iter()
                .any(|existing| access_cookie_covers_host(existing, expected_host))
        {
            return Err("desktop-access-cookie-fence-failed");
        }

        let seeded_at = OffsetDateTime::now_utc();
        window
            .set_cookie(self.cookie(expected_host))
            .map_err(|_| "desktop-access-cookie-store-unavailable")?;
        let seeded_cookies = window
            .cookies()
            .map_err(|_| "desktop-access-cookie-store-unavailable")?;
        if !self.seeded_cookie_matches_expected(&seeded_cookies, expected_host, seeded_at) {
            return Err("desktop-access-cookie-verification-failed");
        }
        Ok(())
    }

    fn cookie<'a>(&'a self, host: &'a str) -> Cookie<'a> {
        Cookie::build((ACCESS_COOKIE_NAME, self.value.as_str()))
            .domain(host)
            .path("/")
            .secure(true)
            .http_only(true)
            .same_site(SameSite::Lax)
            .max_age(ACCESS_COOKIE_MAX_AGE)
            .build()
    }

    fn seeded_cookie_matches_expected(
        &self,
        cookies: &[Cookie<'_>],
        expected_host: &str,
        seeded_at: OffsetDateTime,
    ) -> bool {
        let mut matching = cookies
            .iter()
            .filter(|cookie| access_cookie_covers_host(cookie, expected_host));
        let stored = matching.next();
        stored.is_some()
            && matching.next().is_none()
            && stored.is_some_and(|cookie| self.cookie_matches(cookie, expected_host, seeded_at))
    }

    fn cookie_matches(
        &self,
        cookie: &Cookie<'_>,
        expected_host: &str,
        seeded_at: OffsetDateTime,
    ) -> bool {
        cookie.name() == ACCESS_COOKIE_NAME
            && cookie.domain() == Some(expected_host)
            && cookie.path() == Some("/")
            && cookie.secure() == Some(true)
            && cookie.http_only() == Some(true)
            && cookie.same_site() == Some(SameSite::Lax)
            && cookie_persistence_matches(cookie, seeded_at)
            && bool::from(self.value.as_bytes().ct_eq(cookie.value().as_bytes()))
    }
}

fn access_cookie_covers_host(cookie: &Cookie<'_>, expected_host: &str) -> bool {
    if cookie.name() != ACCESS_COOKIE_NAME {
        return false;
    }
    let Some(domain) = cookie.domain() else {
        return false;
    };
    let domain = domain.strip_prefix('.').unwrap_or(domain);
    domain.eq_ignore_ascii_case(expected_host)
        || expected_host
            .strip_suffix(domain)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

fn cookie_persistence_matches(cookie: &Cookie<'_>, seeded_at: OffsetDateTime) -> bool {
    let max_age = cookie.max_age();
    let expires = cookie.expires_datetime();
    if max_age.is_none() && expires.is_none() {
        return false;
    }
    if max_age.is_some_and(|age| age != ACCESS_COOKIE_MAX_AGE) {
        return false;
    }
    if let Some(expires) = expires {
        let expected = seeded_at + ACCESS_COOKIE_MAX_AGE;
        if expires < expected - ACCESS_COOKIE_EXPIRY_TOLERANCE
            || expires > expected + ACCESS_COOKIE_EXPIRY_TOLERANCE
        {
            return false;
        }
    }
    true
}

fn is_cookie_octet(byte: u8) -> bool {
    matches!(byte, 0x21 | 0x23..=0x2b | 0x2d..=0x3a | 0x3c..=0x5b | 0x5d..=0x7e)
}

fn validate_launch_url(launch_url: &Url, origin: &OriginPolicy) -> Result<(), &'static str> {
    if origin.as_str() != CANONICAL_PRODUCTION_ORIGIN
        || !origin.is_trusted_remote(launch_url)
        || launch_url.as_str() != "https://skitza.app/launch"
    {
        return Err("desktop-access-cookie-origin-invalid");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn production_origin() -> OriginPolicy {
        OriginPolicy::parse(CANONICAL_PRODUCTION_ORIGIN).unwrap()
    }

    #[test]
    fn accepts_bounded_cookie_safe_ascii_without_assuming_a_secret_shape() {
        for value in ["a", "token_with.mixed-ASCII:123", &"x".repeat(2_048)] {
            assert!(DesktopAccessToken::parse(value.to_owned()).is_ok());
        }

        for value in [
            "",
            "has space",
            "has;semicolon",
            "has,comma",
            "has\\backslash",
            "has\"quote",
            "non-ascii-é",
            &"x".repeat(2_049),
        ] {
            assert!(DesktopAccessToken::parse(value.to_owned()).is_err());
        }
    }

    #[test]
    fn absent_value_leaves_every_origin_and_bypass_mode_unchanged() {
        for origin in [
            production_origin(),
            OriginPolicy::parse("https://proof.example").unwrap(),
        ] {
            for protection_bypass_present in [false, true] {
                assert!(
                    DesktopAccessToken::for_origin(&origin, None, protection_bypass_present)
                        .unwrap()
                        .is_none()
                );
            }
        }
    }

    #[test]
    fn value_requires_canonical_production_and_rejects_bypass_combination() {
        assert!(DesktopAccessToken::for_origin(
            &production_origin(),
            Some("valid-token".into()),
            false
        )
        .unwrap()
        .is_some());

        for (origin, bypass) in [
            (OriginPolicy::parse("https://proof.example").unwrap(), false),
            (OriginPolicy::parse("https://skitza.app.").unwrap(), false),
            (
                OriginPolicy::parse("https://www.skitza.app").unwrap(),
                false,
            ),
            (production_origin(), true),
            (OriginPolicy::parse("https://proof.example").unwrap(), true),
        ] {
            assert!(
                DesktopAccessToken::for_origin(&origin, Some("valid-token".into()), bypass)
                    .is_err()
            );
        }
    }

    #[test]
    fn cookie_is_exact_secure_http_only_lax_thirty_day_scope() {
        let token = DesktopAccessToken::parse("valid-token".into()).unwrap();
        let cookie = token.cookie("skitza.app");
        let seeded_at = OffsetDateTime::now_utc();

        assert_eq!(cookie.name(), ACCESS_COOKIE_NAME);
        assert_eq!(cookie.domain(), Some("skitza.app"));
        assert_eq!(cookie.path(), Some("/"));
        assert_eq!(cookie.secure(), Some(true));
        assert_eq!(cookie.http_only(), Some(true));
        assert_eq!(cookie.same_site(), Some(SameSite::Lax));
        assert_eq!(cookie.max_age(), Some(ACCESS_COOKIE_MAX_AGE));
        assert!(cookie.expires_datetime().is_none());
        assert!(token.cookie_matches(&cookie, "skitza.app", seeded_at));
    }

    #[test]
    fn cookie_match_rejects_wrong_value_or_security_scope() {
        let token = DesktopAccessToken::parse("valid-token".into()).unwrap();
        let seeded_at = OffsetDateTime::now_utc();
        for invalid in [
            Cookie::build((ACCESS_COOKIE_NAME, "wrong"))
                .domain("skitza.app")
                .path("/")
                .secure(true)
                .http_only(true)
                .same_site(SameSite::Lax)
                .max_age(ACCESS_COOKIE_MAX_AGE)
                .build(),
            Cookie::build((ACCESS_COOKIE_NAME, "valid-token"))
                .domain("other.example")
                .path("/")
                .secure(true)
                .http_only(true)
                .same_site(SameSite::Lax)
                .max_age(ACCESS_COOKIE_MAX_AGE)
                .build(),
            Cookie::build((ACCESS_COOKIE_NAME, "valid-token"))
                .domain("skitza.app")
                .path("/other")
                .secure(true)
                .http_only(true)
                .same_site(SameSite::Lax)
                .max_age(ACCESS_COOKIE_MAX_AGE)
                .build(),
            Cookie::build((ACCESS_COOKIE_NAME, "valid-token"))
                .domain("skitza.app")
                .path("/")
                .secure(true)
                .http_only(true)
                .same_site(SameSite::None)
                .max_age(ACCESS_COOKIE_MAX_AGE)
                .build(),
        ] {
            assert!(!token.cookie_matches(&invalid, "skitza.app", seeded_at));
        }
    }

    #[test]
    fn cookie_match_accepts_platform_expiry_and_rejects_wrong_lifetime() {
        let token = DesktopAccessToken::parse("valid-token".into()).unwrap();
        let seeded_at = OffsetDateTime::now_utc();
        let platform_cookie = Cookie::build((ACCESS_COOKIE_NAME, "valid-token"))
            .domain("skitza.app")
            .path("/")
            .secure(true)
            .http_only(true)
            .same_site(SameSite::Lax)
            .expires(seeded_at + ACCESS_COOKIE_MAX_AGE)
            .build();
        assert!(token.cookie_matches(&platform_cookie, "skitza.app", seeded_at));

        for invalid in [
            Cookie::build((ACCESS_COOKIE_NAME, "valid-token"))
                .domain("skitza.app")
                .path("/")
                .secure(true)
                .http_only(true)
                .same_site(SameSite::Lax)
                .max_age(CookieDuration::days(29))
                .build(),
            Cookie::build((ACCESS_COOKIE_NAME, "valid-token"))
                .domain("skitza.app")
                .path("/")
                .secure(true)
                .http_only(true)
                .same_site(SameSite::Lax)
                .expires(seeded_at + CookieDuration::days(29))
                .build(),
        ] {
            assert!(!token.cookie_matches(&invalid, "skitza.app", seeded_at));
        }
    }

    #[test]
    fn broader_same_token_cookie_is_fenced_and_cannot_coexist() {
        let token = DesktopAccessToken::parse("valid-token".into()).unwrap();
        let seeded_at = OffsetDateTime::now_utc();
        let exact = token.cookie("skitza.app").into_owned();
        let broader = Cookie::build((ACCESS_COOKIE_NAME, "valid-token"))
            .domain(".skitza.app")
            .path("/")
            .secure(true)
            .http_only(true)
            .same_site(SameSite::Lax)
            .max_age(ACCESS_COOKIE_MAX_AGE)
            .build();

        assert!(access_cookie_covers_host(&exact, "skitza.app"));
        assert!(access_cookie_covers_host(&broader, "skitza.app"));
        assert!(!token.seeded_cookie_matches_expected(&[exact, broader], "skitza.app", seeded_at));
    }

    #[test]
    fn launch_fence_accepts_only_the_clean_canonical_url() {
        let origin = production_origin();
        assert!(
            validate_launch_url(&Url::parse("https://skitza.app/launch").unwrap(), &origin).is_ok()
        );

        for invalid in [
            "https://skitza.app/launch?t=secret",
            "https://skitza.app/launch#fragment",
            "https://skitza.app/other",
            "https://www.skitza.app/launch",
            "http://skitza.app/launch",
        ] {
            assert!(validate_launch_url(&Url::parse(invalid).unwrap(), &origin).is_err());
        }
    }
}
