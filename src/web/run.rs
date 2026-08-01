use std::collections::HashMap;

use dioxus::prelude::*;
use protocol_lib::core::{Amount, Instruction, MixedId, Protocol, units::{UnitIntermediate, physical::Volume}};

use crate::{Route, web::{backend_connection::get_protocol, middleware::get_chemical_name}};

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
fn run_definitions_editable(variables: Signal<HashMap<String, f64>>, protocol: Protocol) -> Element {
    rsx! {{
        let mut vec = protocol.definitions_variables.into_iter()
            .collect::<Vec<(String, UnitIntermediate)>>();
        vec.sort_by(|(ident, _), (ident_2, _)| ident.cmp(ident_2));
        vec.into_iter()
            .map(|(ident, value)| rsx! {
                div {
                    "Definition: {ident} = ",
                    input {
                        value: format!("{:?}", value.get_factor()),
                        oninput: move |e| {
                            let value_str = e.value();
                            match value_str.parse::<f64>() {
                                Ok(val) => {
                                    (*variables.write()).insert(ident.clone(), val);
                                    // info!("{:?}", *variables.read());
                                },
                                Err(_) => (),
                            }
                        }
                    },
                    {format!("  {:?}", value)}
                }
            })
    }}
}


#[component]
fn run_instruction_list(instruction_step_counter: Signal<usize>, protocol: Protocol) -> Element {
    let instruction_collection = protocol.instructions.clone().into_iter()
        .map(|instruction| {
            match instruction {
                Instruction::Autoclave { container_id, duration } =>
                    vec![format!("Autoclave {} for {}", format_container_id(&protocol, container_id), duration)],

                Instruction::Transfer { amount, from_id, into_container_id } =>
                    vec![
                        match amount {
                            Amount::Volume(volume) => format_pipette_take(volume),
                            Amount::Mass(_) => String::from("Use a spoon")
                        },
                        format!("Take {} from {} and put it into {}",
                            amount,
                            match from_id {
                                MixedId::Container(container_id) => format_container_id(&protocol, container_id),
                                MixedId::Material(material_id) => format_material_id(&protocol, material_id)
                            },
                            format_container_id(&protocol, into_container_id)
                        )
                    ],

                Instruction::Fill { amount, from_id, into_container_id } =>
                    vec![
                        match amount {
                            Amount::Volume(volume) => format_pipette_take(volume),
                            Amount::Mass(_) => String::from("Use a spoon")
                        },
                        format!("Fill {} using {} up to {}",
                            match from_id {
                                MixedId::Container(container_id) => format_container_id(&protocol, container_id),
                                MixedId::Material(material_id) => format_material_id(&protocol, material_id)
                            },
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

fn format_container_id(protocol: &Protocol, id: u64) -> Signal<String> {
    use_signal(|| {
        for (ident, container_id) in protocol.definitions_containers.iter() {
            if *container_id == id {
                return ident.clone()
            }
        }
        format!("#{}", id)
    })
}

fn format_material_id(protocol: &Protocol, id: u64) -> Signal<String> {
    for (ident, container_id) in protocol.definitions_containers.iter() {
        if *container_id == id {
            return use_signal(|| ident.clone())
        }
    }
    return get_chemical_name(id)
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
