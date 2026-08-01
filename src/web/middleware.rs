use tokio::sync::Mutex;
use dioxus::{core::spawn, document::eval, hooks::{use_effect, use_resource, use_signal}, logger::tracing::warn, signals::{Signal, WritableExt}};

use crate::PUB_CHEM_URL;

static API_LOCK: Mutex<()> = Mutex::const_new(());

pub fn get_chemical_name(id: u64) -> Signal<String> {
    let mut name = use_signal(|| "...".to_string());
    use_effect(move || {
        spawn(async move {
            let _permit = API_LOCK.lock().await;
            let time = eval(r#"await new Promise(resolve => setTimeout(resolve, 300));"#).await.unwrap_or_default().as_i64().unwrap_or(0);
            warn!("{time:?}");
            let response_opt = reqwest::Client::new()
                .get(format!("{}/pug/compound/cid/{}/property/Title/TXT", PUB_CHEM_URL, id))
                .send()
                .await;
            if let Ok(response) = response_opt {
                *name.write() = response.text().await.unwrap().trim().to_string();
            } else {
                *name.write() = "??".to_string();
            }
            drop(_permit);
        });
    });
    return name
}
