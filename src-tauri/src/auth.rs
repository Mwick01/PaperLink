use rand::RngCore;
use std::sync::{
    Arc,
    RwLock,
};

#[derive(Clone, Default)]
pub struct AuthState {
    token: Arc<RwLock<Option<String>>>,
}

impl AuthState {
    pub fn generate_token(
        &self,
    ) -> anyhow::Result<String> {
        let mut bytes = [0u8; 32];

        rand::rng()
            .fill_bytes(&mut bytes);

        let token = hex::encode(bytes);

        let mut guard = self
            .token
            .write()
            .map_err(|_| {
                anyhow::anyhow!(
                    "auth state lock poisoned"
                )
            })?;

        *guard = Some(token.clone());

        Ok(token)
    }

    pub fn clear(&self) {
        if let Ok(mut guard) =
            self.token.write()
        {
            *guard = None;
        }
    }

    pub fn current_token(
        &self,
    ) -> Option<String> {
        self.token
            .read()
            .ok()
            .and_then(|guard| {
                guard.clone()
            })
    }

    pub fn enabled(&self) -> bool {
        self.current_token()
            .is_some()
    }

    pub fn validate(
        &self,
        token: &str,
    ) -> bool {
        self.current_token()
            .map(|expected| {
                expected == token
            })
            .unwrap_or(false)
    }
}