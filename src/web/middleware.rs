use dioxus::{hooks::use_resource, logger::tracing::warn};

use crate::PUB_CHEM_URL;

pub fn get_chemical_name(id: u64) -> String {
    // let _ = use_resource(move ||
    //     async move {
    //         let response_opt = reqwest::Client::new()
    //             .get(format!("{}/pug/compound/cid/{}/property/Title/TXT", PUB_CHEM_URL, id))
    //             .send()
    //             .await;
    //         if let Ok(response) = response_opt {
    //             warn!("{:?}", response.text().await.unwrap());
    //         } else {
    //             warn!("No response");
    //         }
    //         // let response_opt = use_signal(|| None);
    //         // let mut debounce = use_debounce(Duration::from_millis(300), |_| async {
    //         //     *response_opt.write() =  Some(reqwest::Client::new()
    //         //         .get(format!("{}/pug/compound/cid/{}/property/Title/TXT", PUB_CHEM_URL, id))
    //         //         .send()
    //         //         .await);
    //         // });
    //         // debounce.action(());
    //         // if let Some(response) = *response_opt.read() {
    //         //     if let Ok(response_value) = response {
    //         //         warn!("{}", response_value.text().await.unwrap());
    //         //     }
    //         // }
    //     }
    // );
    return format!("--{}--", id)
}
