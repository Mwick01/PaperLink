use regex::Regex;
use std::process::Stdio;
use std::sync::Arc;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::Mutex,
    time::{timeout, Duration},
};

#[derive(Clone, Default)]
pub struct TunnelManager {
    child: Arc<Mutex<Option<Child>>>,
}

impl TunnelManager {
    pub async fn start(&self, local_url: &str) -> anyhow::Result<String> {
        {
            let mut guard = self.child.lock().await;
            if let Some(child) = guard.as_mut() {
                if child.try_wait()?.is_none() {
                    anyhow::bail!("A tunnel is already running");
                }
                *guard = None;
            }
        }

        let mut child = Command::new("cloudflared")
            .arg("tunnel")
            .arg("--no-autoupdate")
            .arg("--url")
            .arg(local_url)
            .arg("--http-host-header")
            .arg("127.0.0.1:8765")
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| anyhow::anyhow!("Could not start cloudflared. Install it and ensure it is on PATH. {e}"))?;

        let stderr = child.stderr.take().ok_or_else(|| anyhow::anyhow!("Could not read cloudflared output"))?;
        let mut lines = BufReader::new(stderr).lines();
        let url_regex = Regex::new(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")?;

        let public_url = timeout(Duration::from_secs(25), async {
            while let Some(line) = lines.next_line().await? {
                if let Some(found) = url_regex.find(&line) {
                    return Ok::<String, std::io::Error>(found.as_str().to_string());
                }
            }
            Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "cloudflared exited before providing a URL"))
        }).await.map_err(|_| anyhow::anyhow!("Timed out waiting for Cloudflare tunnel URL"))??;

        tokio::spawn(async move {
            while let Ok(Some(_)) = lines.next_line().await {}
        });

        *self.child.lock().await = Some(child);
        Ok(public_url)
    }

    pub async fn stop(&self) -> anyhow::Result<()> {
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        Ok(())
    }
}
