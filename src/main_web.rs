use dioxus::prelude::*;
use web::overview::Overview;
use web::run::Run;

pub mod web;

#[rustfmt::skip]
#[derive(Clone, Debug, PartialEq, Routable)]
pub enum Route {
    #[layout(Wrapper)]
        #[route("/")]
        Overview {},

        #[route("/run/:id")]
        Run { id: u64 },
}

fn main() {
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    rsx! {
        document::Stylesheet { href: asset!("/web_assets/style.css") },
        Router::<Route> {}
    }
}

#[component]
fn Wrapper() -> Element {
    rsx! {
        // Sidebar {},
        div {
            class: "main-content",
            Outlet::<Route> {}
        }
    }
}
