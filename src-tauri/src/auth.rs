use rand::RngCore;
use std::sync::{
    Arc,
    RwLock,
};

#[derive(Clone, Default)]
pub struct AuthState {
    token: Arc<RwLock<Option<String>>>,
    compatibility_mode: Arc<RwLock<bool>>,
}

impl AuthState {
    pub fn generate_token(
        &self,
    ) -> anyhow::Result<String> {
        let mut bytes = [0u8; 32];

        rand::rng().fill_bytes(&mut bytes);

        let token = hex::encode(bytes);

        let mut guard = self
            .token
            .write()
            .map_err(|_| {
                anyhow::anyhow!("auth state lock poisoned")
            })?;

        *guard = Some(token.clone());

        Ok(token)
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.token.write() {
            *guard = None;
        }

        if let Ok(mut guard) = self.compatibility_mode.write() {
            *guard = false;
        }
    }

    pub fn current_token(
        &self,
    ) -> Option<String> {
        self.token
            .read()
            .ok()
            .and_then(|guard| guard.clone())
    }

    pub fn enabled(&self) -> bool {
        self.current_token().is_some()
    }

    pub fn validate(
        &self,
        token: &str,
    ) -> bool {
        self.current_token()
            .map(|expected| expected == token)
            .unwrap_or(false)
    }

    pub fn compatibility_mode(&self) -> bool {
        self.compatibility_mode
            .read()
            .map(|guard| *guard)
            .unwrap_or(false)
    }

    pub fn set_compatibility_mode(
        &self,
        enabled: bool,
    ) -> anyhow::Result<()> {
        let mut guard = self
            .compatibility_mode
            .write()
            .map_err(|_| {
                anyhow::anyhow!("auth state lock poisoned")
            })?;

        *guard = enabled;

        Ok(())
    }
}
