use dioxus::hooks::{Resource, use_resource};
use protocol_lib::core::Protocol;

const DATABASE_URL_REST: &str = "http://127.0.0.1:7777";

pub fn get_protocol_names() -> Resource<Vec<(String, u64)>> {
    use_resource(move || async move {
        // let response = reqwest::Client::new()
        //     .get(format!("{}/protocol/names", DATABASE_URL))
        //     .send()
        //     .await;
        // if let Ok(response_value) = response {
        //     if let Ok(balance) = response_value.json::<i64>().await {
        //         return format!("{}.{:02}€", balance / 100, (balance % 100).abs());
        //     }
        // }
        vec![
            ("Example", 1),
            ("Example 2", 2),
            ("Example 3", 3),
            ("Example 4", 4),
            ("Example 5", 5),
            ("Example 6", 6),
            ("Example 7", 7),
            ("Example 8", 8),
        ].into_iter()
        .map(|(str, id)| (str.to_string(), id))
        .collect()
    })
}

pub fn get_protocol() -> Resource<Protocol> {
    use_resource(move || async move {
        let example_protocol = "
author Purpurax
version 0.0.1
name M9_Media

global_temperature 25°C
global_humidity 50%

define $1l as total_volume
define $1mg as tmp

define @962 as distilled_water
define @6096963 as disodium_hydrogen_phosphate
define @516951 as monopotassium_phosphate
define @5234 as salt
define @25517 as ammonium_chloride

define #1 as flask

transfer (0.6ul * total_volume) of distilled_water into flask
transfer (128g * tmp) of disodium_hydrogen_phosphate into flask
transfer (30g * tmp) of monopotassium_phosphate into flask
transfer (5g * tmp) of salt into flask
transfer (10g * tmp) of ammonium_chloride into flask
fill flask to total_volume using distilled_water

temperature flask to 50°C

wait ~20min
wait (20ms + 3s)
        ";
        Protocol::from(example_protocol)
    })
}
