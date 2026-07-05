use dioxus::prelude::*;
use protocol_lib::core::Instruction;

use crate::web::backend_connection::get_protocol;

#[component]
pub fn Run(id: u64) -> Element {
    let protocol_resource = get_protocol();
    let mut instruction_step_counter = use_signal(|| 0);

    rsx! {
        div {
            class: "run_panel",
            onclick: move |_| *instruction_step_counter.write() += 1,
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
                    }
                },
                {protocol.instructions.into_iter()
                    .map(|instruction| {
                        match instruction {
                            Instruction::Mix { amount, material_id, into_container_id } => format!("--Mix-is-outdated--"),
                            Instruction::Autoclave { container_id, time } => format!("Autoclave {} for {}", container_id, time),
                            Instruction::Transfer { amount, from_container_id, into_container_id } => format!("Take {} from {} and put it into {}", amount, from_container_id, into_container_id),
                            Instruction::Fill { amount, from_container_id, into_container_id } => format!("Fill {} using {} up to {}", from_container_id, into_container_id, amount),
                            Instruction::TemperatureControl { container_id, temperature } => format!("Incubate {} at {} ", container_id, temperature),
                            Instruction::Wait(duration) => format!("Wait for {}", duration),
                            Instruction::Unknown => String::from("Unknown"),
                        }
                    })
                    .enumerate()
                    .map(|(idx, instruction_str)| {
                        rsx! {
                            div {
                                class: {if *instruction_step_counter.read() == idx {
                                    "run_protocol_instruction_highlighted"
                                } else if *instruction_step_counter.read() > idx {
                                    "run_protocol_instruction_done"
                                } else {
                                    "run_protocol_instruction"
                                }},
                                "Instruction: {instruction_str}"
                            }
                        }
                    })}
            }
        }
    }
}
