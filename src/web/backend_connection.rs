use std::{collections::HashMap, hash::{DefaultHasher, Hash, Hasher}};

use dioxus::{hooks::{Resource, use_resource}, logger::tracing::info, signals::{ReadableExt, Signal}};

use crate::PROTOCOL_FOLDER;

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
    })
}

pub fn get_protocol(id: u64, variables: Signal<HashMap<String, f64>>) -> Resource<Protocol> {
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

async fn get_all_file_protocol_content(variables_opt: Option<Signal<HashMap<String, f64>>>) -> Vec<Protocol> {
    let mut contents = vec![];
    for file in PROTOCOL_FOLDER.into_iter() {
        if let Ok(bytes) = dioxus::asset_resolver::read_asset_bytes(&file).await {
            if let Ok(content) = std::str::from_utf8(&bytes) {
                contents.push(content.to_string());
            }
        }
    }
    info!("{:?}", contents.len());

    contents.into_iter()
        .map(|content| {
            let mut protocol = Protocol::empty();
            if let Some(variables) = variables_opt {
                protocol.definitions_variables = (*variables.read_unchecked()).clone().into_iter()
                    .map(|(key, value)|
                        (key, UnitIntermediate::new_factor(value))
                    )
                    .collect::<HashMap<String, UnitIntermediate>>();
            }
            let _ = protocol.parse(&content);
            protocol
        })
        .collect::<Vec<Protocol>>()
}
