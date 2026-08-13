use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    ClientBuilder,
};
use url::Url;
use zeroize::Zeroize;

use crate::origin::OriginPolicy;

const BYPASS_ENV: &str = "SKITZA_DESKTOP_PROTECTION_BYPASS";
const BYPASS_PARAMETER: &str = "x-vercel-protection-bypass";
const SET_BYPASS_COOKIE_PARAMETER: &str = "x-vercel-set-bypass-cookie";
const PRODUCTION_ORIGIN: &str = "https://skitza.app";

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
        if origin.as_str() == PRODUCTION_ORIGIN {
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
    fn production_origin_rejects_even_a_valid_value() {
        let origin = OriginPolicy::parse(PRODUCTION_ORIGIN).unwrap();
        match ProtectionBypass::for_origin(&origin, Some("A".repeat(32))) {
            Err(error) => assert_eq!(error, "protection-bypass-production-forbidden"),
            Ok(_) => panic!("production origin accepted a protection bypass"),
        }
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
}
