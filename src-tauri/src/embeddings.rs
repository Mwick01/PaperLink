use anyhow::{anyhow, Result};
use fastembed::{
    EmbeddingModel,
    TextEmbedding,
    TextInitOptions,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

const MODEL_NAME: &str = "all-MiniLM-L6-v2-q";

#[derive(Clone)]
pub struct EmbeddingEngine {
    model: Arc<Mutex<Option<TextEmbedding>>>,
    cache_dir: PathBuf,
}

impl EmbeddingEngine {
    pub fn new(cache_dir: PathBuf) -> Self {
        Self {
            model: Arc::new(Mutex::new(None)),
            cache_dir,
        }
    }

    fn ensure_loaded<'a>(
        &'a self,
        guard: &'a mut Option<TextEmbedding>,
    ) -> Result<&'a mut TextEmbedding> {
        if guard.is_none() {
            std::fs::create_dir_all(&self.cache_dir)?;

            println!(
                "Loading embedding model into {:?}",
                self.cache_dir
            );

            let options = TextInitOptions::new(
                EmbeddingModel::AllMiniLML6V2Q,
            )
            .with_cache_dir(self.cache_dir.clone())
            .with_show_download_progress(true)
            .with_intra_threads(4);

            let model = TextEmbedding::try_new(options)?;

            *guard = Some(model);
        }

        guard
            .as_mut()
            .ok_or_else(|| anyhow!("embedding model failed to load"))
    }

    pub fn embed(&self, text: &str) -> Result<Vec<f32>> {
        let mut guard = self
            .model
            .lock()
            .map_err(|_| anyhow!("embedding model lock poisoned"))?;

        let model = self.ensure_loaded(&mut guard)?;

        let embeddings = model.embed(
            vec![text],
            None,
        )?;

        embeddings
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("model returned no embedding"))
    }

    pub fn embed_many(
        &self,
        texts: Vec<String>,
    ) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        let mut guard = self
            .model
            .lock()
            .map_err(|_| anyhow!("embedding model lock poisoned"))?;

        let model = self.ensure_loaded(&mut guard)?;

        Ok(model.embed(texts, None)?)
    }

    pub fn model_name(&self) -> &'static str {
        MODEL_NAME
    }
}