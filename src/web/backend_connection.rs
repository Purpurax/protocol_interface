use std::{collections::HashMap, hash::{DefaultHasher, Hash, Hasher}};

use dioxus::{hooks::{Resource, use_resource}, logger::tracing::warn, signals::Signal};
use protocol_lib::core::{Protocol, units::Unit};

use crate::PROTOCOL_FOLDER;

// const DATABASE_URL_REST: &str = "http://127.0.0.1:7777";

/// Currently using Fake instead of DB

pub fn get_protocol_names() -> Resource<Vec<(String, u64)>> {
    use_resource(move || async move {
        get_all_file_protocol_content(None)
            .await
            .into_iter()
            .map(|protocol| {
                let mut hasher = DefaultHasher::new();
                protocol.name.hash(&mut hasher);
                (protocol.name.clone(), hasher.finish())
            })
            .map(|(str, id)| (str.to_string(), id))
            .collect::<Vec<(String, u64)>>()

        // async move {
        //     let response = reqwest::Client::new()
        //         .get(format!("{}/protocol/names", DATABASE_URL))
        //         .send()
        //         .await;
        //     if let Ok(response_value) = response {
        //         if let Ok(balance) = response_value.json::<i64>().await {
        //             return format!("{}.{:02}€", balance / 100, (balance % 100).abs());
        //         }
        //     }
        // }
    })
}

pub fn get_protocol(id: u64, variables: Signal<HashMap<String, (u64, Unit)>>) -> Resource<Protocol> {
    use_resource(move || async move {
        let first = get_all_file_protocol_content(Some(variables))
            .await
            .into_iter()
            .filter(|protocol| {
                let mut hasher = DefaultHasher::new();
                protocol.name.hash(&mut hasher);
                id == hasher.finish()
            })
            .next();
        
        match first {
            Some(val) => val,
            None => Protocol::new("Invalid ID")
        }
    }) 
}

async fn get_all_file_protocol_content(variables_opt: Option<Signal<HashMap<String, (u64, Unit)>>>) -> Vec<Protocol> {
    let identity_function: fn(f64) -> f64 = |x| x;

    let mut contents = vec![];
    for file in PROTOCOL_FOLDER.into_iter() {
        if let Ok(bytes) = dioxus::asset_resolver::read_asset_bytes(&file).await {
            if let Ok(content) = std::str::from_utf8(&bytes) {
                contents.push(content.to_string());
            }
        }
    }

    contents.into_iter()
        .map(|content| {
            let mut protocol = Protocol::empty();
            // if let Some(variables) = variables_opt {
            //     protocol.definitions_variables = (*variables.read_unchecked()).clone().into_iter()
            //         .map(|(key, (value, unit))|
            //             (key, (value, identity_function.clone(), unit))
            //         )
            //         .collect::<HashMap<String, (u64, fn(f64) -> Unit)>>();
            // }
            let result = protocol.parse(&content);
            if let Err(err) = result {
                warn!(content);
                warn!(err);
            } else {
                warn!("WORKED {:?}", protocol);
            }
            protocol
        })
        .collect::<Vec<Protocol>>()
}
