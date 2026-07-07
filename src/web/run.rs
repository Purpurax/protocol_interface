use std::collections::HashMap;

use dioxus::prelude::*;
use protocol_lib::core::{Amount, Instruction, Protocol, units::{Unit, physical::Volume}};

use crate::{Route, web::backend_connection::get_protocol};

#[component]
pub fn Run(id: u64) -> Element {
    let variables = use_signal(|| HashMap::new());
    let protocol_resource = get_protocol(id, variables);
    let mut instruction_step_counter = use_signal(|| 0);

    rsx! {
        div {
            class: "run_panel",
            Link {
                to: Route::Overview {},
                "Back"
            }
            if let Some(protocol) = protocol_resource.read_unchecked().clone() {
                div {
                    class: "run_protocol_description",
                    div {
                        "Name {protocol.name}"
                    },
                    div {
                        "Author {protocol.author}"
                    },
                    div {
                        "Version {protocol.version.0}.{protocol.version.1}.{protocol.version.2}"
                    },
                    div {
                        "Temperate {protocol.temperature}"
                    },
                    div {
                        "Humidity {protocol.humidity}"
                    },
                    run_definitions_editable { variables, protocol: protocol.clone() },
                    button {
                        onclick: move |_| *instruction_step_counter.write() += 1,
                        "STEP next"
                    }
                },
                run_instruction_list { instruction_step_counter, protocol }
            }
        }
    }
}

#[component]
fn run_definitions_editable(variables: Signal<HashMap<String, (u64, Unit)>>, protocol: Protocol) -> Element {
    rsx! {{
        let mut vec = protocol.definitions_variables.into_iter()
            .collect::<Vec<(String, (u64, fn(f64) -> Unit))>>();
        vec.sort_by(|(ident, _), (ident_2, _)| ident.cmp(ident_2));
        vec.into_iter()
            .map(|(ident, (value, conversion))| rsx! {
                div {
                    "Definition: {ident} = ",
                    input {
                        value: format!("{}", conversion(value as f64)),
                        oninput: move |e| {
                            let value_str = e.value();
                            match value_str.parse::<u64>() {
                                Ok(val) => {
                                    // (*variables.write()).insert(ident.clone(), (val, unit.clone()));
                                    // info!("{:?}", *variables.read());
                                },
                                Err(_) => (),
                            }
                        }
                    },
                    // {format!("  {:?}", unit)}
                }
            })
    }}
}


#[component]
fn run_instruction_list(instruction_step_counter: Signal<usize>, protocol: Protocol) -> Element {
    let instruction_collection = protocol.instructions.clone().into_iter()
        .map(|instruction| {
            match instruction {
                Instruction::Mix { amount, material_id, into_container_id } =>
                    vec![format!("--Mix-is-outdated--")],

                Instruction::Autoclave { container_id, time } =>
                    vec![format!("Autoclave {} for {}", format_container_id(&protocol, container_id), time)],

                Instruction::Transfer { amount, from_container_id, into_container_id } =>
                    vec![
                        match amount {
                            Amount::Volume(volume) => format_pipette_take(volume),
                            Amount::Mass(_) => String::from("Use a spoon")
                        },
                        format!("Take {} from {} and put it into {}",
                            amount,
                            format_container_id(&protocol, from_container_id),
                            format_container_id(&protocol, into_container_id)
                        )
                    ],

                Instruction::Fill { amount, from_container_id, into_container_id } =>
                    vec![
                        match amount {
                            Amount::Volume(volume) => format_pipette_take(volume),
                            Amount::Mass(_) => String::from("Use a spoon")
                        },
                        format!("Fill {} using {} up to {}",
                            format_container_id(&protocol, from_container_id),
                            format_container_id(&protocol, into_container_id),
                            amount
                        )
                    ],

                Instruction::TemperatureControl { container_id, temperature } =>
                    vec![format!("Incubate {} at {} ", format_container_id(&protocol, container_id), temperature)],

                Instruction::Wait(duration) =>
                    vec![format!("Wait for {} using a timer", duration)],

                Instruction::Unknown =>
                    vec![String::from("Unknown")],
            }
        })
        .flat_map(|instruction_collection| instruction_collection.into_iter())
        .collect::<Vec<String>>();
    let max_step = if instruction_collection.len() == 0 {
        1
    } else {
        instruction_collection.len()
    };
    let current_step = (*instruction_step_counter.read()) % max_step;

    rsx ! {
        {instruction_collection
            .into_iter()
            .enumerate()
            .map(|(idx, instruction_str)| {
                rsx! {
                    div {
                        class: {if current_step == idx {
                            "run_protocol_instruction_highlighted"
                        } else if current_step > idx {
                            "run_protocol_instruction_done"
                        } else {
                            "run_protocol_instruction"
                        }},
                        "STEP:     {instruction_str}"
                    }
                }
            })}
    }
}

fn format_container_id(protocol: &Protocol, id: u64) -> String {
    for (ident, container_id) in protocol.definitions_containers.iter() {
        if *container_id == id {
            return ident.clone()
        }
    }
    format!("@{}", id)
}

fn format_pipette_take(volume: Volume) -> String {
    if volume <= Volume(10.0) {
        "Use the small pipette"
    } else if volume <= Volume(200.0) {
        "Use the yellow pipette"
    } else if volume <= Volume(5000.0) {
        "Use the blue pipette"
    } else {
        "Use measure cup"
    }.to_string()
}
