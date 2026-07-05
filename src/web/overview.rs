use dioxus::prelude::*;
use dioxus_icons::lucide::{Check, Import, Pen, Plus, Trash, X};

use crate::{Route, web::backend_connection::get_protocol_names};

#[component]
pub fn Overview() -> Element {
    let delete_confirmation = use_signal(|| None);

    rsx! {
        div { class: "overview_panel",
            li {
                class: "overview_items",
                item_list { delete_confirmation },
                items_add {}
            },
            item_remove { delete_confirmation }
        }
    }
}

#[component]
fn item_list(delete_confirmation: Signal<Option<u64>>) -> Element {
    let item_names = get_protocol_names();

    rsx! {
        if let Some(val) = (*item_names.read_unchecked()).clone() {
            {val.into_iter().map(|(name, id)| {
                rsx! {
                    div {
                        class: "overview_item",
                        Link {
                            to: Route::Run { id: id },
                            span {
                                {name.clone()}
                            }
                        },
                        div {
                            class: "overview_item_icons",
                            button {
                                Pen {}
                            },
                            button {
                                onclick: move |_| *delete_confirmation.write() = Some(id),
                                Trash {},
                            }
                        }
                    }
                }
            })}
        }
    }
}

#[component]
fn items_add() -> Element {
    rsx! {
        button {
            onclick: move |ele| info!("{ele:?}"),
            Plus {},
        },
        button {
            onclick: move |ele| info!("{ele:?}"),
            Import {}
        }
    }
}

#[component]
fn item_remove(delete_confirmation: Signal<Option<u64>>) -> Element {
    if let Some(id) = *delete_confirmation.read() {
        rsx! {
            div {
                class: "confirmation_panel",
                onclick: move |_| *delete_confirmation.write() = None,
                span {
                    "Are you sure you want to remove element with id = {id}"
                }
                button {
                    onclick: move |_| info!("Deletion of {id} confirmed"),
                    Check {},
                },
                button {
                    onclick: move |_| info!("Deletion of {id} cancelled"),
                    X {}
                }
            }
        }
    } else {
        rsx! {}
    }
}
